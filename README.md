# Budget Tracker

A mobile-first personal budgeting web app in **TND (Tunisian Dinar)**. No accounts, no
sign-in, no backend — your data is stored privately in your own browser.

## Running it

Double-click `index.html`. That's it — it works straight from the file system, no build
step, no `npm install`, no internet connection.

To serve it over HTTP instead (handy for testing on your phone over Wi-Fi):

```bash
cd budget-tracker
python3 -m http.server 8000
# then open http://localhost:8000
```

To deploy, upload the folder as-is to Netlify, Vercel, GitHub Pages, or any static host.

## First run

You'll be asked for a **starting balance** — the money you already have. Every balance
shown afterwards builds from that number. You can also set an initial monthly budget and
your current savings; both are optional and editable later.

Want to see it populated? Go to **Settings → Load demo data** for a sample month.

## What's in it

**Dashboard**
- Current balance (starting balance + income − expenses) and total savings up top
- Line chart of your balance over time, with **Daily / Weekly / Monthly** toggles
- Overall monthly budget progress bar
- Per-category budget list, sorted so anything over budget floats to the top
- Floating **+** button to add a transaction
- Recent transactions with a category filter, plus edit and delete

**Transactions**
- Full history grouped by day, with income / expenses / net totals for the current filter
- Add, edit and delete — deleting **always** asks for confirmation first
- Filter by category with a single tap
- Mark anything as **repeats monthly** (gym, rent, utilities). Recurring entries carry a
  ↻ tag and a fresh copy is generated automatically each month when you open the app

**Budgets**
- One overall monthly limit plus a limit per category
- Progress bars turn amber at 80% ("83% used") and red once exceeded ("Over budget")
- Spending counters reset on the 1st of each month; the limits themselves carry over

**Savings**
- A single running total, not multiple goals
- Add or withdraw with an optional note; withdrawals are capped at what you've saved
- Full history log, each entry deletable

**Settings**
- Edit the starting balance
- Create custom categories (name, emoji icon, colour, income or expense), rename or
  delete them — deleting one moves its transactions to another category rather than
  losing them
- Load demo data or reset everything

## Notes on the money math

Amounts are stored as **integer millimes** (1 TND = 1000 millimes) and only converted to a
decimal string for display. That means `0.1 + 0.2` is exactly `0.300 TND` — no floating
point drift, ever, no matter how many transactions you add.

## Files

```
budget-tracker/
├── index.html           # markup for every screen and dialog
├── README.md
└── assets/
    ├── styles.css       # design system + mobile-first layout
    ├── app.js           # state, money math, screens, SVG chart
    └── favicon.svg
```

`app.js` is organised in numbered sections — money helpers, dates, state, recurring
engine, derived stats, DOM helpers, renderers, chart, screens, dialogs, demo data,
wiring, boot — so it's easy to find what you want to change.

## Changing things

- **Currency**: `formatTND()` near the top of `app.js` is the only place the format and
  the "TND" suffix are produced.
- **Colours**: the `:root` block at the top of `styles.css`.
- **Default categories**: `defaultCategories()` in `app.js`.
- **Warning threshold**: `progressBlock()` in `app.js` — currently 80% amber, 100% red.

## Limitations

Data lives in this browser's `localStorage`, so it doesn't sync between devices and
clearing your browser data will clear it. Manual entry only — no bank sync, no CSV import,
no export. These were all out of scope for this version.
