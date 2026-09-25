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
