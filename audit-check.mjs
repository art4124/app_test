import fs from "node:fs";

function read(path){ return fs.readFileSync(path,"utf8"); }
function assert(condition,message){
  if(!condition){
    console.error("AUDIT FAIL:",message);
    process.exitCode=1;
  }
}

const index=read("index.html");
const runtime=read("vune-runtime.js");
const css=read("vune.css");
const sw=read("service-worker.js");
const privacy=read("privacy.html");
const terms=read("terms.html");
const manifest=JSON.parse(read("manifest.webmanifest"));
const readme=read("README.md");

assert(index.includes('href="vune.css"'),"index must load consolidated stylesheet");
assert(index.includes('src="vune-runtime.js"'),"index must load consolidated runtime");
assert(!index.includes('src="app.js"'),"index must not load legacy app.js");
assert(!sw.includes("parts.join"),"service worker must not compose runtime files");
assert(!sw.includes("corrections.js"),"service worker must not reference legacy patch files");
assert(!sw.includes("event.waitUntil(caches.open"),"service worker should not use late waitUntil inside fetch response handling");

assert(runtime.includes("vunePersistQueue"),"encrypted writes must be serialized");
assert(runtime.includes('visibilitychange'),"privacy curtain/background lock listener must exist");
assert(runtime.includes('privacy-hidden'),"privacy curtain class must be toggled");
assert(runtime.includes("checkinHistory"),"multiple same-day check-ins must have dedicated history");
assert(runtime.includes("vuneOpenHealthSummary"),"Supporter Health Summary handler must exist");
assert(runtime.includes("vuneSecureDialog"),"sensitive passcode flows must use in-page password UI");
assert(!/\\bprompt\\s*\\(/.test(runtime),"plaintext prompt() must not remain in active runtime source");
assert(runtime.includes("vuneDeleteEverything"),"permanent deletion path must exist");
assert(runtime.includes("Advanced pattern details unlock with Complete"),"Complete-only detail gate must exist");
assert(runtime.includes("vuneUnlockBlockedUntil"),"unlock retry throttling must exist");
assert(runtime.includes('window.addEventListener("storage"'),"multi-tab overwrite guard must exist");
assert(runtime.includes("vuneCloseSensitiveOverlays"),"locking/backgrounding must close sensitive overlays");
assert(runtime.includes("vunePersistGeneration"),"stale queued writes must be invalidated after cross-tab changes");

assert(index.includes("Local encrypted vault"),"Free tier copy should match implemented features");
assert(index.includes("Period prediction"),"Essential tier copy should match analytics entitlement");
assert(index.includes("Bloom Notes journal"),"Plus tier copy should match journal entitlement");
assert(index.includes("Advanced pattern details"),"Complete tier must advertise its unique feature");
assert(index.includes("Doctor-ready Health Summary"),"Supporter tier must advertise Health Summary");
assert(!index.includes("Custom reminders"),"unimplemented custom reminders must not be advertised");
assert(!index.includes("Encrypted sync tools"),"unimplemented sync must not be advertised");

assert(index.includes("data-view=\"insights\""),"Patterns must remain navigable");
const mobileBlock=(index.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)||[""])[0];
assert((mobileBlock.match(/data-view=/g)||[]).length===5,"mobile navigation must contain five destinations");

assert(index.includes("style-src 'self' 'unsafe-inline'"),"CSP must allow required dynamic/inline chart styles");
assert(!index.includes("frame-ancestors 'none'"),"ineffective meta frame-ancestors directive should not remain");
assert(privacy.includes('src="public-theme.js"'),"privacy page must apply stored theme");
assert(terms.includes('src="public-theme.js"'),"terms page must apply stored theme");
assert(!("theme_color" in manifest),"manifest must not force a fixed purple theme");

const accents=["lavender","blue","mint","pink","peach","periwinkle","aqua","sage","butter","mauve"];
for(const accent of accents){
  assert(css.includes("accent-"+accent),"CSS missing accent "+accent);
  assert(runtime.includes('"'+accent+'"'),"runtime missing accent "+accent);
}

assert(css.includes(".danger-text"),"danger text override must exist");
assert(css.includes(".vune-secure-dialog"),"secure dialog styles must exist");
assert(readme.includes("Multiple check-ins on the same date"),"README must describe multiple same-day check-ins");

if(process.exitCode){
  console.error("Static Vune audit failed.");
  process.exit(process.exitCode);
}
console.log("Static Vune audit passed.");
