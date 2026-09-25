"use strict";

const CACHE = "vune-web-v14-dark-card-overflow";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./enhancements.css",
  "./corrections.css",
  "./batch-2026-09-25.css",
  "./screenshot-fixes.css",
  "./surgical-fixes-2026-09-25.css",
  "./app.js",
  "./corrections.js",
  "./batch-2026-09-25.js",
  "./subscription-switch-fix.js",
  "./surgical-fixes-2026-09-25.js",
  "./privacy.html",
  "./terms.html",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

async function textFromNetworkOrCache(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Network response failed");
    const copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(url, copy); });
    return response.text();
  } catch (error) {
    const cached = await caches.match(url);
    if (!cached) throw error;
    return cached.text();
  }
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname.endsWith("/app.js")) {
    event.respondWith(Promise.all([
      textFromNetworkOrCache(new URL("./app.js", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./corrections.js", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./batch-2026-09-25.js", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./subscription-switch-fix.js", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./surgical-fixes-2026-09-25.js", self.registration.scope).href)
    ]).then(function (parts) {
      return new Response(parts.join("\n\n"), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
    }));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.endsWith("/enhancements.css")) {
    event.respondWith(Promise.all([
      textFromNetworkOrCache(new URL("./enhancements.css", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./corrections.css", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./batch-2026-09-25.css", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./screenshot-fixes.css", self.registration.scope).href),
      textFromNetworkOrCache(new URL("./surgical-fixes-2026-09-25.css", self.registration.scope).href)
    ]).then(function (parts) {
      return new Response(parts.join("\n\n"), { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" } });
    }));
    return;
  }

  event.respondWith(
    fetch(event.request).then(function (response) {
      const copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
