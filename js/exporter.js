/**
 * exporter.js
 * ---------------------------------------------------------------------------
 * Builds the downloadable Excel workbook from analysis results, using
 * ExcelJS (SheetJS's free/community build cannot write cell colors — that's
 * a paid-tier-only feature there — so writing is delegated to ExcelJS, while
 * parser.js continues to use SheetJS for reading, which is free and robust).
 *
 * Produces one "KPI Overview" sheet plus one summary sheet per confirmed
 * dimension (was always exactly 2 fixed sheets — now N, driven entirely by
 * what the user confirmed in the schema review step).
 *
 * Colour coding: green fill for period-over-period growth (current month's
 * value > previous month's), red fill for decline — applied independently to
 * EVERY period column (the first period has no prior column to compare
 * against, so it's left uncolored), consistent with the on-screen dashboard.
 * ---------------------------------------------------------------------------
 */

const PhytoExporter = (() => {

  const GREEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
  const GREEN_FONT = { color: { argb: 'FF006100' } };
  const RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
  const RED_FONT = { color: { argb: 'FF9C0006' } };
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B3C' } };
  const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };
  const SUBHEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5A9463' } };
  const THIN_BORDER = { style: 'thin', color: { argb: 'FFDCD6C4' } };

  /**
   * Excel worksheet names must be <=31 chars and can't contain \/*?:[] or
   * duplicate an existing sheet name. Sheet titles now come from arbitrary
   * user column headers, so this is a required correctness fix, not a
   * nice-to-have — ExcelJS throws on any of the above.
   */
  function sanitizeSheetTitle(title, usedTitles) {
    let clean = String(title || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').trim();
    if (!clean) clean = 'Sheet';
    if (clean.length > 31) clean = clean.slice(0, 31).trim();
    let candidate = clean;
    let i = 2;
    while (usedTitles.has(candidate.toLowerCase())) {
      const suffix = ` (${i})`;
      candidate = clean.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    usedTitles.add(candidate.toLowerCase());
    return candidate;
  }

  /**
   * Builds one dimension's summary sheet. Time-series measures get one
   * column per period plus a Total column; standalone measures get just
   * their Total column — mirrors dashboard.js's renderBreakdownTable so the
   * export and on-screen table always agree.
   *
   * manualExtra (optional): {addedRows, customColumns, overrides} — the
   * user's manually added/edited rows and columns from the Detailed
   * Summaries view (see dashboard.js's renderBreakdownTable), included only
   * when the user opts in via the "Download Insights" confirmation prompt.
   * Appended as extra text columns after % Contribution and extra rows
   * after the real data — never mixed into the real totals/coloring above.
   */
  function buildSummarySheet(workbook, sheetTitle, dimensionSummary, measures, primaryMeasureKey, manualExtra) {
    const ws = workbook.addWorksheet(sheetTitle, { views: [{ state: 'frozen', ySplit: 2 }] });
    const { dimensionLabel, timePeriods, rows } = dimensionSummary;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;
    const customColumns = (manualExtra && manualExtra.customColumns) || [];
    const addedRows = (manualExtra && manualExtra.addedRows) || [];
    const overrides = (manualExtra && manualExtra.overrides) || {};

    const totalCols = 1 + (hasPeriods ? timePeriods.length * timeSeriesMeasures.length : 0) + measures.length + 1 + customColumns.length;

    const header1 = ws.getRow(1);
    header1.getCell(1).value = dimensionLabel;
    ws.mergeCells(1, 1, 2, 1);

    let col = 2;
    if (hasPeriods) {
      timePeriods.forEach(p => {
        header1.getCell(col).value = p;
        ws.mergeCells(1, col, 1, col + timeSeriesMeasures.length - 1);
        col += timeSeriesMeasures.length;
      });
    }
    header1.getCell(col).value = 'Total';
    ws.mergeCells(1, col, 1, col + measures.length - 1);
    const totalStartCol = col;
    col += measures.length;
    header1.getCell(col).value = '% Contribution';
    ws.mergeCells(1, col, 2, col);
    const pctCol = col;
    col += 1;
    const customStartCol = col;
    customColumns.forEach(c => {
      header1.getCell(col).value = c.label;
      ws.mergeCells(1, col, 2, col);
      col++;
    });

    const header2 = ws.getRow(2);
    col = 2;
    if (hasPeriods) {
      timePeriods.forEach(() => {
        timeSeriesMeasures.forEach(m => { header2.getCell(col).value = m.label; col++; });
      });
    }
    measures.forEach(m => { header2.getCell(col).value = m.label; col++; });

    for (let c = 1; c <= totalCols; c++) {
      header1.getCell(c).fill = HEADER_FILL;
      header1.getCell(c).font = HEADER_FONT;
      header1.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      header2.getCell(c).fill = SUBHEADER_FILL;
      header2.getCell(c).font = HEADER_FONT;
      header2.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    header1.height = 20;
    header2.height = 18;

    // % Contribution is recomputed against these (already row-removal
    // filtered) rows' own total, not analyze()'s fixed grand total — matches
    // dashboard.js's renderBreakdownTable, so a removed outlier row reflows
    // the download's percentages the same way it does on screen.
    const visibleTotal = primaryMeasureKey
      ? rows.reduce((sum, r) => sum + ((r.byMeasure[primaryMeasureKey] || {}).total || 0), 0)
      : 0;

    rows.forEach(row => {
      const r = ws.addRow([]);
      r.getCell(1).value = row.label;
      r.getCell(1).font = { name: 'Arial', size: 10 };

      let c = 2;
      if (hasPeriods) {
        timePeriods.forEach((p, idx) => {
          timeSeriesMeasures.forEach(m => {
            const v = row.byMeasure[m.key].byPeriod[idx].value;
            r.getCell(c).value = v === null ? null : v;
            c++;
          });
        });
      }
      measures.forEach(m => {
        r.getCell(totalStartCol + measures.indexOf(m)).value = row.byMeasure[m.key].total;
      });
      const pctBm = primaryMeasureKey ? row.byMeasure[primaryMeasureKey] : null;
      const pct = pctBm && visibleTotal !== 0 ? pctBm.total / visibleTotal : 0;
      r.getCell(pctCol).value = pct;
      r.getCell(pctCol).numFmt = '0%';

      const rowOverrides = overrides[row.label] || {};
      customColumns.forEach((cc, i) => {
        const v = rowOverrides[cc.key];
        if (v) r.getCell(customStartCol + i).value = v;
      });

      if (hasPeriods) {
        // Every period gets its own color vs. the period right before it
        // (April uncolored, May vs April, June vs May, ...) — matches the
        // on-screen table rather than only highlighting the last column.
        timePeriods.forEach((p, idx) => {
          if (idx === 0) return;
          timeSeriesMeasures.forEach((m, mi) => {
            const periodTrends = row.byMeasure[m.key].periodTrends;
            const trend = periodTrends ? periodTrends[idx] : null;
            const targetCol = 2 + idx * timeSeriesMeasures.length + mi;
            if (trend === 'up') {
              r.getCell(targetCol).fill = GREEN_FILL;
              r.getCell(targetCol).font = GREEN_FONT;
            } else if (trend === 'down') {
              r.getCell(targetCol).fill = RED_FILL;
              r.getCell(targetCol).font = RED_FONT;
            }
          });
        });
      }

      for (let cc = 1; cc <= totalCols; cc++) {
        r.getCell(cc).border = { bottom: THIN_BORDER };
        if (cc > 1) r.getCell(cc).alignment = { horizontal: 'right' };
      }
    });

    addedRows.forEach(ar => {
      const r = ws.addRow([]);
      r.getCell(1).value = ar.label;
      r.getCell(1).font = { name: 'Arial', size: 10, italic: true };
      measures.forEach(m => {
        const v = ar.values[m.key];
        if (v) r.getCell(totalStartCol + measures.indexOf(m)).value = v;
      });
      customColumns.forEach((cc, i) => {
        const v = ar.values[cc.key];
        if (v) r.getCell(customStartCol + i).value = v;
      });
      for (let cc = 1; cc <= totalCols; cc++) {
        r.getCell(cc).border = { bottom: THIN_BORDER };
        if (cc > 1) r.getCell(cc).alignment = { horizontal: 'right' };
      }
    });

    ws.getColumn(1).width = 34;
    for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 12;

    return ws;
  }

  function buildKPISheet(workbook, kpis, insights, sourceFileName, sheetName, sheetTitle) {
    const ws = workbook.addWorksheet(sanitizeSheetTitle(sheetTitle || 'KPI Overview', new Set()));
    ws.getColumn(1).width = 46;
    ws.getColumn(2).width = 22;

    const titleRow = ws.addRow(['Phyto Solutions — Executive Insights']);
    titleRow.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF2F6B3C' } };
    ws.addRow([`Source file: ${sourceFileName}`]);
    ws.addRow([`Analyzed sheet: ${sheetName}`]);
    ws.addRow([`Generated: ${new Date().toLocaleString()}`]);
    ws.addRow([]);

    const headerRow = ws.addRow(['Metric', 'Value']);
    headerRow.eachCell(cell => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });

    const metricRows = [];
    kpis.measureTotals.forEach(mt => {
      metricRows.push([`Total ${mt.label}`, mt.total]);
      if (mt.hasTimeSeries && mt.latestPeriod) {
        metricRows.push([`${mt.label} — Latest Period (${mt.latestPeriod.period})`, mt.latestPeriod.value]);
        metricRows.push([`${mt.label} — Period-over-Period Change (%)`, mt.momChangePct]);
      }
    });
    kpis.coverage.forEach(c => {
      metricRows.push([`${c.label} — Distinct Values`, c.distinctCount]);
    });
    kpis.topByDimension.forEach(t => {
      if (t.row) metricRows.push([`Top ${t.dimensionLabel}`, t.row.label]);
    });
    if (kpis.primaryDimensionLabel) {
      metricRows.push([`${kpis.primaryDimensionLabel} Trending Up`, kpis.growers]);
      metricRows.push([`${kpis.primaryDimensionLabel} Trending Down`, kpis.decliners]);
    }

    metricRows.forEach(([label, val]) => {
      const r = ws.addRow([label, val]);
      r.getCell(1).font = { name: 'Arial', size: 10 };
      r.getCell(2).font = { name: 'Arial', size: 10, bold: true };
    });

    ws.addRow([]);
    const stripTags = (s) => s.replace(/<\/?b>/g, '');

    function addSection(title, items, color) {
      if (!items.length) return;
      const h = ws.addRow([title]);
      h.getCell(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: color } };
      items.forEach(t => {
        const r = ws.addRow([stripTags(t)]);
        r.getCell(1).font = { name: 'Arial', size: 10 };
        r.getCell(1).alignment = { wrapText: true };
      });
      ws.addRow([]);
    }

    if (insights.mode === 'trend') {
      addSection('Growth Highlights', insights.growth, 'FF1E7B3E');
      addSection('Areas of Concern', insights.decline, 'FFB3261E');
      addSection('Key Takeaways', insights.notable, 'FF2F6B3C');
    } else {
      addSection('Key Insights', insights.notable, 'FF2F6B3C');
    }

    return ws;
  }

  /**
   * Builds the full workbook and triggers a browser download.
   * result: output of PhytoAnalysis.analyze()
   * sourceFileName: original uploaded file name (without extension)
   * sheetName: the sheet the user analyzed
   * Returns a Promise resolving to the filename used.
   */
  async function exportWorkbook(result, sourceFileName, sheetName, viewEditsByDimension) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Phyto Solutions';
    workbook.created = new Date();

    buildKPISheet(workbook, result.kpis, result.insights, sourceFileName, sheetName);

    const usedTitles = new Set(['kpi overview']);
    result.dimensionSummaries.forEach(ds => {
      const title = sanitizeSheetTitle(`${ds.dimensionLabel} Summary`, usedTitles);
      const manualExtra = viewEditsByDimension && viewEditsByDimension[ds.dimensionKey];
      buildSummarySheet(workbook, title, ds, result.parsed.measures, result.primaryMeasureKey, manualExtra);
    });

    const safeFile = sourceFileName.replace(/[\\/:*?"<>|]/g, '_');
    const safeSheet = sheetName.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${safeFile}_${safeSheet}_Insights.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, filename);
    return filename;
  }

  function triggerDownload(blob, filename) {
    if (typeof saveAs === 'function') {
      saveAs(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Like buildSummarySheet, but for buildGroupedSummary's output — one
   * column PER grouped dimension (dimensionsMeta) instead of a single label
   * column, mirroring dashboard.js's renderGroupedTable so the download
   * matches the on-screen grouped table exactly, including the per-period
   * growth/decline color coding.
   */
  function buildGroupedSheet(workbook, sheetTitle, groupedResult, dimensionsMeta, measures, primaryMeasureKey) {
    const ws = workbook.addWorksheet(sheetTitle, { views: [{ state: 'frozen', ySplit: 2 }] });
    const { timePeriods, rows } = groupedResult;
    const labelCols = dimensionsMeta.length ? dimensionsMeta : [{ key: '__all__', label: 'All Data' }];
    const numLabelCols = labelCols.length;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;

    const totalCols = numLabelCols + (hasPeriods ? timePeriods.length * timeSeriesMeasures.length : 0) + measures.length + 1;

    const header1 = ws.getRow(1);
    labelCols.forEach((d, i) => {
      header1.getCell(i + 1).value = d.label;
      ws.mergeCells(1, i + 1, 2, i + 1);
    });

    let col = numLabelCols + 1;
    if (hasPeriods) {
      timePeriods.forEach(p => {
        header1.getCell(col).value = p;
        ws.mergeCells(1, col, 1, col + timeSeriesMeasures.length - 1);
        col += timeSeriesMeasures.length;
      });
    }
    header1.getCell(col).value = 'Total';
    ws.mergeCells(1, col, 1, col + measures.length - 1);
    const totalStartCol = col;
    col += measures.length;
    header1.getCell(col).value = '% Contribution';
    ws.mergeCells(1, col, 2, col);
    const pctCol = col;

    const header2 = ws.getRow(2);
    col = numLabelCols + 1;
    if (hasPeriods) {
      timePeriods.forEach(() => {
        timeSeriesMeasures.forEach(m => { header2.getCell(col).value = m.label; col++; });
      });
    }
    measures.forEach(m => { header2.getCell(col).value = m.label; col++; });

    for (let c = 1; c <= totalCols; c++) {
      header1.getCell(c).fill = HEADER_FILL;
      header1.getCell(c).font = HEADER_FONT;
      header1.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      header2.getCell(c).fill = SUBHEADER_FILL;
      header2.getCell(c).font = HEADER_FONT;
      header2.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    header1.height = 20;
    header2.height = 18;

    // Same dynamic recompute as buildSummarySheet — see the comment there.
    const visibleTotal = primaryMeasureKey
      ? rows.reduce((sum, r) => sum + ((r.byMeasure[primaryMeasureKey] || {}).total || 0), 0)
      : 0;

    rows.forEach(row => {
      const r = ws.addRow([]);
      labelCols.forEach((d, i) => {
        r.getCell(i + 1).value = row.groupValues[d.key];
        r.getCell(i + 1).font = { name: 'Arial', size: 10 };
      });

      let c = numLabelCols + 1;
      if (hasPeriods) {
        timePeriods.forEach((p, idx) => {
          timeSeriesMeasures.forEach(m => {
            const v = row.byMeasure[m.key].byPeriod[idx].value;
            r.getCell(c).value = v === null ? null : v;
            c++;
          });
        });
      }
      measures.forEach(m => {
        r.getCell(totalStartCol + measures.indexOf(m)).value = row.byMeasure[m.key].total;
      });
      const pctBm = primaryMeasureKey ? row.byMeasure[primaryMeasureKey] : null;
      const pct = pctBm && visibleTotal !== 0 ? pctBm.total / visibleTotal : 0;
      r.getCell(pctCol).value = pct;
      r.getCell(pctCol).numFmt = '0%';

      if (hasPeriods) {
        timePeriods.forEach((p, idx) => {
          if (idx === 0) return;
          timeSeriesMeasures.forEach((m, mi) => {
            const periodTrends = row.byMeasure[m.key].periodTrends;
            const trend = periodTrends ? periodTrends[idx] : null;
            const targetCol = numLabelCols + 1 + idx * timeSeriesMeasures.length + mi;
            if (trend === 'up') {
              r.getCell(targetCol).fill = GREEN_FILL;
              r.getCell(targetCol).font = GREEN_FONT;
            } else if (trend === 'down') {
              r.getCell(targetCol).fill = RED_FILL;
              r.getCell(targetCol).font = RED_FONT;
            }
          });
        });
      }

      for (let cc = 1; cc <= totalCols; cc++) {
        r.getCell(cc).border = { bottom: THIN_BORDER };
        if (cc > numLabelCols) r.getCell(cc).alignment = { horizontal: 'right' };
      }
    });

    labelCols.forEach((d, i) => { ws.getColumn(i + 1).width = 28; });
    for (let c = numLabelCols + 1; c <= totalCols; c++) ws.getColumn(c).width = 12;

    return ws;
  }

  /**
   * Downloads the CURRENTLY VIEWED single-dimension breakdown table as its
   * own one-sheet .xlsx — same measures/periods/totals/% contribution AND
   * the same green/red per-period color coding as the on-screen table and
   * the full "Download Insights" workbook, so a standalone download of one
   * view never loses information the multi-sheet export has.
   *
   * options: measureKeys (column customization), excludedKeys (Set<string>
   * of row labels removed from this view — dropped from the file too, so
   * the download always matches what's currently on screen).
   */
  async function exportBreakdownView(result, dimensionKey, sourceFileName, sheetName, options) {
    options = options || {};
    const ds = result.dimensionSummaries.find(d => d.dimensionKey === dimensionKey);
    if (!ds) throw new Error('No breakdown selected to export.');
    const allMeasures = result.parsed.measures;
    const measures = (options.measureKeys && options.measureKeys.length)
      ? options.measureKeys.map(k => allMeasures.find(m => m.key === k)).filter(Boolean)
      : allMeasures;
    const excludedKeys = options.excludedKeys || new Set();
    const filteredDs = { ...ds, rows: ds.rows.filter(r => !excludedKeys.has(r.label)) };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Phyto Solutions';
    workbook.created = new Date();
    const title = sanitizeSheetTitle(`${ds.dimensionLabel} View`, new Set());
    // "Download This View" always includes manual row/column edits — that's
    // the whole point of a per-view download, unlike the full "Download
    // Insights" workbook which asks first (see exportWorkbook).
    buildSummarySheet(workbook, title, filteredDs, measures, result.primaryMeasureKey, options.manualExtra);

    const safeFile = sourceFileName.replace(/[\\/:*?"<>|]/g, '_');
    const safeSheet = sheetName.replace(/[\\/:*?"<>|]/g, '_');
    const safeDim = ds.dimensionLabel.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${safeFile}_${safeSheet}_${safeDim}_View.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, filename);
    return filename;
  }

  /**
   * Downloads the CURRENTLY VIEWED SQL-style grouped table (Group By / Order
   * By) as its own one-sheet .xlsx, with the same color coding — the
   * counterpart to exportBreakdownView() for the composite-grouping view.
   *
   * options: measureKeys, excludedKeys (Set<string> of row.key values
   * removed from this view).
   */
  async function exportGroupedView(groupedResult, dimensionsMeta, allMeasures, primaryMeasureKey, sourceFileName, sheetName, options) {
    options = options || {};
    const measures = (options.measureKeys && options.measureKeys.length)
      ? options.measureKeys.map(k => allMeasures.find(m => m.key === k)).filter(Boolean)
      : allMeasures;
    const excludedKeys = options.excludedKeys || new Set();
    const filtered = { ...groupedResult, rows: groupedResult.rows.filter(r => !excludedKeys.has(r.key)) };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Phyto Solutions';
    workbook.created = new Date();
    buildGroupedSheet(workbook, sanitizeSheetTitle('Grouped View', new Set()), filtered, dimensionsMeta, measures, primaryMeasureKey);

    const safeFile = sourceFileName.replace(/[\\/:*?"<>|]/g, '_');
    const safeSheet = sheetName.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${safeFile}_${safeSheet}_GroupedView.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, filename);
    return filename;
  }

  /**
   * Downloads the "New Insights" workbook — a single sheet built from
   * PhytoAnalysis.buildFocusedInsights()'s output (insights narrated around
   * a user-picked dimension+measure instead of the default one). Kept
   * entirely separate from exportWorkbook()/"Download Insights" so the two
   * downloads never interfere with each other.
   */
  async function exportFocusedInsights(kpis, insights, sourceFileName, sheetName, focusLabel) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Phyto Solutions';
    workbook.created = new Date();
    buildKPISheet(workbook, kpis, insights, sourceFileName, sheetName, 'New Insights');

    const safeFile = sourceFileName.replace(/[\\/:*?"<>|]/g, '_');
    const safeSheet = sheetName.replace(/[\\/:*?"<>|]/g, '_');
    const safeFocus = focusLabel.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${safeFile}_${safeSheet}_NewInsights_${safeFocus}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerDownload(blob, filename);
    return filename;
  }

  return { exportWorkbook, exportBreakdownView, exportGroupedView, exportFocusedInsights, sanitizeSheetTitle };
})();
