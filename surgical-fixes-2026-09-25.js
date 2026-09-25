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

  /* Garden is retired from the current beta. Daily check-ins now save normally
     without routing away from the page or triggering a care animation. */
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

    if(state.ui) state.ui.pendingGardenGrowth = false;

    await persistState();
    renderAll();
    safe("checkinDate").value = date;
    loadCheckinForDate(date);
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

  stableAppearance();
  syncPlanBadge();
})();