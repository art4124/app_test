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
