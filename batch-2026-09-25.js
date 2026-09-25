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

/* On the web prototype, revealing the current Recovery Key uses exactly one factor: vault passcode.
   Native iPhone can replace this one factor with Face ID or device passcode, never stack them. */
showCurrentRecoveryKey = async function(){
  const pass=prompt("Enter your Vune vault passcode to reveal the Recovery Key.");
  if(!pass) return;
  try{
    const salt=localStorage.getItem(SALT_KEY), payload=localStorage.getItem(DATA_KEY);
    if(!salt || !payload) throw new Error("No active vault");
    const key=await deriveKey(pass,fromBase64(salt));
    await decryptJson(payload,key);
    const box=safe("recoveryKeyDisplay");
    box.textContent=state.settings.recoveryKey;
    box.hidden=false;
    showToast("Recovery Key revealed after one verification check. Keep it somewhere private.");
  }catch(e){ showToast("That vault passcode could not be verified."); }
};

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
