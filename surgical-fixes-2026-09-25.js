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