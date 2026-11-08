// On Course service worker. Bump VERSION on every deploy that changes a cached file.
// No start_url in the manifest on purpose: Add to Home Screen keeps the ?j= link, and
// ignoreSearch below serves index.html for it, so the app also starts offline.
var VERSION = 'on-course-v2';
var SHELL = [
  './',
  'index.html',
  'manifest.json',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'firebase-app-compat.js',
  'firebase-auth-compat.js',
  'firebase-database-compat.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// App files come from the cache; everything else (Firebase traffic, Google Fonts) goes to the network.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) { return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
});
