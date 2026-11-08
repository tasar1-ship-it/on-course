// Two-device test of On Course sync (version 0.2): the real page in two browsers (iPhone and iPad sizes)
// against the real database rules, with a stand-in for the Firebase SDK and an offline switch.
// Run:  NODE_PATH=../../commitment-board/tools/node_modules ENGINE=webkit node e2e.js
// (borrows Playwright 1.63 and targaryen from commitment-board/tools; nothing is downloaded.)
var http = require('http'), fs = require('fs'), path = require('path');
var targaryen = require('targaryen');
var ENGINE = process.env.ENGINE || 'webkit';
var engine = require('playwright')[ENGINE];

var SITE = path.join(__dirname, '..');
var SHOTS = path.join(__dirname, 'shots');
var rules = JSON.parse(fs.readFileSync(path.join(SITE, 'database.rules.json'), 'utf8'));
var MOCK = fs.readFileSync(path.join(__dirname, 'mock-firebase.js'), 'utf8');
var db = targaryen.database(rules, {}, Date.now());
var pages = [], results = [], offline = {}, held = [];

function rtdbNow(uid, kind, p, value) {
  var actor = db.as({ uid: uid }), res;
  if (kind === 'get') { res = actor.read('/' + p); return res.allowed ? { ok: true, value: db.snapshot('/' + p).val() } : { ok: false }; }
  res = kind === 'update' ? actor.update('/' + p, value) : actor.write('/' + p, value);
  if (!res.allowed) { return { ok: false }; }
  db = res.newDatabase;
  pages.forEach(function (pg) { pg.evaluate(function () { if (window.__rtdbChanged) { window.__rtdbChanged(); } }).catch(function () {}); });
  return { ok: true };
}
// While a device is offline its calls wait, in order, and are answered when it comes back online.
function rtdb(uid, kind, p, value) {
  if (offline[uid]) { return new Promise(function (resolve) { held.push({ uid: uid, a: [uid, kind, p, value], resolve: resolve }); }); }
  return rtdbNow(uid, kind, p, value);
}
function ok(label, cond, detail) { results.push({ label: label, ok: !!cond, detail: detail }); }
function remote(key) { return db.snapshot('/oncourse/' + key).val() || {}; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn, ms) { var t = Date.now(); while (Date.now() - t < (ms || 5000)) { if (await fn()) { return true; } await wait(80); } return false; }

(async function () {
  if (!fs.existsSync(SHOTS)) { fs.mkdirSync(SHOTS, { recursive: true }); }
  var server = http.createServer(function (req, res) {
    var f = req.url.split('?')[0]; if (f === '/') { f = '/index.html'; }
    var full = path.join(SITE, f);
    if (!fs.existsSync(full)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.js$/.test(f) ? 'application/javascript' : 'application/json' });
    res.end(fs.readFileSync(full));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var BASE = 'http://127.0.0.1:' + server.address().port + '/';
  var browser = await engine.launch();
  var errs = [];
  async function device(uid, viewport) {
    var ctx = await browser.newContext({ viewport: viewport });
    await ctx.addInitScript('window.__uid = ' + JSON.stringify(uid) + ';');
    await ctx.addInitScript('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: function (t) { window.__clip = t; return Promise.resolve(); } } });');
    await ctx.exposeFunction('__rtdb', rtdb);
    await ctx.route('**/firebase-app-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: MOCK }); });
    await ctx.route('**/firebase-auth-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: '' }); });
    await ctx.route('**/firebase-database-compat.js', function (r) { r.fulfill({ contentType: 'application/javascript', body: '' }); });
    var pg = await ctx.newPage();
    pg.on('pageerror', function (e) { errs.push(uid + ' pageerror ' + e.message); });
    pg.on('console', function (m) { if (m.type() === 'error') { errs.push(uid + ' console ' + m.text()); } });
    pages.push(pg);
    return pg;
  }
  var state = function (pg) { return pg.getAttribute('#syncbtn', 'data-s'); };
  var titles = function (pg) { return pg.$$eval('.list-col .task .t-title', function (a) { return a.map(function (e) { return e.textContent; }); }); };
  var doneTitles = function (pg) { return pg.$$eval('.list-col .task.is-done .t-title', function (a) { return a.map(function (e) { return e.textContent; }).sort(); }); };
  async function goOffline(uid, pg) { offline[uid] = true; await pg.evaluate(function () { window.__setOnline(false); }); }
  async function goOnline(uid, pg) {
    offline[uid] = false;
    var mine = held.filter(function (h) { return h.uid === uid; }); held = held.filter(function (h) { return h.uid !== uid; });
    mine.forEach(function (h) { try { h.resolve(rtdbNow.apply(null, h.a)); } catch (e) {} });
    await pg.evaluate(function () { window.__setOnline(true); });
  }

  /* 1. iPhone opens the app: local only, example tasks */
  var A = await device('uA', { width: 375, height: 667 });
  await A.goto(BASE); await A.waitForSelector('.task');
  ok('iPhone starts as "not synced"', (await state(A)) === 'off');
  var exampleToday = await titles(A);
  ok('iPhone shows example tasks for today', exampleToday.length > 0, exampleToday.length);

  /* 2. Set up sync on the iPhone with pasted Firebase settings */
  await A.click('#syncbtn'); await A.waitForSelector('#cfg-text');
  await A.fill('#cfg-text', 'const firebaseConfig = {\n  apiKey: "AIzaTestKey",\n  authDomain: "on-course-test.firebaseapp.com",\n  databaseURL: "https://on-course-test-default-rtdb.europe-west1.firebasedatabase.app",\n  projectId: "on-course-test",\n  appId: "1:1:web:1"\n};');
  await A.click('[data-action="sync-start"]');
  ok('iPhone shows Synced after setup', await until(async function () { return (await state(A)) === 'ok'; }), await state(A));
  var key = await A.evaluate(function () { return localStorage.getItem('oncourse-key'); }); key = JSON.parse(key);
  ok('list key is 24 characters', key && key.length === 24, key);
  var nRemote = Object.keys(remote(key).tasks || {}).length;
  var nLocal = await A.evaluate(function () { return JSON.parse(localStorage.getItem('oncourse-v1')).tasks.length; });
  ok('all local tasks were uploaded', nRemote === nLocal && nRemote > 0, nRemote + ' / ' + nLocal);
  ok('address keeps the link code for Add to Home Screen', /\?j=[A-Za-z0-9_-]+$/.test(A.url()));
  await A.screenshot({ path: path.join(SHOTS, '1-iphone-sync-sheet.png') });
  var link = await A.inputValue('#join-link');
  await A.click('[data-action="sync-close"]');

  /* 3. iPad opens the link */
  var B = await device('uB', { width: 1032, height: 1376 });
  await B.goto(link.replace(/^https?:\/\/[^/]+\//, BASE));
  ok('iPad shows Synced after opening the link', await until(async function () { return (await state(B)) === 'ok'; }), await state(B));
  ok('iPad shows the same tasks today', JSON.stringify((await titles(B)).sort()) === JSON.stringify(exampleToday.slice().sort()));
  ok('iPad did not add its own examples twice', Object.keys(remote(key).tasks || {}).length === nRemote, Object.keys(remote(key).tasks || {}).length);
  ok('iPad shows the same ticks', JSON.stringify(await doneTitles(B)) === JSON.stringify(await doneTitles(A)));

  /* 4. Tick on the iPhone shows on the iPad */
  var first = await A.$eval('.list-col .task:not(.is-done) .t-title', function (e) { return e.textContent; });
  await A.click('.list-col .task:not(.is-done) .tick');
  ok('a tick on the iPhone reaches the iPad', await until(async function () { return (await doneTitles(B)).indexOf(first) >= 0; }), first);

  /* 5. Add on the iPad shows on the iPhone, then delete */
  await B.click('.fab'); await B.fill('#task-title', 'Return library book'); await B.click('#task-form button[type=submit]');
  ok('a task added on the iPad reaches the iPhone', await until(async function () { return (await titles(A)).indexOf('Return library book') >= 0; }));
  await B.click('.list-col .task:has-text("Return library book") .edit'); await B.click('#del-btn'); await B.click('#del-btn');
  ok('a task deleted on the iPad disappears on the iPhone', await until(async function () { return (await titles(A)).indexOf('Return library book') < 0; }));
  await B.screenshot({ path: path.join(SHOTS, '2-ipad-synced.png') });

  /* 6. Offline on the iPhone: tick, close and reopen the app, come back online */
  await goOffline('uA', A);
  var second = await A.$eval('.list-col .task:not(.is-done) .t-title', function (e) { return e.textContent; });
  await A.click('.list-col .task:not(.is-done) .tick');
  await A.click('#syncbtn');
  ok('offline: iPhone shows Offline with 1 change waiting', await until(async function () { return (await state(A)) === 'warn'; }) && /1 change will be sent/.test(await A.textContent('.sstate')), await A.textContent('.sstate'));
  await A.click('[data-action="sync-close"]');
  await wait(400);
  ok('offline: the iPad does not have the tick yet', (await doneTitles(B)).indexOf(second) < 0);
  await A.reload(); await A.waitForSelector('.task');
  ok('offline: after reopening, the tick is still shown on the iPhone', (await doneTitles(A)).indexOf(second) >= 0);
  ok('offline: after reopening, the change is still queued', (await A.evaluate(function () { return JSON.parse(localStorage.getItem('oncourse-pending')).length; })) === 1);
  await A.screenshot({ path: path.join(SHOTS, '3-iphone-offline.png') });
  await goOnline('uA', A);
  ok('back online: the queued tick reaches the iPad', await until(async function () { return (await doneTitles(B)).indexOf(second) >= 0; }), second);
  ok('back online: the iPhone shows Synced and the queue is empty', await until(async function () { return (await state(A)) === 'ok'; }) && (await A.evaluate(function () { return JSON.parse(localStorage.getItem('oncourse-pending')).length; })) === 0);

  /* 7. A third device joins by pasting the code; clearing examples on the iPad reaches everyone */
  var C = await device('uC', { width: 375, height: 667 });
  await C.goto(BASE); await C.waitForSelector('.task');
  await C.click('#syncbtn'); await C.fill('#join-code', link.split('?j=')[1]); await C.click('[data-action="sync-join"]');
  ok('pasting the code joins the same list', await until(async function () { return (await state(C)) === 'ok' && JSON.stringify(await doneTitles(C)) === JSON.stringify(await doneTitles(A)); }));
  await B.click('[data-action="clear-ex"]');
  ok('clearing examples on the iPad empties the list everywhere', await until(async function () { return Object.keys(remote(key).tasks || {}).length === 0 && (await A.$$('.list-col .task')).length === 0; }));

  /* 8. The rules */
  var probe = function (pg, kind, p, v) { return pg.evaluate(function (a) { var r = window.firebase.database().ref(a.p); var pr = a.kind === 'get' ? r.once('value') : r.set(a.v); return pr.then(function () { return 'ALLOWED'; }, function (e) { return e.code; }); }, { kind: kind, p: p, v: v }); };
  ok('rules: nobody can list all lists', (await probe(A, 'get', 'oncourse')) === 'PERMISSION_DENIED');
  ok('rules: a short key is refused', (await probe(A, 'set', 'oncourse/short/tasks/x', { title: 'x', cat: 'school' })) === 'PERMISSION_DENIED');
  ok('rules: a task without a title is refused', (await probe(A, 'set', 'oncourse/' + key + '/tasks/x', { cat: 'school' })) === 'PERMISSION_DENIED');
  ok('rules: a done mark must be true on a real date', (await probe(A, 'set', 'oncourse/' + key + '/done/x/yesterday', true)) === 'PERMISSION_DENIED');

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  var bad = results.filter(function (r) { return !r.ok; });
  results.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + (r.ok || r.detail === undefined ? '' : '  [' + r.detail + ']')); });
  console.log('\n' + (results.length - bad.length) + ' of ' + results.length + ' checks passed (' + ENGINE + ')');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
