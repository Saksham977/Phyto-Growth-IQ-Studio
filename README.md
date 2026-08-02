# Phyto-Growth-IQ-Studio

Phyto-Growth-IQ-Studio turns any Excel workbook into an executive dashboard. It auto-detects your
columns (dimensions, measures, time periods), lets you confirm them, then generates KPIs,
growth/decline insights, charts, and a formatted export — all processed locally in your browser,
nothing ever uploaded, 100% secure.

## How it works

1. **Log in** with the app password (a lock screen, not a real authentication system — see
   Security below).
2. **Pick a tab** — Primary Sales Data, Doctor Wise Analysis, or Secondary Sale. Each is an
   independent workspace: its own upload, its own confirmed schema, its own dashboard. Switching
   tabs never loses what you've already uploaded/analyzed elsewhere.
3. **Upload** an `.xlsx` / `.xls` / `.xlsm` file and pick a sheet.
4. **Confirm detected columns.** Each column is auto-classified as a **Dimension** (a label to
   group by), a **Measure** (a numeric metric), part of a **Time-Period** series (e.g. Jan/Feb/Mar,
   or a single concatenated header like "April Qty"), or **Ignore**. Detection also skips past any
   number of leading banner/blank rows automatically. Review and correct anything that looks wrong.
5. **Analyze** — the dashboard renders instantly.
6. **Export** everything to a formatted Excel workbook, or the current breakdown view to CSV.

## The dashboard

Once a sheet is analyzed, each tab renders a full dashboard:

- **Overview** — KPI cards summarizing totals for each detected measure, a latest-period card with
  period-over-period change, top performers per dimension, a trending-up/down count, and coverage counts.
- **Filters** — a multi-select per detected dimension (e.g. Doctor + Party + Month, in any
  combination) that narrows every KPI, insight, table, and chart to the selected values.
- **Management Insights** — plain-English narrative cards: growth highlights and areas of concern
  when the data has a time trend, or top-contributor/concentration insights when it doesn't.
- **Performance Analysis** — pick a dimension and measure, set a threshold (default 100,000), and
  see flagged entries below it, the highest/lowest performer, and matching red/green highlighting
  in the table below.
- **Detailed Summaries** — a searchable table you can break down by any confirmed dimension, with
  a column selector (show/hide/reorder measures, with a "Save View" button that remembers your
  preference for that tab), and growth/decline highlighting in green/red.
- **Visualize** — Bar, Line, Area, Pie, Donut, Histogram, or Heatmap, with metric and breakdown
  selectors populated dynamically from your data.

## Tech stack

- Vanilla JS (no framework, no bundler) + plain CSS + HTML — open `index.html` directly, nothing to build.
- [SheetJS](https://sheetjs.com/), [ExcelJS](https://github.com/exceljs/exceljs),
  [Chart.js](https://www.chartjs.org/), and [FileSaver.js](https://github.com/eligrey/FileSaver.js/),
  vendored locally in `js/vendor/` — no CDN, works fully offline.

## Project structure

```
index.html          Page shell: lock screen, tab nav, upload/schema/dashboard per tab
css/styles.css      Design tokens + theme variables (Nature / Dusk Grove)
assets/logo.svg      Logo (currentColor — themes automatically)
js/
  auth.js             Lock-screen gate (in-memory only; re-locks on refresh/logout)
  schema.js            Detects column roles + time-period structure from a raw sheet
  schemaReview.js        Renders/edits the confirmation table (pure rendering, no state)
  parser.js                Sheet + confirmed schema -> normalized records
  analysis.js                Records -> per-dimension summaries, KPIs, insights
  filters.js                   Multi-select filtering over parsed records, pre-analysis
  viewPrefs.js                   Saves/loads a tab's column view preference (localStorage)
  dashboard.js                    Analysis results -> DOM rendering (KPIs, table, filters, performance)
  charts.js                        Analysis results -> Chart.js configs
  exporter.js                        Analysis results -> downloadable .xlsx / .csv
  theme.js                            Light/dark toggle, persisted in localStorage
  app.js                                Orchestration: one reusable controller per tab
  vendor/                                Third-party libraries (see above)
```

Each stage only depends on the previous stage's output shape, so any one layer can be extended
without touching the others (e.g. a new chart type is one case in `charts.js`'s `buildConfig()`).
`app.js`'s `createTabController()` is instantiated once per tab with a distinct set of DOM element
ids, so all 3 tabs share the exact same logic.

## Getting started

No install needed — just open `index.html` in a modern browser.

## Key design notes

- Dimension grouping is **exact-match** on trimmed cell text — no fuzzy merging of similar values.
- Growth/decline compares each row's latest period to the previous one; only meaningful for
  time-series measures with 2+ periods.
- All measures are **summed**, never averaged — mark non-summable columns (e.g. a rating) as **Ignore**.
- Blank cells count as "no data," not zero; a row is skipped only if every tracked column in it is blank.
- Filters, column view preferences, and Performance Analysis settings are per-tab, in-memory or
  localStorage — there's no backend, so nothing is shared across devices.

## Security

The lock screen is a UX deterrent (keeps casual/accidental access off a shared device), **not real
security** — this is a static site with no server, so a client-side password check can always be
bypassed via browser dev tools by anyone who tries. It re-locks on every page refresh and via the
Logout button; there is no persistence of the unlocked state.

## Privacy

Files are read via the browser's `FileReader` API straight into memory and never leave the machine.
Exports are generated in memory and handed to the browser's native download mechanism. No cookies,
no analytics, no server component — only the theme preference and (optionally) a saved column view
are persisted, in `localStorage`.
