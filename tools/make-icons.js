// Renders tools/icon.svg to the PNG icons the app ships. Run: NODE_PATH=../../commitment-board/tools/node_modules node make-icons.js
var fs = require('fs'), path = require('path'), chromium = require('playwright').chromium;
(async function () {
  var svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  var b = await chromium.launch();
  for (var s of [180, 192, 512]) {
    var pg = await b.newPage({ viewport: { width: s, height: s } });
    await pg.setContent('<html><body style="margin:0">' + svg.replace('width="512" height="512"', 'width="' + s + '" height="' + s + '"') + '</body></html>');
    await pg.screenshot({ path: path.join(__dirname, '..', 'icon-' + s + '.png') });
    await pg.close();
  }
  await b.close(); console.log('icons written');
})();
