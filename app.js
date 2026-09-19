/* =========================================================================
   Budget Tracker
   A single-user personal budgeting app. No backend, no auth — state lives
   in localStorage. All money is handled as integer millimes (1 TND = 1000
   millimes) so there are never floating point rounding errors.
   ========================================================================= */
(function () {
  "use strict";

  /* =======================================================================
     1. Money helpers
     ===================================================================== */

  /** "12.5" | 12.5  ->  12500 millimes */
  function toMillimes(value) {
    if (typeof value === "number") {
      return isFinite(value) ? Math.round(value * 1000) : 0;
    }
    var n = parseFloat(String(value).replace(",", ".").trim());
    return isFinite(n) ? Math.round(n * 1000) : 0;
  }

  /** 12500 -> "12.500 TND" */
  function formatTND(millimes, withCode) {
    if (withCode === undefined) withCode = true;
    var sign = millimes < 0 ? "-" : "";
    var abs = Math.abs(Math.round(millimes));
    var whole = Math.floor(abs / 1000);
    var frac = String(abs % 1000).padStart(3, "0");
    var grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return sign + grouped + "." + frac + (withCode ? " TND" : "");
  }

  /** Short form for chart axes: 12500 -> "12.5k" / "12" */
  function formatShort(millimes) {
    var v = millimes / 1000;
    var abs = Math.abs(v);
    if (abs >= 1000) return (v / 1000).toFixed(abs >= 10000 ? 0 : 1) + "k";
    if (abs >= 100) return v.toFixed(0);
    return v.toFixed(abs >= 10 ? 0 : 1);
  }

  /** Text typed into an amount box -> millimes, or null when invalid. */
  function parseInputAmount(raw) {
    var s = String(raw || "").replace(",", ".").trim();
    if (s === "") return null;
    if (!/^-?\d*\.?\d*$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return Math.round(n * 1000);
  }

  /* =======================================================================
     2. Date helpers (all dates are plain "YYYY-MM-DD" strings, local time)
     ===================================================================== */

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function iso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function todayISO() {
    return iso(new Date());
  }
  function fromISO(s) {
    var p = String(s).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function monthKey(s) {
    return String(s).slice(0, 7);
  }
  function currentMonthKey() {
    return todayISO().slice(0, 7);
  }
  function addMonths(dateStr, n) {
    var d = fromISO(dateStr);
    var day = d.getDate();
    var target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    // Clamp to the last day of the target month (31 Jan + 1 month -> 28 Feb).
    var lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return iso(target);
  }
  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (x.getDay() + 6) % 7; // Monday-first
    x.setDate(x.getDate() - day);
    return x;
  }

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function prettyMonth(key) {
    var p = key.split("-");
    return MONTHS[Number(p[1]) - 1] + " " + p[0];
  }

  function prettyDay(dateStr) {
    var t = todayISO();
    if (dateStr === t) return "Today";
    var y = new Date();
    y.setDate(y.getDate() - 1);
    if (dateStr === iso(y)) return "Yesterday";
    var d = fromISO(dateStr);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  /* =======================================================================
     3. State
     ===================================================================== */

  var STORAGE_KEY = "budget-tracker.v1";

  var PALETTE = [
    "#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626",
    "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#475569",
  ];

  function defaultCategories() {
    return [
      { id: "c-food", name: "Food", icon: "🍽️", color: "#ea580c", type: "expense", custom: false },
      { id: "c-rent", name: "Rent", icon: "🏠", color: "#7c3aed", type: "expense", custom: false },
      { id: "c-transport", name: "Transport", icon: "🚗", color: "#2563eb", type: "expense", custom: false },
      { id: "c-utilities", name: "Utilities", icon: "💡", color: "#ca8a04", type: "expense", custom: false },
      { id: "c-entertainment", name: "Entertainment", icon: "🎬", color: "#db2777", type: "expense", custom: false },
      { id: "c-health", name: "Health", icon: "💊", color: "#16a34a", type: "expense", custom: false },
      { id: "c-shopping", name: "Shopping", icon: "🛍️", color: "#0891b2", type: "expense", custom: false },
      { id: "c-education", name: "Education", icon: "📚", color: "#0f766e", type: "expense", custom: false },
      { id: "c-other", name: "Other", icon: "📦", color: "#475569", type: "expense", custom: false },
      { id: "c-salary", name: "Salary", icon: "💼", color: "#16a34a", type: "income", custom: false },
      { id: "c-gift", name: "Gift", icon: "🎁", color: "#db2777", type: "income", custom: false },
      { id: "c-income-other", name: "Other income", icon: "➕", color: "#0891b2", type: "income", custom: false },
    ];
  }

  function blankState() {
    return {
      version: 1,
      onboarded: false,
      startingBalance: 0,
      categories: defaultCategories(),
      transactions: [],
      budgets: { overall: null, byCategory: {} },
      savings: [],
      lastRecurringRun: null,
    };
  }

  var state = blankState();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = Object.assign(blankState(), parsed);
        state.budgets = Object.assign({ overall: null, byCategory: {} }, parsed.budgets || {});
        if (!Array.isArray(state.categories) || !state.categories.length) {
          state.categories = defaultCategories();
        }
        if (!Array.isArray(state.transactions)) state.transactions = [];
        if (!Array.isArray(state.savings)) state.savings = [];
      }
    } catch (err) {
      console.warn("Could not read saved data, starting fresh.", err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      toast("Could not save — storage is unavailable.");
    }
  }

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function categoryById(id) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === id) return state.categories[i];
    }
    return { id: id, name: "Uncategorised", icon: "❔", color: "#8a99a5", type: "expense" };
  }

  /* =======================================================================
     4. Recurring transactions
     Any transaction flagged `recurring` is a template. On every app start we
     roll it forward, creating one copy per elapsed month up to today.
     ===================================================================== */

  function runRecurring() {
    var today = todayISO();
    var created = 0;
    // Only templates (originals) spawn children.
    var templates = state.transactions.filter(function (t) {
      return t.recurring && !t.recurringFrom;
    });

    templates.forEach(function (tpl) {
      // Find how far this series already reached.
      var latest = tpl.date;
      state.transactions.forEach(function (t) {
        if (t.recurringFrom === tpl.id && t.date > latest) latest = t.date;
      });
      var next = addMonths(latest, 1);
      var guard = 0;
      while (next <= today && guard < 240) {
        state.transactions.push({
          id: uid("tx"),
          amount: tpl.amount,
          type: tpl.type,
          categoryId: tpl.categoryId,
          date: next,
          note: tpl.note,
          recurring: true,
          recurringFrom: tpl.id,
          createdAt: new Date().toISOString(),
        });
        created++;
        next = addMonths(next, 1);
        guard++;
      }
    });

    if (created > 0) {
      state.lastRecurringRun = today;
      save();
    }
    return created;
  }

  /* =======================================================================
     5. Derived stats
     ===================================================================== */

  function sortedTransactions() {
    return state.transactions.slice().sort(function (a, b) {
      if (a.date === b.date) return (b.createdAt || "") < (a.createdAt || "") ? -1 : 1;
      return a.date < b.date ? 1 : -1;
    });
  }

  function totals() {
    var income = 0;
    var expense = 0;
    state.transactions.forEach(function (t) {
      if (t.type === "income") income += t.amount;
      else expense += t.amount;
    });
    return { income: income, expense: expense };
  }

  function currentBalance() {
    var t = totals();
    return state.startingBalance + t.income - t.expense;
  }

  function monthTotals(key) {
    var income = 0;
    var expense = 0;
    state.transactions.forEach(function (t) {
      if (monthKey(t.date) !== key) return;
      if (t.type === "income") income += t.amount;
      else expense += t.amount;
    });
    return { income: income, expense: expense };
  }

  function spentByCategory(key) {
    var map = {};
    state.transactions.forEach(function (t) {
      if (t.type !== "expense" || monthKey(t.date) !== key) return;
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    return map;
  }

  function savingsTotal() {
    return state.savings.reduce(function (sum, s) {
      return sum + (s.type === "withdraw" ? -s.amount : s.amount);
    }, 0);
  }

  /** Balance as of the end of `dateStr` (inclusive). */
  function balanceAsOf(dateStr) {
    var bal = state.startingBalance;
    state.transactions.forEach(function (t) {
      if (t.date > dateStr) return;
      bal += t.type === "income" ? t.amount : -t.amount;
    });
    return bal;
  }

  /** Buckets of {label, value} for the balance chart. */
  function chartSeries(range) {
    var out = [];
    var now = new Date();
    var i;

    if (range === "daily") {
      for (i = 29; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        out.push({
          key: iso(d),
          label: d.getDate() === 1 || i === 0 || i === 29 ? d.getDate() + "/" + (d.getMonth() + 1) : "",
          value: balanceAsOf(iso(d)),
        });
      }
    } else if (range === "weekly") {
      var thisWeek = startOfWeek(now);
      for (i = 11; i >= 0; i--) {
        var ws = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7);
        var we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
        var end = iso(we) > todayISO() ? todayISO() : iso(we);
        out.push({
          key: iso(ws),
          label: i % 2 === 0 ? ws.getDate() + "/" + (ws.getMonth() + 1) : "",
          value: balanceAsOf(end),
        });
      }
    } else {
      for (i = 11; i >= 0; i--) {
        var m = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        var mEnd = iso(lastDay) > todayISO() ? todayISO() : iso(lastDay);
        out.push({
          key: iso(m),
          label: i % 2 === 0 ? MONTHS[m.getMonth()].slice(0, 3) : "",
          value: balanceAsOf(mEnd),
        });
      }
    }
    return out;
  }

  /* =======================================================================
     6. Tiny DOM helpers
     ===================================================================== */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var toastTimer = null;
  function toast(message) {
    var t = $("#toast");
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.hidden = true;
    }, 2400);
  }

  /** Mix a hex colour with white to get a soft tint. */
  function tint(hex, amount) {
    var h = hex.replace("#", "");
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var mix = function (c) {
      return Math.round(c + (255 - c) * amount);
    };
    return "rgb(" + mix(r) + "," + mix(g) + "," + mix(b) + ")";
  }

  /* =======================================================================
     7. Reusable renderers
     ===================================================================== */

  /** Progress bar block for a budget. Returns a DOM node. */
  function progressBlock(opts) {
    var wrap = el("div", "prog");
    var head = el("div", "prog-head");

    var name = el("div", "prog-name");
    if (opts.icon) {
      var dot = el("span", "tx-icon", opts.icon);
      dot.style.width = "26px";
      dot.style.height = "26px";
      dot.style.fontSize = "14px";
      dot.style.borderRadius = "9px";
      dot.style.background = tint(opts.color || "#0f766e", 0.86);
      name.appendChild(dot);
    }
    name.appendChild(el("span", null, opts.label));
    head.appendChild(name);

    var hasLimit = opts.limit !== null && opts.limit !== undefined && opts.limit > 0;
    var amounts = el(
      "div",
      "prog-amounts",
      hasLimit
        ? formatTND(opts.spent, false) + " / " + formatTND(opts.limit, false)
        : formatTND(opts.spent, false) + " spent"
    );
    head.appendChild(amounts);
    wrap.appendChild(head);

    var pct = hasLimit ? (opts.spent / opts.limit) * 100 : 0;
    var bar = el("div", "bar");
    var fill = el("div", "bar-fill");
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (hasLimit) {
      if (pct >= 100) fill.classList.add("over");
      else if (pct >= 80) fill.classList.add("warn");
      else if (opts.color) fill.style.background = opts.color;
    } else {
      fill.style.width = "0%";
    }
    bar.appendChild(fill);
    wrap.appendChild(bar);

    var foot = el("div", "prog-foot");
    if (hasLimit) {
      var tag;
      if (pct >= 100) {
        tag = el("span", "tag tag-over", "Over budget");
      } else if (pct >= 80) {
        tag = el("span", "tag tag-warn", Math.round(pct) + "% used");
      } else {
        tag = el("span", "tag tag-ok", Math.round(pct) + "% used");
      }
      foot.appendChild(tag);
      var left = opts.limit - opts.spent;
      foot.appendChild(
        el(
          "span",
          "muted small",
          left >= 0
            ? formatTND(left, false) + " left"
            : formatTND(Math.abs(left), false) + " over"
        )
      );
    } else {
      foot.appendChild(el("span", "muted small", "No limit set"));
    }
    wrap.appendChild(foot);
    return wrap;
  }

  var ICON_EDIT =
    '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4zM14.5 5.5l4 4"/></svg>';
  var ICON_DELETE =
    '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

  /** Renders a transaction list (optionally grouped by day) into `container`. */
  function renderTransactions(container, list, opts) {
    opts = opts || {};
    clear(container);

    if (!list.length) {
      var empty = el("div", "empty");
      empty.appendChild(el("strong", null, opts.emptyTitle || "Nothing here yet"));
      empty.appendChild(
        el("span", null, opts.emptyText || "Tap the + button to record your first transaction.")
      );
      container.appendChild(empty);
      return;
    }

    var lastDay = null;
    list.forEach(function (t) {
      if (opts.groupByDay && t.date !== lastDay) {
        lastDay = t.date;
        container.appendChild(el("div", "tx-day", prettyDay(t.date)));
      }

      var cat = categoryById(t.categoryId);
      var row = el("div", "tx");

      var icon = el("div", "tx-icon", cat.icon);
      icon.style.background = tint(cat.color, 0.86);
      row.appendChild(icon);

      var main = el("div", "tx-main");
      main.appendChild(el("div", "tx-title", t.note && t.note.trim() ? t.note : cat.name));
      var sub = el("div", "tx-sub");
      sub.appendChild(el("span", null, cat.name));
      if (!opts.groupByDay) {
        sub.appendChild(el("span", null, "·"));
        sub.appendChild(el("span", null, prettyDay(t.date)));
      }
      if (t.recurring) {
        sub.appendChild(el("span", "tag tag-rec", "↻ Monthly"));
      }
      main.appendChild(sub);
      row.appendChild(main);

      row.appendChild(
        el(
          "div",
          "tx-amount " + (t.type === "income" ? "pos" : "neg"),
          (t.type === "income" ? "+" : "−") + formatTND(t.amount, false)
        )
      );

      var actions = el("div", "tx-actions");
      var edit = el("button", null);
      edit.innerHTML = ICON_EDIT;
      edit.setAttribute("aria-label", "Edit transaction");
      edit.addEventListener("click", function (e) {
        e.stopPropagation();
        openTxModal(t.id);
      });
      var del = el("button", null);
      del.innerHTML = ICON_DELETE;
      del.setAttribute("aria-label", "Delete transaction");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        requestDelete(t);
      });
      actions.appendChild(edit);
      actions.appendChild(del);
      row.appendChild(actions);

      row.addEventListener("click", function () {
        openTxModal(t.id);
      });
      container.appendChild(row);
    });
  }

  /** Category filter chips. */
  function renderChips(container, selectedId, onPick) {
    clear(container);
    var used = {};
    state.transactions.forEach(function (t) {
      used[t.categoryId] = true;
    });

    var options = [{ id: "all", name: "All", icon: "" }].concat(
      state.categories.filter(function (c) {
        return used[c.id];
      })
    );

    options.forEach(function (c) {
      var chip = el("button", "chip", c.icon ? c.icon + " " + c.name : c.name);
      chip.setAttribute("aria-pressed", String(c.id === selectedId));
      chip.addEventListener("click", function () {
        onPick(c.id);
      });
      container.appendChild(chip);
    });
  }

  /* =======================================================================
     8. Line chart (hand-rolled SVG — no chart library needed)
     ===================================================================== */

  function renderChart(container, points) {
    clear(container);

    if (points.length < 2) {
      container.appendChild(el("div", "chart-empty", "Not enough data to draw a trend yet."));
      return;
    }

    var W = 320;
    var H = 170;
    var padL = 40;
    var padR = 8;
    var padT = 12;
    var padB = 24;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var values = points.map(function (p) {
      return p.value;
    });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (min === max) {
      max = min + 1000;
      min = min - 1000;
    }
    var span = max - min;
    min -= span * 0.12;
    max += span * 0.12;
    span = max - min;

    var x = function (i) {
      return padL + (i / (points.length - 1)) * innerW;
    };
    var y = function (v) {
      return padT + innerH - ((v - min) / span) * innerH;
    };

    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Balance over time");

    function add(tag, attrs, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) {
        n.setAttribute(k, attrs[k]);
      });
      (parent || svg).appendChild(n);
      return n;
    }

    // Gridlines + y labels
    for (var g = 0; g <= 3; g++) {
      var val = min + (span * g) / 3;
      var gy = y(val);
      add("line", {
        x1: padL, y1: gy, x2: W - padR, y2: gy,
        stroke: "#e4eaed", "stroke-width": 1,
      });
      var lbl = add("text", {
        x: padL - 6, y: gy + 3.5, "text-anchor": "end",
        "font-size": 9, fill: "#8a99a5",
      });
      lbl.textContent = formatShort(val);
    }

    // Zero line, when the range crosses it
    if (min < 0 && max > 0) {
      add("line", {
        x1: padL, y1: y(0), x2: W - padR, y2: y(0),
        stroke: "#dc2626", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0.5,
      });
    }

    // Area + line
    var linePts = points.map(function (p, i) {
      return x(i) + "," + y(p.value);
    });

    var gradId = "grad-" + Math.random().toString(36).slice(2, 7);
    var defs = add("defs", {});
    var lg = add("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    add("stop", { offset: "0%", "stop-color": "#0f766e", "stop-opacity": "0.26" }, lg);
    add("stop", { offset: "100%", "stop-color": "#0f766e", "stop-opacity": "0" }, lg);

    add("polygon", {
      points: padL + "," + (padT + innerH) + " " + linePts.join(" ") + " " + (W - padR) + "," + (padT + innerH),
      fill: "url(#" + gradId + ")",
    });
    add("polyline", {
      points: linePts.join(" "),
      fill: "none", stroke: "#0f766e", "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    });

    // Last point marker
    var lastX = x(points.length - 1);
    var lastY = y(points[points.length - 1].value);
    add("circle", { cx: lastX, cy: lastY, r: 4.5, fill: "#fff", stroke: "#0f766e", "stroke-width": 2.5 });

    // X labels
    points.forEach(function (p, i) {
      if (!p.label) return;
      var t = add("text", {
        x: x(i), y: H - 6, "text-anchor": "middle", "font-size": 9, fill: "#8a99a5",
      });
      t.textContent = p.label;
    });

    container.appendChild(svg);
  }

  /* =======================================================================
     9. Screens
     ===================================================================== */

  var ui = {
    screen: "dashboard",
    chartRange: "daily",
    dashFilter: "all",
    txFilter: "all",
    savingsMode: "add",
    newCatColor: PALETTE[0],
  };

  var TITLES = {
    dashboard: ["Dashboard", "Overview"],
    transactions: ["Transactions", "Activity"],
    budgets: ["Budgets", "Monthly limits"],
    savings: ["Savings", "Your reserve"],
    settings: ["Settings", "Preferences"],
  };

  function showScreen(name) {
    if (!TITLES[name]) name = "dashboard";
    ui.screen = name;
    $$(".screen").forEach(function (s) {
      s.hidden = s.dataset.screen !== name;
    });
    $$(".navitem").forEach(function (n) {
      if (n.dataset.nav === name) n.setAttribute("aria-current", "page");
      else n.removeAttribute("aria-current");
    });
    $("#topbar-eyebrow").textContent = TITLES[name][0];
    $("#topbar-title").textContent = TITLES[name][1];
    $("#fab").hidden = name === "settings";
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    $("#month-pill").textContent = prettyMonth(currentMonthKey());
    if (ui.screen === "dashboard") renderDashboard();
    else if (ui.screen === "transactions") renderTransactionsScreen();
    else if (ui.screen === "budgets") renderBudgets();
    else if (ui.screen === "savings") renderSavings();
    else if (ui.screen === "settings") renderSettings();
  }

  /* ----------------------------- Dashboard ------------------------------ */

  function renderDashboard() {
    var key = currentMonthKey();
    var m = monthTotals(key);

    $("#db-balance").textContent = formatTND(currentBalance());
    $("#db-income").textContent = formatTND(m.income, false);
    $("#db-expense").textContent = formatTND(m.expense, false);
    $("#db-savings").textContent = formatTND(savingsTotal(), false);

    renderChart($("#chart-wrap"), chartSeries(ui.chartRange));

    // Overall budget
    var overallWrap = $("#db-overall");
    clear(overallWrap);
    overallWrap.appendChild(
      progressBlock({
        label: "All spending",
        spent: m.expense,
        limit: state.budgets.overall,
        color: "#0f766e",
      })
    );

    // Category budgets
    var catWrap = $("#db-categories");
    clear(catWrap);
    var spent = spentByCategory(key);
    var rows = state.categories.filter(function (c) {
      return c.type === "expense" && (state.budgets.byCategory[c.id] > 0 || spent[c.id]);
    });
    // Over-budget first, then by amount spent.
    rows.sort(function (a, b) {
      var la = state.budgets.byCategory[a.id] || 0;
      var lb = state.budgets.byCategory[b.id] || 0;
      var pa = la ? (spent[a.id] || 0) / la : -1;
      var pb = lb ? (spent[b.id] || 0) / lb : -1;
      if (pa !== pb) return pb - pa;
      return (spent[b.id] || 0) - (spent[a.id] || 0);
    });

    if (!rows.length) {
      var e = el("div", "empty");
      e.appendChild(el("strong", null, "No category budgets yet"));
      e.appendChild(el("span", null, "Set limits on the Budgets screen to track them here."));
      catWrap.appendChild(e);
    } else {
      rows.slice(0, 6).forEach(function (c) {
        catWrap.appendChild(
          progressBlock({
            label: c.name,
            icon: c.icon,
            color: c.color,
            spent: spent[c.id] || 0,
            limit: state.budgets.byCategory[c.id] || null,
          })
        );
      });
    }

    // Recent transactions
    renderChips($("#db-chips"), ui.dashFilter, function (id) {
      ui.dashFilter = id;
      renderDashboard();
    });
    var recent = sortedTransactions().filter(function (t) {
      return ui.dashFilter === "all" || t.categoryId === ui.dashFilter;
    });
    renderTransactions($("#db-recent"), recent.slice(0, 6), {
      groupByDay: false,
      emptyTitle: "No transactions yet",
      emptyText: "Tap the + button to record your first one.",
    });
  }

  /* ---------------------------- Transactions ---------------------------- */

  function renderTransactionsScreen() {
    var all = sortedTransactions();
    var list = all.filter(function (t) {
      return ui.txFilter === "all" || t.categoryId === ui.txFilter;
    });

    var inc = 0;
    var exp = 0;
    list.forEach(function (t) {
      if (t.type === "income") inc += t.amount;
      else exp += t.amount;
    });
    $("#tx-income").textContent = formatTND(inc, false);
    $("#tx-expense").textContent = formatTND(exp, false);
    var net = inc - exp;
    var netEl = $("#tx-net");
    netEl.textContent = (net >= 0 ? "+" : "−") + formatTND(Math.abs(net), false);
    netEl.className = "mini-value " + (net >= 0 ? "pos" : "neg");

    $("#tx-count").textContent =
      list.length + (list.length === 1 ? " entry" : " entries");

    renderChips($("#tx-chips"), ui.txFilter, function (id) {
      ui.txFilter = id;
      renderTransactionsScreen();
    });

    renderTransactions($("#tx-list"), list, {
      groupByDay: true,
      emptyTitle: ui.txFilter === "all" ? "No transactions yet" : "Nothing in this category",
      emptyText:
        ui.txFilter === "all"
          ? "Tap the + button to record your first one."
          : "Try a different category filter.",
    });
  }

  /* ------------------------------ Budgets ------------------------------- */

  function renderBudgets() {
    var key = currentMonthKey();
    var m = monthTotals(key);
    var spent = spentByCategory(key);

    var wrap = $("#bg-overall");
    clear(wrap);
    wrap.appendChild(
      progressBlock({
        label: "Spent in " + prettyMonth(key),
        spent: m.expense,
        limit: state.budgets.overall,
        color: "#0f766e",
      })
    );
    var input = $("#bg-overall-input");
    if (document.activeElement !== input) {
      input.value = state.budgets.overall ? (state.budgets.overall / 1000).toFixed(3) : "";
    }

    var list = $("#bg-categories");
    clear(list);
    state.categories
      .filter(function (c) {
        return c.type === "expense";
      })
      .forEach(function (c) {
        var row = el("div", "budget-row");
        row.appendChild(
          progressBlock({
            label: c.name,
            icon: c.icon,
            color: c.color,
            spent: spent[c.id] || 0,
            limit: state.budgets.byCategory[c.id] || null,
          })
        );

        var form = el("div", "inline-form");
        var box = el("div", "amount-input");
        var inp = el("input");
        inp.type = "text";
        inp.setAttribute("inputmode", "decimal");
        inp.placeholder = "No limit";
        var limit = state.budgets.byCategory[c.id];
        inp.value = limit ? (limit / 1000).toFixed(3) : "";
        box.appendChild(inp);
        box.appendChild(el("span", "amount-suffix", "TND"));
        form.appendChild(box);

        var btn = el("button", "btn btn-primary", "Save");
        btn.addEventListener("click", function () {
          var v = inp.value.trim();
          if (v === "") {
            delete state.budgets.byCategory[c.id];
            save();
            toast("Limit removed for " + c.name);
          } else {
            var mm = parseInputAmount(v);
            if (mm === null || mm < 0) {
              toast("Enter a valid amount");
              return;
            }
            state.budgets.byCategory[c.id] = mm;
            save();
            toast(c.name + " limit saved");
          }
          renderBudgets();
        });
        form.appendChild(btn);
        row.appendChild(form);
        list.appendChild(row);
      });
  }

  /* ------------------------------ Savings ------------------------------- */

  function renderSavings() {
    var added = 0;
    var withdrawn = 0;
    state.savings.forEach(function (s) {
      if (s.type === "withdraw") withdrawn += s.amount;
      else added += s.amount;
    });

    $("#sv-total").textContent = formatTND(savingsTotal());
    $("#sv-added").textContent = formatTND(added, false);
    $("#sv-withdrawn").textContent = formatTND(withdrawn, false);

    $$("[data-sv-type]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.svType === ui.savingsMode));
    });
    $("#sv-submit").textContent =
      ui.savingsMode === "add" ? "Add to savings" : "Withdraw from savings";

    var hist = $("#sv-history");
    clear(hist);
    var entries = state.savings.slice().sort(function (a, b) {
      return (b.createdAt || "") < (a.createdAt || "") ? -1 : 1;
    });

    if (!entries.length) {
      var e = el("div", "empty");
      e.appendChild(el("strong", null, "No savings activity yet"));
      e.appendChild(el("span", null, "Add an amount above to start your reserve."));
      hist.appendChild(e);
      return;
    }

    entries.forEach(function (s) {
      var row = el("div", "tx");
      var icon = el("div", "tx-icon", s.type === "withdraw" ? "↓" : "↑");
      icon.style.background = s.type === "withdraw" ? "#fdecec" : "#e6f6ec";
      icon.style.color = s.type === "withdraw" ? "#dc2626" : "#16a34a";
      row.appendChild(icon);

      var main = el("div", "tx-main");
      main.appendChild(
        el("div", "tx-title", s.note && s.note.trim() ? s.note : s.type === "withdraw" ? "Withdrawal" : "Deposit")
      );
      main.appendChild(el("div", "tx-sub", prettyDay(s.date)));
      row.appendChild(main);

      row.appendChild(
        el(
          "div",
          "tx-amount " + (s.type === "withdraw" ? "neg" : "pos"),
          (s.type === "withdraw" ? "−" : "+") + formatTND(s.amount, false)
        )
      );

      var actions = el("div", "tx-actions");
      var del = el("button", null);
      del.innerHTML = ICON_DELETE;
      del.setAttribute("aria-label", "Delete savings entry");
      del.addEventListener("click", function () {
        confirmDialog(
          "Delete savings entry?",
          "This will remove " + formatTND(s.amount) + " from your savings history.",
          function () {
            state.savings = state.savings.filter(function (x) {
              return x.id !== s.id;
            });
            save();
            renderSavings();
            toast("Entry deleted");
          }
        );
      });
      actions.appendChild(del);
      row.appendChild(actions);

      hist.appendChild(row);
    });
  }

  /* ------------------------------ Settings ------------------------------ */

  function renderSettings() {
    var startInput = $("#st-start");
    if (document.activeElement !== startInput) {
      startInput.value = (state.startingBalance / 1000).toFixed(3);
    }

    $("#st-cat-count").textContent = state.categories.length + " total";

    // Colour swatches
    var colors = $("#st-cat-colors");
    clear(colors);
    PALETTE.forEach(function (c) {
      var b = el("button", "swatch");
      b.style.background = c;
      b.setAttribute("aria-pressed", String(c === ui.newCatColor));
      b.setAttribute("aria-label", "Pick colour " + c);
      b.addEventListener("click", function () {
        ui.newCatColor = c;
        renderSettings();
      });
      colors.appendChild(b);
    });

    // Category list
    var list = $("#st-categories");
    clear(list);
    state.categories.forEach(function (c) {
      var row = el("div", "cat-row");
      var icon = el("div", "tx-icon", c.icon);
      icon.style.background = tint(c.color, 0.86);
      row.appendChild(icon);

      var name = el("div", "name", c.name);
      row.appendChild(name);
      row.appendChild(el("span", "tag " + (c.type === "income" ? "tag-ok" : "tag-rec"), c.type));

      var actions = el("div", "tx-actions");
      var edit = el("button", null);
      edit.innerHTML = ICON_EDIT;
      edit.setAttribute("aria-label", "Rename " + c.name);
      edit.addEventListener("click", function () {
        var next = window.prompt("Rename category", c.name);
        if (next === null) return;
        next = next.trim();
        if (!next) {
          toast("Name cannot be empty");
          return;
        }
        c.name = next.slice(0, 24);
        save();
        renderSettings();
        toast("Category renamed");
      });
      actions.appendChild(edit);

      var del = el("button", null);
      del.innerHTML = ICON_DELETE;
      del.setAttribute("aria-label", "Delete " + c.name);
      del.addEventListener("click", function () {
        var inUse = state.transactions.filter(function (t) {
          return t.categoryId === c.id;
        }).length;
        if (state.categories.length <= 1) {
          toast("Keep at least one category");
          return;
        }
        confirmDialog(
          "Delete “" + c.name + "”?",
          inUse
            ? inUse + " transaction(s) use this category. They will be moved to “Other”."
            : "This category will be removed.",
          function () {
            var fallback = state.categories.filter(function (x) {
              return x.id !== c.id && x.type === c.type;
            })[0];
            if (fallback) {
              state.transactions.forEach(function (t) {
                if (t.categoryId === c.id) t.categoryId = fallback.id;
              });
            }
            delete state.budgets.byCategory[c.id];
            state.categories = state.categories.filter(function (x) {
              return x.id !== c.id;
            });
            save();
            renderSettings();
            toast("Category deleted");
          }
        );
      });
      actions.appendChild(del);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  /* =======================================================================
     10. Transaction dialog
     ===================================================================== */

  var editingId = null;
  var draft = { type: "expense", categoryId: null };

  function openTxModal(id) {
    editingId = id || null;
    var modal = $("#tx-modal");
    var err = $("#tx-error");
    err.hidden = true;

    if (editingId) {
      var t = state.transactions.filter(function (x) {
        return x.id === editingId;
      })[0];
      if (!t) return;
      draft.type = t.type;
      draft.categoryId = t.categoryId;
      $("#tx-amount").value = (t.amount / 1000).toFixed(3);
      $("#tx-date").value = t.date;
      $("#tx-note").value = t.note || "";
      $("#tx-recurring").checked = !!t.recurring;
      $("#tx-modal-title").textContent = "Edit transaction";
      $("#tx-delete").hidden = false;
    } else {
      draft.type = "expense";
      draft.categoryId = null;
      $("#tx-amount").value = "";
      $("#tx-date").value = todayISO();
      $("#tx-note").value = "";
      $("#tx-recurring").checked = false;
      $("#tx-modal-title").textContent = "Add transaction";
      $("#tx-delete").hidden = true;
    }

    syncTxType();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      $("#tx-amount").focus();
    }, 60);
  }

  function closeTxModal() {
    $("#tx-modal").hidden = true;
    document.body.style.overflow = "";
    editingId = null;
  }

  function syncTxType() {
    $$("[data-tx-type]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.txType === draft.type));
    });
    renderCategoryPicker();
  }

  function renderCategoryPicker() {
    var wrap = $("#tx-categories");
    clear(wrap);
    var options = state.categories.filter(function (c) {
      return c.type === draft.type;
    });

    if (!options.length) {
      wrap.appendChild(el("div", "empty", "No " + draft.type + " categories. Add one in Settings."));
      return;
    }
    // Keep a valid selection.
    var stillValid = options.some(function (c) {
      return c.id === draft.categoryId;
    });
    if (!stillValid) draft.categoryId = options[0].id;

    options.forEach(function (c) {
      var btn = el("button", "cat-opt");
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(c.id === draft.categoryId));
      var dot = el("span", "dot", c.icon);
      dot.style.background = tint(c.color, 0.84);
      btn.appendChild(dot);
      btn.appendChild(el("span", null, c.name));
      btn.addEventListener("click", function () {
        draft.categoryId = c.id;
        renderCategoryPicker();
      });
      wrap.appendChild(btn);
    });
  }

  function saveTransaction() {
    var err = $("#tx-error");
    var amount = parseInputAmount($("#tx-amount").value);
    var date = $("#tx-date").value || todayISO();

    if (amount === null || amount <= 0) {
      err.textContent = "Enter an amount greater than zero.";
      err.hidden = false;
      return;
    }
    if (!draft.categoryId) {
      err.textContent = "Pick a category.";
      err.hidden = false;
      return;
    }
    err.hidden = true;

    var payload = {
      amount: amount,
      type: draft.type,
      categoryId: draft.categoryId,
      date: date,
      note: $("#tx-note").value.trim(),
      recurring: $("#tx-recurring").checked,
    };

    if (editingId) {
      state.transactions.forEach(function (t) {
        if (t.id === editingId) Object.assign(t, payload);
      });
      toast("Transaction updated");
    } else {
      payload.id = uid("tx");
      payload.createdAt = new Date().toISOString();
      state.transactions.push(payload);
      toast(payload.recurring ? "Recurring transaction added" : "Transaction added");
    }

    save();
    runRecurring();
    closeTxModal();
    render();
  }

  /* ------------------------------ Deleting ------------------------------ */

  function requestDelete(t) {
    var cat = categoryById(t.categoryId);
    var label = (t.note && t.note.trim()) || cat.name;
    var extra = "";
    var children = state.transactions.filter(function (x) {
      return x.recurringFrom === t.id;
    });
    if (children.length) {
      extra = " Its " + children.length + " generated monthly copies will be deleted too.";
    }
    confirmDialog(
      "Delete this transaction?",
      "“" + label + "” for " + formatTND(t.amount) + " will be removed. This cannot be undone." + extra,
      function () {
        state.transactions = state.transactions.filter(function (x) {
          return x.id !== t.id && x.recurringFrom !== t.id;
        });
        save();
        closeTxModal();
        render();
        toast("Transaction deleted");
      }
    );
  }

  var confirmAction = null;
  function confirmDialog(title, text, onOk) {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    confirmAction = onOk;
    $("#confirm").hidden = false;
  }
  function closeConfirm() {
    $("#confirm").hidden = true;
    confirmAction = null;
  }

  /* =======================================================================
     11. Demo data
     ===================================================================== */

  function loadDemoData() {
    var now = new Date();
    function daysAgo(n) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
      return iso(d);
    }

    state.startingBalance = toMillimes(1850);
    state.budgets.overall = toMillimes(1500);
    state.budgets.byCategory = {
      "c-food": toMillimes(450),
      "c-transport": toMillimes(180),
      "c-utilities": toMillimes(160),
      "c-entertainment": toMillimes(120),
      "c-shopping": toMillimes(200),
    };

    var demo = [
      [2400, "income", "c-salary", 28, "Monthly salary", true],
      [620, "expense", "c-rent", 27, "Apartment rent", true],
      [75, "expense", "c-utilities", 26, "STEG bill", true],
      [45, "expense", "c-entertainment", 25, "Gym membership", true],
      [86.5, "expense", "c-food", 22, "Weekly groceries"],
      [12, "expense", "c-transport", 20, "Taxi"],
      [34.9, "expense", "c-shopping", 18, "T-shirt"],
      [22.5, "expense", "c-food", 15, "Lunch with Sami"],
      [9, "expense", "c-transport", 13, "Metro card"],
      [140, "expense", "c-health", 11, "Dentist"],
      [78.25, "expense", "c-food", 8, "Groceries"],
      [60, "income", "c-gift", 7, "Birthday gift"],
      [29.9, "expense", "c-entertainment", 5, "Cinema"],
      [18, "expense", "c-transport", 3, "Fuel"],
      [41.75, "expense", "c-food", 1, "Market run"],
      [15, "expense", "c-shopping", 0, "Phone case"],
    ];

    state.transactions = demo.map(function (row, i) {
      return {
        id: uid("tx"),
        amount: toMillimes(row[0]),
        type: row[1],
        categoryId: row[2],
        date: daysAgo(row[3]),
        note: row[4],
        recurring: !!row[5],
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      };
    });

    state.savings = [
      { id: uid("sv"), amount: toMillimes(500), type: "add", date: daysAgo(40), note: "Opening savings", createdAt: new Date(Date.now() - 40000).toISOString() },
      { id: uid("sv"), amount: toMillimes(200), type: "add", date: daysAgo(26), note: "Salary set-aside", createdAt: new Date(Date.now() - 26000).toISOString() },
      { id: uid("sv"), amount: toMillimes(120), type: "withdraw", date: daysAgo(9), note: "Laptop repair", createdAt: new Date(Date.now() - 9000).toISOString() },
    ];

    state.onboarded = true;
    save();
    runRecurring();
    showScreen("dashboard");
    toast("Demo data loaded");
  }

  /* =======================================================================
     12. Wiring
     ===================================================================== */

  function bindEvents() {
    // Navigation
    $$(".navitem").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = a.dataset.nav;
      });
    });
    $$(".link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = a.getAttribute("href").slice(1);
      });
    });
    window.addEventListener("hashchange", function () {
      showScreen(location.hash.replace("#", ""));
    });

    // Chart range
    $$("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () {
        ui.chartRange = b.dataset.range;
        $$("[data-range]").forEach(function (x) {
          x.setAttribute("aria-selected", String(x === b));
        });
        renderChart($("#chart-wrap"), chartSeries(ui.chartRange));
      });
    });

    // FAB + transaction dialog
    $("#fab").addEventListener("click", function () {
      openTxModal(null);
    });
    $$("#tx-modal [data-close]").forEach(function (b) {
      b.addEventListener("click", closeTxModal);
    });
    $$("[data-tx-type]").forEach(function (b) {
      b.addEventListener("click", function () {
        draft.type = b.dataset.txType;
        syncTxType();
      });
    });
    $("#tx-save").addEventListener("click", saveTransaction);
    $("#tx-amount").addEventListener("keydown", function (e) {
      if (e.key === "Enter") saveTransaction();
    });
    $("#tx-delete").addEventListener("click", function () {
      var t = state.transactions.filter(function (x) {
        return x.id === editingId;
      })[0];
      if (t) requestDelete(t);
    });

    // Confirm dialog
    $("#confirm-cancel").addEventListener("click", closeConfirm);
    $$("#confirm [data-close]").forEach(function (b) {
      b.addEventListener("click", closeConfirm);
    });
    $("#confirm-ok").addEventListener("click", function () {
      var fn = confirmAction;
      closeConfirm();
      if (fn) fn();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("#confirm").hidden) closeConfirm();
      else if (!$("#tx-modal").hidden) closeTxModal();
    });

    // Budgets — overall limit
    $("#bg-overall-save").addEventListener("click", function () {
      var v = $("#bg-overall-input").value.trim();
      if (v === "") {
        state.budgets.overall = null;
        save();
        renderBudgets();
        toast("Overall limit removed");
        return;
      }
      var mm = parseInputAmount(v);
      if (mm === null || mm < 0) {
        toast("Enter a valid amount");
        return;
      }
      state.budgets.overall = mm;
      save();
      renderBudgets();
      toast("Monthly budget saved");
    });

    // Savings
    $$("[data-sv-type]").forEach(function (b) {
      b.addEventListener("click", function () {
        ui.savingsMode = b.dataset.svType;
        renderSavings();
      });
    });
    $("#sv-submit").addEventListener("click", function () {
      var mm = parseInputAmount($("#sv-amount").value);
      if (mm === null || mm <= 0) {
        toast("Enter an amount greater than zero");
        return;
      }
      if (ui.savingsMode === "withdraw" && mm > savingsTotal()) {
        toast("You only have " + formatTND(savingsTotal()) + " saved");
        return;
      }
      state.savings.push({
        id: uid("sv"),
        amount: mm,
        type: ui.savingsMode,
        date: todayISO(),
        note: $("#sv-note").value.trim(),
        createdAt: new Date().toISOString(),
      });
      save();
      $("#sv-amount").value = "";
      $("#sv-note").value = "";
      renderSavings();
      toast(ui.savingsMode === "add" ? "Added to savings" : "Withdrawn from savings");
    });

    // Settings
    $("#st-start-save").addEventListener("click", function () {
      var mm = parseInputAmount($("#st-start").value);
      if (mm === null) {
        toast("Enter a valid amount");
        return;
      }
      state.startingBalance = mm;
      save();
      renderSettings();
      toast("Starting balance updated");
    });

    $("#st-cat-add").addEventListener("click", function () {
      var name = $("#st-cat-name").value.trim();
      if (!name) {
        toast("Give the category a name");
        return;
      }
      var exists = state.categories.some(function (c) {
        return c.name.toLowerCase() === name.toLowerCase();
      });
      if (exists) {
        toast("That category already exists");
        return;
      }
      state.categories.push({
        id: uid("c"),
        name: name.slice(0, 24),
        icon: $("#st-cat-icon").value.trim() || "🏷️",
        color: ui.newCatColor,
        type: $("#st-cat-type").value,
        custom: true,
      });
      save();
      $("#st-cat-name").value = "";
      $("#st-cat-icon").value = "";
      renderSettings();
      toast("Category added");
    });

    $("#st-seed").addEventListener("click", function () {
      confirmDialog(
        "Load demo data?",
        "This replaces everything currently stored with a sample month of activity.",
        loadDemoData
      );
    });

    $("#st-reset").addEventListener("click", function () {
      confirmDialog(
        "Reset everything?",
        "All transactions, budgets, categories and savings will be permanently deleted.",
        function () {
          localStorage.removeItem(STORAGE_KEY);
          state = blankState();
          boot();
          toast("All data cleared");
        }
      );
    });

    // Onboarding
    $("#onboard-submit").addEventListener("click", function () {
      var start = parseInputAmount($("#onboard-balance").value);
      if (start === null) start = 0;
      var budget = parseInputAmount($("#onboard-budget").value);
      var sav = parseInputAmount($("#onboard-savings").value);

      state.startingBalance = start;
      if (budget !== null && budget > 0) state.budgets.overall = budget;
      if (sav !== null && sav > 0) {
        state.savings.push({
          id: uid("sv"),
          amount: sav,
          type: "add",
          date: todayISO(),
          note: "Opening savings",
          createdAt: new Date().toISOString(),
        });
      }
      state.onboarded = true;
      save();
      boot();
      toast("You're all set");
    });

    $("#onboard-balance").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("#onboard-submit").click();
    });
  }

  /* =======================================================================
     13. Boot
     ===================================================================== */

  function boot() {
    if (!state.onboarded) {
      $("#onboarding").hidden = false;
      $("#app").hidden = true;
      return;
    }
    $("#onboarding").hidden = true;
    $("#app").hidden = false;

    var created = runRecurring();
    var target = location.hash.replace("#", "") || "dashboard";
    showScreen(target);
    if (created > 0) {
      setTimeout(function () {
        toast(created + " recurring entr" + (created === 1 ? "y" : "ies") + " added for this month");
      }, 400);
    }
  }

  load();
  bindEvents();
  boot();
})();
