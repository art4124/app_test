"use strict";

/* Surgical fixes only — preserve existing feature logic and palette definitions. */
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

  /* Navigation and Settings rerenders must never silently restore the default palette. */
  if(typeof showView === "function"){
    const baseShowView = showView;
    showView = function(name){
      const result = baseShowView(name);
      stableAppearance();
      requestAnimationFrame(stableAppearance);
      return result;
    };
  }

  if(typeof renderSettings === "function"){
    const baseRenderSettings = renderSettings;
    renderSettings = function(){
      const result = baseRenderSettings();
      stableAppearance();
      requestAnimationFrame(stableAppearance);
      return result;
    };
  }

  if(typeof renderAll === "function"){
    const baseRenderAll = renderAll;
    renderAll = function(){
      const result = baseRenderAll();
      stableAppearance();
      return result;
    };
  }

  /* A completed NEW daily check-in saves first, then opens Garden so the existing
     one-time watering/growth animation can consume pendingGardenGrowth immediately.
     Editing an existing date never earns a duplicate watering. */
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
      showToast("Add at least one feeling, symptom, cycle detail, or note before watering your plant. 🌱");
      return;
    }

    if(safe("checkinRequirement")) safe("checkinRequirement").hidden = true;
    const isNewEntry = !state.entries[date];

    state.entries[date] = {
      date: date,
      period: period,
      flow: flow,
      mood: mood,
      symptoms: symptoms,
      reflection: reflection,
      updatedAt: new Date().toISOString()
    };
    state.ui.pendingGardenGrowth = isNewEntry;

    await persistState();
    renderAll();
    safe("checkinDate").value = date;
    loadCheckinForDate(date);

    if(isNewEntry){
      showToast("Saved — watering your plant now. 🌱💧");
      showView("garden");
    } else {
      await persistState();
      showToast("Check-in updated. Your plant keeps its existing care day. 💜");
    }
  };

  stableAppearance();
})();
