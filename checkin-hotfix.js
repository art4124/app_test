"use strict";

/* Direct-load check-in hotfix.
   This file is loaded explicitly by index.html so the first-care sequence does
   not depend on a service-worker-composed script response. */
(function(){
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

    const isFirstCheckinForDate = !Object.prototype.hasOwnProperty.call(state.entries || {}, date);

    state.entries[date] = {
      date: date,
      period: period,
      flow: flow,
      mood: mood,
      symptoms: symptoms,
      reflection: reflection,
      updatedAt: new Date().toISOString()
    };

    state.ui.pendingGardenGrowth = isFirstCheckinForDate;

    await persistState();
    renderAll();
    safe("checkinDate").value = date;
    loadCheckinForDate(date);

    if(isFirstCheckinForDate){
      showToast("First check-in saved — watering your plant. 🌱💧");
      showView("garden");
    } else {
      showToast("Check-in updated and saved. Your plant was already cared for today. 💜");
    }
  };
})();
