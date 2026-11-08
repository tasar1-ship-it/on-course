// Records a 30-second "how to use On Course" tour of the real app at iPhone size (390 x 844, 2x).
// Frames are full-resolution screenshots taken continuously (about 38 a second, 780 x 1688);
// frames-to-mp4.swift turns them into an H.264 MP4. (Chromium's screencast only gives 390 x 844 frames.)
// Run:  NODE_PATH=../../commitment-board/tools/node_modules node demo-video.js <frames-folder>
var http = require('http'), fs = require('fs'), path = require('path');
var chromium = require('playwright').chromium;
var SITE = path.join(__dirname, '..');
var OUT = process.argv[2] || path.join(__dirname, 'video-frames');
var TYPES = { html: 'text/html; charset=utf-8', js: 'application/javascript', json: 'application/json', png: 'image/png' };
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var OVERLAY = `
(function () {
  var css = document.createElement('style');
  css.textContent = [
    '#main .banner{display:none!important}',
    '.fab{bottom:118px!important}',
    '#cap{position:fixed;left:14px;right:14px;bottom:22px;z-index:50;background:#102131;color:#fff;border-radius:18px;padding:14px 16px 15px;display:flex;gap:12px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .35s,transform .35s,top .35s,bottom .35s;font-family:Figtree,system-ui,sans-serif;pointer-events:none}',
    '#cap.top{bottom:auto;top:22px}',
    '#cap.off{opacity:0;transform:translateY(12px)}',
    '#cap .n{flex:none;width:34px;height:34px;border-radius:50%;background:#3EC4C0;color:#102131;display:grid;place-items:center;font:700 19px "Barlow Condensed",sans-serif}',
    '#cap .t{font-size:17px;font-weight:600;line-height:1.3}',
    '#tap{position:fixed;z-index:60;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(62,196,192,.35);border:3px solid #3EC4C0;pointer-events:none;opacity:0}',
    '#tap.go{animation:tap .7s ease-out}',
    '@keyframes tap{0%{opacity:1;transform:scale(.5)}60%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.25)}}',
    '.hl{outline:3px solid #3EC4C0!important;outline-offset:3px;transition:outline-color .3s}',
    '#card{position:fixed;inset:0;z-index:70;background:#102131;color:#fff;display:grid;place-content:center;justify-items:center;gap:18px;text-align:center;padding:30px;transition:opacity .5s;font-family:Figtree,system-ui,sans-serif}',
    '#card.off{opacity:0;pointer-events:none}',
    '#card img{width:120px;height:120px;border-radius:27px}',
    '#card h1{font:700 52px/1 "Barlow Condensed",sans-serif;letter-spacing:.02em;text-transform:uppercase;margin:0}',
    '#card p{font-size:20px;line-height:1.4;margin:0;color:#C9D6E2;max-width:290px}',
    '#card p b{color:#fff}'
  ].join('');
  document.head.appendChild(css);
  var cap = document.createElement('div'); cap.id = 'cap'; cap.className = 'off'; cap.innerHTML = '<span class="n"></span><span class="t"></span>'; document.body.appendChild(cap);
  var tap = document.createElement('div'); tap.id = 'tap'; document.body.appendChild(tap);
  var card = document.createElement('div'); card.id = 'card'; document.body.appendChild(card);
  window.demo = {
    caption: function (n, t) {
      cap.classList.add('off');
      setTimeout(function () { cap.querySelector('.n').textContent = n; cap.querySelector('.t').textContent = t; cap.classList.remove('off'); }, n === 1 ? 0 : 300);
    },
    hideCaption: function () { cap.classList.add('off'); },
    top: function (on) { cap.classList.toggle('top', on); },
    tap: function (x, y) { tap.style.left = x + 'px'; tap.style.top = y + 'px'; tap.classList.remove('go'); void tap.offsetWidth; tap.classList.add('go'); },
    card: function (html) { card.innerHTML = html; card.classList.remove('off'); },
    hideCard: function () { card.classList.add('off'); }
  };
})();`;

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  var server = http.createServer(function (req, res) {
    var f = req.url.split('?')[0]; if (f === '/') { f = '/index.html'; }
    var full = path.join(SITE, f);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[f.split('.').pop()] || 'application/octet-stream' }); res.end(fs.readFileSync(full));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var BASE = 'http://127.0.0.1:' + server.address().port + '/';
  var browser = await chromium.launch();
  var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  // Stand-in speech recogniser for the video: "hears" the words one by one, as on a phone.
  await ctx.addInitScript('window.SpeechRecognition = function () { var s = this; this.start = function () { var w = ["return", "library", "book"], i = 0; var iv = setInterval(function () { i++; s.onresult({ results: [[{ transcript: w.slice(0, i).join(" ") }]] }); if (i >= w.length) { clearInterval(iv); setTimeout(function () { s.onend(); }, 500); } }, 420); }; this.stop = function () { s.onend(); }; };');
  var pg = await ctx.newPage();
  await pg.goto(BASE); await pg.waitForSelector('.task'); await pg.evaluate(function () { return document.fonts.ready; });
  await pg.evaluate(OVERLAY);
  await pg.evaluate(function () { demo.card('<img src="icon-512.png" alt=""><h1>On Course</h1><p>How to use it,<br>in 30 seconds</p>'); });
  await wait(600);

  // Continuous full-resolution screenshots with their capture time; resampled to 30 fps afterwards.
  var cdp = await ctx.newCDPSession(pg), frames = [], n = 0, capturing = true;
  var t0 = Date.now() / 1000;
  var loop = (async function () {
    while (capturing) {
      // The clip is in page coordinates, so it follows the scroll position.
      var lm = await cdp.send('Page.getLayoutMetrics'), vv = lm.cssVisualViewport;
      var r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { x: vv.pageX, y: vv.pageY, width: 390, height: 844, scale: 2 } });
      var file = path.join(OUT, 'f' + String(n++).padStart(5, '0') + '.jpg');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      frames.push({ file: file, t: Date.now() / 1000 });
    }
  })();

  async function tapOn(sel) {
    var box = await pg.locator(sel).first().boundingBox();
    await pg.evaluate(function (b) { demo.tap(b.x + b.width / 2, b.y + b.height / 2); }, box);
    await wait(180);
    await pg.locator(sel).first().click();
  }
  async function smoothScroll(y, ms) {
    await pg.evaluate(function (a) {
      var from = window.scrollY, to = a.y, start = performance.now();
      return new Promise(function (res) { (function step(now) { var p = Math.min(1, (now - start) / a.ms); var e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; window.scrollTo(0, from + (to - from) * e); if (p < 1) { requestAnimationFrame(step); } else { res(); } })(start); });
    }, { y: y, ms: ms });
  }
  var at = async function (sec) { var left = t0 + sec - Date.now() / 1000; if (left > 0) { await wait(left * 1000); } };

  /* 0-2.8 s: title card */
  await at(2.8); await pg.evaluate(function () { demo.hideCard(); });

  /* 1: today */
  await at(3.2);
  await pg.evaluate(function () { demo.caption(1, 'Today shows what’s due and how far you are.'); document.getElementById('pcard').classList.add('hl'); });
  await at(7.4); await pg.evaluate(function () { document.getElementById('pcard').classList.remove('hl'); });

  /* 2: tick tasks */
  await pg.evaluate(function () { demo.caption(2, 'Tap a task when it’s done. The bars fill up.'); });
  var listY = await pg.evaluate(function () { return document.querySelector('.filters').getBoundingClientRect().top + window.scrollY - 230; });
  await smoothScroll(listY, 900);
  await at(9.0); await tapOn('.list-col .task:not(.is-done) .tick');
  await at(10.6); await tapOn('.list-col .task:not(.is-done) .tick');
  await at(12.0); await smoothScroll(0, 700);

  /* 3: add a task */
  await at(12.9);
  await pg.evaluate(function () { demo.caption(3, 'Add a task: type it, or tap the mic and say it.'); demo.top(true); });
  await at(13.6); await tapOn('.fab');
  await at(14.5); await tapOn('#mic-btn');
  await at(16.4); await tapOn('label.opt[data-cat="other"]');
  await at(17.3); await tapOn('#task-form button[type=submit]');
  await at(17.9);
  var newY = await pg.evaluate(function () { var t = Array.prototype.find.call(document.querySelectorAll('.t-title'), function (e) { return e.textContent === 'Return library book'; }); var tr = t.closest('.task'); tr.classList.add('hl'); return tr.getBoundingClientRect().top + window.scrollY - 300; });
  await pg.evaluate(function () { demo.top(false); });
  await smoothScroll(newY, 800);

  /* 4: plan ahead */
  await at(19.8);
  await smoothScroll(0, 600);
  await pg.evaluate(function () { demo.caption(4, 'Use the arrow and tap a day to plan ahead.'); });
  await at(20.8); await tapOn('[data-action="next"]');
  await at(21.9); await tapOn('.dchip >> nth=0');
  await at(23.2); await tapOn('[data-action="today"]');

  /* 5: week */
  await at(24.0);
  await pg.evaluate(function () { demo.caption(5, 'Week shows every day at once.'); });
  await at(24.6); await tapOn('[data-action="view"][data-view="week"]');
  await at(25.4); await smoothScroll(420, 1500);

  /* end card */
  await at(27.4);
  await pg.evaluate(function () { demo.hideCaption(); demo.card('<img src="icon-512.png" alt=""><h1>On Course</h1><p>Put it on your Home Screen:<br><b>Share › Add to Home Screen</b></p><p>The cloud button keeps your iPhone and iPad in step.</p>'); });
  await at(30.6);

  capturing = false; await loop;
  await browser.close(); server.close();

  // Resample to 30 fps: each output frame shows the newest captured frame at that moment.
  var start = t0, end = t0 + 30.6, fps = 30, list = [], j = 0;
  for (var k = 0; start + k / fps <= end; k++) {
    var tt = start + k / fps;
    while (j + 1 < frames.length && frames[j + 1].t <= tt) { j++; }
    if (list.length && list[list.length - 1].file === frames[j].file) { list[list.length - 1].count++; } else { list.push({ file: frames[j].file, count: 1 }); }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ fps: fps, frames: list }));
  console.log('captured', frames.length, 'frames over', (frames[frames.length - 1].t - start).toFixed(1), 's; output', list.reduce(function (a, b) { return a + b.count; }, 0), 'frames at 30 fps');
})().catch(function (e) { console.error(e); process.exit(2); });
