# Phyto-Growth-IQ-Studio

Phyto-Growth-IQ-Studio turns any Excel workbook into an executive dashboard. It auto-detects your
columns (dimensions, measures, time periods), lets you confirm them, then generates KPIs,
growth/decline insights, charts, and a formatted Excel export — all processed locally in your
browser, nothing ever uploaded, 100% secure.

## How it works

1. **Upload** an `.xlsx` / `.xls` / `.xlsm` file and pick a sheet.
2. **Confirm detected columns.** Each column is auto-classified as a **Dimension** (a label to
   group by), a **Measure** (a numeric metric), part of a **Time-Period** series (e.g. Jan/Feb/Mar),
   or **Ignore**. Review and correct anything that looks wrong.
3. **Analyze** — the dashboard renders instantly.
4. **Export** everything to a formatted Excel workbook.

## The dashboard

Once a sheet is analyzed, Phyto-Growth-IQ-Studio renders an executive dashboard with four sections:

- **Overview** — KPI cards summarizing totals for each detected measure, a latest-period card with
  period-over-period change, top performers per dimension, a trending-up/down count, and coverage counts.
- **Management Insights** — plain-English narrative cards: growth highlights and areas of concern
  when the data has a time trend, or top-contributor/concentration insights when it doesn't.
- **Detailed Summaries** — a searchable table you can break down by any confirmed dimension
  (product, region, customer, etc.), with per-period values and growth/decline highlighting in green/red.
- **Visualize** — bar, line, pie, or histogram charts, with metric and breakdown selectors populated
  dynamically from your data.

From there, everything on screen can be exported to a formatted Excel workbook.

## Tech stack

- Vanilla JS (no framework, no bundler) + plain CSS + HTML — open `index.html` directly, nothing to build.
- [SheetJS](https://sheetjs.com/), [ExcelJS](https://github.com/exceljs/exceljs),
  [Chart.js](https://www.chartjs.org/), and [FileSaver.js](https://github.com/eligrey/FileSaver.js/),
  vendored locally in `js/vendor/` — no CDN, works fully offline.

## Project structure

```
index.html          Page shell: upload, schema review panel, dashboard containers
css/styles.css      Design tokens + theme variables (Nature / Dusk Grove)
assets/logo.svg      Logo (currentColor — themes automatically)
js/
  schema.js           Detects column roles + time-period structure from a raw sheet
  schemaReview.js       Renders/edits the confirmation table (pure rendering, no state)
  parser.js               Sheet + confirmed schema -> normalized records
  analysis.js               Records -> per-dimension summaries, KPIs, insights
  dashboard.js                Analysis results -> DOM rendering
  charts.js                     Analysis results -> Chart.js configs
  exporter.js                    Analysis results -> downloadable .xlsx
  theme.js                        Light/dark toggle, persisted in localStorage
  app.js                            Orchestration: upload -> detect -> review -> analyze -> export
  vendor/                            Third-party libraries (see above)
```

Each stage only depends on the previous stage's output shape, so any one layer can be extended
without touching the others (e.g. a new chart type is one case in `charts.js`'s `buildConfig()`).

## Getting started

No install needed — just open `index.html` in a modern browser.

## Key design notes

- Dimension grouping is **exact-match** on trimmed cell text — no fuzzy merging of similar values.
- Growth/decline compares each row's latest period to the previous one; only meaningful for
  time-series measures with 2+ periods.
- All measures are **summed**, never averaged — mark non-summable columns (e.g. a rating) as **Ignore**.
- Blank cells count as "no data," not zero; a row is skipped only if every tracked column in it is blank.

## Privacy

Files are read via the browser's `FileReader` API straight into memory and never leave the machine.
Exports are generated in memory and handed to the browser's native download mechanism. No cookies,
no analytics, no server component — only the theme preference is persisted (`localStorage`).
