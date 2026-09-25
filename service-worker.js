"use strict";

const CACHE = "vune-web-v27-consolidated-runtime";
const APP_SHELL = [
  "./",
  "./index.html",
  "./vune.css",
  "./vune-runtime.js",
  "./public-theme.js",
  "./privacy.html",
  "./terms.html",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE)
      .then(function(cache){ return cache.addAll(APP_SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(key){ return key !== CACHE; }).map(function(key){ return caches.delete(key); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request,{cache:"no-store"})
      .then(async function(response){
        if(response && response.ok){
          const copy = response.clone();
          try{
            const cache = await caches.open(CACHE);
            await cache.put(event.request,copy);
          }catch(error){}
        }
        return response;
      })
      .catch(async function(){
        const cached = await caches.match(event.request);
        if(cached) return cached;
        if(event.request.mode === "navigate") return caches.match("./index.html");
        return new Response("Offline resource unavailable",{status:503,statusText:"Offline"});
      })
  );
});
