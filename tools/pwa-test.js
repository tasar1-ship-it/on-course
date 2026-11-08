// Home-screen test (version 0.3): manifest and icons load, the offline worker caches the app,
// the app starts with no connection (also from a ?j= link), the home-screen hint and the old-device message.
// Run:  NODE_PATH=../../commitment-board/tools/node_modules node pwa-test.js   (Chromium: Playwright's WebKit has no service workers)
var http = require('http'), fs = require('fs'), path = require('path');
var chromium = require('playwright').chromium;
var SITE = path.join(__dirname, '..'), SHOTS = path.join(__dirname, 'shots');
var results = [];
function ok(label, cond, detail) { results.push({ label: label, ok: !!cond, detail: detail }); }
var TYPES = { html: 'text/html; charset=utf-8', js: 'application/javascript', json: 'application/json', png: 'image/png' };

(async function () {
  if (!fs.existsSync(SHOTS)) { fs.mkdirSync(SHOTS, { recursive: true }); }
  var server = http.createServer(function (req, res) {
    var f = req.url.split('?')[0]; if (f === '/') { f = '/index.html'; }
    var full = path.join(SITE, f);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[f.split('.').pop()] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var BASE = 'http://127.0.0.1:' + server.address().port + '/';
  var browser = await chromium.launch(), errs = [];

  /* 1. Manifest, icons and offline start */
  var ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  var pg = await ctx.newPage();
  pg.on('pageerror', function (e) { errs.push('pageerror ' + e.message); });
  await pg.goto(BASE); await pg.waitForSelector('.task');
  var man = await pg.evaluate(async function () { var r = await fetch(document.querySelector('link[rel=manifest]').href); return r.json(); });
  ok('manifest: standalone, named On Course, no start_url', man.display === 'standalone' && man.name === 'On Course' && !('start_url' in man));
  var icons = await pg.evaluate(async function () {
    var out = [], srcs = ['icon-180.png', 'icon-192.png', 'icon-512.png'];
    for (var i = 0; i < srcs.length; i++) { var r = await fetch(srcs[i]); out.push(r.status); }
    return out;
  });
  ok('all three icons load', icons.join() === '200,200,200', icons.join());
  ok('apple-touch-icon is set', (await pg.getAttribute('link[rel=apple-touch-icon]', 'href')) === 'icon-180.png');
  await pg.evaluate(function () { return navigator.serviceWorker.ready; });
  await pg.reload(); await pg.waitForSelector('.task');
  ok('offline worker controls the page', await pg.evaluate(function () { return !!navigator.serviceWorker.controller; }));
  var cached = await pg.evaluate(async function () { var c = await caches.open('on-course-v2'); return (await c.keys()).length; });
  ok('offline worker cached the 9 app files', cached === 9, cached);
  await ctx.setOffline(true);
  await pg.goto(BASE + '?j=someLinkCode'); await pg.waitForSelector('.task', { timeout: 5000 }).catch(function () {});
  ok('app starts with no connection, also from a ?j= link', (await pg.$$('.task')).length > 0);
  await ctx.setOffline(false);
  await ctx.close();

  /* 2. Home-screen hint on iPhone Safari (not yet on the home screen) */
  var ctx2 = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, serviceWorkers: 'block' });
  await ctx2.addInitScript('Object.defineProperty(navigator, "standalone", { value: false, configurable: true }); Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });');
  var p2 = await ctx2.newPage();
  p2.on('pageerror', function (e) { errs.push('pageerror ' + e.message); });
  await p2.goto(BASE); await p2.waitForSelector('.task');
  ok('home-screen hint shows in iPhone Safari', !!(await p2.$('#home-hint')));
  await p2.screenshot({ path: path.join(SHOTS, '4-iphone-home-hint.png') });
  await p2.click('[data-action="hide-hint"]'); await p2.reload(); await p2.waitForSelector('.task');
  ok('"Got it" hides the hint for good', !(await p2.$('#home-hint')));
  await ctx2.close();
  var ctx3 = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  await ctx3.addInitScript('Object.defineProperty(navigator, "standalone", { value: true, configurable: true }); Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });');
  var p3 = await ctx3.newPage(); await p3.goto(BASE); await p3.waitForSelector('.task');
  ok('no hint when opened from the home screen', !(await p3.$('#home-hint')));
  await ctx3.close();

  /* 3. A device too old for the app gets a message, not a blank page */
  var ctx4 = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  await ctx4.addInitScript('CSS.supports = function () { return false; };');
  var p4 = await ctx4.newPage(); await p4.goto(BASE); await p4.waitForSelector('.empty');
  ok('old device sees the update message', /needs iOS 16\.4/.test(await p4.textContent('#main')));
  await ctx4.close();

  /* 4. Voice dictation (version 0.4) */
  var ctx5 = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  await ctx5.addInitScript('delete window.webkitSpeechRecognition; delete window.SpeechRecognition;');
  var p5 = await ctx5.newPage(); p5.on('pageerror', function (e) { errs.push('pageerror ' + e.message); });
  await p5.goto(BASE); await p5.waitForSelector('.task');
  await p5.click('.fab'); await p5.click('#mic-btn');
  ok('dictation without speech recognition: points to the keyboard microphone and focuses the field',
    /microphone key on the keyboard/.test(await p5.textContent('#mic-hint')) && (await p5.evaluate(function () { return document.activeElement.id; })) === 'task-title');
  await ctx5.close();
  var ctx6 = await browser.newContext({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' });
  await ctx6.addInitScript('window.SpeechRecognition = function () { var s = this; window.__rec = s; this.start = function () { var w = ["return", "library", "book"], i = 0; var iv = setInterval(function () { i++; s.onresult({ results: [[{ transcript: w.slice(0, i).join(" ") }]] }); if (i >= w.length) { clearInterval(iv); setTimeout(function () { s.onend(); }, 150); } }, 120); }; this.stop = function () { s.onend(); }; };');
  var p6 = await ctx6.newPage(); p6.on('pageerror', function (e) { errs.push('pageerror ' + e.message); });
  await p6.goto(BASE); await p6.waitForSelector('.task');
  await p6.click('.fab'); await p6.click('#mic-btn');
  ok('dictation: the mic shows it is listening', (await p6.getAttribute('#mic-btn', 'aria-pressed')) === 'true' && /Listening/.test(await p6.textContent('#mic-hint')));
  await p6.waitForFunction(function () { return document.getElementById('mic-btn').getAttribute('aria-pressed') === 'false'; });
  ok('dictation: the spoken words fill the field, first letter capitalised', (await p6.inputValue('#task-title')) === 'Return library book', await p6.inputValue('#task-title'));
  ok('dictation: the listening note goes away afterwards', await p6.isHidden('#mic-hint'));
  await p6.click('label.opt[data-cat="other"]'); await p6.click('#task-form button[type=submit]');
  ok('dictation: the dictated task is saved', (await p6.$$eval('.t-title', function (a) { return a.map(function (e) { return e.textContent; }); })).indexOf('Return library book') >= 0);
  await ctx6.close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); server.close();
  var bad = results.filter(function (r) { return !r.ok; });
  results.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + (r.ok || r.detail === undefined ? '' : '  [' + r.detail + ']')); });
  console.log('\n' + (results.length - bad.length) + ' of ' + results.length + ' checks passed (chromium)');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
