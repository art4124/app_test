/* ===== app.js ===== */
"use strict";

const DATA_KEY = "vune_encrypted_state_v1";
const SALT_KEY = "vune_salt_v1";
const RECOVERY_BACKUP_KEY = "vune_recovery_backup_v1";
const TERMS_VERSION = "1.0";
const ITERATIONS = 250000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let state = null;
let currentKey = null;
let autoLockTimer = null;
let toastTimer = null;
let journalEditingId = null;
let calendarCursor = new Date();
calendarCursor.setDate(1);
let recoveryResetRequired = false;

const planNames = { free:"Free", essential:"Essential", plus:"Plus", complete:"Complete", supporter:"Supporter" };
const planOrder = { free:0, essential:1, plus:2, complete:3, supporter:4 };
const planDetails = {
  free:{price:"$0",note:"Cycle logging + daily check-ins",unlock:"Track your cycle and review your history"},
  essential:{price:"$4.99 / month",note:"Free + Analytics",unlock:"Unlocks analytics"},
  plus:{price:"$12.99 / month",note:"Essential + Bloom Notes",unlock:"Adds the private journal"},
  complete:{price:"$24.99 / month",note:"Plus + Advanced Insights",unlock:"Adds advanced pattern insights"},
  supporter:{price:"$32.99 / month",note:"Complete + Companion",unlock:"Adds the Vune Companion"}
};

function $(id){ return document.getElementById(id); }
function safe(id){ return $(id); }
function esc(v){ return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
function todayISO(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseISO(v){ const p=v.split("-").map(Number); return new Date(Date.UTC(p[0],p[1]-1,p[2])); }
function isoUTC(d){ return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0"); }
function addDays(v,n){ const d=parseISO(v); d.setUTCDate(d.getUTCDate()+n); return isoUTC(d); }
function diffDays(a,b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
function prettyDate(v,opt){ if(!v)return"—"; return new Intl.DateTimeFormat(undefined,opt||{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(parseISO(v)); }
function toBase64(bytes){ let s=""; const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]); return btoa(s); }
function fromBase64(v){ const s=atob(v); const a=new Uint8Array(s.length); for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i); return a; }
function randomRecoveryKey(){ const b=crypto.getRandomValues(new Uint8Array(24)); return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("").match(/.{1,8}/g).join("-").toUpperCase(); }

async function deriveKey(secret,salt){
  const material=await crypto.subtle.importKey("raw",encoder.encode(secret),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:ITERATIONS,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptJson(value,key){ const iv=crypto.getRandomValues(new Uint8Array(12)); const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(JSON.stringify(value))); return JSON.stringify({v:1,iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ct))}); }
async function decryptJson(payload,key){ const p=JSON.parse(payload); const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(p.iv)},key,fromBase64(p.ciphertext)); return JSON.parse(decoder.decode(plain)); }

function defaultState(){ return {version:2,createdAt:new Date().toISOString(),settings:{plan:"free",lockMinutes:5,appearance:"system",companionName:"Luma",recoveryKey:randomRecoveryKey(),termsAcceptedVersion:null,lastBackupAt:null},entries:{},journals:[],assistantMessages:[],ui:{}}; }
function normalizeState(v){ const b=defaultState(); const n=Object.assign({},b,v||{}); n.settings=Object.assign({},b.settings,n.settings||{}); if(!n.settings.recoveryKey)n.settings.recoveryKey=randomRecoveryKey(); n.entries=n.entries||{}; n.journals=Array.isArray(n.journals)?n.journals:[]; n.assistantMessages=Array.isArray(n.assistantMessages)?n.assistantMessages:[]; n.ui=Object.assign({},b.ui,n.ui||{}); return n; }
function hasVault(){ return Boolean(localStorage.getItem(DATA_KEY)&&localStorage.getItem(SALT_KEY)); }

async function persistState(){ if(!state||!currentKey)return; localStorage.setItem(DATA_KEY,await encryptJson(state,currentKey)); await persistRecoveryBackup(); }
async function persistRecoveryBackup(){ if(!state||!state.settings.recoveryKey)return; const salt=crypto.getRandomValues(new Uint8Array(16)); const key=await deriveKey(state.settings.recoveryKey, salt); const copy=JSON.parse(JSON.stringify(state)); const payload=await encryptJson(copy,key); localStorage.setItem(RECOVERY_BACKUP_KEY,JSON.stringify({format:"vune-recovery-backup",version:1,salt:toBase64(salt),payload,updatedAt:new Date().toISOString()})); state.settings.lastBackupAt=new Date().toISOString(); }
async function restoreWithRecoveryKey(recoveryKey){ const raw=localStorage.getItem(RECOVERY_BACKUP_KEY); if(!raw)throw new Error("No recovery backup"); const pack=JSON.parse(raw); const key=await deriveKey(recoveryKey,fromBase64(pack.salt)); return normalizeState(await decryptJson(pack.payload,key)); }

function showToast(msg){ const t=safe("toast"); if(!t)return; t.textContent=msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),2800); }
function showSetup(){ safe("lockScreen").hidden=false; safe("appShell").hidden=true; safe("setupPanel").hidden=false; safe("unlockPanel").hidden=true; setTimeout(()=>safe("newPasscode")&&safe("newPasscode").focus(),50); }
function showUnlock(){ safe("lockScreen").hidden=false; safe("appShell").hidden=true; safe("setupPanel").hidden=true; safe("unlockPanel").hidden=false; if(safe("unlockError"))safe("unlockError").textContent=""; if(safe("unlockPasscode"))safe("unlockPasscode").value=""; setTimeout(()=>safe("unlockPasscode")&&safe("unlockPasscode").focus(),50); }
function showApp(){ safe("lockScreen").hidden=true; safe("appShell").hidden=false; if(safe("checkinDate"))safe("checkinDate").value=todayISO(); if(safe("journalDate"))safe("journalDate").value=todayISO(); applyAppearance(); renderAll(); scheduleAutoLock(); if(state.settings.termsAcceptedVersion!==TERMS_VERSION)showTermsGate(); }
async function setupVault(passcode){ const salt=crypto.getRandomValues(new Uint8Array(16)); currentKey=await deriveKey(passcode,salt); state=defaultState(); localStorage.setItem(SALT_KEY,toBase64(salt)); await persistState(); showApp(); }
async function unlockVault(passcode){ const salt=localStorage.getItem(SALT_KEY),payload=localStorage.getItem(DATA_KEY); if(!salt||!payload)throw new Error("No vault"); const key=await deriveKey(passcode,fromBase64(salt)); state=normalizeState(await decryptJson(payload,key)); currentKey=key; showApp(); }
async function lockApp(){ if(state&&currentKey){try{await persistState();}catch(e){}} state=null; currentKey=null; clearTimeout(autoLockTimer); autoLockTimer=null; hasVault()?showUnlock():showSetup(); }
function scheduleAutoLock(){ clearTimeout(autoLockTimer); if(!state)return; const m=Number(state.settings.lockMinutes); if(m>0)autoLockTimer=setTimeout(lockApp,m*60000); }
function noteActivity(){ if(state)scheduleAutoLock(); }

function getEntryDates(){ return Object.keys(state.entries||{}).sort(); }
function getPeriodStarts(){ const dates=getEntryDates().filter(d=>state.entries[d]&&state.entries[d].period); return dates.filter(d=>!state.entries[addDays(d,-1)]||!state.entries[addDays(d,-1)].period); }
function getPeriodDayNumber(date){ if(!state.entries[date]||!state.entries[date].period)return null; let n=1,d=date; while(state.entries[addDays(d,-1)]&&state.entries[addDays(d,-1)].period){n++;d=addDays(d,-1);} return n; }
function average(a){ return a.length?a.reduce((s,v)=>s+v,0)/a.length:null; }
function getCycleLengths(){ const s=getPeriodStarts(),out=[]; for(let i=1;i<s.length;i++){const d=diffDays(s[i-1],s[i]); if(d>=15&&d<=60)out.push({start:s[i-1],next:s[i],days:d});} return out; }
function getPrediction(){ const starts=getPeriodStarts(); if(!starts.length)return null; const cycles=getCycleLengths().slice(-6); const avg=cycles.length?Math.round(average(cycles.map(x=>x.days))):28; const last=starts[starts.length-1]; return {date:addDays(last,avg),average:avg,confidence:cycles.length>=5?"Higher":cycles.length>=2?"Building":"Early estimate"}; }
function hasAnalytics(){ return planOrder[state.settings.plan]>=planOrder.essential; }
function hasJournal(){ return planOrder[state.settings.plan]>=planOrder.plus; }
function hasCompanion(){ return state.settings.plan==="supporter"; }
function getPredictedPeriodDates(){ if(!hasAnalytics())return[]; const p=getPrediction(); if(!p)return[]; return Array.from({length:5},(_,i)=>addDays(p.date,i)); }
function getSymptomCounts(){ const c={}; getEntryDates().forEach(d=>(state.entries[d].symptoms||[]).forEach(s=>c[s]=(c[s]||0)+1)); return Object.keys(c).map(name=>({name,count:c[name]})).sort((a,b)=>b.count-a.count); }
function getMoodCounts(){ const c={}; getEntryDates().forEach(d=>{const m=state.entries[d].mood;if(m)c[m]=(c[m]||0)+1;}); return Object.keys(c).map(name=>({name,count:c[name]})).sort((a,b)=>b.count-a.count); }
function applyAppearance(){ if(!state)return; const pref=state.settings.appearance||"system"; const dark=pref==="dark"||(pref==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches); document.body.classList.toggle("theme-dark",dark); document.querySelectorAll("[data-appearance]").forEach(b=>b.classList.toggle("active",b.dataset.appearance===pref)); }
function ensureEnhancementStyles(){ if(!document.querySelector('link[href="enhancements.css"]')){ const l=document.createElement("link"); l.rel="stylesheet"; l.href="enhancements.css"; document.head.appendChild(l); } }

function gateView(name){ if(name==="journal"&&!hasJournal())return {title:"Bloom Notes unlocks with Plus",body:"Plus includes analytics and your private Bloom Notes journal."}; if(name==="insights"&&!hasAnalytics())return {title:"Analytics unlock with Essential",body:"Essential adds cycle analytics and pattern summaries."}; return null; }
function showGate(name,gate){ const view=safe("view-"+name); if(!view)return; let box=view.querySelector(".feature-gate"); if(!box){ box=document.createElement("div"); box.className="feature-gate"; view.appendChild(box); } box.innerHTML='<span class="eyebrow">Plan feature</span><h3>'+esc(gate.title)+'</h3><p>'+esc(gate.body)+'</p><button class="primary-btn" type="button" data-go="settings">See plans</button>'; Array.from(view.children).forEach(ch=>{ if(ch!==box)ch.hidden=true; }); box.hidden=false; }
function clearGate(name){ const view=safe("view-"+name); if(!view)return; const box=view.querySelector(".feature-gate"); if(box)box.hidden=true; Array.from(view.children).forEach(ch=>{ if(!ch.classList.contains("feature-gate"))ch.hidden=false; }); }
function showView(name){ if(name==="garden")name="today"; if(recoveryResetRequired&&name!=="settings"){showToast("Create a new vault passcode before continuing.");name="settings";} const gate=gateView(name); if(gate)showGate(name,gate); else clearGate(name); document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name)); document.querySelectorAll(".nav-btn[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name)); if(name==="calendar")renderCalendar(); if(name==="journal"&&hasJournal())renderJournal(); if(name==="insights"&&hasAnalytics())renderInsights(); if(name==="settings")renderSettings(); window.scrollTo({top:0,behavior:"smooth"}); }

function renderToday(){ const now=new Date(),hour=now.getHours(); if(safe("todayGreeting"))safe("todayGreeting").textContent=hour<12?"Good morning 💜":hour<18?"Good afternoon 🌿":"Good evening 🌙"; if(safe("todayDate"))safe("todayDate").textContent=now.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}); const p=hasAnalytics()?getPrediction():null; if(safe("predictionDate")){ safe("predictionDate").textContent=hasAnalytics()?(p?prettyDate(p.date,{month:"long",day:"numeric",timeZone:"UTC"}):"Add your first period"):"Essential feature"; safe("predictionDetail").textContent=hasAnalytics()?(p?"About "+Math.max(0,diffDays(todayISO(),p.date))+" days away • "+p.average+"-day average":"Log a period start to begin."):"Upgrade to Essential for cycle analytics."; safe("predictionConfidence").textContent=hasAnalytics()?(p?p.confidence:"Still learning"):"Locked"; } if(safe("activePlanBadge"))safe("activePlanBadge").textContent=planNames[state.settings.plan]; }
function loadCheckinForDate(date){ const e=state.entries[date]||{}; if(safe("flowSelect"))safe("flowSelect").value=e.flow||"none"; if(safe("moodSelect"))safe("moodSelect").value=e.mood||""; if(safe("periodToday"))safe("periodToday").checked=Boolean(e.period); if(safe("dailyReflection"))safe("dailyReflection").value=e.reflection||""; document.querySelectorAll("#symptomChips input[type=checkbox]").forEach(i=>i.checked=new Set(e.symptoms||[]).has(i.value)); if(safe("saveCheckinStatus"))safe("saveCheckinStatus").textContent=state.entries[date]?"Saved entry loaded.":""; }
async function saveCheckin(ev){ ev.preventDefault(); const date=safe("checkinDate").value,period=safe("periodToday").checked,flow=safe("flowSelect").value,mood=safe("moodSelect").value,symptoms=Array.from(document.querySelectorAll("#symptomChips input:checked")).map(i=>i.value),reflection=safe("dailyReflection").value.trim(); if(!(period||flow!=="none"||mood||symptoms.length||reflection)){ if(safe("checkinRequirement"))safe("checkinRequirement").hidden=false; showToast("Add at least one feeling, symptom, cycle detail, or note before saving your check-in.");return;} if(safe("checkinRequirement"))safe("checkinRequirement").hidden=true; state.entries[date]={date,period,flow,mood,symptoms,reflection,updatedAt:new Date().toISOString()}; await persistState(); renderAll(); safe("checkinDate").value=date; loadCheckinForDate(date); showToast("Check-in saved. 💜"); }

function renderCalendar(){ if(!state)return; const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth(); safe("calendarMonthLabel").textContent=calendarCursor.toLocaleDateString(undefined,{month:"long",year:"numeric"}); const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),predicted=new Set(getPredictedPeriodDates()),html=[]; for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i); const iso=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"),entry=state.entries[iso],journals=hasJournal()?state.journals.filter(j=>j.date===iso):[],tags=[]; if(entry&&entry.period)tags.push('<span class="calendar-tag period">Day '+getPeriodDayNumber(iso)+'</span>'); if(entry)tags.push('<span class="calendar-tag checkin">Check-in</span>'); journals.forEach(()=>tags.push('<span class="calendar-tag journal">Journal</span>')); if(predicted.has(iso)&&!(entry&&entry.period))tags.push('<span class="calendar-tag predicted">Next period</span>'); html.push('<button type="button" class="calendar-day garden-day has-detail'+(d.getMonth()!==m?' muted-day':'')+(iso===todayISO()?' today':'')+'" data-calendar-date="'+iso+'"><span class="day-number">'+d.getDate()+'</span><span class="calendar-event-list">'+tags.join("")+'</span></button>'); } safe("calendarGrid").innerHTML=html.join(""); }
function ensureDayDetailSheet(){ if(safe("dayDetailSheet"))return; const wrap=document.createElement("div"); wrap.id="dayDetailSheet"; wrap.className="day-detail-sheet"; wrap.hidden=true; wrap.innerHTML='<section class="day-detail-card" role="dialog" aria-modal="true"><div class="day-detail-head"><div><span class="eyebrow">Day details</span><h3 id="dayDetailTitle"></h3></div><button id="closeDayDetail" class="icon-btn" type="button">×</button></div><div id="dayDetailItems" class="day-detail-items"></div></section>'; document.body.appendChild(wrap); safe("closeDayDetail").addEventListener("click",()=>wrap.hidden=true); wrap.addEventListener("click",e=>{if(e.target===wrap)wrap.hidden=true;}); }
function openDayDetail(date){ ensureDayDetailSheet(); safe("dayDetailTitle").textContent=prettyDate(date,{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}); const items=[]; const e=state.entries[date]; if(e&&e.period)items.push('<button class="day-detail-item period" data-open-checkin="'+date+'"><strong>Period — Day '+getPeriodDayNumber(date)+'</strong><small>Open this day’s cycle check-in</small></button>'); if(e)items.push('<button class="day-detail-item checkin" data-open-checkin="'+date+'"><strong>Cycle check-in</strong><small>Open the saved check-in for this date</small></button>'); if(hasJournal())state.journals.filter(j=>j.date===date).forEach(j=>items.push('<button class="day-detail-item journal" data-open-journal="'+esc(j.id)+'"><strong>'+esc(j.title||prettyDate(j.date))+'</strong><small>Bloom Notes • '+esc(prettyDate(j.date))+'</small></button>')); safe("dayDetailItems").innerHTML=items.length?items.join(""):'<p class="muted">Nothing has been saved for this day yet.</p>'; safe("dayDetailSheet").hidden=false; }

async function saveJournal(ev){ ev.preventDefault(); if(!hasJournal())return; const date=safe("journalDate").value,title=safe("journalTitle").value.trim(),text=safe("journalText").value.trim(); if(!text)return; if(journalEditingId){const j=state.journals.find(x=>x.id===journalEditingId);if(j){j.date=date;j.title=title;j.text=text;j.updatedAt=new Date().toISOString();}journalEditingId=null;}else state.journals.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random(),date,title,text,createdAt:new Date().toISOString()}); state.journals.sort((a,b)=>b.date.localeCompare(a.date)); await persistState(); safe("journalTitle").value="";safe("journalText").value="";safe("journalDate").value=todayISO();renderJournal();renderCalendar();showToast("Your private note is tucked safely away. 🔐💜"); }
function renderJournal(){ if(!state||!hasJournal())return; const l=safe("journalList"); if(!l)return; if(!state.journals.length){l.innerHTML='<article class="card empty-state"><strong>No notes yet 💜</strong><br><span>This space is here whenever something feels worth remembering.</span></article>';return;} l.innerHTML=state.journals.map(j=>'<article class="journal-entry compact-entry"><div class="journal-entry-head"><div><span class="eyebrow">'+esc(prettyDate(j.date))+'</span><h3>'+esc(j.title||prettyDate(j.date,{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+'</h3></div><div class="journal-actions"><button class="text-btn" type="button" data-edit-journal="'+esc(j.id)+'">Open</button><button class="text-btn danger-text" type="button" data-delete-journal="'+esc(j.id)+'">Delete</button></div></div></article>').join(""); }
function editJournal(id){ if(!hasJournal())return; const j=state.journals.find(x=>x.id===id); if(!j)return; journalEditingId=id; safe("journalDate").value=j.date;safe("journalTitle").value=j.title||"";safe("journalText").value=j.text;showView("journal");setTimeout(()=>safe("journalText").focus(),50); }
async function deleteJournal(id){ const j=state.journals.find(x=>x.id===id); if(!j)return; if(!confirm("Delete this journal entry? This cannot be undone."))return; state.journals=state.journals.filter(x=>x.id!==id);await persistState();renderJournal();renderCalendar();showToast("Journal entry deleted."); }

function renderBars(id,vals){ const t=safe(id); if(!t)return; if(!vals.length){t.className="bar-chart empty-state";t.textContent=id==="moodChart"?"Your mood patterns will appear here over time.":"Your symptom patterns will appear here over time.";return;} const max=Math.max(...vals.map(x=>x.count));t.className="bar-chart";t.innerHTML=vals.slice(0,6).map(x=>'<div class="bar-row"><span>'+esc(x.name)+'</span><div class="bar-track"><span style="width:'+Math.round(x.count/max*100)+'%"></span></div><strong>'+x.count+'</strong></div>').join(""); }
function renderInsights(){ if(!hasAnalytics())return; const cycles=getCycleLengths(),vals=cycles.map(x=>x.days),avg=vals.length?Math.round(average(vals)):null; if(safe("avgCycleStat"))safe("avgCycleStat").textContent=avg==null?"—":avg;if(safe("cycleRangeStat"))safe("cycleRangeStat").textContent=vals.length?Math.min(...vals)+"–"+Math.max(...vals):"—";if(safe("trackedCyclesStat"))safe("trackedCyclesStat").textContent=getPeriodStarts().length;if(safe("checkinsStat"))safe("checkinsStat").textContent=getEntryDates().length;renderBars("symptomChart",getSymptomCounts());renderBars("moodChart",getMoodCounts());const t=safe("cycleHistory");if(t){if(!cycles.length){t.className="cycle-history empty-state";t.textContent="Once you’ve logged two period starts, Vune can begin showing your cycle rhythm here.";}else{const recent=cycles.slice(-8),max=Math.max(...recent.map(x=>x.days));t.className="cycle-history";t.innerHTML=recent.map(x=>'<div class="cycle-bar-wrap"><strong>'+x.days+'d</strong><div class="cycle-bar" style="height:'+Math.max(35,Math.round(x.days/max*130))+'px"></div><small>'+esc(prettyDate(x.start,{month:"short",day:"numeric",timeZone:"UTC"}))+'</small></div>').join("");}} }

function setCompanionOpen(open){ const p=safe("companionPanel"),l=safe("companionLauncher");if(!p||!l)return;p.hidden=!open;l.setAttribute("aria-expanded",String(open));if(open)renderAssistant(); }
function renderAssistant(){ if(!state)return; const name=state.settings.companionName||"Luma"; document.querySelectorAll(".companion-header strong").forEach(el=>el.textContent=name+" • Vune Companion"); const launcher=safe("companionLauncher");if(launcher){const s=launcher.querySelector("strong");if(s)s.textContent="Ask "+name;} const gate=safe("assistantGate"),exp=safe("assistantExperience");if(gate)gate.hidden=hasCompanion();if(exp)exp.hidden=!hasCompanion();if(!hasCompanion())return; const target=safe("assistantMessages");if(!target)return;target.innerHTML="";const msgs=state.assistantMessages.length?state.assistantMessages:[{role:"assistant",text:"Hi, I’m "+name+" ✦\n\nI can help you notice patterns, summarize what you’ve tracked, and prepare questions for appointments. I don’t diagnose."}];msgs.forEach(m=>{const d=document.createElement("div");d.className="assistant-message "+m.role;d.textContent=m.text;target.appendChild(d);});target.scrollTop=target.scrollHeight; }
function assistantSummary(){ const cycles=getCycleLengths(),sym=getSymptomCounts(),p=getPrediction(),parts=[]; if(cycles.length){const vals=cycles.map(x=>x.days);parts.push("Your recorded cycles average about "+Math.round(average(vals))+" days, with a range of "+Math.min(...vals)+"–"+Math.max(...vals)+" days.");}else parts.push("I’m still learning your rhythm. Log at least two period starts for a cycle summary."); if(sym.length)parts.push("Most logged symptoms: "+sym.slice(0,3).map(x=>x.name+" ("+x.count+")").join(", ")+"."); if(p)parts.push("Current estimate for the next period start: "+prettyDate(p.date)+"."); parts.push("This reflects your own records and is not a diagnosis."); return parts.join("\n\n"); }
function answerAssistant(prompt){ const lower=prompt.toLowerCase(),name=state.settings.companionName||"Luma"; if(/diagnos|do i have|pcos|endometri|pregnant/.test(lower))return "I can organize what you’ve tracked, but I can’t diagnose a condition or confirm pregnancy. A clinician can help with medical questions."; if(/summary|pattern|overview/.test(lower))return assistantSummary(); if(/next period|prediction/.test(lower)){const p=getPrediction();return p?"Based on your records, the current estimate is "+prettyDate(p.date)+". This can shift as your cycle changes.":"I need at least one recorded period start before I can estimate the next one.";} if(/journal|note/.test(lower))return "You have "+state.journals.length+" Bloom Notes entr"+(state.journals.length===1?"y":"ies")+" saved in your encrypted vault."; return name+" can help summarize cycle patterns, symptoms, moods, period estimates, and appointment prep."; }
async function sendAssistant(ev){ev.preventDefault();if(!hasCompanion())return;const p=safe("assistantPrompt").value.trim();if(!p)return;state.assistantMessages.push({role:"user",text:p,at:new Date().toISOString()},{role:"assistant",text:answerAssistant(p),at:new Date().toISOString()});safe("assistantPrompt").value="";await persistState();renderAssistant();}

function injectSettingsAdditions(){ const menu=document.querySelector(".settings-menu"); if(!menu)return; if(!document.querySelector('[data-settings-tab="appearance"]')){const b=document.createElement("button");b.className="settings-tab";b.type="button";b.dataset.settingsTab="appearance";b.innerHTML='<span>◐</span><span><strong>Appearance</strong><small>Light & dark</small></span>';menu.insertBefore(b,menu.querySelector('.danger-settings-tab'));} if(!document.querySelector('[data-settings-tab="companion"]')){const b=document.createElement("button");b.className="settings-tab";b.type="button";b.dataset.settingsTab="companion";b.innerHTML='<span>✦</span><span><strong>Companion</strong><small>Name your guide</small></span>';menu.insertBefore(b,menu.querySelector('.danger-settings-tab'));} const panels=document.querySelector(".settings-panels"); if(panels&&!document.querySelector('[data-settings-panel="appearance"]')){const s=document.createElement("section");s.className="settings-panel";s.dataset.settingsPanel="appearance";s.hidden=true;s.innerHTML='<div class="settings-panel-heading"><div><span class="eyebrow">Appearance</span><h3>Choose your lighting</h3></div></div><div class="settings-mini-card"><div class="appearance-options"><button class="appearance-option" type="button" data-appearance="light">☀️<br><strong>Light</strong></button><button class="appearance-option" type="button" data-appearance="dark">🌙<br><strong>Dark</strong></button><button class="appearance-option" type="button" data-appearance="system">◐<br><strong>System</strong></button></div></div>';panels.appendChild(s);} if(panels&&!document.querySelector('[data-settings-panel="companion"]')){const s=document.createElement("section");s.className="settings-panel";s.dataset.settingsPanel="companion";s.hidden=true;s.innerHTML='<div class="settings-panel-heading"><div><span class="eyebrow">Companion</span><h3>Your Vune Companion</h3></div></div><div class="settings-mini-card"><label>Companion name<input id="companionNameInput" maxlength="30" placeholder="Luma"></label><button id="saveCompanionNameBtn" class="secondary-btn" type="button">Save name</button><button id="resetCompanionNameBtn" class="text-btn" type="button">Reset to Luma</button></div>';panels.appendChild(s);} }
function showSettingsCategory(name){ document.querySelectorAll("[data-settings-tab]").forEach(t=>{const a=t.dataset.settingsTab===name;t.classList.toggle("active",a);t.setAttribute("aria-selected",String(a));}); document.querySelectorAll("[data-settings-panel]").forEach(p=>{const a=p.dataset.settingsPanel===name;p.classList.toggle("active",a);p.hidden=!a;}); }
function renderSettings(){ if(!state)return; injectSettingsAdditions(); const cur=state.settings.plan||"free",det=planDetails[cur]; if(safe("currentPlanCard"))safe("currentPlanCard").innerHTML='<div class="current-plan-main"><div><span class="current-plan-label">Your plan</span><strong>'+esc(planNames[cur])+'</strong><small>'+esc(det.note)+'</small></div><div class="current-plan-price">'+esc(det.price)+'</div></div><span class="current-plan-status">Current</span>'; document.querySelectorAll(".plan-card").forEach(b=>{const isCur=b.dataset.plan===cur;b.hidden=isCur;let unlock=b.querySelector(".new-unlock");if(!unlock){unlock=document.createElement("span");unlock.className="new-unlock";b.appendChild(unlock);} }); if(safe("lockMinutesSelect"))safe("lockMinutesSelect").value=String(state.settings.lockMinutes); if(safe("companionNameInput"))safe("companionNameInput").value=state.settings.companionName||"Luma"; applyAppearance(); rewriteSettingsCopy(); if(recoveryResetRequired){showSettingsCategory("security");document.querySelectorAll(".side-nav,.mobile-nav,.settings-menu").forEach(el=>el.classList.add("locked-navigation"));}else document.querySelectorAll(".side-nav,.mobile-nav,.settings-menu").forEach(el=>el.classList.remove("locked-navigation")); }
function rewriteSettingsCopy(){ const backup=document.querySelector('[data-settings-panel="backup"]'); if(backup){backup.innerHTML='<div class="settings-panel-heading"><div><span class="eyebrow">Backup</span><h3>Recovery Key</h3></div></div><div class="settings-mini-card"><p class="muted">Your web-test backup stays encrypted in this browser. Your Recovery Key is what can unlock it if you forget your vault passcode.</p><div class="button-row"><button id="restoreBackupBtn" class="secondary-btn" type="button">Restore backup</button><button id="showRecoveryKeyBtn" class="secondary-btn" type="button">Show current Recovery Key</button></div><p id="backupStatus" class="muted">'+(state.settings.lastBackupAt?'Last protected: '+esc(new Date(state.settings.lastBackupAt).toLocaleString()):'Backup will be protected after your next save.')+'</p><div id="recoveryKeyDisplay" class="recovery-key-box" hidden></div></div>'; } const privacy=document.querySelector('[data-settings-panel="privacy"]'); if(privacy){privacy.innerHTML='<div class="settings-panel-heading"><div><span class="eyebrow">Privacy</span><h3>Your data belongs to you</h3></div></div><div class="privacy-promise"><div><strong>Stored locally</strong><span>Your personal health information stays encrypted in this browser for this web prototype.</span></div><div><strong>Not sold</strong><span>Vune does not sell your personal health data.</span></div><div><strong>No Vune health-data server</strong><span>This prototype does not back up your health entries to a Vune server.</span></div><div><strong>Encrypted</strong><span>Your vault and local recovery copy are encrypted.</span></div></div><div class="legal-link-row"><a class="text-link" href="privacy.html">Privacy notes →</a><a class="text-link" href="terms.html">Terms & Conditions →</a></div>'; } const data=document.querySelector('[data-settings-panel="data"]'); if(data){data.innerHTML='<div class="settings-panel-heading"><div><span class="eyebrow">Data</span><h3>Local Vune data</h3></div></div><div class="settings-mini-card"><p class="muted">Vune no longer uses downloadable backup files in this test. Restore is handled with your Recovery Key.</p><div class="button-row"><button class="secondary-btn" type="button" data-settings-jump="backup">Recovery & backup</button></div></div><div class="settings-mini-card danger-settings-card"><p class="muted">Deleting this browser copy removes the encrypted vault and its local recovery backup. This cannot be recovered afterward.</p><button id="deleteAllBtn" class="danger-btn" type="button">Delete this browser copy</button></div>'; } const sec=document.querySelector('[data-settings-panel="security"]'); if(sec&&!sec.querySelector(".recovery-warning")){const w=document.createElement("p");w.className="recovery-warning";w.textContent="Important: if you lose your vault passcode and Recovery Key and cannot use a supported device recovery method, Vune cannot recover your encrypted data. There is no master key or backdoor.";sec.appendChild(w);} }
async function selectPlan(plan){ if(!planNames[plan])return;state.settings.plan=plan;await persistState();renderAll();showToast(planNames[plan]+" is ready to explore ✨ No payment was collected."); }
async function changePasscode(force=false){ return false; }
function deleteAllData(){ if(!confirm("Delete all Vune data stored in this browser?"))return;if(!confirm("Final confirmation: permanently delete this browser copy and its recovery backup?"))return;localStorage.removeItem(DATA_KEY);localStorage.removeItem(SALT_KEY);localStorage.removeItem(RECOVERY_BACKUP_KEY);location.reload(); }

function ensureRecoveryModal(){ if(safe("recoveryModal"))return; const m=document.createElement("div");m.id="recoveryModal";m.className="recovery-modal";m.hidden=true;m.innerHTML='<section class="recovery-card" role="dialog" aria-modal="true"><span class="eyebrow">Vault recovery</span><h3>Use your Recovery Key</h3><p class="muted">Enter the Recovery Key you saved when your vault was accessible.</p><label>Recovery Key<input id="recoveryInput" autocomplete="off" placeholder="XXXX-XXXX-..."></label><div class="button-row"><button id="confirmRecoveryBtn" class="primary-btn" type="button">Restore vault</button><button id="cancelRecoveryBtn" class="secondary-btn" type="button">Cancel</button></div><p class="recovery-warning">Web test note: Face ID, device passcode, and Apple identity confirmation require native platform APIs and are not simulated as passwords inside Vune.</p></section>';document.body.appendChild(m);safe("cancelRecoveryBtn").onclick=()=>m.hidden=true;safe("confirmRecoveryBtn").onclick=async()=>{try{const restored=await restoreWithRecoveryKey(safe("recoveryInput").value.trim());state=restored;currentKey=null;recoveryResetRequired=true;m.hidden=true;safe("lockScreen").hidden=true;safe("appShell").hidden=false;renderAll();showView("settings");showSettingsCategory("security");showToast("Recovery succeeded. Create a new vault passcode to continue.");setTimeout(()=>changePasscode(true),150);}catch(e){showToast("That Recovery Key could not unlock the backup.");}}; }
async function showCurrentRecoveryKey(){ return false; }

function ensureTermsLinks(){ const f=document.querySelector(".sidebar-footer");if(f&&!f.querySelector('a[href="terms.html"]')){const a=document.createElement("a");a.href="terms.html";a.className="text-link";a.textContent="Terms & Conditions";f.appendChild(a);} }
function ensureTermsGate(){ if(safe("termsGate"))return; const g=document.createElement("div");g.id="termsGate";g.className="terms-gate";g.hidden=true;g.innerHTML='<section class="terms-card"><span class="eyebrow">Before you continue</span><h2>Vune Terms & Conditions</h2><p>Vune is for cycle tracking and personal wellness organization. It is not medical advice, diagnosis, treatment, contraception, fertility care, or emergency care.</p><p>Your encrypted vault has no Vune master key. If you lose your passcode, Recovery Key, and supported recovery methods, your data may be unrecoverable.</p><p>The web prototype stores encrypted health entries and its encrypted recovery copy locally in this browser. It does not collect payment.</p><p><a class="text-link" href="terms.html" target="_blank" rel="noopener">Read the full Terms & Conditions →</a></p><label class="terms-check"><input id="termsAgreeCheck" type="checkbox"><span>I have read and agree to the Vune Terms & Conditions.</span></label><div class="terms-actions"><button id="acceptTermsBtn" class="primary-btn" type="button" disabled>Agree & continue</button></div></section>';document.body.appendChild(g);safe("termsAgreeCheck").onchange=e=>safe("acceptTermsBtn").disabled=!e.target.checked;safe("acceptTermsBtn").onclick=async()=>{state.settings.termsAcceptedVersion=TERMS_VERSION;await persistState();g.hidden=true;showToast("Terms accepted.");}; }
function showTermsGate(){ensureTermsGate();safe("termsGate").hidden=false;}

function renderAll(){ renderToday();renderCalendar();if(hasJournal())renderJournal();if(hasAnalytics())renderInsights();renderAssistant();renderSettings(); }

function bindEvents(){
  safe("setupForm").addEventListener("submit",async e=>{e.preventDefault();const a=safe("newPasscode").value,b=safe("confirmPasscode").value;if(a.length<8)return showToast("Use at least 8 characters.");if(a!==b)return showToast("Passcodes do not match.");try{await setupVault(a);safe("newPasscode").value="";safe("confirmPasscode").value="";showToast("Encrypted Vune vault created.");}catch(err){showToast("Could not create the encrypted vault in this browser.");}});
  safe("unlockForm").addEventListener("submit",async e=>{e.preventDefault();try{await unlockVault(safe("unlockPasscode").value);}catch(err){safe("unlockError").textContent="That passcode could not unlock this vault.";}});
  if(safe("resetFromLock")){safe("resetFromLock").textContent="Forgot passcode?";safe("resetFromLock").onclick=()=>{ensureRecoveryModal();safe("recoveryModal").hidden=false;};}
  document.addEventListener("click",e=>{
    const nav=e.target.closest(".nav-btn[data-view]");if(nav){showView(nav.dataset.view);return;}
    const go=e.target.closest("[data-go]");if(go){showView(go.dataset.go);setCompanionOpen(false);return;}
    const day=e.target.closest("[data-calendar-date]");if(day&&state){openDayDetail(day.dataset.calendarDate);return;}
    const oc=e.target.closest("[data-open-checkin]");if(oc){safe("dayDetailSheet").hidden=true;safe("checkinDate").value=oc.dataset.openCheckin;loadCheckinForDate(oc.dataset.openCheckin);showView("today");return;}
    const oj=e.target.closest("[data-open-journal]");if(oj){safe("dayDetailSheet").hidden=true;editJournal(oj.dataset.openJournal);return;}
    const ej=e.target.closest("[data-edit-journal]");if(ej){editJournal(ej.dataset.editJournal);return;}
    const dj=e.target.closest("[data-delete-journal]");if(dj){deleteJournal(dj.dataset.deleteJournal);return;}
    const plan=e.target.closest("[data-plan]");if(plan&&state){selectPlan(plan.dataset.plan);return;}
    const tab=e.target.closest("[data-settings-tab]");if(tab){showSettingsCategory(tab.dataset.settingsTab);return;}
    const jump=e.target.closest("[data-settings-jump]");if(jump){showSettingsCategory(jump.dataset.settingsJump);return;}
    const ap=e.target.closest("[data-appearance]");if(ap&&state){state.settings.appearance=ap.dataset.appearance;persistState();applyAppearance();return;}
    const jp=e.target.closest("[data-journal-prompt]");if(jp&&state&&hasJournal()){const f=safe("journalText"),txt=jp.dataset.journalPrompt||"";f.value=f.value.trim()?f.value+"\n\n"+txt:txt;f.focus();return;}
    if(e.target.id==="restoreBackupBtn"){ensureRecoveryModal();safe("recoveryModal").hidden=false;return;}
    if(e.target.id==="showRecoveryKeyBtn"){showCurrentRecoveryKey();return;}
    if(e.target.id==="deleteAllBtn"){deleteAllData();return;}
    if(e.target.id==="saveCompanionNameBtn"){const v=safe("companionNameInput").value.trim();state.settings.companionName=v||"Luma";persistState();renderAssistant();showToast("Companion name saved.");return;}
    if(e.target.id==="resetCompanionNameBtn"){state.settings.companionName="Luma";persistState();renderSettings();renderAssistant();showToast("Companion name reset to Luma.");return;}
  });
  safe("checkinForm").addEventListener("submit",saveCheckin);safe("checkinDate").addEventListener("change",()=>loadCheckinForDate(safe("checkinDate").value));safe("journalForm").addEventListener("submit",saveJournal);safe("assistantForm").addEventListener("submit",sendAssistant);
  safe("companionLauncher").addEventListener("click",()=>setCompanionOpen(safe("companionPanel").hidden));safe("closeCompanionBtn").addEventListener("click",()=>setCompanionOpen(false));
  safe("prevMonth").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar();});safe("nextMonth").addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar();});
  const toolbar=safe("prevMonth")&&safe("prevMonth").parentElement;if(toolbar&&!safe("todayCalendarBtn")){const b=document.createElement("button");b.id="todayCalendarBtn";b.className="secondary-btn compact";b.type="button";b.textContent="Today";b.onclick=()=>{calendarCursor=new Date();calendarCursor.setDate(1);renderCalendar();};toolbar.insertBefore(b,safe("nextMonth"));}
  safe("lockNowBtn").addEventListener("click",lockApp);safe("mobileLockBtn").addEventListener("click",lockApp);
  if(safe("lockMinutesSelect"))safe("lockMinutesSelect").addEventListener("change",async()=>{state.settings.lockMinutes=Number(safe("lockMinutesSelect").value);await persistState();scheduleAutoLock();showToast("Privacy preference saved. 🔐");});
  if(safe("changePasscodeBtn"))safe("changePasscodeBtn").addEventListener("click",()=>changePasscode(false));
  ["pointerdown","keydown","touchstart"].forEach(n=>document.addEventListener(n,noteActivity,{passive:true}));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(safe("dayDetailSheet"))safe("dayDetailSheet").hidden=true;if(safe("companionPanel"))setCompanionOpen(false);}});
}

async function init(){ if(!window.crypto||!window.crypto.subtle){document.body.innerHTML='<main style="max-width:680px;margin:60px auto;padding:24px;font-family:system-ui"><h1>Vune needs a secure browser context</h1><p>Open it over HTTPS or localhost in a modern browser.</p></main>';return;} ensureEnhancementStyles();ensureTermsLinks();ensureDayDetailSheet();ensureRecoveryModal();ensureTermsGate();injectSettingsAdditions();bindEvents();if(hasVault())showUnlock();else showSetup();if(window.matchMedia)window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(state&&state.settings.appearance==="system")applyAppearance();});if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{})); }

document.addEventListener("DOMContentLoaded",init);


/* ===== corrections.js ===== */
"use strict";

/* Vune beta correction batch — display preferences only are mirrored outside the encrypted vault
   so the lock screen can honor the user's chosen appearance before decryption. */
const VUNE_APPEARANCE_PREF_KEY = "vune_appearance_pref_v1";
const VUNE_ACCENT_PREF_KEY = "vune_accent_pref_v1";
const VUNE_ACCENTS = ["lavender","blue","mint","pink","peach","periwinkle","aqua","sage","butter","mauve"];
let vuneCalendarDetailDate = null;

function vuneStoredAppearance(){
  const value = localStorage.getItem(VUNE_APPEARANCE_PREF_KEY);
  return ["light","dark","system"].includes(value) ? value : "light";
}
function vuneStoredAccent(){
  const value = localStorage.getItem(VUNE_ACCENT_PREF_KEY);
  return VUNE_ACCENTS.includes(value) ? value : "lavender";
}
function vuneApplyDisplayPreferences(pref, accent){
  const appearance = ["light","dark","system"].includes(pref) ? pref : "light";
  const chosenAccent = VUNE_ACCENTS.includes(accent) ? accent : "lavender";
  const dark = appearance === "dark" || (appearance === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("theme-dark", dark);
  VUNE_ACCENTS.forEach(name => document.body.classList.toggle("accent-" + name, name === chosenAccent));
  document.querySelectorAll("[data-appearance]").forEach(button => button.classList.toggle("active", button.dataset.appearance === appearance));
  document.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", button.dataset.accent === chosenAccent));
}

/* First launch defaults to light. Existing user choices remain intact. */
const vuneOriginalDefaultState = defaultState;
defaultState = function(){
  const next = vuneOriginalDefaultState();
  next.settings.appearance = "light";
  next.settings.accent = "lavender";
  return next;
};

/* Apply the selected mode/accent everywhere, including the locked vault screen. */
applyAppearance = function(){
  const appearance = state && state.settings ? (state.settings.appearance || "light") : vuneStoredAppearance();
  const accent = state && state.settings ? (state.settings.accent || vuneStoredAccent()) : vuneStoredAccent();
  if(state && state.settings){
    localStorage.setItem(VUNE_APPEARANCE_PREF_KEY, appearance);
    localStorage.setItem(VUNE_ACCENT_PREF_KEY, accent);
  }
  vuneApplyDisplayPreferences(appearance, accent);
};

const vuneOriginalShowSetup = showSetup;
showSetup = function(){
  vuneApplyDisplayPreferences(vuneStoredAppearance(), vuneStoredAccent());
  vuneOriginalShowSetup();
};
const vuneOriginalShowUnlock = showUnlock;
showUnlock = function(){
  vuneApplyDisplayPreferences(vuneStoredAppearance(), vuneStoredAccent());
  vuneOriginalShowUnlock();
};

/* Complete now adds the Vune AI Companion; Supporter inherits Complete. */
planDetails.complete.note = "Plus + Vune AI Companion";
planDetails.complete.unlock = "Adds Vune AI Companion";
hasCompanion = function(){ return planOrder[state.settings.plan] >= planOrder.complete; };

/* Add pastel accent choices to Appearance. */
const vuneOriginalInjectSettingsAdditions = injectSettingsAdditions;
injectSettingsAdditions = function(){
  vuneOriginalInjectSettingsAdditions();
  const panel = document.querySelector('[data-settings-panel="appearance"] .settings-mini-card');
  if(panel && !panel.querySelector(".accent-options")){
    const wrap = document.createElement("div");
    wrap.className = "accent-picker";
    wrap.innerHTML = '<div class="accent-heading"><strong>Accent color</strong><small>Soft pastels tuned for light and dark mode</small></div><div class="accent-options" role="group" aria-label="Accent color"><button type="button" class="accent-option" data-accent="lavender"><span></span>Lavender</button><button type="button" class="accent-option" data-accent="blue"><span></span>Pastel blue</button><button type="button" class="accent-option" data-accent="mint"><span></span>Mint</button><button type="button" class="accent-option" data-accent="pink"><span></span>Soft pink</button><button type="button" class="accent-option" data-accent="peach"><span></span>Peach</button></div>';
    panel.appendChild(wrap);
  }
};

/* Calendar day details expand in place, occupying the calendar tile area. */
const vuneOriginalRenderCalendar = renderCalendar;
renderCalendar = function(){
  vuneCalendarDetailDate = null;
  vuneOriginalRenderCalendar();
  const grid = safe("calendarGrid");
  if(grid) grid.classList.remove("detail-open");
};
openDayDetail = function(date){
  const grid = safe("calendarGrid");
  if(!grid || !state) return;
  vuneCalendarDetailDate = date;
  const items = [];
  const entry = state.entries[date];
  if(entry && entry.period) items.push('<button class="day-detail-item period" data-open-checkin="'+date+'"><strong>Period — Day '+getPeriodDayNumber(date)+'</strong><small>Open this day’s cycle check-in</small></button>');
  if(entry) items.push('<button class="day-detail-item checkin" data-open-checkin="'+date+'"><strong>Cycle check-in</strong><small>Open the saved check-in for this date</small></button>');
  if(hasJournal()) state.journals.filter(j => j.date === date).forEach(j => items.push('<button class="day-detail-item journal" data-open-journal="'+esc(j.id)+'"><strong>'+esc(j.title || prettyDate(j.date))+'</strong><small>Bloom Notes • '+esc(prettyDate(j.date))+'</small></button>'));
  grid.classList.add("detail-open");
  grid.innerHTML = '<section class="calendar-expanded-day" aria-label="Selected calendar day"><div class="calendar-expanded-head"><div><span class="eyebrow">Day details</span><h3>'+esc(prettyDate(date,{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+'</h3></div><button class="icon-btn" type="button" data-calendar-back aria-label="Return to calendar">×</button></div><div class="day-detail-items">'+(items.length ? items.join("") : '<p class="muted">Nothing has been saved for this day yet.</p>')+'</div><button class="secondary-btn calendar-back-btn" type="button" data-calendar-back>Back to month</button></section>';
};

/* Keep Patterns summaries compact; full analytics are available through See More pages. */
const vuneOriginalRenderInsights = renderInsights;
renderInsights = function(){
  vuneOriginalRenderInsights();
  if(!hasAnalytics()) return;
  vuneCompactPatternBlock("symptomChart", getSymptomCounts(), "body");
  vuneCompactPatternBlock("moodChart", getMoodCounts(), "feelings");
  const cycles = getCycleLengths();
  const history = safe("cycleHistory");
  if(history && cycles.length > 3){
    Array.from(history.children).forEach((node, index) => { if(index < history.children.length - 3) node.remove(); });
    vuneAddSeeMore(history.parentElement, "cycle");
  }
};
function vuneCompactPatternBlock(id, values, type){
  const target = safe(id);
  if(!target || values.length <= 3) return;
  const rows = Array.from(target.querySelectorAll(".bar-row"));
  rows.slice(3).forEach(row => row.remove());
  vuneAddSeeMore(target.parentElement, type);
}
function vuneAddSeeMore(card, type){
  if(!card || card.querySelector('[data-pattern-more="'+type+'"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-btn pattern-see-more";
  button.dataset.patternMore = type;
  button.textContent = "See more →";
  card.appendChild(button);
}
function vuneShowPatternDetail(type){
  let view = safe("view-pattern-detail");
  if(!view){
    view = document.createElement("section");
    view.id = "view-pattern-detail";
    view.className = "view pattern-detail-view";
    const main = document.querySelector(".main-content");
    const footer = main && main.querySelector(".app-footer");
    if(main) main.insertBefore(view, footer || null);
  }
  let title = "Patterns", eyebrow = "Your patterns", content = "";
  if(type === "body"){
    title = "Your Body"; eyebrow = "Symptom patterns";
    const values = getSymptomCounts();
    content = values.length ? values.map(x => '<div class="pattern-detail-row"><span>'+esc(x.name)+'</span><strong>'+x.count+' logged</strong></div>').join("") : '<p class="muted">Your symptom patterns will gently appear here as you log more.</p>';
  } else if(type === "feelings"){
    title = "Your Feelings"; eyebrow = "Mood patterns";
    const values = getMoodCounts();
    content = values.length ? values.map(x => '<div class="pattern-detail-row"><span>'+esc(x.name)+'</span><strong>'+x.count+' logged</strong></div>').join("") : '<p class="muted">Your mood patterns will appear here over time.</p>';
  } else {
    title = "Your Cycle Story"; eyebrow = "Cycle lengths";
    const cycles = getCycleLengths();
    content = cycles.length ? cycles.slice().reverse().map(x => '<div class="pattern-detail-row"><span>'+esc(prettyDate(x.start,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))+' → '+esc(prettyDate(x.next,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))+'</span><strong>'+x.days+' days</strong></div>').join("") : '<p class="muted">Once you’ve logged two period starts, Vune can begin showing your cycle rhythm here.</p>';
  }
  view.innerHTML = '<div class="page-heading"><div><span class="eyebrow">'+eyebrow+'</span><h2>'+title+'</h2><p class="muted">This uses the same records and analytics as your Patterns overview.</p></div><button class="secondary-btn" type="button" data-pattern-back>← Back to Patterns</button></div><article class="card pattern-detail-card">'+content+'</article>';
  showView("pattern-detail");
}

/* Make the local Companion conversational while preserving its established tracking functions. */
const vuneOriginalAnswerAssistant = answerAssistant;
answerAssistant = function(prompt){
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  const name = state.settings.companionName || "Luma";
  if(/^(hi|hello|hey|hiya|good morning|good afternoon|good evening)[!. ]*$/.test(lower)){
    const replies = ["Hello 💜 How are you today?", "Hi there 🌿 How are you feeling today?", "Hey 💜 I’m glad you stopped by. How’s your day going?"];
    return replies[Math.floor(Math.random()*replies.length)];
  }
  if(/how are you/.test(lower)) return "I’m here and ready to spend a little time with you 💜 How are you doing?";
  if(/^(thanks|thank you|ty)[!. ]*$/.test(lower)) return "Of course 💜 I’m here whenever you want to check in or look at what you’ve been tracking.";
  if(/^(bye|goodbye|see you|talk later)[!. ]*$/.test(lower)) return "See you later 💜 Take care of yourself.";
  const functional = /diagnos|do i have|pcos|endometri|pregnant|summary|pattern|overview|next period|prediction|journal|note|symptom|mood|appointment|doctor|health summary/.test(lower);
  if(functional) return vuneOriginalAnswerAssistant(prompt);
  const replies = [
    "I’m listening 💜 Tell me a little more about that, and I can respond with you rather than just giving you a menu of features.",
    "I’m here with you 🌿 Want to tell me more about what’s on your mind, or would you like to look at something you’ve tracked?",
    "That makes sense to bring up. 💜 What part of it would you like to talk through together?"
  ];
  return replies[Math.floor(Math.random()*replies.length)];
};

/* Ensure settings render also refreshes accents and hides the active plan from the chooser. */
const vuneOriginalRenderSettings = renderSettings;
renderSettings = function(){
  vuneOriginalRenderSettings();
  if(state && state.settings && !VUNE_ACCENTS.includes(state.settings.accent)) state.settings.accent = "lavender";
  document.querySelectorAll(".plan-card").forEach(card => { card.hidden = card.dataset.plan === state.settings.plan; });
  applyAppearance();
};

/* Batch-specific interaction hooks. */
document.addEventListener("click", async function(event){
  const accent = event.target.closest("[data-accent]");
  if(accent && state){
    state.settings.accent = accent.dataset.accent;
    localStorage.setItem(VUNE_ACCENT_PREF_KEY, state.settings.accent);
    await persistState();
    applyAppearance();
    return;
  }
  if(event.target.closest("[data-calendar-back]")){
    renderCalendar();
    return;
  }
  const more = event.target.closest("[data-pattern-more]");
  if(more){
    vuneShowPatternDetail(more.dataset.patternMore);
    return;
  }
  if(event.target.closest("[data-pattern-back]")){
    showView("insights");
  }
});

document.addEventListener("keydown", function(event){
  if(event.key === "Escape" && vuneCalendarDetailDate){ renderCalendar(); }
});

/* Apply a non-sensitive stored display preference as early as possible. */
vuneApplyDisplayPreferences(vuneStoredAppearance(), vuneStoredAccent());


/* ===== batch-2026-09-25.js ===== */
"use strict";

/* Vune beta correction batch — September 25, 2026.
   This file intentionally layers on top of app.js + corrections.js. */
const VUNE_BETA_PLAN_KEY = "vune_beta_plan_v1";
const VUNE_DEVELOPMENT_MODE = true; // Web prototype only. Production/native must require a second verification factor.
const VUNE_ALL_ACCENTS = ["lavender","blue","mint","pink","peach","periwinkle","aqua","sage","butter","mauve"];

function vuneBatchStoredAccent(){
  const value = localStorage.getItem(VUNE_ACCENT_PREF_KEY);
  return VUNE_ALL_ACCENTS.includes(value) ? value : "lavender";
}

/* Complete = deeper analytics. Companion remains Supporter-only. */
planDetails.complete.note = "Plus + Advanced Pattern Insights";
planDetails.complete.unlock = "Adds Advanced Pattern Insights";
planDetails.supporter.note = "Complete + Vune AI Companion";
planDetails.supporter.unlock = "Adds Vune AI Companion";
hasCompanion = function(){ return Boolean(state && state.settings && state.settings.plan === "supporter"); };

/* Ten pastel accents, applied globally including the locked vault screen and Companion. */
vuneApplyDisplayPreferences = function(pref, accent){
  const appearance = ["light","dark","system"].includes(pref) ? pref : "light";
  const chosenAccent = VUNE_ALL_ACCENTS.includes(accent) ? accent : "lavender";
  const dark = appearance === "dark" || (appearance === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("theme-dark", dark);
  VUNE_ALL_ACCENTS.forEach(name => document.body.classList.toggle("accent-" + name, name === chosenAccent));
  document.querySelectorAll("[data-appearance]").forEach(button => button.classList.toggle("active", button.dataset.appearance === appearance));
  document.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", button.dataset.accent === chosenAccent));
};

applyAppearance = function(){
  const appearance = state && state.settings ? (state.settings.appearance || "light") : vuneStoredAppearance();
  const accent = state && state.settings ? (VUNE_ALL_ACCENTS.includes(state.settings.accent) ? state.settings.accent : vuneBatchStoredAccent()) : vuneBatchStoredAccent();
  if(state && state.settings){
    state.settings.appearance = appearance;
    state.settings.accent = accent;
    localStorage.setItem(VUNE_APPEARANCE_PREF_KEY, appearance);
    localStorage.setItem(VUNE_ACCENT_PREF_KEY, accent);
  }
  vuneApplyDisplayPreferences(appearance, accent);
};

function vuneEnsureTenAccents(){
  const options = document.querySelector(".accent-options");
  if(!options) return;
  const additions = [
    ["periwinkle","Periwinkle"],["aqua","Pastel aqua"],["sage","Soft sage"],["butter","Butter yellow"],["mauve","Mauve"]
  ];
  additions.forEach(([value,label]) => {
    if(options.querySelector('[data-accent="'+value+'"]')) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "accent-option";
    button.dataset.accent = value;
    button.innerHTML = "<span></span>" + label;
    options.appendChild(button);
  });
  vuneApplyDisplayPreferences(vuneStoredAppearance(), vuneBatchStoredAccent());
}

const vuneBatchRenderSettingsBase = renderSettings;
renderSettings = function(){
  vuneBatchRenderSettingsBase();
  vuneEnsureTenAccents();
  if(!state || !state.settings) return;
  const savedPlan = localStorage.getItem(VUNE_BETA_PLAN_KEY);
  if(savedPlan && planNames[savedPlan] && savedPlan !== state.settings.plan){
    state.settings.plan = savedPlan;
    persistState();
  }
  const completeUnlock = document.querySelector('.plan-card[data-plan="complete"] .new-unlock');
  if(completeUnlock) completeUnlock.textContent = "Adds Advanced Pattern Insights";
  const supporterUnlock = document.querySelector('.plan-card[data-plan="supporter"] .new-unlock');
  if(supporterUnlock) supporterUnlock.textContent = "Adds Vune AI Companion";
};

/* Beta plan switcher: explicit selection, persistent, freely switchable. */
async function vuneSelectBetaPlan(plan){
  if(!state || !planNames[plan]) return;
  state.settings.plan = plan;
  localStorage.setItem(VUNE_BETA_PLAN_KEY, plan);
  await persistState();
  renderAll();
  renderSettings();
  showToast(planNames[plan] + " is now the current beta plan ✨");
}

document.addEventListener("click", function(event){
  const plan = event.target.closest("[data-plan]");
  if(plan && state){
    event.preventDefault();
    event.stopImmediatePropagation();
    vuneSelectBetaPlan(plan.dataset.plan);
    return;
  }
}, true);

/* Accent clicks need to accept all ten values rather than the earlier five-value list. */
document.addEventListener("click", function(event){
  const accent = event.target.closest("[data-accent]");
  if(!accent || !state || !VUNE_ALL_ACCENTS.includes(accent.dataset.accent)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  state.settings.accent = accent.dataset.accent;
  localStorage.setItem(VUNE_ACCENT_PREF_KEY, state.settings.accent);
  persistState().then(function(){ applyAppearance(); vuneEnsureTenAccents(); });
}, true);

/* Daily check-in: make the submit path deterministic and keep the entry in the encrypted vault. */
document.addEventListener("submit", function(event){
  if(event.target && event.target.id === "checkinForm"){
    event.preventDefault();
    event.stopImmediatePropagation();
    saveCheckin(event);
  }
}, true);

/* Past Check-ins page. */
function vuneEnsurePastCheckinsView(){
  let view = safe("view-past-checkins");
  if(!view){
    view = document.createElement("section");
    view.id = "view-past-checkins";
    view.className = "view past-checkins-view";
    const main = document.querySelector(".main-content");
    const footer = main && main.querySelector(".app-footer");
    if(main) main.insertBefore(view, footer || null);
  }
  const formActions = document.querySelector("#checkinForm .form-actions");
  if(formActions && !safe("viewPastCheckinsBtn")){
    const button = document.createElement("button");
    button.id = "viewPastCheckinsBtn";
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = "View Past Check-ins";
    formActions.appendChild(button);
  }
  return view;
}

function vuneCheckinSummary(entry){
  const bits = [];
  if(entry.period) bits.push("Period day" + (getPeriodDayNumber(entry.date) ? " " + getPeriodDayNumber(entry.date) : ""));
  if(entry.flow && entry.flow !== "none") bits.push(entry.flow.charAt(0).toUpperCase()+entry.flow.slice(1)+" flow");
  if(entry.mood) bits.push("Mood: "+entry.mood);
  if(entry.symptoms && entry.symptoms.length) bits.push(entry.symptoms.length+" symptom"+(entry.symptoms.length===1?"":"s"));
  return bits.length ? bits.join(" • ") : "Saved Daily Check-in";
}

function vuneRenderPastCheckins(selectedDate){
  const view = vuneEnsurePastCheckinsView();
  if(!view || !state) return;
  const entries = Object.values(state.entries || {}).filter(Boolean).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const selected = selectedDate && state.entries[selectedDate];
  let content = "";
  if(selected){
    content = '<article class="card past-checkin-detail"><div class="past-checkin-detail-head"><div><span class="eyebrow">Saved Daily Check-in</span><h3>'+esc(prettyDate(selected.date,{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+'</h3></div><button class="secondary-btn" type="button" data-go="calendar">← Back to Calendar</button></div><div class="past-checkin-fields">'+
      '<div><small>Cycle</small><strong>'+(selected.period?'Period day '+(getPeriodDayNumber(selected.date)||""):'No period logged')+'</strong></div>'+
      '<div><small>Flow</small><strong>'+esc(selected.flow && selected.flow!=="none" ? selected.flow : "None logged")+'</strong></div>'+
      '<div><small>Mood</small><strong>'+esc(selected.mood || "None logged")+'</strong></div>'+
      '<div><small>Symptoms</small><strong>'+esc((selected.symptoms||[]).join(", ") || "None logged")+'</strong></div>'+
      '</div>'+(selected.reflection?'<div class="past-checkin-note"><small>Note</small><p>'+esc(selected.reflection)+'</p></div>':'')+'</article>';
  } else {
    content = entries.length ? '<div class="past-checkin-list">'+entries.map(entry => '<button class="card past-checkin-row" type="button" data-past-checkin-date="'+esc(entry.date)+'"><span><strong>'+esc(prettyDate(entry.date,{weekday:"short",month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))+'</strong><small>'+esc(vuneCheckinSummary(entry))+'</small></span><span aria-hidden="true">→</span></button>').join("")+'</div>' : '<article class="card"><p class="muted">Your completed Daily Check-ins will appear here.</p></article>';
  }
  view.innerHTML = '<div class="page-heading"><div><span class="eyebrow">Your history</span><h2>Past Check-ins</h2><p class="muted">Review the Daily Check-ins saved in your encrypted Vune vault.</p></div><button class="secondary-btn" type="button" data-go="today">← Daily Check-in</button></div>'+content;
  showView("past-checkins");
}

/* Calendar links now route to the saved check-in page, not back into the editor. */
document.addEventListener("click", function(event){
  const open = event.target.closest("[data-open-checkin]");
  if(open){
    event.preventDefault();
    event.stopImmediatePropagation();
    vuneRenderPastCheckins(open.dataset.openCheckin);
    return;
  }
  if(event.target.closest("#viewPastCheckinsBtn")){
    event.preventDefault();
    event.stopImmediatePropagation();
    vuneRenderPastCheckins();
    return;
  }
  const row = event.target.closest("[data-past-checkin-date]");
  if(row){ vuneRenderPastCheckins(row.dataset.pastCheckinDate); return; }
  if(event.target.closest("[data-past-checkin-list]")){ vuneRenderPastCheckins(); return; }
}, true);

/* Smooth the in-calendar expansion/collapse instead of an immediate pop. */
const vuneBatchOpenDayDetailBase = openDayDetail;
openDayDetail = function(date){
  const grid = safe("calendarGrid");
  if(grid && grid.animate) grid.animate([{opacity:1,transform:"translateY(0)"},{opacity:.25,transform:"translateY(8px)"}],{duration:130,easing:"ease-out"});
  setTimeout(function(){
    vuneBatchOpenDayDetailBase(date);
    const next = safe("calendarGrid");
    if(next && next.animate) next.animate([{opacity:0,transform:"translateY(14px)"},{opacity:1,transform:"translateY(0)"}],{duration:300,easing:"cubic-bezier(.2,.8,.2,1)"});
  },120);
};

document.addEventListener("click", function(event){
  if(!event.target.closest("[data-calendar-back]")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const grid = safe("calendarGrid");
  const done = function(){ renderCalendar(); const g=safe("calendarGrid"); if(g&&g.animate)g.animate([{opacity:0},{opacity:1}],{duration:260,easing:"ease-out"}); };
  if(grid && grid.animate){ const a=grid.animate([{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(10px)"}],{duration:180,easing:"ease-in"}); a.onfinish=done; } else done();
}, true);

/* Companion quick actions populate the input; Ask performs the request. */
document.addEventListener("click", function(event){
  const quick = event.target.closest("[data-assistant-prompt]");
  if(!quick) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const input = safe("assistantPrompt");
  if(input){ input.value = quick.dataset.assistantPrompt || ""; input.focus(); input.setSelectionRange(input.value.length,input.value.length); }
}, true);

function vuneRecentEntries(limit){
  return Object.values((state && state.entries) || {}).filter(Boolean).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,limit||30);
}
function vuneAnalyticsSummary(){
  const entries = vuneRecentEntries(30), symptoms = getSymptomCounts(), moods = getMoodCounts(), cycles = getCycleLengths(), parts=[];
  parts.push(entries.length ? "I reviewed your most recent "+entries.length+" saved check-in"+(entries.length===1?"":"s")+"." : "You don’t have enough saved check-ins for a pattern summary yet.");
  if(symptoms.length) parts.push("The symptoms showing up most are "+symptoms.slice(0,3).map(x=>x.name+" ("+x.count+")").join(", ")+".");
  if(moods.length) parts.push("Your most frequently logged moods are "+moods.slice(0,3).map(x=>x.name+" ("+x.count+")").join(", ")+".");
  if(cycles.length){ const values=cycles.map(x=>x.days); parts.push("Your recorded cycle lengths average about "+Math.round(average(values))+" days, with a "+Math.min(...values)+"–"+Math.max(...values)+" day range."); }
  return parts.join(" ");
}
function vuneAppointmentPrep(){
  const entries=vuneRecentEntries(30), symptoms=getSymptomCounts(), moods=getMoodCounts(), cycles=getCycleLengths(), lines=[];
  lines.push("Here’s a concise appointment-prep summary from your Vune records:");
  lines.push("• Check-ins reviewed: "+entries.length);
  if(symptoms.length) lines.push("• Most logged symptoms: "+symptoms.slice(0,5).map(x=>x.name+" ("+x.count+")").join(", "));
  if(moods.length) lines.push("• Most logged moods: "+moods.slice(0,5).map(x=>x.name+" ("+x.count+")").join(", "));
  if(cycles.length){const values=cycles.map(x=>x.days);lines.push("• Recorded cycle range: "+Math.min(...values)+"–"+Math.max(...values)+" days; average "+Math.round(average(values))+" days");}
  if(!entries.length) lines.push("• There isn’t enough tracked information yet to build a detailed report.");
  return lines.join("\n");
}
function vuneMedicalFollowup(text){
  return text + "\n\nI can help you understand patterns in your Vune data, but I can’t diagnose medical conditions. You can share these observations with your healthcare provider.\n\nWould you like me to put together a doctor-appointment-ready report?";
}

const vuneBatchAnswerAssistantBase = answerAssistant;
answerAssistant = function(prompt){
  const text=String(prompt||"").trim(), lower=text.toLowerCase();
  if(/gentle summary|recent patterns|what symptoms|keeps showing up|patterns/.test(lower)) return vuneMedicalFollowup(vuneAnalyticsSummary());
  if(/appointment prep|doctor appointment|provider report|doctor-appointment-ready|health summary/.test(lower)) return vuneMedicalFollowup(vuneAppointmentPrep());
  const answer=vuneBatchAnswerAssistantBase(prompt);
  if(/symptom|mood|cycle|period|pregnan|diagnos|pcos|endometri|health|pain|bleed|flow|prediction/.test(lower)) return vuneMedicalFollowup(answer);
  return answer;
};

/* Delete active browser copy but retain its encrypted recovery backup, then reset UI defaults. */
deleteAllData = function(){
  if(!confirm("Delete this Vune browser copy and reset the app to its default settings?")) return;
  if(!confirm("Final confirmation: remove the active vault from this browser? Your encrypted recovery backup will remain available for Recovery Key restore.")) return;
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(VUNE_APPEARANCE_PREF_KEY);
  localStorage.removeItem(VUNE_ACCENT_PREF_KEY);
  localStorage.removeItem(VUNE_BETA_PLAN_KEY);
  document.body.classList.remove("theme-dark");
  vuneApplyDisplayPreferences("light","lavender");
  location.reload();
};

/* Make Restore Backup reachable after the active vault is deleted. */
function vuneEnsureRestoreOnSetup(){
  const setup = safe("setupPanel");
  if(!setup || safe("restoreFromSetupBtn")) return;
  const button=document.createElement("button");
  button.id="restoreFromSetupBtn";
  button.className="secondary-btn restore-from-setup";
  button.type="button";
  button.textContent="Restore backup";
  button.addEventListener("click", function(){ ensureRecoveryModal(); safe("recoveryModal").hidden=false; });
  setup.appendChild(button);
}

const vuneBatchShowSetupBase = showSetup;
showSetup = function(){
  vuneApplyDisplayPreferences("light", "lavender");
  vuneBatchShowSetupBase();
  vuneEnsureRestoreOnSetup();
};

/* Recovery Key alone is permitted only in this development/web-test build.
   The visible Web test note in ensureRecoveryModal is intentionally unchanged. */
const vuneBatchEnsureRecoveryModalBase = ensureRecoveryModal;
ensureRecoveryModal = function(){
  vuneBatchEnsureRecoveryModalBase();
  const confirmButton=safe("confirmRecoveryBtn");
  if(confirmButton) confirmButton.disabled=!VUNE_DEVELOPMENT_MODE;
};

/* Recovery Key reveal is implemented by the final secure-dialog layer below. */

/* Keep the newly added controls available whenever app content rerenders. */
const vuneBatchRenderAllBase = renderAll;
renderAll = function(){
  vuneBatchRenderAllBase();
  vuneEnsurePastCheckinsView();
  vuneEnsureTenAccents();
  applyAppearance();
};

/* Apply persisted beta appearance immediately, including lock screen. */
vuneApplyDisplayPreferences(vuneStoredAppearance(), vuneBatchStoredAccent());
setTimeout(function(){ vuneEnsurePastCheckinsView(); vuneEnsureRestoreOnSetup(); },0);


/* ===== subscription-switch-fix.js ===== */
"use strict";

/* Targeted beta subscription-switch fix.
   Keep this isolated: no appearance, recovery, calendar, check-in, or Companion behavior is changed here. */

function vuneSyncStoredBetaPlan(){
  if(!state || !state.settings) return;
  const savedPlan = localStorage.getItem(VUNE_BETA_PLAN_KEY);
  if(savedPlan && planNames[savedPlan]) state.settings.plan = savedPlan;
}

/* Apply the saved beta plan before Settings renders, so Current Plan never shows stale state. */
const vuneSubscriptionRenderSettingsBase = renderSettings;
renderSettings = function(){
  vuneSyncStoredBetaPlan();
  vuneSubscriptionRenderSettingsBase();
};

/* Apply the saved beta plan before any whole-app rerender as well. */
const vuneSubscriptionRenderAllBase = renderAll;
renderAll = function(){
  vuneSyncStoredBetaPlan();
  vuneSubscriptionRenderAllBase();
};

/* One source of truth for beta plan selection. The existing click handlers can call either name. */
async function vuneSetBetaPlan(plan){
  if(!state || !state.settings || !planNames[plan]) return;
  state.settings.plan = plan;
  localStorage.setItem(VUNE_BETA_PLAN_KEY, plan);
  await persistState();
  renderAll();
  showToast(planNames[plan] + " is now your current beta plan ✨");
}

vuneSelectBetaPlan = vuneSetBetaPlan;
selectPlan = vuneSetBetaPlan;


/* ===== surgical-fixes-2026-09-25.js ===== */
"use strict";

/* Surgical fixes only — preserve existing feature logic, storage, palette names/count, and navigation structure. */
(function(){
  function stableAppearance(){
    if(typeof vuneApplyDisplayPreferences !== "function") return;
    const appearance = state && state.settings && ["light","dark","system"].includes(state.settings.appearance)
      ? state.settings.appearance
      : (typeof vuneStoredAppearance === "function" ? vuneStoredAppearance() : "light");
    const accent = state && state.settings && typeof VUNE_ALL_ACCENTS !== "undefined" && VUNE_ALL_ACCENTS.includes(state.settings.accent)
      ? state.settings.accent
      : (typeof vuneBatchStoredAccent === "function" ? vuneBatchStoredAccent() : "lavender");

    if(state && state.settings){
      state.settings.appearance = appearance;
      state.settings.accent = accent;
      if(typeof VUNE_APPEARANCE_PREF_KEY !== "undefined") localStorage.setItem(VUNE_APPEARANCE_PREF_KEY, appearance);
      if(typeof VUNE_ACCENT_PREF_KEY !== "undefined") localStorage.setItem(VUNE_ACCENT_PREF_KEY, accent);
    }
    vuneApplyDisplayPreferences(appearance, accent);
  }

  function syncPlanBadge(){
    if(!state || !state.settings) return;
    const plan = planNames[state.settings.plan] ? state.settings.plan : "free";
    const badge = safe("activePlanBadge");
    if(badge){
      badge.textContent = planNames[plan];
      badge.dataset.plan = plan;
      badge.setAttribute("aria-label", "Current plan: " + planNames[plan]);
    }
  }

  /* Navigation and Settings rerenders must never silently restore the default palette. */
  if(typeof showView === "function"){
    const baseShowView = showView;
    showView = function(name){
      const result = baseShowView(name);
      stableAppearance();
      syncPlanBadge();
      requestAnimationFrame(function(){
        stableAppearance();
        syncPlanBadge();
      });
      return result;
    };
  }

  if(typeof renderSettings === "function"){
    const baseRenderSettings = renderSettings;
    renderSettings = function(){
      const result = baseRenderSettings();
      stableAppearance();
      syncPlanBadge();
      requestAnimationFrame(function(){
        stableAppearance();
        syncPlanBadge();
      });
      return result;
    };
  }

  if(typeof renderToday === "function"){
    const baseRenderToday = renderToday;
    renderToday = function(){
      const result = baseRenderToday();
      syncPlanBadge();
      return result;
    };
  }

  if(typeof renderAll === "function"){
    const baseRenderAll = renderAll;
    renderAll = function(){
      const result = baseRenderAll();
      stableAppearance();
      syncPlanBadge();
      return result;
    };
  }

  /* Final beta plan setter: one source of truth, with immediate home-badge synchronization. */
  async function setBetaPlanAndSync(plan){
    if(!state || !state.settings || !planNames[plan]) return;
    state.settings.plan = plan;
    if(typeof VUNE_BETA_PLAN_KEY !== "undefined") localStorage.setItem(VUNE_BETA_PLAN_KEY, plan);
    await persistState();
    renderAll();
    syncPlanBadge();
    showToast(planNames[plan] + " is now your current beta plan ✨");
  }
  vuneSelectBetaPlan = setBetaPlanAndSync;
  selectPlan = setBetaPlanAndSync;

  /* Daily check-ins save in place and remain available in history. */
  saveCheckin = async function(ev){
    if(ev && typeof ev.preventDefault === "function") ev.preventDefault();
    if(!state) return;

    const date = safe("checkinDate").value;
    const period = safe("periodToday").checked;
    const flow = safe("flowSelect").value;
    const mood = safe("moodSelect").value;
    const symptoms = Array.from(document.querySelectorAll("#symptomChips input:checked")).map(function(input){ return input.value; });
    const reflection = safe("dailyReflection").value.trim();

    if(!(period || flow !== "none" || mood || symptoms.length || reflection)){
      if(safe("checkinRequirement")) safe("checkinRequirement").hidden = false;
      showToast("Add at least one feeling, symptom, cycle detail, or note before saving your check-in.");
      return;
    }

    if(safe("checkinRequirement")) safe("checkinRequirement").hidden = true;

    state.entries[date] = {
      date: date,
      period: period,
      flow: flow,
      mood: mood,
      symptoms: symptoms,
      reflection: reflection,
      updatedAt: new Date().toISOString()
    };


    await persistState();
    renderAll();
    safe("checkinDate").value = date;
    loadCheckinForDate(date);

    const saveStatus = safe("saveCheckinStatus");
    if(saveStatus){
      saveStatus.textContent = "✓ Check-in saved successfully";
      saveStatus.classList.add("checkin-save-confirmation");
      saveStatus.setAttribute("role","status");
      saveStatus.setAttribute("aria-live","polite");
    }
    showToast("Check-in saved. 💜");
  };

  /* Keep the local prototype conversational for general wellness prompts while
     preserving cycle analytics, appointment prep, and medical guardrails below it. */
  if(typeof answerAssistant === "function"){
    const baseAnswerAssistant = answerAssistant;
    answerAssistant = function(prompt){
      const text = String(prompt || "").trim();
      const lower = text.toLowerCase();

      if(/\b(relax|relaxation|calm down|wind down|de-?stress|stress relief|breathing exercise|grounding)\b/.test(lower)){
        return "Absolutely 🌿 A few gentle options you can try are:\n\n• Slow breathing — inhale for 4, exhale for 6, for a minute or two.\n• Progressive muscle relaxation — gently tense and release one muscle group at a time.\n• 5-4-3-2-1 grounding — notice 5 things you see, 4 you feel, 3 you hear, 2 you smell, and 1 you taste.\n• A short walk or light stretch if movement feels good.\n• A low-stimulation wind-down: dim lights, quiet music, or a warm shower.\n\nIf you tell me whether you want something quick, physical, or bedtime-friendly, I can narrow it down.";
      }

      const reply = baseAnswerAssistant(prompt);
      const lastAssistant = state && Array.isArray(state.assistantMessages)
        ? [...state.assistantMessages].reverse().find(function(message){ return message && message.role === "assistant"; })
        : null;

      if(lastAssistant && lastAssistant.text === reply && !/summary|pattern|period|cycle|symptom|mood|appointment|doctor|health|diagnos|pregnan/.test(lower)){
        return "I’m with you 🌿 Tell me a little more about what you want help with, and I’ll respond to that directly.";
      }
      return reply;
    };
  }



  /* Bloom Notes history: the main journal shows only the newest saved note.
     Opening a note routes to a dedicated history page instead of filling the
     new-entry form. */
  function vuneSortedJournalEntries(){
    if(!state || !Array.isArray(state.journals)) return [];
    return state.journals.slice().sort(function(a,b){
      const byDate = String(b.date || "").localeCompare(String(a.date || ""));
      if(byDate) return byDate;
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
  }

  function vuneEnsureJournalEntriesView(){
    let view = safe("view-journal-entries");
    if(view) return view;
    view = document.createElement("section");
    view.id = "view-journal-entries";
    view.className = "view journal-entries-view";
    const main = document.querySelector(".main-content");
    const footer = main && main.querySelector(".app-footer");
    if(main) main.insertBefore(view, footer || null);
    return view;
  }

  function vuneRenderJournalEntries(selectedId){
    if(!state || !hasJournal()) return;
    const view = vuneEnsureJournalEntriesView();
    const entries = vuneSortedJournalEntries();

    const content = entries.length
      ? entries.map(function(j){
          const selected = selectedId && String(j.id) === String(selectedId);
          return '<article class="card journal-history-entry'+(selected?' selected':'')+'" data-journal-entry-id="'+esc(j.id)+'">'+
            '<div class="journal-entry-head"><div><span class="eyebrow">'+esc(prettyDate(j.date))+'</span><h3>'+
            esc(j.title || prettyDate(j.date,{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+
            '</h3></div><div class="journal-actions">'+
            '<button class="text-btn" type="button" data-journal-edit-from-entries="'+esc(j.id)+'">Edit</button>'+
            '<button class="text-btn danger-text" type="button" data-delete-journal="'+esc(j.id)+'">Delete</button>'+
            '</div></div><p class="journal-history-text">'+esc(j.text || "")+'</p></article>';
        }).join("")
      : '<article class="card empty-state"><strong>No Bloom Notes yet.</strong><br><span>Your saved notes will appear here.</span></article>';

    view.innerHTML =
      '<div class="page-heading"><div><span class="eyebrow">Your private journal</span><h2>Bloom Notes Entries</h2>'+
      '<p class="muted">Most recent to oldest.</p></div>'+
      '<button class="secondary-btn" type="button" data-go="journal">← Back to Bloom Notes</button></div>'+
      '<div class="journal-history-page-list">'+content+'</div>';

    showView("journal-entries");

    if(selectedId){
      requestAnimationFrame(function(){
        const selected = view.querySelector('[data-journal-entry-id="'+CSS.escape(String(selectedId))+'"]');
        if(selected) selected.scrollIntoView({behavior:"smooth",block:"center"});
      });
    }
  }

  renderJournal = function(){
    if(!state || !hasJournal()) return;
    const list = safe("journalList");
    if(!list) return;

    const heading = document.querySelector("#view-journal .journal-history-heading");
    if(heading){
      const eyebrow = heading.querySelector(".eyebrow");
      const title = heading.querySelector("h3");
      if(eyebrow) eyebrow.textContent = "Most recent";
      if(title) title.textContent = "Latest Bloom Note";
    }

    const entries = vuneSortedJournalEntries();
    if(!entries.length){
      list.innerHTML = '<article class="card empty-state"><strong>No notes yet 💜</strong><br><span>This space is here whenever something feels worth remembering.</span></article>';
      return;
    }

    const j = entries[0];
    list.innerHTML =
      '<article class="journal-entry compact-entry journal-latest-entry"><div class="journal-entry-head"><div><span class="eyebrow">'+
      esc(prettyDate(j.date))+'</span><h3>'+
      esc(j.title || prettyDate(j.date,{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+
      '</h3></div><div class="journal-actions">'+
      '<button class="text-btn" type="button" data-open-journal="'+esc(j.id)+'">Open</button>'+
      '<button class="text-btn danger-text" type="button" data-delete-journal="'+esc(j.id)+'">Delete</button>'+
      '</div></div></article>'+
      (entries.length > 1
        ? '<button class="secondary-btn journal-view-all" type="button" data-view-all-journals>View all '+entries.length+' Bloom Notes →</button>'
        : '<button class="secondary-btn journal-view-all" type="button" data-view-all-journals>Open journal entries →</button>');
  };

  document.addEventListener("click", function(event){
    const open = event.target.closest("[data-open-journal]");
    if(open){
      event.preventDefault();
      event.stopImmediatePropagation();
      const sheet = safe("dayDetailSheet");
      if(sheet) sheet.hidden = true;
      vuneRenderJournalEntries(open.dataset.openJournal);
      return;
    }

    const all = event.target.closest("[data-view-all-journals]");
    if(all){
      event.preventDefault();
      event.stopImmediatePropagation();
      vuneRenderJournalEntries();
      return;
    }

    const edit = event.target.closest("[data-journal-edit-from-entries]");
    if(edit){
      event.preventDefault();
      event.stopImmediatePropagation();
      editJournal(edit.dataset.journalEditFromEntries);
      return;
    }
  }, true);

  /* Remove an accidental literal backslash-n text node left by an earlier patch. */
  Array.from(document.body.childNodes).forEach(function(node){
    if(node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "\\n") node.remove();
  });

  stableAppearance();
  syncPlanBadge();
})();


/* =========================================================
   VUNE AUDIT REPAIR LAYER — 2026-09-25
   Consolidates critical behavioral fixes while preserving the
   already-tested UI and feature flow above.
   ========================================================= */
(function(){
  "use strict";

  /* The consolidated stylesheet is loaded directly by index.html. */
  ensureEnhancementStyles = function(){};

  /* ---------- State validation + check-in history ---------- */
  const vuneAuditDefaultStateBase = defaultState;
  defaultState = function(){
    const next = vuneAuditDefaultStateBase();
    next.checkinHistory = [];
    return next;
  };

  const vuneAuditNormalizeStateBase = normalizeState;
  normalizeState = function(value){
    const next = vuneAuditNormalizeStateBase(value);
    if(!planNames[next.settings.plan]) next.settings.plan = "free";
    if(!["light","dark","system"].includes(next.settings.appearance)) next.settings.appearance = "light";
    const accentList = typeof VUNE_ALL_ACCENTS !== "undefined" ? VUNE_ALL_ACCENTS :
      (typeof VUNE_ACCENTS !== "undefined" ? VUNE_ACCENTS : ["lavender"]);
    if(!accentList.includes(next.settings.accent)) next.settings.accent = "lavender";
    if(!next.entries || typeof next.entries !== "object" || Array.isArray(next.entries)) next.entries = {};
    next.journals = Array.isArray(next.journals)
      ? next.journals.filter(function(j){ return j && typeof j === "object" && j.date && typeof j.text === "string"; })
      : [];
    next.assistantMessages = Array.isArray(next.assistantMessages)
      ? next.assistantMessages.filter(function(m){ return m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"; })
      : [];

    const suppliedHistory = value && Array.isArray(value.checkinHistory) ? value.checkinHistory : null;
    const migrated = suppliedHistory || Object.values(next.entries).filter(Boolean).map(function(entry){
      return Object.assign({},entry,{
        id: entry.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()),
        submittedAt: entry.updatedAt || entry.createdAt || (entry.date ? entry.date+"T12:00:00.000Z" : new Date().toISOString())
      });
    });
    next.checkinHistory = migrated.filter(function(entry){
      return entry && typeof entry === "object" && typeof entry.date === "string";
    }).map(function(entry){
      return Object.assign({},entry,{
        id: entry.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()),
        submittedAt: entry.submittedAt || entry.updatedAt || entry.createdAt || new Date().toISOString(),
        symptoms: Array.isArray(entry.symptoms) ? entry.symptoms : []
      });
    });
    return next;
  };

  /* ---------- Serialized encrypted writes ---------- */
  let vunePersistQueue = Promise.resolve();
  let vunePersistGeneration = 0;
  persistState = function(){
    if(!state || !currentKey) return Promise.resolve(false);

    const stamp = new Date().toISOString();
    state.settings.lastBackupAt = stamp;
    const snapshot = JSON.parse(JSON.stringify(state));
    const keySnapshot = currentKey;
    const generation = vunePersistGeneration;

    const run = vunePersistQueue.catch(function(){ return undefined; }).then(async function(){
      const activePayload = await encryptJson(snapshot,keySnapshot);
      const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
      const recoveryKey = await deriveKey(snapshot.settings.recoveryKey,recoverySalt);
      const recoveryPayload = await encryptJson(snapshot,recoveryKey);
      if(generation !== vunePersistGeneration) return false;

      localStorage.setItem(DATA_KEY,activePayload);
      localStorage.setItem(RECOVERY_BACKUP_KEY,JSON.stringify({
        format:"vune-recovery-backup",
        version:1,
        salt:toBase64(recoverySalt),
        payload:recoveryPayload,
        updatedAt:stamp
      }));
      return true;
    });

    vunePersistQueue = run;
    return run.catch(function(error){
      showToast("Vune could not save this change. Please try again.");
      throw error;
    });
  };

  /* ---------- Privacy curtain + immediate-on-background lock ---------- */
  scheduleAutoLock = function(){
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
    if(!state) return;
    const minutes = Number(state.settings.lockMinutes);
    if(minutes > 0) autoLockTimer = setTimeout(lockApp,minutes*60000);
  };

  function vuneApplyVisibilityPrivacy(){
    const hidden = document.hidden;
    document.body.classList.toggle("privacy-hidden",hidden);
    if(hidden && state && Number(state.settings.lockMinutes) === 0){
      lockApp().catch(function(){});
    }
  }
  document.addEventListener("visibilitychange",vuneApplyVisibilityPrivacy);
  window.addEventListener("pagehide",function(){ document.body.classList.add("privacy-hidden"); });
  window.addEventListener("pageshow",function(){ if(!document.hidden) document.body.classList.remove("privacy-hidden"); });

  /* Prevent stale unlocked tabs from overwriting a newer vault from another tab. */
  window.addEventListener("storage",function(event){
    if(event.key !== DATA_KEY || !state) return;
    vunePersistGeneration += 1;
    state = null;
    currentKey = null;
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
    showUnlock();
    showToast("Vune changed in another tab. Unlock again to continue safely.");
  });

  /* ---------- All ten accents + accessible selection state ---------- */
  const vuneAuditApplyDisplayBase = vuneApplyDisplayPreferences;
  vuneApplyDisplayPreferences = function(pref,accent){
    vuneAuditApplyDisplayBase(pref,accent);
    document.querySelectorAll("[data-appearance]").forEach(function(button){
      button.setAttribute("aria-pressed",String(button.classList.contains("active")));
    });
    document.querySelectorAll("[data-accent]").forEach(function(button){
      button.setAttribute("aria-pressed",String(button.classList.contains("active")));
    });

    const map = {
      lavender:"#9b7fbd", blue:"#8fb7d7", mint:"#9ccdb8", pink:"#d7a7bf", peach:"#e7b496",
      periwinkle:"#aeb8e8", aqua:"#9fd7d8", sage:"#b9cfae", butter:"#e9d890", mauve:"#c7a9c8"
    };
    const dark = document.body.classList.contains("theme-dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content",dark ? "#17151b" : (map[accent] || "#9b7fbd"));
  };

  /* ---------- Unlock throttling ---------- */
  let vuneUnlockFailures = 0;
  let vuneUnlockBlockedUntil = 0;
  const vuneAuditUnlockBase = unlockVault;
  unlockVault = async function(passcode){
    if(Date.now() < vuneUnlockBlockedUntil) throw new Error("Unlock temporarily paused");
    try{
      const result = await vuneAuditUnlockBase(passcode);
      vuneUnlockFailures = 0;
      vuneUnlockBlockedUntil = 0;
      return result;
    }catch(error){
      vuneUnlockFailures += 1;
      if(vuneUnlockFailures >= 5){
        vuneUnlockBlockedUntil = Date.now() + 30000;
        vuneUnlockFailures = 0;
      }
      throw error;
    }
  };

  /* ---------- Secure in-page passcode dialogs ---------- */
  function vuneSecureDialog(config){
    return new Promise(function(resolve){
      const dialog = document.createElement("dialog");
      dialog.className = "vune-secure-dialog";
      const needsConfirmation = Boolean(config.confirm);
      dialog.innerHTML =
        '<form method="dialog" class="vune-secure-card">'+
          '<span class="eyebrow">'+esc(config.eyebrow || "Vune security")+'</span>'+
          '<h3>'+esc(config.title || "Confirm")+'</h3>'+
          '<p class="muted">'+esc(config.message || "")+'</p>'+
          '<label>'+esc(config.label || "Passcode")+
            '<input id="vuneSecurePrimary" type="password" minlength="'+String(config.minLength || 6)+'" autocomplete="'+(config.autocomplete || "current-password")+'" required>'+
          '</label>'+
          (needsConfirmation
            ? '<label>Confirm new passcode<input id="vuneSecureConfirm" type="password" minlength="'+String(config.minLength || 6)+'" autocomplete="new-password" required></label>'
            : '')+
          '<p id="vuneSecureError" class="form-error" role="alert"></p>'+
          '<div class="button-row"><button class="primary-btn" value="confirm" type="submit">'+esc(config.confirmLabel || "Continue")+
          '</button><button class="secondary-btn" value="cancel" type="button" data-secure-cancel>Cancel</button></div>'+
        '</form>';
      document.body.appendChild(dialog);

      let settled = false;
      function finish(value){
        if(settled) return;
        settled = true;
        try{ dialog.close(); }catch(e){}
        dialog.remove();
        resolve(value);
      }

      dialog.querySelector("[data-secure-cancel]").addEventListener("click",function(){ finish(null); });
      dialog.addEventListener("cancel",function(event){ event.preventDefault(); finish(null); });
      dialog.querySelector("form").addEventListener("submit",function(event){
        event.preventDefault();
        const first = dialog.querySelector("#vuneSecurePrimary").value;
        const second = needsConfirmation ? dialog.querySelector("#vuneSecureConfirm").value : null;
        const error = dialog.querySelector("#vuneSecureError");
        if(first.length < (config.minLength || 6)){ error.textContent = "Use at least "+(config.minLength || 6)+" characters."; return; }
        if(needsConfirmation && first !== second){ error.textContent = "Passcodes did not match."; return; }
        finish({primary:first,confirm:second});
      });

      dialog.showModal();
      requestAnimationFrame(function(){ dialog.querySelector("#vuneSecurePrimary").focus(); });
    });
  }

  changePasscode = async function(force){
    const response = await vuneSecureDialog({
      eyebrow:"Vault security",
      title:force ? "Create a new vault passcode" : "Change your vault passcode",
      message:force
        ? "Create a new passcode to finish restoring this vault."
        : "Choose a new passcode for this encrypted browser vault.",
      label:"New passcode",
      confirm:true,
      autocomplete:"new-password",
      confirmLabel:"Save new passcode",
      minLength:8
    });
    if(!response){
      if(force) showToast("A new passcode is required before using Vune.");
      return false;
    }

    const oldSalt = localStorage.getItem(SALT_KEY);
    const oldPayload = localStorage.getItem(DATA_KEY);
    const oldKey = currentKey;

    try{
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(response.primary,salt);
      const payload = await encryptJson(state,key);

      localStorage.setItem(DATA_KEY,payload);
      localStorage.setItem(SALT_KEY,toBase64(salt));
      currentKey = key;
      await persistState();

      recoveryResetRequired = false;
      renderSettings();
      showToast("Your vault passcode has been updated.");
      return true;
    }catch(error){
      try{
        if(oldPayload != null) localStorage.setItem(DATA_KEY,oldPayload);
        if(oldSalt != null) localStorage.setItem(SALT_KEY,oldSalt);
      }catch(rollbackError){}
      currentKey = oldKey;
      showToast("Vune could not change the passcode. Your previous passcode is still active.");
      return false;
    }
  };

  showCurrentRecoveryKey = async function(){
    const response = await vuneSecureDialog({
      eyebrow:"Recovery Key",
      title:"Verify before revealing",
      message:"Enter your current Vune vault passcode.",
      label:"Vault passcode",
      autocomplete:"current-password",
      confirmLabel:"Reveal Recovery Key"
    });
    if(!response) return;

    try{
      const salt = localStorage.getItem(SALT_KEY);
      const payload = localStorage.getItem(DATA_KEY);
      if(!salt || !payload) throw new Error("No active vault");
      const key = await deriveKey(response.primary,fromBase64(salt));
      await decryptJson(payload,key);
      const box = safe("recoveryKeyDisplay");
      box.textContent = state.settings.recoveryKey;
      box.hidden = false;
      showToast("Recovery Key revealed after verification.");
    }catch(error){
      showToast("That vault passcode could not be verified.");
    }
  };

  /* ---------- Multiple check-ins on the same day ---------- */
  function vuneNewCheckinId(){
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+"-"+Math.random().toString(16).slice(2);
  }

  saveCheckin = async function(event){
    if(event && typeof event.preventDefault === "function") event.preventDefault();
    if(!state) return;

    const date = safe("checkinDate").value;
    const period = safe("periodToday").checked;
    const flow = safe("flowSelect").value;
    const mood = safe("moodSelect").value;
    const symptoms = Array.from(document.querySelectorAll("#symptomChips input:checked")).map(function(input){ return input.value; });
    const reflection = safe("dailyReflection").value.trim();

    if(!(period || flow !== "none" || mood || symptoms.length || reflection)){
      if(safe("checkinRequirement")) safe("checkinRequirement").hidden = false;
      showToast("Add at least one feeling, symptom, cycle detail, or note before saving your check-in.");
      return;
    }

    if(safe("checkinRequirement")) safe("checkinRequirement").hidden = true;
    const submittedAt = new Date().toISOString();
    const record = {
      id:vuneNewCheckinId(),
      date:date,
      period:period,
      flow:flow,
      mood:mood,
      symptoms:symptoms,
      reflection:reflection,
      submittedAt:submittedAt,
      updatedAt:submittedAt
    };

    if(!Array.isArray(state.checkinHistory)) state.checkinHistory = [];
    state.checkinHistory.push(record);
    state.entries[date] = Object.assign({},record);

    await persistState();
    renderAll();
    safe("checkinDate").value = date;
    loadCheckinForDate(date);

    const saveStatus = safe("saveCheckinStatus");
    if(saveStatus){
      saveStatus.textContent = "✓ Check-in saved successfully";
      saveStatus.classList.add("checkin-save-confirmation");
      saveStatus.setAttribute("role","status");
      saveStatus.setAttribute("aria-live","polite");
    }
    showToast("Check-in saved. 💜");
  };

  function vuneCheckinTime(entry){
    const raw = entry && (entry.submittedAt || entry.updatedAt || entry.createdAt);
    if(!raw) return "";
    const parsed = new Date(raw);
    if(Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  }

  vuneRenderPastCheckins = function(selectedKey){
    const view = vuneEnsurePastCheckinsView();
    if(!view || !state) return;

    const history = (Array.isArray(state.checkinHistory) ? state.checkinHistory : [])
      .slice()
      .sort(function(a,b){
        const aKey = String(a.submittedAt || a.updatedAt || a.date || "");
        const bKey = String(b.submittedAt || b.updatedAt || b.date || "");
        return bKey.localeCompare(aKey);
      });

    const selectedById = selectedKey && history.find(function(entry){ return String(entry.id) === String(selectedKey); });
    const selectedDateItems = !selectedById && selectedKey
      ? history.filter(function(entry){ return entry.date === selectedKey; })
      : [];

    function detail(entry,backMarkup){
      return '<article class="card past-checkin-detail"><div class="past-checkin-detail-head"><div>'+
        '<span class="eyebrow">Saved Daily Check-in</span><h3>'+
        esc(prettyDate(entry.date,{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+
        (vuneCheckinTime(entry) ? ' • '+esc(vuneCheckinTime(entry)) : '')+
        '</h3></div>'+backMarkup+'</div><div class="past-checkin-fields">'+
        '<div><small>Cycle</small><strong>'+(entry.period ? 'Period day '+(getPeriodDayNumber(entry.date)||"") : 'No period logged')+'</strong></div>'+
        '<div><small>Flow</small><strong>'+esc(entry.flow && entry.flow !== "none" ? entry.flow : "None logged")+'</strong></div>'+
        '<div><small>Mood</small><strong>'+esc(entry.mood || "None logged")+'</strong></div>'+
        '<div><small>Symptoms</small><strong>'+esc((entry.symptoms||[]).join(", ") || "None logged")+'</strong></div>'+
        '</div>'+(entry.reflection ? '<div class="past-checkin-note"><small>Note</small><p>'+esc(entry.reflection)+'</p></div>' : '')+
        '</article>';
    }

    let content = "";
    if(selectedById){
      content = detail(selectedById,'<button class="secondary-btn" type="button" data-past-checkin-date-list="'+esc(selectedById.date)+'">← This day’s check-ins</button>');
    }else if(selectedDateItems.length === 1){
      content = detail(selectedDateItems[0],'<button class="secondary-btn" type="button" data-go="calendar">← Back to Calendar</button>');
    }else if(selectedDateItems.length > 1){
      content = '<article class="card"><div class="past-checkin-detail-head"><div><span class="eyebrow">Check-ins for this day</span><h3>'+
        esc(prettyDate(selectedKey,{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}))+
        '</h3></div><button class="secondary-btn" type="button" data-go="calendar">← Back to Calendar</button></div>'+
        '<div class="past-checkin-list">'+selectedDateItems.map(function(entry,index){
          return '<button class="card past-checkin-row" type="button" data-past-checkin-id="'+esc(entry.id)+'"><span><strong>'+
            (vuneCheckinTime(entry) ? esc(vuneCheckinTime(entry)) : 'Check-in '+(index+1))+
            '</strong><small>'+esc(vuneCheckinSummary(entry))+'</small></span><span aria-hidden="true">→</span></button>';
        }).join("")+'</div></article>';
    }else{
      content = history.length
        ? '<div class="past-checkin-list">'+history.map(function(entry){
            return '<button class="card past-checkin-row" type="button" data-past-checkin-id="'+esc(entry.id)+'"><span><strong>'+
              esc(prettyDate(entry.date,{weekday:"short",month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))+
              (vuneCheckinTime(entry) ? ' • '+esc(vuneCheckinTime(entry)) : '')+
              '</strong><small>'+esc(vuneCheckinSummary(entry))+'</small></span><span aria-hidden="true">→</span></button>';
          }).join("")+'</div>'
        : '<article class="card"><p class="muted">Your completed Daily Check-ins will appear here.</p></article>';
    }

    view.innerHTML = '<div class="page-heading"><div><span class="eyebrow">Your history</span><h2>Past Check-ins</h2>'+
      '<p class="muted">Review every Daily Check-in saved in your encrypted Vune vault.</p></div>'+
      '<button class="secondary-btn" type="button" data-go="today">← Daily Check-in</button></div>'+content;
    showView("past-checkins");
  };

  document.addEventListener("click",function(event){
    const item = event.target.closest("[data-past-checkin-id]");
    if(item){
      event.preventDefault();
      event.stopImmediatePropagation();
      vuneRenderPastCheckins(item.dataset.pastCheckinId);
      return;
    }
    const dateList = event.target.closest("[data-past-checkin-date-list]");
    if(dateList){
      event.preventDefault();
      event.stopImmediatePropagation();
      vuneRenderPastCheckins(dateList.dataset.pastCheckinDateList);
    }
  },true);

  /* ---------- Cycle calculations: show irregular history, use plausible cycles for forecasts ---------- */
  getCycleLengths = function(){
    const starts = getPeriodStarts(), out = [];
    for(let i=1;i<starts.length;i++){
      const days = diffDays(starts[i-1],starts[i]);
      if(days > 0 && days <= 365) out.push({start:starts[i-1],next:starts[i],days:days});
    }
    return out;
  };

  getPrediction = function(){
    const starts = getPeriodStarts();
    if(!starts.length) return null;
    const usable = getCycleLengths().filter(function(item){ return item.days >= 15 && item.days <= 60; }).slice(-6);
    const avg = usable.length ? Math.round(average(usable.map(function(item){ return item.days; }))) : 28;
    const last = starts[starts.length-1];
    return {
      date:addDays(last,avg),
      average:avg,
      confidence:usable.length>=5 ? "Higher" : usable.length>=2 ? "Building" : "Early estimate"
    };
  };

  function vuneTypicalPeriodLength(){
    const starts = getPeriodStarts();
    const lengths = starts.map(function(start){
      let count = 0;
      let date = start;
      while(state.entries[date] && state.entries[date].period && count < 14){
        count += 1;
        date = addDays(date,1);
      }
      return count;
    }).filter(function(length){ return length >= 1 && length <= 14; });
    if(!lengths.length) return 5;
    return Math.max(2,Math.min(10,Math.round(average(lengths.slice(-6)))));
  }

  getPredictedPeriodDates = function(){
    if(!hasAnalytics()) return [];
    const prediction = getPrediction();
    if(!prediction) return [];
    const length = vuneTypicalPeriodLength();
    return Array.from({length:length},function(_,index){ return addDays(prediction.date,index); });
  };

  const vuneAuditRenderTodayBase = renderToday;
  renderToday = function(){
    vuneAuditRenderTodayBase();
    if(!state || !hasAnalytics()) return;
    const prediction = getPrediction();
    const detail = safe("predictionDetail");
    if(prediction && detail){
      const delta = diffDays(todayISO(),prediction.date);
      if(delta < 0) detail.textContent = "Estimate passed "+Math.abs(delta)+" day"+(Math.abs(delta)===1?"":"s")+" ago • "+prediction.average+"-day average";
    }
  };

  /* ---------- Complete-only advanced pattern detail ---------- */
  function vuneHasAdvancedInsights(){
    return Boolean(state && state.settings && planOrder[state.settings.plan] >= planOrder.complete);
  }

  const vuneAuditAddSeeMoreBase = typeof vuneAddSeeMore === "function" ? vuneAddSeeMore : null;
  if(vuneAuditAddSeeMoreBase){
    vuneAddSeeMore = function(card,type){
      if(!vuneHasAdvancedInsights()) return;
      vuneAuditAddSeeMoreBase(card,type);
    };
  }

  if(typeof vuneShowPatternDetail === "function"){
    const vuneAuditPatternDetailBase = vuneShowPatternDetail;
    vuneShowPatternDetail = function(type){
      if(!vuneHasAdvancedInsights()){
        showToast("Advanced pattern details unlock with Complete.");
        return;
      }
      return vuneAuditPatternDetailBase(type);
    };
  }

  const vuneAuditRenderInsightsBase = renderInsights;
  renderInsights = function(){
    vuneAuditRenderInsightsBase();
    if(!state || !hasAnalytics()) return;

    document.querySelectorAll(".pattern-see-more").forEach(function(button){
      if(!vuneHasAdvancedInsights()) button.remove();
    });

    const history = safe("cycleHistory");
    if(history){
      const bars = Array.from(history.children).filter(function(node){ return !node.classList.contains("pattern-see-more"); });
      while(bars.length > 3){
        const node = bars.shift();
        if(node) node.remove();
      }
    }

    if(vuneHasAdvancedInsights() && typeof vuneAddSeeMore === "function"){
      const symptomValues = getSymptomCounts();
      const moodValues = getMoodCounts();
      const cycles = getCycleLengths();
      if(symptomValues.length >= 3) vuneAddSeeMore(safe("symptomChart") && safe("symptomChart").parentElement,"body");
      if(moodValues.length >= 3) vuneAddSeeMore(safe("moodChart") && safe("moodChart").parentElement,"feelings");
      if(cycles.length >= 3) vuneAddSeeMore(history && history.parentElement,"cycle");
    }
  };

  /* ---------- Supporter Health Summary ---------- */
  function vuneOpenHealthSummary(){
    if(!state || !hasCompanion()){
      showToast("Health Summary is available with Supporter.");
      return;
    }
    const dialog = safe("reportDialog");
    const content = safe("reportContent");
    if(!dialog || !content) return;

    const symptoms = getSymptomCounts().slice(0,8);
    const moods = getMoodCounts().slice(0,8);
    const cycles = getCycleLengths();
    const periodStarts = getPeriodStarts().slice(-6).reverse();
    const checkins = Array.isArray(state.checkinHistory) ? state.checkinHistory.length : getEntryDates().length;
    const values = cycles.map(function(item){ return item.days; });

    content.innerHTML =
      '<section class="report-section"><h3>Tracking overview</h3><div class="report-grid">'+
        '<div class="report-metric"><strong>'+checkins+'</strong><small>check-ins</small></div>'+
        '<div class="report-metric"><strong>'+getPeriodStarts().length+'</strong><small>period starts</small></div>'+
        '<div class="report-metric"><strong>'+(values.length ? Math.round(average(values))+" days" : "—")+'</strong><small>average recorded cycle</small></div>'+
      '</div></section>'+
      '<section class="report-section"><h3>Frequently logged symptoms</h3><p>'+
        (symptoms.length ? symptoms.map(function(item){ return esc(item.name)+" ("+item.count+")"; }).join(", ") : "Not enough symptom data yet.")+
      '</p></section>'+
      '<section class="report-section"><h3>Frequently logged moods</h3><p>'+
        (moods.length ? moods.map(function(item){ return esc(item.name)+" ("+item.count+")"; }).join(", ") : "Not enough mood data yet.")+
      '</p></section>'+
      '<section class="report-section"><h3>Recent period starts</h3><p>'+
        (periodStarts.length ? periodStarts.map(function(date){ return esc(prettyDate(date)); }).join(" • ") : "No period starts logged yet.")+
      '</p></section>'+
      '<section class="report-section"><h3>For your appointment</h3><p>This summary organizes information you entered into Vune. It cannot diagnose a condition. You can share it with your healthcare provider and discuss any symptoms, cycle changes, pain, bleeding, or other concerns that matter to you.</p></section>';

    if(typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open","");
  }

  document.addEventListener("click",function(event){
    if(event.target.closest("#generateReportBtn")){
      event.preventDefault();
      vuneOpenHealthSummary();
      return;
    }
    if(event.target.closest("#closeReportBtn") || event.target.closest("#closeReportBtn2")){
      const dialog = safe("reportDialog");
      if(dialog && typeof dialog.close === "function") dialog.close();
      else if(dialog) dialog.removeAttribute("open");
      return;
    }
    if(event.target.closest("#printReportBtn")){
      window.print();
    }
  });

  /* ---------- Journal history edge cases ---------- */
  deleteJournal = async function(id){
    const journal = state && state.journals.find(function(item){ return item.id === id; });
    if(!journal) return;
    if(!confirm("Delete this journal entry? This cannot be undone.")) return;

    state.journals = state.journals.filter(function(item){ return item.id !== id; });
    if(journalEditingId === id){
      journalEditingId = null;
      if(safe("journalTitle")) safe("journalTitle").value = "";
      if(safe("journalText")) safe("journalText").value = "";
      if(safe("journalDate")) safe("journalDate").value = todayISO();
    }

    await persistState();
    renderJournal();
    renderCalendar();

    const card = document.querySelector('[data-journal-entry-id="'+CSS.escape(String(id))+'"]');
    if(card) card.remove();
    const pageList = document.querySelector("#view-journal-entries .journal-history-page-list");
    if(pageList && !pageList.querySelector("[data-journal-entry-id]")){
      pageList.innerHTML = '<article class="card empty-state"><strong>No Bloom Notes yet.</strong><br><span>Your saved notes will appear here.</span></article>';
    }
    showToast("Journal entry deleted.");
  };

  document.addEventListener("click",function(event){
    if(event.target.closest("[data-edit-journal],[data-journal-edit-from-entries]")) return;
    const nav = event.target.closest(".nav-btn[data-view],[data-go]");
    if(nav) journalEditingId = null;
  },true);

  /* ---------- Accurate deletion/recovery controls ---------- */
  const vuneAuditRewriteSettingsBase = rewriteSettingsCopy;
  rewriteSettingsCopy = function(){
    vuneAuditRewriteSettingsBase();

    const dataPanel = document.querySelector('[data-settings-panel="data"]');
    if(dataPanel){
      const dangerCard = dataPanel.querySelector(".danger-settings-card");
      if(dangerCard){
        const note = dangerCard.querySelector("p");
        if(note) note.textContent = "Deleting this browser copy removes the active encrypted vault and resets Vune. Your encrypted Recovery Key backup remains available unless you choose the permanent-delete option below.";
        const activeButton = dangerCard.querySelector("#deleteAllBtn");
        if(activeButton) activeButton.textContent = "Delete active browser copy";
        if(!dangerCard.querySelector("#deleteEverythingBtn")){
          const fullDelete = document.createElement("button");
          fullDelete.id = "deleteEverythingBtn";
          fullDelete.className = "danger-btn";
          fullDelete.type = "button";
          fullDelete.textContent = "Permanently delete vault + recovery backup";
          dangerCard.appendChild(fullDelete);
        }
      }
    }
  };

  async function vuneDeleteEverything(){
    if(!confirm("Permanently delete the active Vune vault and its encrypted Recovery Key backup?")) return;
    if(!confirm("Final confirmation: this removes all locally stored Vune data and cannot be undone.")) return;
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(SALT_KEY);
    localStorage.removeItem(RECOVERY_BACKUP_KEY);
    if(typeof VUNE_APPEARANCE_PREF_KEY !== "undefined") localStorage.removeItem(VUNE_APPEARANCE_PREF_KEY);
    if(typeof VUNE_ACCENT_PREF_KEY !== "undefined") localStorage.removeItem(VUNE_ACCENT_PREF_KEY);
    if(typeof VUNE_BETA_PLAN_KEY !== "undefined") localStorage.removeItem(VUNE_BETA_PLAN_KEY);
    location.reload();
  }

  document.addEventListener("click",function(event){
    if(event.target.closest("#deleteEverythingBtn")) vuneDeleteEverything();
  });

  /* ---------- Best-effort anti-framing for GitHub Pages prototype ---------- */
  if(window.self !== window.top){
    document.documentElement.classList.add("vune-framed");
    try{ window.top.location = window.self.location.href; }catch(error){}
  }
})();



/* =========================================================
   VUNE AUDIT FOLLOW-UP — multiple-check-in analytics + tier copy
   ========================================================= */
(function(){
  "use strict";

  planDetails.free = {price:"$0",note:"Cycle tracking + daily check-ins",unlock:"Track your cycle and review your history"};
  planDetails.essential = {price:"$4.99 / month",note:"Free + Predictions & Analytics",unlock:"Adds period prediction and pattern summaries"};
  planDetails.plus = {price:"$12.99 / month",note:"Essential + Bloom Notes",unlock:"Adds the private Bloom Notes journal"};
  planDetails.complete = {price:"$24.99 / month",note:"Plus + Advanced Pattern Details",unlock:"Adds expanded pattern and cycle detail"};
  planDetails.supporter = {price:"$32.99 / month",note:"Complete + Companion & Health Summary",unlock:"Adds Vune Companion, appointment prep, and Health Summary"};

  function vuneAllCheckins(){
    if(state && Array.isArray(state.checkinHistory) && state.checkinHistory.length) return state.checkinHistory;
    return Object.values((state && state.entries) || {}).filter(Boolean);
  }

  getSymptomCounts = function(){
    const counts = {};
    vuneAllCheckins().forEach(function(entry){
      (entry.symptoms || []).forEach(function(symptom){
        counts[symptom] = (counts[symptom] || 0) + 1;
      });
    });
    return Object.keys(counts).map(function(name){ return {name:name,count:counts[name]}; })
      .sort(function(a,b){ return b.count-a.count; });
  };

  getMoodCounts = function(){
    const counts = {};
    vuneAllCheckins().forEach(function(entry){
      if(entry.mood) counts[entry.mood] = (counts[entry.mood] || 0) + 1;
    });
    return Object.keys(counts).map(function(name){ return {name:name,count:counts[name]}; })
      .sort(function(a,b){ return b.count-a.count; });
  };

  vuneRecentEntries = function(limit){
    return vuneAllCheckins().slice().sort(function(a,b){
      return String(b.submittedAt || b.updatedAt || b.date || "").localeCompare(String(a.submittedAt || a.updatedAt || a.date || ""));
    }).slice(0,limit || 30);
  };
})();


/* ---------- Setup protection when a restorable backup already exists ---------- */
document.addEventListener("submit",async function(event){
  if(!event.target || event.target.id !== "setupForm") return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const first = safe("newPasscode").value;
  const second = safe("confirmPasscode").value;
  if(first.length < 8){ showToast("Use at least 8 characters."); return; }
  if(first !== second){ showToast("Passcodes do not match."); return; }

  if(!hasVault() && localStorage.getItem(RECOVERY_BACKUP_KEY)){
    const replace = confirm("An encrypted Vune Recovery Key backup is still available. Creating a new vault will replace that restorable backup. Continue with a new vault?");
    if(!replace){
      showToast("New vault creation cancelled. You can restore the existing backup instead.");
      return;
    }
  }

  try{
    await setupVault(first);
    safe("newPasscode").value = "";
    safe("confirmPasscode").value = "";
    showToast("Encrypted Vune vault created.");
  }catch(error){
    showToast("Could not create the encrypted vault in this browser.");
  }
},true);

/* Improve keyboard focus when opening prototype recovery and Terms overlays. */
const vuneAuditShowTermsGateBase = showTermsGate;
showTermsGate = function(){
  vuneAuditShowTermsGateBase();
  requestAnimationFrame(function(){
    const checkbox = safe("termsAgreeCheck");
    if(checkbox) checkbox.focus();
  });
};

const vuneAuditEnsureRecoveryModalBase2 = ensureRecoveryModal;
ensureRecoveryModal = function(){
  vuneAuditEnsureRecoveryModalBase2();
  setTimeout(function(){
    const modal = safe("recoveryModal");
    const input = safe("recoveryInput");
    if(modal && !modal.hidden && input) input.focus();
  },0);
};


/* =========================================================
   VUNE AUDIT COMPLETION — sensitive overlays + form state
   ========================================================= */
(function(){
  "use strict";

  function vuneCloseSensitiveOverlays(){
    document.querySelectorAll(".vune-secure-dialog").forEach(function(dialog){
      const cancel = dialog.querySelector("[data-secure-cancel]");
      if(cancel) cancel.click();
      else{
        try{ dialog.close(); }catch(error){}
        dialog.remove();
      }
    });

    const report = safe("reportDialog");
    if(report && report.open){
      try{ report.close(); }catch(error){ report.removeAttribute("open"); }
    }

    const recovery = safe("recoveryModal");
    if(recovery){
      recovery.hidden = true;
      const input = safe("recoveryInput");
      if(input) input.value = "";
    }

    if(safe("companionPanel")) setCompanionOpen(false);
  }

  const vuneAuditLockAppBase = lockApp;
  lockApp = async function(){
    vuneCloseSensitiveOverlays();
    return vuneAuditLockAppBase();
  };

  document.addEventListener("visibilitychange",function(){
    if(document.hidden) vuneCloseSensitiveOverlays();
  },true);

  const vuneAuditLoadCheckinBase = loadCheckinForDate;
  loadCheckinForDate = function(date){
    const status = safe("saveCheckinStatus");
    if(status) status.classList.remove("checkin-save-confirmation");
    const result = vuneAuditLoadCheckinBase(date);
    if(status && !status.textContent.trim()) status.removeAttribute("role");
    return result;
  };

  const vuneAuditShowAppBase = showApp;
  showApp = function(){
    const result = vuneAuditShowAppBase();
    const dateField = safe("checkinDate");
    if(state && dateField) loadCheckinForDate(dateField.value || todayISO());
    return result;
  };
})();
