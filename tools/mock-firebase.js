/* Test stand-in for the Firebase SDK (after commitment-board/tools/mock-firebase.js), with child() and an
   offline switch. Every database call goes to the test harness, which applies the real rules. */
(function () {
  var listeners = [], online = true;
  function call(kind, path, value) { return window.__rtdb(window.__uid, kind, path, value === undefined ? null : value); }
  function norm(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
  function snap(path, v) { return { val: function () { return v; }, exists: function () { return v !== null && v !== undefined; }, key: path.split('/').pop() }; }
  function denied() { var e = new Error('PERMISSION_DENIED'); e.code = 'PERMISSION_DENIED'; return e; }
  function fire(L) {
    if (L.dead) { return; }
    if (L.path === '.info/connected') { if (L.last !== online) { L.last = online; L.cb(snap(L.path, online)); } return; }
    call('get', L.path).then(function (r) {
      var j;
      if (!r.ok) { L.dead = true; if (L.err) { L.err(denied()); } return; }
      j = JSON.stringify(r.value);
      if (j !== L.last) { L.last = j; L.cb(snap(L.path, r.value)); }
    });
  }
  function Ref(path) { this.path = norm(path); }
  Ref.prototype.child = function (c) { return new Ref(this.path + '/' + c); };
  Ref.prototype.set = function (v) { return call('set', this.path, v).then(function (r) { if (!r.ok) { throw denied(); } }); };
  Ref.prototype.update = function (v) { return call('update', this.path, v).then(function (r) { if (!r.ok) { throw denied(); } }); };
  Ref.prototype.remove = function () { return this.set(null); };
  Ref.prototype.once = function () { var p = this.path; return call('get', p).then(function (r) { if (!r.ok) { throw denied(); } return snap(p, r.value); }); };
  Ref.prototype.on = function (ev, cb, err) { var L = { path: this.path, cb: cb, err: err }; listeners.push(L); fire(L); return cb; };
  window.__rtdbChanged = function () { listeners.forEach(fire); };
  window.__setOnline = function (b) { online = b; listeners.forEach(fire); };
  window.firebase = {
    initializeApp: function () {},
    auth: function () { return { signInAnonymously: function () { return Promise.resolve({ user: { uid: window.__uid } }); } }; },
    database: function () { return { ref: function (p) { return new Ref(p); } }; }
  };
})();
