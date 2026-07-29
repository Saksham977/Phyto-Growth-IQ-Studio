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
 * Colour coding: green fill for period-over-period growth (latest > previous),
 * red fill for decline — applied to the LAST period's cells, consistent with
 * the trend badges shown in the on-screen dashboard.
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
   */
  function buildSummarySheet(workbook, sheetTitle, dimensionSummary, measures, primaryMeasureKey) {
    const ws = workbook.addWorksheet(sheetTitle, { views: [{ state: 'frozen', ySplit: 2 }] });
    const { dimensionLabel, timePeriods, rows } = dimensionSummary;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;

    const totalCols = 1 + (hasPeriods ? timePeriods.length * timeSeriesMeasures.length : 0) + measures.length + 1;

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

    const lastPeriodStartCol = hasPeriods ? 2 + (timePeriods.length - 1) * timeSeriesMeasures.length : null;

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
      r.getCell(pctCol).value = pctBm ? pctBm.pctContribution / 100 : 0;
      r.getCell(pctCol).numFmt = '0%';

      if (hasPeriods) {
        timeSeriesMeasures.forEach((m, mi) => {
          const trend = row.byMeasure[m.key].trend;
          const targetCol = lastPeriodStartCol + mi;
          if (trend === 'up') {
            r.getCell(targetCol).fill = GREEN_FILL;
            r.getCell(targetCol).font = GREEN_FONT;
          } else if (trend === 'down') {
            r.getCell(targetCol).fill = RED_FILL;
            r.getCell(targetCol).font = RED_FONT;
          }
        });
      }

      for (let cc = 1; cc <= totalCols; cc++) {
        r.getCell(cc).border = { bottom: THIN_BORDER };
        if (cc > 1) r.getCell(cc).alignment = { horizontal: 'right' };
      }
    });

    ws.getColumn(1).width = 34;
    for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 12;

    return ws;
  }

  function buildKPISheet(workbook, kpis, insights, sourceFileName, sheetName) {
    const ws = workbook.addWorksheet(sanitizeSheetTitle('KPI Overview', new Set()));
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
  async function exportWorkbook(result, sourceFileName, sheetName) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Phyto Solutions';
    workbook.created = new Date();

    buildKPISheet(workbook, result.kpis, result.insights, sourceFileName, sheetName);

    const usedTitles = new Set(['kpi overview']);
    result.dimensionSummaries.forEach(ds => {
      const title = sanitizeSheetTitle(`${ds.dimensionLabel} Summary`, usedTitles);
      buildSummarySheet(workbook, title, ds, result.parsed.measures, result.primaryMeasureKey);
    });

    const safeFile = sourceFileName.replace(/[\\/:*?"<>|]/g, '_');
    const safeSheet = sheetName.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${safeFile}_${safeSheet}_Insights.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    if (typeof saveAs === 'function') {
      saveAs(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    return filename;
  }

  return { exportWorkbook, sanitizeSheetTitle };
})();
