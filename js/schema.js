/**
 * schema.js
 * ---------------------------------------------------------------------------
 * Detects the structure of an arbitrary uploaded sheet — which columns are
 * dimensions (labels to group by), which are measures (numeric metrics), and
 * whether there's a repeating time-period structure (months/quarters/years) —
 * so the rest of the app no longer needs to assume a fixed "Party Name/Item
 * Name/Division + Jan/Feb Units/Value" layout.
 *
 * Detection is heuristic and is never trusted blindly: `detectSchema()`'s
 * output is shown to the user as an editable review table (schemaReview.js)
 * before analysis runs. `applyUserEdits()` re-derives the grouped shape after
 * any manual correction. This file only classifies structure — it never reads
 * numeric values for analysis purposes (analysis.js/parser.js do that).
 * ---------------------------------------------------------------------------
 */

const PhytoSchema = (() => {

  const SAMPLE_SIZE = 200;
  const NUMERIC_THRESHOLD = 0.85;

  const SUBHEADER_LEXICON = /^(units?|qty|quantity|value|amount|revenue|sales|volume|count|price|rate|cost|target|actual|budget|variance|no\.?)$/i;
  const ID_LEXICON = /\b(id|code|no\.?|number|sr\.?\s*no|serial|sku|order\s*#|invoice)\b/i;
  // Header names that indicate a calendar/temporal *label* rather than a summable
  // metric — e.g. a per-row "Date" or "Year" column in long/transactional data
  // (as opposed to a column that IS a period, like "Jan-24" or "2014", which
  // TIME_PERIOD_PATTERNS below already catches). Without this, a numeric-looking
  // Date (Excel serial numbers) or Year column gets summed into a meaningless total.
  const TEMPORAL_DIMENSION_LEXICON = /\b(date|dob|year|quarter|day|timestamp)\b/i;
  const PRIMARY_MEASURE_LEXICON = /value|revenue|sales|amount/i;
  const TIME_PERIOD_PATTERNS = [
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/']?\d{0,4}$/i,
    /^q[1-4][\s\-\/']?\d{0,4}$/i,
    /^quarter\s?[1-4]/i,
    /^(19|20)\d{2}$/,
    /^fy[\s\-']?\d{2,4}$/i,
    /^w(eek)?[\s\-]?\d{1,2}$/i,
    /^(period|month|p)[\s\-_]?\d{1,2}$/i,
  ];

  function cellText(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  // Inserts a space at camelCase/concatenated-word boundaries (e.g.
  // "PassengerId" -> "Passenger Id", "OrderID" -> "Order ID") so lexicon
  // regexes with \b word boundaries can match identifier suffixes that are
  // glued onto another word — a very common real-world naming convention
  // that plain \b matching misses (\b only fires at word/non-word transitions,
  // not mid-word case changes).
  function withCamelBoundaries(label) {
    return cellText(label).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  function matchesTimePeriodLexicon(label) {
    const s = cellText(label);
    if (!s) return false;
    return TIME_PERIOD_PATTERNS.some(re => re.test(s));
  }

  function slugify(label) {
    const words = String(label || 'column')
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    if (!words.length) return 'column';
    return words
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }

  function makeUniqueKey(label, usedKeys) {
    let key = slugify(label);
    let base = key, i = 2;
    while (usedKeys.has(key)) { key = base + i; i++; }
    usedKeys.add(key);
    return key;
  }

  /**
   * Detects header shape: how many header rows (1 or 2), and which row data
   * starts on. dataStartRow alone (combined with headerRowCount) fully
   * describes the layout, which is why it's the one thing exposed as a
   * single user-overridable control in the review UI.
   */
  function detectHeaderLayout(aoa, merges) {
    // Merge signal (authoritative): a horizontal merge spanning >=2 columns
    // on row 0 or row 1 means a 2-row merged header starting at that row.
    for (const headerRow of [0, 1]) {
      const hasHeaderMerge = merges.some(m => m.s.r === headerRow && m.e.r === headerRow && m.e.c > m.s.c);
      if (hasHeaderMerge) {
        return { headerRowCount: 2, dataStartRow: headerRow + 2 };
      }
    }
    // Lexicon fallback (no merge metadata available): row-below-header looks
    // like Units/Value-style sub-labels.
    for (const headerRow of [0, 1]) {
      const subRow = aoa[headerRow + 1] || [];
      const nonBlank = subRow.filter(c => cellText(c) !== '');
      if (nonBlank.length === 0) continue;
      const matches = nonBlank.filter(c => SUBHEADER_LEXICON.test(cellText(c)));
      if (matches.length / nonBlank.length >= 0.5) {
        return { headerRowCount: 2, dataStartRow: headerRow + 2 };
      }
    }
    // 1-row header. Detect a leading title/banner row (few cells, followed
    // by a row that looks like real column headers).
    const row0 = aoa[0] || [];
    const row1 = aoa[1] || [];
    const row0NonBlank = row0.filter(c => cellText(c) !== '').length;
    const row1NonBlank = row1.filter(c => cellText(c) !== '').length;
    if (row0NonBlank > 0 && row0NonBlank <= 2 && row1NonBlank >= 3 && row1NonBlank > row0NonBlank) {
      return { headerRowCount: 1, dataStartRow: 2 };
    }
    return { headerRowCount: 1, dataStartRow: 1 };
  }

  /**
   * Builds one entry per raw column: {colIndex, headerLabel, parentLabel, subLabel}.
   */
  function buildColumnBlocks(aoa, headerRowCount, dataStartRow, merges) {
    const headerStartRow = dataStartRow - headerRowCount;
    let numCols = 0;
    aoa.forEach(row => { if (row && row.length > numCols) numCols = row.length; });

    const columns = [];

    if (headerRowCount === 1) {
      const row = aoa[headerStartRow] || [];
      for (let c = 0; c < numCols; c++) {
        const label = cellText(row[c]);
        columns.push({
          colIndex: c,
          headerLabel: label || `Column ${XLSX.utils.encode_col(c)}`,
          parentLabel: null,
          subLabel: null,
        });
      }
      return columns;
    }

    const parentRow = aoa[headerStartRow] || [];
    const subRow = aoa[headerStartRow + 1] || [];
    const parentMerges = merges.filter(m => m.s.r === headerStartRow && m.e.r === headerStartRow);

    let c = 0;
    while (c < numCols) {
      const merge = parentMerges.find(m => m.s.c === c);
      let endCol;
      if (merge) {
        endCol = merge.e.c;
      } else if (cellText(parentRow[c])) {
        endCol = c;
        let n = c + 1;
        while (n < numCols && !cellText(parentRow[n])) { endCol = n; n++; }
      } else {
        endCol = c;
      }
      const parentLabel = cellText(parentRow[c]) || null;
      for (let cc = c; cc <= endCol; cc++) {
        const subLabel = cellText(subRow[cc]) || null;
        let headerLabel;
        if (parentLabel && subLabel) headerLabel = `${parentLabel} → ${subLabel}`;
        else if (parentLabel) headerLabel = parentLabel;
        else if (subLabel) headerLabel = subLabel;
        else headerLabel = `Column ${XLSX.utils.encode_col(cc)}`;
        columns.push({ colIndex: cc, headerLabel, parentLabel, subLabel });
      }
      c = endCol + 1;
    }
    return columns;
  }

  /**
   * Classifies one column as dimension / measure / time-period / ignore by
   * sampling its data values. Rule order matters: lexicon matches (ID,
   * time-period) win outright; numeric ratio only decides measure-vs-dimension
   * for columns with no lexicon hit. A mandatory human review step is the
   * safety net for anything this gets wrong, so a single clear threshold is
   * preferred over multiple tuned thresholds that are hard to hand-verify.
   */
  function classifyColumn(aoa, colIndex, dataStartRow, headerLabel, parentLabel) {
    let nonBlank = 0, numeric = 0;
    const sampleValues = [];
    const maxRow = Math.min(aoa.length, dataStartRow + SAMPLE_SIZE);

    for (let r = dataStartRow; r < maxRow; r++) {
      const row = aoa[r];
      if (!row) continue;
      const v = row[colIndex];
      if (v === null || v === undefined || v === '') continue;
      nonBlank++;
      if (sampleValues.length < 3) sampleValues.push(String(v));
      if (PhytoParser.toNumberOrNull(v) !== null) numeric++;
    }

    if (nonBlank === 0) {
      return { role: 'ignore', confidence: 'high', reason: 'Empty column', sampleValues };
    }

    const numericRatio = numeric / nonBlank;
    const normalizedHeader = withCamelBoundaries(headerLabel);

    if (ID_LEXICON.test(normalizedHeader)) {
      return { role: 'dimension', confidence: 'high', reason: 'Header name suggests an identifier/code column', sampleValues };
    }
    if (matchesTimePeriodLexicon(parentLabel || headerLabel)) {
      return { role: 'time-period', confidence: 'high', reason: 'Header text looks like a time period (month/quarter/year)', sampleValues };
    }
    if (TEMPORAL_DIMENSION_LEXICON.test(normalizedHeader)) {
      return { role: 'dimension', confidence: 'high', reason: 'Header name suggests a date/calendar column, not a summable metric', sampleValues };
    }
    if (numericRatio >= NUMERIC_THRESHOLD) {
      return { role: 'measure', confidence: numericRatio === 1 ? 'high' : 'medium', reason: `Mostly numeric (${Math.round(numericRatio * 100)}% of sampled values)`, sampleValues };
    }
    const sampledRows = maxRow - dataStartRow;
    if (!headerLabel && nonBlank < 0.1 * sampledRows) {
      return { role: 'ignore', confidence: 'low', reason: 'Mostly blank, unlabeled column', sampleValues };
    }
    return { role: 'dimension', confidence: numericRatio < 0.3 ? 'high' : 'medium', reason: 'Mostly non-numeric text', sampleValues };
  }

  /**
   * Groups classified columns into dimensions / standalone measures / a
   * time-period series (one entry per detected period, in left-to-right
   * column order — no separate sequence-guessing pass; the mandatory review
   * table is the correction path for the rare case column order isn't
   * chronological).
   */
  function assembleGroups(columns, headerRowCount) {
    const dimensions = [];
    const standaloneMeasures = [];
    const timePeriodGroups = new Map(); // groupLabel -> { label, order, subCols:[{colIndex,measureLabel}] }
    const usedKeys = new Set();

    columns.forEach((col, idx) => {
      if (col.role === 'ignore') return;
      if (col.role === 'dimension') {
        dimensions.push({ colIndex: col.colIndex, label: col.headerLabel, key: makeUniqueKey(col.headerLabel, usedKeys) });
        return;
      }
      if (col.role === 'measure') {
        standaloneMeasures.push({ colIndex: col.colIndex, label: col.headerLabel, key: makeUniqueKey(col.headerLabel, usedKeys) });
        return;
      }
      if (col.role === 'time-period') {
        const groupLabel = (headerRowCount === 2 && col.parentLabel) ? col.parentLabel : col.headerLabel;
        if (!timePeriodGroups.has(groupLabel)) {
          timePeriodGroups.set(groupLabel, { label: groupLabel, order: idx, subCols: [] });
        }
        const measureLabel = (headerRowCount === 2 && col.subLabel) ? col.subLabel : 'Value';
        timePeriodGroups.get(groupLabel).subCols.push({ colIndex: col.colIndex, measureLabel });
      }
    });

    // Assign one stable key per distinct sub-measure name across all periods
    // (e.g. every "Units" sub-column, whichever month it's in, maps to the
    // same key) so analysis.js can sum a measure across periods generically.
    const measureKeyByLabel = new Map();
    const orderedGroups = Array.from(timePeriodGroups.values()).sort((a, b) => a.order - b.order);
    const timePeriods = orderedGroups.map((group, order) => ({
      label: group.label,
      order,
      subMeasureColumns: group.subCols.map(sc => {
        let key = measureKeyByLabel.get(sc.measureLabel);
        if (!key) {
          key = makeUniqueKey(sc.measureLabel, usedKeys);
          measureKeyByLabel.set(sc.measureLabel, key);
        }
        return { measureKey: key, colIndex: sc.colIndex, label: sc.measureLabel };
      }),
    }));

    const measureRegistry = [
      ...Array.from(measureKeyByLabel.entries()).map(([label, key]) => ({ key, label, hasTimeSeries: true })),
      ...standaloneMeasures.map(m => ({ key: m.key, label: m.label, hasTimeSeries: false })),
    ];

    return { dimensions, standaloneMeasures, timePeriods, measureRegistry };
  }

  function pickPrimaryMeasureKey(measureRegistry) {
    if (!measureRegistry.length) return null;
    const match = measureRegistry.find(m => PRIMARY_MEASURE_LEXICON.test(m.label));
    return (match || measureRegistry[0]).key;
  }

  function checkConsistentSubMeasures(timePeriods) {
    const warnings = [];
    if (timePeriods.length < 2) return warnings;
    const referenceKeys = [...timePeriods[0].subMeasureColumns.map(c => c.measureKey)].sort().join(',');
    timePeriods.slice(1).forEach(tp => {
      const keys = [...tp.subMeasureColumns.map(c => c.measureKey)].sort().join(',');
      if (keys !== referenceKeys) {
        warnings.push(`Inconsistent sub-columns detected: "${tp.label}" doesn't have the same measures as "${timePeriods[0].label}". Missing values will be treated as blank.`);
      }
    });
    return warnings;
  }

  function buildWarnings(dimensions, timePeriods, measureRegistry, extra) {
    const warnings = [...extra];
    if (measureRegistry.length === 0) {
      warnings.push('No numeric measure columns were detected. Mark at least one column as "Measure" or "Time-Period" below.');
    }
    if (dimensions.length === 0) {
      warnings.push('No dimension/label columns were detected — results will be grouped into a single "All Data" row.');
    }
    if (timePeriods.length === 0) {
      warnings.push('No repeating time-period structure was detected — showing flat totals instead of month-over-month trends.');
    }
    return warnings;
  }

  /**
   * Runs full detection for a sheet. Returns a DetectedSchema object that
   * schemaReview.js renders as an editable table and PhytoParser.parseSheet()
   * consumes once confirmed.
   */
  function detectSchema(workbook, sheetName) {
    const aoa = PhytoParser.sheetToAOA(workbook, sheetName);
    const merges = PhytoParser.getMerges(workbook, sheetName);

    if (aoa.length === 0) {
      return {
        sheetName, headerRowCount: 1, dataStartRow: 1,
        columns: [], dimensions: [], timePeriods: [], standaloneMeasures: [], measureRegistry: [],
        primaryMeasureKey: null, warnings: ['This sheet appears to be empty.'],
        _aoa: aoa, _merges: merges,
      };
    }

    const { headerRowCount, dataStartRow } = detectHeaderLayout(aoa, merges);
    const blocks = buildColumnBlocks(aoa, headerRowCount, dataStartRow, merges);
    const columns = blocks.map(b => ({
      ...b,
      ...classifyColumn(aoa, b.colIndex, dataStartRow, b.headerLabel, b.parentLabel),
    }));
    const { dimensions, standaloneMeasures, timePeriods, measureRegistry } = assembleGroups(columns, headerRowCount);
    const primaryMeasureKey = pickPrimaryMeasureKey(measureRegistry);
    const warnings = buildWarnings(dimensions, timePeriods, measureRegistry, checkConsistentSubMeasures(timePeriods));

    return {
      sheetName, headerRowCount, dataStartRow,
      columns, dimensions, timePeriods, standaloneMeasures, measureRegistry,
      primaryMeasureKey, warnings,
      _aoa: aoa, _merges: merges,
    };
  }

  /**
   * Re-derives the grouped shape after user edits. Full-replace semantics:
   * callers pass the complete current role/primary-measure/header-layout
   * state each time, not an incremental patch.
   */
  function applyUserEdits(schema, columnRoleOverrides, primaryMeasureKeyOverride, headerLayoutOverride) {
    let headerRowCount = schema.headerRowCount;
    let dataStartRow = schema.dataStartRow;
    let columns = schema.columns;

    const layoutChanged = headerLayoutOverride &&
      (headerLayoutOverride.headerRowCount !== headerRowCount || headerLayoutOverride.dataStartRow !== dataStartRow);

    if (layoutChanged) {
      headerRowCount = headerLayoutOverride.headerRowCount;
      dataStartRow = headerLayoutOverride.dataStartRow;
      const blocks = buildColumnBlocks(schema._aoa, headerRowCount, dataStartRow, schema._merges);
      columns = blocks.map(b => ({
        ...b,
        ...classifyColumn(schema._aoa, b.colIndex, dataStartRow, b.headerLabel, b.parentLabel),
      }));
    }

    if (columnRoleOverrides && columnRoleOverrides.length) {
      const overrideMap = new Map(columnRoleOverrides.map(o => [o.colIndex, o.role]));
      columns = columns.map(col => {
        const role = overrideMap.get(col.colIndex);
        if (role === undefined || role === col.role && !layoutChanged) return col;
        if (role === undefined) return col;
        return { ...col, role, confidence: 'high', reason: 'User override' };
      });
    }

    const { dimensions, standaloneMeasures, timePeriods, measureRegistry } = assembleGroups(columns, headerRowCount);
    let primaryMeasureKey = primaryMeasureKeyOverride || schema.primaryMeasureKey;
    if (!measureRegistry.some(m => m.key === primaryMeasureKey)) {
      primaryMeasureKey = pickPrimaryMeasureKey(measureRegistry);
    }
    const warnings = buildWarnings(dimensions, timePeriods, measureRegistry, checkConsistentSubMeasures(timePeriods));

    return {
      ...schema,
      headerRowCount, dataStartRow, columns, dimensions, timePeriods, standaloneMeasures, measureRegistry,
      primaryMeasureKey, warnings,
    };
  }

  function validateSchema(schema) {
    const errors = [];
    if (!schema.measureRegistry || schema.measureRegistry.length === 0) {
      errors.push('At least one column must be marked as Measure or Time-Period to analyze this sheet.');
    }
    return { valid: errors.length === 0, errors, warnings: schema.warnings || [] };
  }

  return {
    detectSchema,
    applyUserEdits,
    validateSchema,
  };
})();
