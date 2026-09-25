"use strict";

const DATA_KEY = "vune_encrypted_state_v1";
const SALT_KEY = "vune_salt_v1";
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

const planNames = {
  free: "Free",
  essential: "Essential",
  plus: "Plus",
  complete: "Complete",
  supporter: "Supporter"
};

function defaultState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    settings: {
      plan: "supporter",
      lockMinutes: 5
    },
    entries: {},
    journals: [],
    assistantMessages: [],
    ui: {
      pendingGardenGrowth: false
    }
  };
}

function $(id) {
  return document.getElementById(id);
}

function toBase64(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i);
  return arr;
}

async function deriveKey(passcode, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passcode),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: ITERATIONS,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptState(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plaintext);
  return JSON.stringify({
    version: 1,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  });
}

async function decryptState(payload, key) {
  const parsed = JSON.parse(payload);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parsed.iv) },
    key,
    fromBase64(parsed.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function persistState() {
  if (!state || !currentKey) return;
  localStorage.setItem(DATA_KEY, await encryptState(state, currentKey));
}

function hasVault() {
  return Boolean(localStorage.getItem(DATA_KEY) && localStorage.getItem(SALT_KEY));
}

function showSetup() {
  $("lockScreen").hidden = false;
  $("appShell").hidden = true;
  $("setupPanel").hidden = false;
  $("unlockPanel").hidden = true;
  setTimeout(function () { $("newPasscode").focus(); }, 50);
}

function showUnlock() {
  $("lockScreen").hidden = false;
  $("appShell").hidden = true;
  $("setupPanel").hidden = true;
  $("unlockPanel").hidden = false;
  $("unlockError").textContent = "";
  $("unlockPasscode").value = "";
  setTimeout(function () { $("unlockPasscode").focus(); }, 50);
}

function showApp() {
  $("lockScreen").hidden = true;
  $("appShell").hidden = false;
  $("checkinDate").value = todayISO();
  $("journalDate").value = todayISO();
  renderAll();
  scheduleAutoLock();
}

async function setupVault(passcode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passcode, salt);
  currentKey = key;
  state = defaultState();
  localStorage.setItem(SALT_KEY, toBase64(salt));
  await persistState();
  showApp();
}

async function unlockVault(passcode) {
  const saltValue = localStorage.getItem(SALT_KEY);
  const payload = localStorage.getItem(DATA_KEY);
  if (!saltValue || !payload) throw new Error("No vault");
  const key = await deriveKey(passcode, fromBase64(saltValue));
  const decrypted = await decryptState(payload, key);
  currentKey = key;
  state = normalizeState(decrypted);
  showApp();
}

function normalizeState(value) {
  const base = defaultState();
  const normalized = Object.assign({}, base, value || {});
  normalized.settings = Object.assign({}, base.settings, normalized.settings || {});
  normalized.entries = normalized.entries || {};
  normalized.journals = Array.isArray(normalized.journals) ? normalized.journals : [];
  normalized.assistantMessages = Array.isArray(normalized.assistantMessages) ? normalized.assistantMessages : [];
  normalized.ui = Object.assign({}, base.ui, normalized.ui || {});
  return normalized;
}

async function lockApp() {
  if (state && currentKey) {
    try { await persistState(); } catch (error) { /* fail closed */ }
  }
  state = null;
  currentKey = null;
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  if (hasVault()) showUnlock();
  else showSetup();
}

function scheduleAutoLock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (!state) return;
  const minutes = Number(state.settings.lockMinutes);
  if (minutes <= 0) return;
  autoLockTimer = setTimeout(function () {
    lockApp();
  }, minutes * 60 * 1000);
}

function noteActivity() {
  if (state) scheduleAutoLock();
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function parseISO(value) {
  const parts = value.split("-").map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function isoFromDateUTC(date) {
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}

function addDays(value, days) {
  const date = parseISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDateUTC(date);
}

function diffDays(fromValue, toValue) {
  return Math.round((parseISO(toValue) - parseISO(fromValue)) / 86400000);
}

function prettyDate(value, options) {
  if (!value) return "—";
  const date = parseISO(value);
  return new Intl.DateTimeFormat(undefined, options || { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getEntryDates() {
  return Object.keys(state.entries || {}).sort();
}

function getPeriodStarts() {
  const dates = getEntryDates().filter(function (date) {
    return Boolean(state.entries[date] && state.entries[date].period);
  });
  return dates.filter(function (date) {
    const prev = addDays(date, -1);
    return !state.entries[prev] || !state.entries[prev].period;
  });
}

function getCycleLengths() {
  const starts = getPeriodStarts();
  const values = [];
  for (let i = 1; i < starts.length; i += 1) {
    const days = diffDays(starts[i - 1], starts[i]);
    if (days >= 15 && days <= 60) values.push({ start: starts[i - 1], next: starts[i], days: days });
  }
  return values;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
}

function getPrediction() {
  const starts = getPeriodStarts();
  if (!starts.length) return null;
  const cycles = getCycleLengths().slice(-6);
  let avg = cycles.length ? Math.round(average(cycles.map(function (item) { return item.days; }))) : 28;
  const last = starts[starts.length - 1];
  let predicted = addDays(last, avg);
  while (diffDays(predicted, todayISO()) > avg + 5) predicted = addDays(predicted, avg);
  const confidence = cycles.length >= 5 ? "Higher" : cycles.length >= 2 ? "Building" : "Early estimate";
  return { date: predicted, average: avg, confidence: confidence, cycles: cycles.length };
}

function getPredictedPeriodDates() {
  const prediction = getPrediction();
  if (!prediction) return [];
  const list = [];
  for (let i = 0; i < 5; i += 1) list.push(addDays(prediction.date, i));
  return list;
}

function getSymptomCounts() {
  const counts = {};
  getEntryDates().forEach(function (date) {
    const symptoms = state.entries[date].symptoms || [];
    symptoms.forEach(function (symptom) {
      counts[symptom] = (counts[symptom] || 0) + 1;
    });
  });
  return Object.keys(counts).map(function (name) {
    return { name: name, count: counts[name] };
  }).sort(function (a, b) { return b.count - a.count; });
}

function getMoodCounts() {
  const counts = {};
  getEntryDates().forEach(function (date) {
    const mood = state.entries[date].mood;
    if (mood) counts[mood] = (counts[mood] || 0) + 1;
  });
  return Object.keys(counts).map(function (name) {
    return { name: name, count: counts[name] };
  }).sort(function (a, b) { return b.count - a.count; });
}

function getLastEntryDate() {
  const dates = getEntryDates();
  return dates.length ? dates[dates.length - 1] : null;
}

function getGardenInfo() {
  const dates = getEntryDates();
  const waterings = dates.length;
  const first = dates.length ? dates[0] : null;
  const age = first ? Math.max(1, diffDays(first, todayISO()) + 1) : 0;
  const starts = getPeriodStarts().length;
  const milestones = [
    { id: "first", label: "First Sprout", detail: "First daily check-in", icon: "🌱", unlocked: waterings >= 1 },
    { id: "week", label: "Week of Care", detail: "7 days logged", icon: "🌿", unlocked: waterings >= 7 },
    { id: "month", label: "First Bloom", detail: "30 days logged", icon: "🌸", unlocked: waterings >= 30 },
    { id: "cycles", label: "Cycle Keeper", detail: "3 period starts tracked", icon: "💜", unlocked: starts >= 3 },
    { id: "season", label: "Season of Care", detail: "90 days logged", icon: "🪻", unlocked: waterings >= 90 }
  ];
  let stage = 0;
  let stageName = "Seed";
  let next = 1;
  let message = "Your garden is ready for its first moment of care.";
  if (waterings >= 1) { stage = 1; stageName = "Sprout"; next = 3; message = "A small beginning is still a beginning. 🌱"; }
  if (waterings >= 3) { stage = 2; stageName = "Growing"; next = 7; message = "Your check-ins are helping your garden take shape. 🌿"; }
  if (waterings >= 7) { stage = 3; stageName = "Budding"; next = 14; message = "You’re building a clearer picture of your cycle. 💜"; }
  if (waterings >= 14) { stage = 4; stageName = "Blooming"; next = 30; message = "Your care is turning into something beautiful and useful. 🌸"; }
  if (waterings >= 30) { stage = 5; stageName = "Full Bloom"; next = 30; message = "Your garden reflects time, care, and consistency — never perfection. ✨"; }
  const previousThreshold = stage === 0 ? 0 : stage === 1 ? 1 : stage === 2 ? 3 : stage === 3 ? 7 : stage === 4 ? 14 : 30;
  const progress = stage === 5 ? 100 : Math.max(0, Math.min(100, ((waterings - previousThreshold) / (next - previousThreshold)) * 100));
  return {
    waterings: waterings,
    age: age,
    periodStarts: starts,
    milestones: milestones,
    blooms: milestones.filter(function (item) { return item.unlocked; }).length,
    stage: stage,
    stageName: stageName,
    message: message,
    next: next,
    progress: progress
  };
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
}

function showView(name) {
  document.querySelectorAll(".view").forEach(function (view) {
    view.classList.toggle("active", view.id === "view-" + name);
  });
  document.querySelectorAll(".nav-btn[data-view]").forEach(function (button) {
    button.classList.toggle("active", button.dataset.view === name);
  });
  if (name === "calendar") renderCalendar();
  if (name === "garden") renderGarden();
  if (name === "journal") renderJournal();
  if (name === "insights") renderInsights();
  if (name === "assistant") renderAssistant();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  renderToday();
  renderCalendar();
  renderGarden();
  renderJournal();
  renderInsights();
  renderAssistant();
  renderSettings();
}

function renderToday() {
  const now = new Date();
  const hour = now.getHours();
  $("todayGreeting").textContent = hour < 12 ? "Good morning 💜" : hour < 18 ? "Good afternoon 🌿" : "Good evening 🌙";
  $("todayDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const prediction = getPrediction();
  if (prediction) {
    $("predictionDate").textContent = prettyDate(prediction.date, { month: "long", day: "numeric", timeZone: "UTC" });
    const until = diffDays(todayISO(), prediction.date);
    $("predictionDetail").textContent = until >= 0 ? "About " + until + " day" + (until === 1 ? "" : "s") + " away • " + prediction.average + "-day average" : Math.abs(until) + " days past this estimate • log a new start when it arrives";
    $("predictionConfidence").textContent = prediction.confidence;
  } else {
    $("predictionDate").textContent = "Add your first period";
    $("predictionDetail").textContent = "Once you log a period start, Vune can begin learning your rhythm.";
    $("predictionConfidence").textContent = "Still learning";
  }

  const last = getLastEntryDate();
  const returnBox = $("returnMessage");
  if (last && last < todayISO()) {
    const rested = diffDays(last, todayISO());
    returnBox.hidden = false;
    returnBox.textContent = "Welcome back 💜 Your garden has rested for " + rested + " day" + (rested === 1 ? "" : "s") + ". Everything you grew is still here.";
  } else {
    returnBox.hidden = true;
  }

  const garden = getGardenInfo();
  const plantEmoji = garden.stage >= 4 ? "🌸" : garden.stage >= 2 ? "🌿" : garden.stage >= 1 ? "🌱" : "🫘";
  $("miniPlant").textContent = plantEmoji;
  $("gardenMiniStatus").textContent = garden.stageName;
  $("gardenMiniDetail").textContent = garden.waterings + " care day" + (garden.waterings === 1 ? "" : "s") + " • no streaks, no lost progress";
  $("activePlanBadge").textContent = planNames[state.settings.plan] + (state.settings.plan === "supporter" ? " preview" : " preview");
}

function loadCheckinForDate(date) {
  const entry = state.entries[date] || {};
  $("flowSelect").value = entry.flow || "none";
  $("moodSelect").value = entry.mood || "";
  $("periodToday").checked = Boolean(entry.period);
  $("dailyReflection").value = entry.reflection || "";
  const selected = new Set(entry.symptoms || []);
  document.querySelectorAll("#symptomChips input[type=checkbox]").forEach(function (input) {
    input.checked = selected.has(input.value);
  });
  $("saveCheckinStatus").textContent = state.entries[date] ? "Saved entry loaded." : "";
  const requirement = $("checkinRequirement");
  if (requirement) requirement.hidden = true;
}

async function saveCheckin(event) {
  event.preventDefault();
  const date = $("checkinDate").value;
  if (!date) return;

  const period = $("periodToday").checked;
  const flow = $("flowSelect").value;
  const mood = $("moodSelect").value;
  const symptoms = Array.from(document.querySelectorAll("#symptomChips input:checked")).map(function (input) { return input.value; });
  const reflection = $("dailyReflection").value.trim();
  const hasMeaningfulEntry = period || flow !== "none" || Boolean(mood) || symptoms.length > 0 || reflection.length > 0;
  const requirement = $("checkinRequirement");

  if (!hasMeaningfulEntry) {
    if (requirement) {
      requirement.hidden = false;
      requirement.classList.remove("attention");
      void requirement.offsetWidth;
      requirement.classList.add("attention");
      requirement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    showToast("Add at least one feeling, symptom, cycle detail, or note before watering your plant. 🌱");
    return;
  }

  if (requirement) requirement.hidden = true;

  const existed = Boolean(state.entries[date]);
  state.entries[date] = {
    date: date,
    period: period,
    flow: flow,
    mood: mood,
    symptoms: symptoms,
    reflection: reflection,
    updatedAt: new Date().toISOString()
  };

  state.ui = state.ui || {};
  state.ui.pendingGardenGrowth = true;

  await persistState();
  renderAll();
  $("checkinDate").value = date;
  loadCheckinForDate(date);
  showToast(existed ? "Updated gently 💜 Your garden is ready to show a little growth." : "Saved — your plant had a drink today. Visit your garden to watch it grow. 🌱💧");
}

function renderCalendar() {
  if (!state) return;
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $("calendarMonthLabel").textContent = calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const predicted = new Set(getPredictedPeriodDates());
  const html = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    const entry = state.entries[iso];
    const muted = date.getMonth() !== month;
    const dots = [];
    if (entry && entry.period) dots.push('<i class="day-dot period"></i>');
    if (entry) dots.push('<i class="day-dot logged"></i>');
    if (predicted.has(iso) && !(entry && entry.period)) dots.push('<i class="day-dot predicted"></i>');
    html.push(
      '<button type="button" class="calendar-day' + (muted ? ' muted-day' : '') + (iso === todayISO() ? ' today' : '') + '" data-calendar-date="' + iso + '">' +
      '<span class="day-number">' + date.getDate() + '</span><span class="day-dots">' + dots.join("") + '</span></button>'
    );
  }
  $("calendarGrid").innerHTML = html.join("");
}

function playGardenGrowth() {
  const moment = $("growthMoment");
  const plant = $("plantArt");
  if (!moment || !plant) return;

  moment.hidden = false;
  moment.classList.remove("is-playing");
  plant.classList.remove("is-growing");
  void moment.offsetWidth;
  moment.classList.add("is-playing");
  plant.classList.add("is-growing");

  window.setTimeout(function () {
    moment.classList.remove("is-playing");
    plant.classList.remove("is-growing");
    moment.hidden = true;
  }, 2400);
}

function renderGarden() {
  if (!state) return;
  const garden = getGardenInfo();
  $("plantArt").className = "plant-art stage-" + garden.stage;
  $("plantStageName").textContent = garden.stageName;
  $("plantStageMessage").textContent = garden.message;
  $("gardenProgressBar").style.width = garden.progress + "%";
  $("gardenProgressText").textContent = garden.stage === 5 ? "Your garden is in full bloom." : garden.waterings + " of " + garden.next + " care days toward the next stage";
  $("wateringsCount").textContent = String(garden.waterings);
  $("bloomsCount").textContent = String(garden.blooms);
  $("gardenAge").textContent = String(garden.age);

  $("memoryBlooms").innerHTML = garden.milestones.map(function (item) {
    return '<div class="bloom-item' + (item.unlocked ? '' : ' locked') + '">' +
      '<span class="bloom-icon">' + item.icon + '</span><div><strong>' + escapeHtml(item.label) + '</strong><small>' +
      escapeHtml(item.unlocked ? item.detail + " • unlocked" : item.detail) + '</small></div></div>';
  }).join("");

  if (state.ui && state.ui.pendingGardenGrowth && $("view-garden").classList.contains("active")) {
    state.ui.pendingGardenGrowth = false;
    persistState();
    window.requestAnimationFrame(playGardenGrowth);
  }
}

async function saveJournal(event) {
  event.preventDefault();
  const date = $("journalDate").value;
  const title = $("journalTitle").value.trim();
  const text = $("journalText").value.trim();
  if (!text) return;

  if (journalEditingId) {
    const existing = state.journals.find(function (entry) { return entry.id === journalEditingId; });
    if (existing) {
      existing.date = date;
      existing.title = title;
      existing.text = text;
      existing.updatedAt = new Date().toISOString();
    }
    journalEditingId = null;
  } else {
    state.journals.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      date: date,
      title: title,
      text: text,
      createdAt: new Date().toISOString()
    });
  }

  state.journals.sort(function (a, b) { return b.date.localeCompare(a.date); });
  await persistState();
  $("journalTitle").value = "";
  $("journalText").value = "";
  $("journalDate").value = todayISO();
  renderJournal();
  showToast("Your private note is tucked safely away. 🔐💜");
}

function renderJournal() {
  if (!state) return;
  const list = $("journalList");
  if (!state.journals.length) {
    list.innerHTML = '<article class="card empty-state"><strong>No notes yet 💜</strong><br><span>This space is here whenever something feels worth remembering.</span></article>';
    return;
  }
  list.innerHTML = state.journals.map(function (entry) {
    return '<article class="journal-entry">' +
      '<div class="journal-entry-head"><div><span class="eyebrow">' + escapeHtml(prettyDate(entry.date)) + '</span><h3>' +
      escapeHtml(entry.title || "Untitled reflection") + '</h3></div>' +
      '<div class="journal-actions"><button class="text-btn" type="button" data-edit-journal="' + escapeHtml(entry.id) + '">Edit</button>' +
      '<button class="text-btn danger-text" type="button" data-delete-journal="' + escapeHtml(entry.id) + '">Delete</button></div></div>' +
      '<p>' + escapeHtml(entry.text) + '</p></article>';
  }).join("");
}

async function deleteJournal(id) {
  const item = state.journals.find(function (entry) { return entry.id === id; });
  if (!item) return;
  if (!window.confirm("Delete this journal entry? This cannot be undone without an older encrypted backup.")) return;
  state.journals = state.journals.filter(function (entry) { return entry.id !== id; });
  await persistState();
  renderJournal();
  showToast("Journal entry deleted.");
}

function editJournal(id) {
  const item = state.journals.find(function (entry) { return entry.id === id; });
  if (!item) return;
  journalEditingId = id;
  $("journalDate").value = item.date;
  $("journalTitle").value = item.title || "";
  $("journalText").value = item.text;
  $("journalText").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderBars(targetId, values) {
  const target = $(targetId);
  if (!values.length) {
    target.className = "bar-chart empty-state";
    target.textContent = targetId === "moodChart" ? "Your mood patterns will appear here over time." : "Your symptom patterns will gently appear here as you log more.";
    return;
  }
  target.className = "bar-chart";
  const max = Math.max.apply(null, values.map(function (item) { return item.count; }));
  target.innerHTML = values.slice(0, 6).map(function (item) {
    const width = Math.round((item.count / max) * 100);
    const label = item.name.charAt(0).toUpperCase() + item.name.slice(1);
    return '<div class="bar-row"><span>' + escapeHtml(label) + '</span><div class="bar-track"><span style="width:' + width + '%"></span></div><strong>' + item.count + '</strong></div>';
  }).join("");
}

function renderInsights() {
  if (!state) return;
  const cycles = getCycleLengths();
  const values = cycles.map(function (item) { return item.days; });
  const avg = values.length ? Math.round(average(values)) : null;
  $("avgCycleStat").textContent = avg == null ? "—" : String(avg);
  $("cycleRangeStat").textContent = values.length ? Math.min.apply(null, values) + "–" + Math.max.apply(null, values) : "—";
  $("trackedCyclesStat").textContent = String(getPeriodStarts().length);
  $("checkinsStat").textContent = String(getEntryDates().length);

  renderBars("symptomChart", getSymptomCounts());
  renderBars("moodChart", getMoodCounts());

  const target = $("cycleHistory");
  if (!cycles.length) {
    target.className = "cycle-history empty-state";
    target.textContent = "Once you’ve logged two period starts, Vune can begin showing your cycle rhythm here.";
  } else {
    target.className = "cycle-history";
    const recent = cycles.slice(-8);
    const max = Math.max.apply(null, recent.map(function (item) { return item.days; }));
    target.innerHTML = recent.map(function (item) {
      const height = Math.max(35, Math.round((item.days / max) * 130));
      return '<div class="cycle-bar-wrap"><strong>' + item.days + 'd</strong><div class="cycle-bar" style="height:' + height + 'px"></div><small>' + escapeHtml(prettyDate(item.start, { month: "short", day: "numeric", timeZone: "UTC" })) + '</small></div>';
    }).join("");
  }
}

function setCompanionOpen(open) {
  const panel = $("companionPanel");
  const launcher = $("companionLauncher");
  if (!panel || !launcher) return;

  panel.hidden = !open;
  launcher.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("companion-open", open);

  if (open) {
    renderAssistant();
    const messages = $("assistantMessages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  }
}

function renderAssistant() {
  if (!state) return;
  const supporter = state.settings.plan === "supporter";
  $("assistantGate").hidden = supporter;
  $("assistantExperience").hidden = !supporter;
  if (!supporter) return;

  const target = $("assistantMessages");
  target.innerHTML = "";
  if (!state.assistantMessages.length) {
    addAssistantBubble("assistant", "Hi, I’m your Vune Companion ✦\n\nI’m here to help you notice patterns, make sense of what you’ve tracked, and get ready for appointments. Nothing you ask me in this test experience is sent to an outside AI provider.");
  } else {
    state.assistantMessages.forEach(function (message) {
      addAssistantBubble(message.role, message.text);
    });
  }
  target.scrollTop = target.scrollHeight;
}

function addAssistantBubble(role, text) {
  const div = document.createElement("div");
  div.className = "assistant-message " + role;
  div.textContent = text;
  $("assistantMessages").appendChild(div);
}

function assistantSummary() {
  const cycles = getCycleLengths();
  const symptoms = getSymptomCounts();
  const prediction = getPrediction();
  const parts = [];
  if (cycles.length) {
    const values = cycles.map(function (item) { return item.days; });
    parts.push("Here’s what your cycle has been looking like lately 💜\n\nYour recorded cycles average about " + Math.round(average(values)) + " days, with a range of " + Math.min.apply(null, values) + "–" + Math.max.apply(null, values) + " days.");
  } else {
    parts.push("I’m still learning your rhythm 🌱 Once you’ve logged at least two period starts, I can give you a more useful cycle summary.");
  }
  if (symptoms.length) {
    parts.push("The things you’ve been noticing most are " + symptoms.slice(0, 3).map(function (item) { return item.name + " (" + item.count + ")"; }).join(", ") + ".");
  }
  if (prediction) parts.push("Your current local estimate for the next period start is " + prettyDate(prediction.date) + ".");
  parts.push("This is just a gentle summary of your own records — not a diagnosis — but it can help you notice what repeats over time.");
  return parts.join("\n\n");
}

function appointmentSummary() {
  const starts = getPeriodStarts();
  const cycles = getCycleLengths();
  const symptoms = getSymptomCounts();
  const heavyDays = getEntryDates().filter(function (date) { return state.entries[date].flow === "heavy"; }).length;
  const lines = ["Here’s a simple appointment prep note based on what you’ve tracked 💜"];
  lines.push("• " + starts.length + " period start" + (starts.length === 1 ? "" : "s") + " logged.");
  if (cycles.length) {
    const values = cycles.map(function (item) { return item.days; });
    lines.push("• Recorded cycle range: " + Math.min.apply(null, values) + "–" + Math.max.apply(null, values) + " days.");
  }
  if (symptoms.length) lines.push("• Most logged symptoms: " + symptoms.slice(0, 4).map(function (item) { return item.name; }).join(", ") + ".");
  if (heavyDays) lines.push("• Heavy flow was logged on " + heavyDays + " day" + (heavyDays === 1 ? "" : "s") + ".");
  lines.push("• You have " + state.journals.length + " private journal entr" + (state.journals.length === 1 ? "y" : "ies") + " available to review yourself.");
  lines.push("\nYou could ask your clinician whether any of these patterns are expected for you or worth watching more closely. Vune can organize what you tracked, but it can’t diagnose a condition.");
  return lines.join("\n");
}

function answerAssistant(prompt) {
  const lower = prompt.toLowerCase();
  if (/diagnos|do i have|pcos|endometri|fibroid|infection|am i pregnant|pregnant/.test(lower)) {
    return "I can help organize what you’ve noticed, but I can’t tell you whether you have a medical condition. 💜\n\nIf you want, I can summarize your patterns or help you put together questions to bring to a clinician.";
  }
  if (/doctor|appointment|clinician|obgyn|ob-gyn/.test(lower)) return appointmentSummary();
  if (/summary|summarize|pattern|overview/.test(lower)) return assistantSummary();
  if (/next period|when.*period|prediction/.test(lower)) {
    const prediction = getPrediction();
    return prediction ? "Based on what you’ve logged so far, Vune’s current estimate is " + prettyDate(prediction.date) + ". 🌙\n\nThat uses an average cycle length of about " + prediction.average + " days, and it may shift as your body and your tracking change." : "I’m still learning your rhythm 🌱 Log a period start and I can begin making a gentle estimate.";
  }
  if (/symptom|cramp|headache|fatigue|bloat|acne|back pain|tender|craving/.test(lower)) {
    const symptoms = getSymptomCounts();
    if (!symptoms.length) return "Nothing to summarize here yet — and that’s completely okay. 🌿 Log symptoms only when it feels useful.";
    const named = symptoms.find(function (item) { return lower.indexOf(item.name.toLowerCase()) >= 0; });
    if (named) return "You’ve noticed " + named.name + " on " + named.count + " check-in day" + (named.count === 1 ? "" : "s") + ". I’m only reflecting what you recorded, not making a medical interpretation.";
    return "Here’s what has been showing up most in your check-ins: " + symptoms.slice(0, 5).map(function (item) { return item.name + " (" + item.count + ")"; }).join(", ") + ". 💜";
  }
  if (/mood|feel|emotion/.test(lower)) {
    const moods = getMoodCounts();
    if (!moods.length) return "You haven’t added any moods yet. If you’d rather not track them, that’s okay too. 🌿";
    return "The moods you’ve logged most often are " + moods.slice(0, 4).map(function (item) { return item.name + " (" + item.count + ")"; }).join(", ") + ". Think of this as a reflection, not a judgment. 💜";
  }
  if (/journal|diary|reflection/.test(lower)) {
    return "You have " + state.journals.length + " saved journal entr" + (state.journals.length === 1 ? "y" : "ies") + " and " + getEntryDates().filter(function (date) { return Boolean(state.entries[date].reflection); }).length + " daily reflections. This prototype keeps them inside your encrypted browser vault.";
  }
  return "I can help with cycle summaries, things that keep showing up, mood patterns, period estimates, and appointment prep. ✦\n\nTry asking “What patterns are showing up?” or “Help me get ready for an appointment.”";
}

async function sendAssistant(event) {
  event.preventDefault();
  if (state.settings.plan !== "supporter") return;
  const prompt = $("assistantPrompt").value.trim();
  if (!prompt) return;
  const response = answerAssistant(prompt);
  state.assistantMessages.push({ role: "user", text: prompt, at: new Date().toISOString() });
  state.assistantMessages.push({ role: "assistant", text: response, at: new Date().toISOString() });
  $("assistantPrompt").value = "";
  await persistState();
  renderAssistant();
}

function generateHealthSummary() {
  if (state.settings.plan !== "supporter") {
    showToast("Switch to Supporter preview to test Health Summary.");
    return;
  }
  const starts = getPeriodStarts();
  const cycles = getCycleLengths();
  const values = cycles.map(function (item) { return item.days; });
  const symptoms = getSymptomCounts();
  const moods = getMoodCounts();
  const periodDays = getEntryDates().filter(function (date) { return state.entries[date].period; }).length;
  const heavyDays = getEntryDates().filter(function (date) { return state.entries[date].flow === "heavy"; }).length;

  let rows = "";
  starts.slice(-6).reverse().forEach(function (start) {
    rows += "<tr><td>" + escapeHtml(prettyDate(start)) + "</td><td>Period start logged</td></tr>";
  });

  $("reportContent").innerHTML =
    '<div class="report-section"><p class="muted">Generated locally on ' + escapeHtml(new Date().toLocaleDateString()) + '. This summary organizes user-entered records and is not a diagnosis.</p></div>' +
    '<div class="report-section"><h3>Cycle overview</h3><div class="report-grid">' +
    '<div class="report-metric"><small>Period starts</small><strong>' + starts.length + '</strong></div>' +
    '<div class="report-metric"><small>Average cycle</small><strong>' + (values.length ? Math.round(average(values)) + " days" : "—") + '</strong></div>' +
    '<div class="report-metric"><small>Cycle range</small><strong>' + (values.length ? Math.min.apply(null, values) + "–" + Math.max.apply(null, values) + " days" : "—") + '</strong></div>' +
    '</div></div>' +
    '<div class="report-section"><h3>Tracking overview</h3><p>' + getEntryDates().length + ' daily check-ins • ' + periodDays + ' period days • ' + heavyDays + ' heavy-flow days • ' + state.journals.length + ' private journal entries.</p></div>' +
    '<div class="report-section"><h3>Most logged symptoms</h3><p>' + (symptoms.length ? symptoms.slice(0, 6).map(function (item) { return escapeHtml(item.name) + " (" + item.count + ")"; }).join(", ") : "No symptoms logged.") + '</p></div>' +
    '<div class="report-section"><h3>Most logged moods</h3><p>' + (moods.length ? moods.slice(0, 6).map(function (item) { return escapeHtml(item.name) + " (" + item.count + ")"; }).join(", ") : "No moods logged.") + '</p></div>' +
    '<div class="report-section"><h3>Recent recorded period starts</h3>' + (rows ? '<table class="report-table"><thead><tr><th>Date</th><th>Record</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p>No period starts logged.</p>') + '</div>' +
    '<div class="report-section"><h3>Suggested discussion prompts</h3><ul><li>Have my cycle lengths or symptoms changed in a way that matters clinically?</li><li>Are any of my logged flow or pain patterns worth evaluating?</li><li>What additional information would be useful to track?</li></ul></div>';

  $("reportDialog").showModal();
}

function showSettingsCategory(name) {
  const tabs = Array.from(document.querySelectorAll("[data-settings-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-settings-panel]"));
  if (!tabs.length || !panels.length) return;

  tabs.forEach(function (tab) {
    const active = tab.dataset.settingsTab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  panels.forEach(function (panel) {
    const active = panel.dataset.settingsPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderSettings() {
  if (!state) return;
  document.querySelectorAll(".plan-card").forEach(function (button) {
    button.classList.toggle("active", button.dataset.plan === state.settings.plan);
  });
  $("lockMinutesSelect").value = String(state.settings.lockMinutes);

  const currentTab = document.querySelector("[data-settings-tab].active");
  if (!currentTab) showSettingsCategory("plan");
}

async function selectPlan(plan) {
  if (!planNames[plan]) return;
  state.settings.plan = plan;
  await persistState();
  renderAll();
  showToast(planNames[plan] + " is ready to explore ✨ No payment was collected.");
}

async function exportBackup() {
  await persistState();
  const backup = {
    format: "vune-web-encrypted-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    salt: localStorage.getItem(SALT_KEY),
    payload: localStorage.getItem(DATA_KEY)
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vune-encrypted-backup-" + todayISO() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Encrypted backup exported.");
}

async function importBackup(file) {
  const text = await file.text();
  const backup = JSON.parse(text);
  if (!backup || backup.format !== "vune-web-encrypted-backup" || !backup.salt || !backup.payload) throw new Error("Invalid Vune backup");
  if (!window.confirm("Replace this browser's current Vune vault with the selected encrypted backup?")) return;
  localStorage.setItem(SALT_KEY, backup.salt);
  localStorage.setItem(DATA_KEY, backup.payload);
  await lockApp();
  showToast("Backup imported. Unlock it with the passcode used when it was exported.");
}

async function changePasscode() {
  const first = window.prompt("Create a new Vune passcode (at least 6 characters).");
  if (first == null) return;
  if (first.length < 6) {
    showToast("Passcode must be at least 6 characters.");
    return;
  }
  const second = window.prompt("Confirm the new passcode.");
  if (second !== first) {
    showToast("Passcodes did not match.");
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(first, salt);
  currentKey = newKey;
  localStorage.setItem(SALT_KEY, toBase64(salt));
  await persistState();
  showToast("Passcode changed. Export a fresh backup if you keep backups.");
}

function deleteAllData() {
  if (!window.confirm("Delete all Vune data stored in this browser? This cannot be undone without an encrypted backup.")) return;
  if (!window.confirm("Final confirmation: permanently reset this browser copy of Vune?")) return;
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(SALT_KEY);
  state = null;
  currentKey = null;
  location.reload();
}

function bindEvents() {
  $("setupForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const first = $("newPasscode").value;
    const second = $("confirmPasscode").value;
    if (first.length < 6) {
      showToast("Use at least 6 characters.");
      return;
    }
    if (first !== second) {
      showToast("Passcodes do not match.");
      return;
    }
    try {
      await setupVault(first);
      $("newPasscode").value = "";
      $("confirmPasscode").value = "";
      showToast("Encrypted Vune vault created.");
    } catch (error) {
      showToast("Could not create the encrypted vault in this browser.");
    }
  });

  $("unlockForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("unlockError").textContent = "";
    try {
      await unlockVault($("unlockPasscode").value);
    } catch (error) {
      $("unlockError").textContent = "That passcode could not unlock this vault.";
    }
  });

  $("resetFromLock").addEventListener("click", function () {
    if (window.confirm("Reset the encrypted Vune vault stored in this browser?")) {
      localStorage.removeItem(DATA_KEY);
      localStorage.removeItem(SALT_KEY);
      location.reload();
    }
  });

  document.querySelectorAll(".nav-btn[data-view]").forEach(function (button) {
    button.addEventListener("click", function () { showView(button.dataset.view); });
  });
  document.addEventListener("click", function (event) {
    const go = event.target.closest("[data-go]");
    if (go) {
      showView(go.dataset.go);
      setCompanionOpen(false);
    }

    const calendarDay = event.target.closest("[data-calendar-date]");
    if (calendarDay && state) {
      $("checkinDate").value = calendarDay.dataset.calendarDate;
      loadCheckinForDate(calendarDay.dataset.calendarDate);
      showView("today");
    }

    const edit = event.target.closest("[data-edit-journal]");
    if (edit) editJournal(edit.dataset.editJournal);

    const del = event.target.closest("[data-delete-journal]");
    if (del) deleteJournal(del.dataset.deleteJournal);

    const prompt = event.target.closest("[data-assistant-prompt]");
    if (prompt && state && state.settings.plan === "supporter") {
      $("assistantPrompt").value = prompt.dataset.assistantPrompt;
      $("assistantPrompt").focus();
    }

    const plan = event.target.closest("[data-plan]");
    if (plan && state) selectPlan(plan.dataset.plan);

    const settingsTab = event.target.closest("[data-settings-tab]");
    if (settingsTab) showSettingsCategory(settingsTab.dataset.settingsTab);

    const journalPrompt = event.target.closest("[data-journal-prompt]");
    if (journalPrompt && state) {
      const field = $("journalText");
      const promptText = journalPrompt.dataset.journalPrompt || "";
      if (!field.value.trim()) field.value = promptText;
      else field.value = field.value + "\n\n" + promptText;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  });

  $("checkinForm").addEventListener("submit", saveCheckin);
  $("checkinDate").addEventListener("change", function () { if (state) loadCheckinForDate($("checkinDate").value); });
  $("journalForm").addEventListener("submit", saveJournal);
  $("assistantForm").addEventListener("submit", sendAssistant);

  $("companionLauncher").addEventListener("click", function () {
    setCompanionOpen($("companionPanel").hidden);
  });
  $("closeCompanionBtn").addEventListener("click", function () {
    setCompanionOpen(false);
  });

  $("prevMonth").addEventListener("click", function () {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    renderCalendar();
  });
  $("nextMonth").addEventListener("click", function () {
    calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    renderCalendar();
  });

  $("lockNowBtn").addEventListener("click", lockApp);
  $("mobileLockBtn").addEventListener("click", lockApp);
  $("generateReportBtn").addEventListener("click", generateHealthSummary);
  $("closeReportBtn").addEventListener("click", function () { $("reportDialog").close(); });
  $("closeReportBtn2").addEventListener("click", function () { $("reportDialog").close(); });
  $("printReportBtn").addEventListener("click", function () { window.print(); });

  $("lockMinutesSelect").addEventListener("change", async function () {
    state.settings.lockMinutes = Number($("lockMinutesSelect").value);
    await persistState();
    scheduleAutoLock();
    showToast("Your privacy preference is saved. 🔐");
  });

  $("changePasscodeBtn").addEventListener("click", changePasscode);
  $("exportBackupBtn").addEventListener("click", exportBackup);
  $("importBackupInput").addEventListener("change", async function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      await importBackup(file);
    } catch (error) {
      showToast("That file is not a valid Vune encrypted backup.");
    }
    event.target.value = "";
  });
  $("deleteAllBtn").addEventListener("click", deleteAllData);

  ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
    document.addEventListener(name, noteActivity, { passive: true });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !$("companionPanel").hidden) {
      setCompanionOpen(false);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      document.body.classList.add("privacy-hidden");
      if (state && Number(state.settings.lockMinutes) === 0) lockApp();
    } else {
      document.body.classList.remove("privacy-hidden");
    }
  });
}

async function init() {
  if (!window.crypto || !window.crypto.subtle) {
    document.body.innerHTML = '<main style="max-width:680px;margin:60px auto;padding:24px;font-family:system-ui"><h1>Vune needs a secure browser context</h1><p>This prototype requires Web Crypto. Open it over HTTPS or localhost in a modern browser.</p></main>';
    return;
  }

  bindEvents();
  if (hasVault()) showUnlock();
  else showSetup();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js").catch(function () { /* offline install is optional */ });
    });
  }
}

document.addEventListener("DOMContentLoaded", init);