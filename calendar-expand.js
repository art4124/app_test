"use strict";

(function () {
  let expandedDate = null;

  function injectExpandedDayStyles() {
    if (document.getElementById("vuneExpandedDayStyles")) return;
    const style = document.createElement("style");
    style.id = "vuneExpandedDayStyles";
    style.textContent = `
      .garden-calendar-card.day-expanded-mode .garden-weekdays,
      .garden-calendar-card.day-expanded-mode .garden-legend { display:none !important; }
      .garden-calendar-card.day-expanded-mode .garden-calendar-grid {
        display:block !important;
        min-height:520px;
      }
      .calendar-expanded-day {
        min-height:520px;
        width:100%;
        display:flex;
        flex-direction:column;
        padding:26px;
        border:1px solid #e4d9e8;
        border-radius:22px;
        background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(252,248,253,.96));
        box-shadow:0 14px 34px rgba(76,54,88,.08);
        animation:vuneDayExpand .18s ease-out;
      }
      .calendar-expanded-head {
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:18px;
        padding-bottom:18px;
        margin-bottom:18px;
        border-bottom:1px solid var(--line);
      }
      .calendar-expanded-head h3 { margin:.25rem 0 0; font-size:1.5rem; }
      .calendar-expanded-items { display:grid; gap:12px; align-content:start; }
      .calendar-expanded-empty {
        flex:1;
        display:grid;
        place-items:center;
        text-align:center;
        padding:40px 20px;
        color:var(--muted);
      }
      .calendar-expanded-day .day-detail-item { font-size:.95rem; }
      body.theme-dark .calendar-expanded-day {
        background:var(--vune-dark-surface-2)!important;
        color:var(--vune-dark-text)!important;
        border-color:#4b4352;
      }
      body.theme-dark .calendar-expanded-head { border-color:#4b4352; }
      @keyframes vuneDayExpand {
        from { opacity:.55; transform:scale(.985); }
        to { opacity:1; transform:scale(1); }
      }
      @media(max-width:720px) {
        .garden-calendar-card.day-expanded-mode .garden-calendar-grid,
        .calendar-expanded-day { min-height:430px; }
        .calendar-expanded-day { padding:18px; border-radius:18px; }
        .calendar-expanded-head h3 { font-size:1.25rem; }
      }
      @media(prefers-reduced-motion:reduce) {
        .calendar-expanded-day { animation:none; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildExpandedItems(date) {
    const items = [];
    const entry = state && state.entries ? state.entries[date] : null;

    if (entry && entry.period) {
      items.push('<button class="day-detail-item period" data-open-checkin="' + date + '"><strong>Period — Day ' + getPeriodDayNumber(date) + '</strong><small>Open this day’s cycle check-in</small></button>');
    }

    if (entry) {
      items.push('<button class="day-detail-item checkin" data-open-checkin="' + date + '"><strong>Cycle check-in</strong><small>Open the saved check-in for this date</small></button>');
    }

    if (state && hasJournal()) {
      state.journals.filter(function (journal) { return journal.date === date; }).forEach(function (journal) {
        items.push('<button class="day-detail-item journal" data-open-journal="' + esc(journal.id) + '"><strong>' + esc(journal.title || prettyDate(journal.date)) + '</strong><small>Bloom Notes • ' + esc(prettyDate(journal.date)) + '</small></button>');
      });
    }

    return items;
  }

  function expandCalendarDay(date) {
    const grid = document.getElementById("calendarGrid");
    const card = grid && grid.closest(".garden-calendar-card");
    if (!grid || !card || !state) return;

    expandedDate = date;
    card.classList.add("day-expanded-mode");

    const items = buildExpandedItems(date);
    const title = prettyDate(date, { weekday:"long", month:"long", day:"numeric", year:"numeric", timeZone:"UTC" });

    grid.innerHTML = '<section class="calendar-expanded-day" aria-label="Details for ' + esc(title) + '">' +
      '<div class="calendar-expanded-head"><div><span class="eyebrow">Day details</span><h3>' + esc(title) + '</h3></div>' +
      '<button class="icon-btn" type="button" data-close-expanded-day aria-label="Close day details">×</button></div>' +
      (items.length ? '<div class="calendar-expanded-items">' + items.join("") + '</div>' : '<div class="calendar-expanded-empty"><div><strong>Nothing saved for this day yet.</strong><p>You can return to the calendar whenever you’re ready.</p></div></div>') +
      '</section>';
  }

  function closeExpandedDay(restoreCalendar) {
    if (!expandedDate) return;
    expandedDate = null;
    const grid = document.getElementById("calendarGrid");
    const card = grid && grid.closest(".garden-calendar-card");
    if (card) card.classList.remove("day-expanded-mode");
    if (restoreCalendar !== false && typeof renderCalendar === "function") renderCalendar();
  }

  function bindExpandedCalendar() {
    injectExpandedDayStyles();

    document.addEventListener("click", function (event) {
      const close = event.target.closest("[data-close-expanded-day]");
      if (close) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeExpandedDay(true);
        return;
      }

      const day = event.target.closest("[data-calendar-date]");
      if (day && state) {
        event.preventDefault();
        event.stopImmediatePropagation();
        expandCalendarDay(day.dataset.calendarDate);
        return;
      }

      if (expandedDate && (event.target.closest("[data-open-checkin]") || event.target.closest("[data-open-journal]"))) {
        const card = document.querySelector(".garden-calendar-card");
        if (card) card.classList.remove("day-expanded-mode");
        expandedDate = null;
      }
    }, true);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && expandedDate) {
        event.preventDefault();
        closeExpandedDay(true);
      }
    }, true);
  }

  document.addEventListener("DOMContentLoaded", bindExpandedCalendar);
})();
