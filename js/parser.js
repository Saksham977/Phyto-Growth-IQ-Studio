/**
 * parser.js
 * ---------------------------------------------------------------------------
 * Responsible for turning a raw uploaded workbook (parsed by SheetJS) into a
 * normalized in-memory structure the rest of the app can work with.
 *
 * The sheet's layout is no longer assumed fixed — schema.js detects it (and
 * the user confirms/corrects it via the review UI), and parseSheet() below
 * just walks the sheet according to whatever schema it's handed. It's
 * defensive about blank cells, which is why we read raw data with
 * `sheet_to_json({header:1})` rather than relying on SheetJS's own
 * header-guessing.
 * ---------------------------------------------------------------------------
 */

const PhytoParser = (() => {

  /**
   * Reads an ArrayBuffer into a SheetJS workbook.
   */
  function readWorkbook(arrayBuffer) {
    return XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  }

  /**
   * Extracts raw AOA (array-of-arrays) for a given sheet name.
   */
  function sheetToAOA(workbook, sheetName) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook.`);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }

  /**
   * Returns the merged-cell ranges for a sheet (used by schema.js to detect
   * 2-row merged headers structurally rather than by lexicon guessing alone).
   */
  function getMerges(workbook, sheetName) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook.`);
    return ws['!merges'] || [];
  }

  /**
   * Converts a raw cell value to a finite number, or null if not numeric
   * (blank cells, formatting artifacts, stray text, etc. are treated as "no data").
   */
  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    // Handle stray strings such as accidental HTML/markup slipping into cells.
    const cleaned = String(v).replace(/[, ]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) && /^-?\d+(\.\d+)?$/.test(cleaned) ? n : null;
  }

  function cellText(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  /**
   * Main entry point: parses a sheet into normalized row records, driven by a
   * confirmed schema (see schema.js — the output of PhytoSchema.detectSchema(),
   * possibly edited via PhytoSchema.applyUserEdits()) rather than a fixed
   * layout. Returns: {
   *   sheetName,
   *   dimensions: [{key,label}],
   *   measures: [{key,label,hasTimeSeries}],
   *   timePeriods: [string],
   *   primaryMeasureKey,
   *   records: [{ dims: {key:label,...}, measures: {key: {hasTimeSeries,periods|value}} }],
   *   rowCount, skippedRows
   * }
   */
  function parseSheet(workbook, sheetName, confirmedSchema) {
    const aoa = sheetToAOA(workbook, sheetName);
    const { dataStartRow, dimensions, timePeriods, standaloneMeasures, measureRegistry, primaryMeasureKey } = confirmedSchema;

    // Every raw column index this schema actually tracks — used to decide
    // whether a row is "entirely blank" (no dimension can be structurally
    // privileged anymore, unlike the old fixed "Item Name" rule).
    const trackedColIndexes = [
      ...dimensions.map(d => d.colIndex),
      ...standaloneMeasures.map(m => m.colIndex),
      ...timePeriods.flatMap(tp => tp.subMeasureColumns.map(sc => sc.colIndex)),
    ];

    const records = [];
    let skippedRows = 0;

    for (let r = dataStartRow; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) { continue; }

      const isBlank = trackedColIndexes.every(c => {
        const v = row[c];
        return v === null || v === undefined || v === '';
      });
      if (isBlank) { skippedRows++; continue; }

      const dims = {};
      dimensions.forEach(d => {
        const raw = row[d.colIndex];
        let text;
        if (d.dateFormat) {
          const n = toNumberOrNull(raw);
          text = n !== null ? XLSX.SSF.format(d.dateFormat, n) : cellText(raw);
        } else {
          text = cellText(raw);
        }
        dims[d.key] = text || `(Unspecified ${d.label})`;
      });

      const measures = {};
      measureRegistry.forEach(m => {
        if (m.hasTimeSeries) {
          const periods = timePeriods.map(tp => {
            const subCol = tp.subMeasureColumns.find(sc => sc.measureKey === m.key);
            const raw = subCol ? row[subCol.colIndex] : undefined;
            return { period: tp.label, value: toNumberOrNull(raw) };
          });
          measures[m.key] = { hasTimeSeries: true, periods };
        } else {
          const standalone = standaloneMeasures.find(sm => sm.key === m.key);
          const raw = standalone ? row[standalone.colIndex] : undefined;
          measures[m.key] = { hasTimeSeries: false, value: toNumberOrNull(raw) };
        }
      });

      records.push({ dims, measures });
    }

    return {
      sheetName,
      dimensions: dimensions.map(d => ({ key: d.key, label: d.label })),
      measures: measureRegistry.map(m => ({ key: m.key, label: m.label, hasTimeSeries: m.hasTimeSeries })),
      timePeriods: timePeriods.map(tp => tp.label),
      primaryMeasureKey,
      records,
      rowCount: records.length,
      skippedRows,
    };
  }

  /**
   * Lists sheet names in a workbook.
   */
  function listSheetNames(workbook) {
    return workbook.SheetNames;
  }

  return {
    readWorkbook,
    listSheetNames,
    parseSheet,
    sheetToAOA,
    getMerges,
    toNumberOrNull,
  };
})();
