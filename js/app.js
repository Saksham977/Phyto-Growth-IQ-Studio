/**
 * app.js
 * ---------------------------------------------------------------------------
 * Top-level orchestration: wires file upload -> sheet selection -> schema
 * detection/review -> analysis -> filters -> rendering -> export/chart
 * controls. All processing happens client-side in memory; nothing is ever
 * sent to a server.
 *
 * `createTabController(ids, tabKey)` builds one independent instance of this
 * whole flow, scoped entirely to the DOM element ids passed in — this is
 * what lets the 3 tabs (Primary Sales Data / Doctor Wise Analysis /
 * Secondary Sale) each have their own upload, schema review, filters, and
 * dashboard state that persists when you switch away and back, while
 * sharing 100% of the same logic. `tabKey` namespaces the saved column-view
 * preference (viewPrefs.js) per tab. Tab-switching itself (`initTabNav`) is
 * just show/hide; it doesn't touch any tab's data.
 * ---------------------------------------------------------------------------
 */

function createTabController(ids, tabKey) {
  let state = {
    workbook: null,
    fileName: '',       // without extension
    sheetName: null,
    schema: null,       // current confirmed (possibly user-edited) DetectedSchema
    rawParsed: null,    // the pristine, unmodified PhytoParser.parseSheet() output
    baseParsed: null,   // rawParsed + derivedColumns applied — what filters/analysis actually operate on
    derivedColumns: [], // [{key, label, sourceKey, sourceLabel, mapping, unmappedLabel}] — user-built "group into a new column" definitions
    result: null,       // output of PhytoAnalysis.analyze() on the filtered records
    filterSelections: {}, // {[dimensionKey]: Set<string>}
    visibleMeasureKeys: null, // null = show every measure, in detected order
    fullMeasureOrder: null,   // every measure key in the user's chosen order (incl. hidden)
    selectedDimensionKey: null,
    groupByKeys: [],          // SQL-style GROUP BY: array of dimension keys — empty = opted out (default)
    sortConfig: null,         // SQL-style ORDER BY: {key:'dim:<k>'|'measure:<k>', direction} or null = default
    excludedRowsByDimension: {}, // {[dimensionKey]: Set<rowLabel>} — rows removed from THIS view only
    excludedGroupedRowKeys: new Set(), // Set<row.key> removed from the grouped view only
    viewEdits: {}, // {[dimensionKey]: {editMode, addedRows, customColumns, overrides}} — manual add-row/add-column/edit layer, session-only
    nextEditId: 1, // counter for added-row/added-column ids, unique within this tab
    insightsFocus: null,  // null = showing the original insights; else {dimensionKey, measureKey, dimensionLabel, measureLabel}
    focusedKpis: null,    // PhytoAnalysis.buildFocusedInsights() output, kept in sync with insightsFocus
    focusedInsights: null,
  };

  // ---- DOM refs ----
  const dropzone = document.getElementById(ids.dropzone);
  const fileInput = document.getElementById(ids.fileInput);
  const fileChip = document.getElementById(ids.fileChip);
  const fileChipName = document.getElementById(ids.fileChipName);
  const removeFileBtn = document.getElementById(ids.removeFileBtn);
  const controlsPanel = document.getElementById(ids.controlsPanel);
  const sheetSelect = document.getElementById(ids.sheetSelect);
  const analyzeBtn = document.getElementById(ids.analyzeBtn);
  const exportBtn = document.getElementById(ids.exportBtn);
  const exportViewBtn = document.getElementById(ids.exportViewBtn);
  const exportGroupedBtn = document.getElementById(ids.exportGroupedBtn);
  const loadingBar = document.getElementById(ids.loadingBar);
  const dashboard = document.getElementById(ids.dashboard);
  const filterPanel = document.getElementById(ids.filterPanel);
  const deriveColumnBuilder = document.getElementById(ids.deriveColumnBuilder);
  const activeDerivedColumns = document.getElementById(ids.activeDerivedColumns);
  const perfDimensionSelect = document.getElementById(ids.perfDimensionSelect);
  const perfMeasureSelect = document.getElementById(ids.perfMeasureSelect);
  const perfThresholdInput = document.getElementById(ids.perfThresholdInput);
  const performancePanel = document.getElementById(ids.performancePanel);
  const breakdownSelect = document.getElementById(ids.breakdownSelect);
  const saveViewBtn = document.getElementById(ids.saveViewBtn);
  const columnSelector = document.getElementById(ids.columnSelector);
  const groupByControls = document.getElementById(ids.groupByControls);
  const orderByControls = document.getElementById(ids.orderByControls);
  const groupedTableWrap = document.getElementById(ids.groupedTableWrap);
  const chartTypeSelect = document.getElementById(ids.chartTypeSelect);
  const chartMetricSelect = document.getElementById(ids.chartMetricSelect);
  const chartSourceSelect = document.getElementById(ids.chartSourceSelect);
  const chartCanvas = document.getElementById(ids.chartCanvas);
  const chartEmptyState = document.getElementById(ids.chartEmptyState);
  const heatmapWrap = document.getElementById(ids.heatmapWrap);
  const chartExcludeUnspecifiedBtn = document.getElementById(ids.chartExcludeUnspecifiedBtn);
  const insightsFocusToggle = document.getElementById(ids.insightsFocusToggle);
  const insightsFocusDimensionSelect = document.getElementById(ids.insightsFocusDimension);
  const insightsFocusMeasureSelect = document.getElementById(ids.insightsFocusMeasure);
  const newInsightsBtn = document.getElementById(ids.newInsightsBtn);
  const downloadNewInsightsBtn = document.getElementById(ids.downloadNewInsightsBtn);
  const insightsModeLabel = document.getElementById(ids.insightsModeLabel);

  function showToast(message, warn) {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  function setLoading(on) {
    loadingBar.classList.toggle('visible', on);
  }

  function stripExt(name) {
    return name.replace(/\.(xlsx|xls|xlsm)$/i, '');
  }

  // ---- Library availability guard ----
  // If js/vendor/*.js failed to load (blocked, missing, or corrupted), fail
  // fast with a clear message instead of a cryptic "X is not defined" error
  // deep inside parsing/export code.
  function checkRequiredLibraries() {
    const missing = [];
    if (typeof XLSX === 'undefined') missing.push('XLSX (js/vendor/xlsx.full.min.js)');
    if (typeof ExcelJS === 'undefined') missing.push('ExcelJS (js/vendor/exceljs.min.js)');
    if (typeof Chart === 'undefined') missing.push('Chart.js (js/vendor/chart.umd.min.js)');
    if (typeof saveAs === 'undefined') missing.push('FileSaver (js/vendor/FileSaver.min.js)');
    return missing;
  }

  // ---- File handling ----
  function handleFile(file) {
    if (!file) return;
    const validExt = /\.(xlsx|xls|xlsm)$/i.test(file.name);
    if (!validExt) {
      showToast('Please upload a valid Excel file (.xlsx, .xls, .xlsm).', true);
      return;
    }
    const missingLibs = checkRequiredLibraries();
    if (missingLibs.length) {
      showToast('Required library failed to load: ' + missingLibs.join(', ') + '. Try reloading the page.', true);
      return;
    }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = new Uint8Array(e.target.result);
        const workbook = PhytoParser.readWorkbook(buf);
        const sheetNames = PhytoParser.listSheetNames(workbook);
        if (!sheetNames.length) {
          showToast('No sheets were found in this workbook.', true);
          setLoading(false);
          return;
        }
        state.workbook = workbook;
        state.fileName = stripExt(file.name);
        state.schema = null;
        state.baseParsed = null;
        state.result = null;

        populateSheetDropdown(sheetNames);
        showFileChip(file.name);
        controlsPanel.classList.add('visible');
        dashboard.classList.remove('visible');
        runDetection();
        setLoading(false);
      } catch (err) {
        console.error(err);
        showToast('Could not read this file: ' + err.message, true);
        setLoading(false);
      }
    };
    reader.onerror = () => {
      showToast('There was a problem reading the file from disk.', true);
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }

  function populateSheetDropdown(sheetNames) {
    sheetSelect.innerHTML = sheetNames.map(n => `<option value="${n}">${n}</option>`).join('');
    // Prefer a sheet that looks like raw data over an existing "Result"-style sheet, if present.
    const preferred = sheetNames.find(n => /summary|data|raw/i.test(n)) || sheetNames[0];
    sheetSelect.value = preferred;
  }

  function showFileChip(name) {
    fileChipName.textContent = name;
    fileChip.style.display = 'inline-flex';
    dropzone.style.display = 'none';
  }

  function resetFile() {
    state = {
      workbook: null, fileName: '', sheetName: null, schema: null,
      rawParsed: null, baseParsed: null, derivedColumns: [], result: null,
      filterSelections: {}, visibleMeasureKeys: null, fullMeasureOrder: null, selectedDimensionKey: null,
      groupByKeys: [], sortConfig: null,
      excludedRowsByDimension: {}, excludedGroupedRowKeys: new Set(),
      viewEdits: {}, nextEditId: 1,
      insightsFocus: null, focusedKpis: null, focusedInsights: null,
    };
    fileInput.value = '';
    fileChip.style.display = 'none';
    dropzone.style.display = 'block';
    controlsPanel.classList.remove('visible');
    dashboard.classList.remove('visible');
    exportViewBtn.disabled = true;
    exportGroupedBtn.disabled = true;
    filterPanel.innerHTML = '';
    deriveColumnBuilder.innerHTML = '';
    activeDerivedColumns.innerHTML = '';
    columnSelector.innerHTML = '';
    performancePanel.innerHTML = '';
    groupByControls.innerHTML = '';
    orderByControls.innerHTML = '';
    groupedTableWrap.innerHTML = '';
    insightsFocusToggle.checked = false;
    insightsFocusDimensionSelect.disabled = true;
    insightsFocusMeasureSelect.disabled = true;
    insightsFocusDimensionSelect.innerHTML = '';
    insightsFocusMeasureSelect.innerHTML = '';
    newInsightsBtn.disabled = true;
    newInsightsBtn.textContent = 'New Insights';
    downloadNewInsightsBtn.disabled = true;
    insightsModeLabel.textContent = '';
    PhytoCharts.destroy(ids.chartCanvas);
  }

  // ---- Schema detection & review ----
  function runDetection() {
    if (!state.workbook) return;
    const sheetName = sheetSelect.value;
    try {
      const detected = PhytoSchema.detectSchema(state.workbook, sheetName);
      state.schema = detected;
      state.result = null;
      dashboard.classList.remove('visible');
      PhytoSchemaReview.render(detected, ids.schemaReviewPanel, onSchemaChanged);
      updateAnalyzeAvailability();
    } catch (err) {
      console.error(err);
      showToast('Could not read this sheet: ' + err.message, true);
    }
  }

  function onSchemaChanged(updatedSchema) {
    state.schema = updatedSchema;
    updateAnalyzeAvailability();
  }

  function updateAnalyzeAvailability() {
    const validation = PhytoSchema.validateSchema(state.schema);
    analyzeBtn.disabled = !validation.valid;
  }

  // ---- Analysis ----
  function runAnalysis() {
    if (!state.workbook || !state.schema) return;
    const sheetName = sheetSelect.value;
    setLoading(true);
    // Defer to next tick so the loading indicator can paint for large files.
    setTimeout(() => {
      try {
        const parsed = PhytoParser.parseSheet(state.workbook, sheetName, state.schema);
        if (parsed.rowCount === 0) {
          showToast('No data rows were found in the selected sheet.', true);
          setLoading(false);
          return;
        }
        state.sheetName = sheetName;
        state.rawParsed = parsed;
        state.baseParsed = parsed;
        state.derivedColumns = [];
        state.filterSelections = {};
        state.selectedDimensionKey = null;
        // Group By / Order By start OFF on every fresh analysis — the user
        // opts in explicitly by checking field(s), rather than the grouped
        // table appearing automatically.
        state.groupByKeys = [];
        state.sortConfig = null;
        state.excludedRowsByDimension = {};
        state.excludedGroupedRowKeys = new Set();
        state.viewEdits = {};
        state.nextEditId = 1;
        state.insightsFocus = null;
        state.focusedKpis = null;
        state.focusedInsights = null;
        insightsFocusToggle.checked = false;
        insightsFocusDimensionSelect.disabled = true;
        insightsFocusMeasureSelect.disabled = true;
        newInsightsBtn.disabled = true;
        newInsightsBtn.textContent = 'New Insights';
        downloadNewInsightsBtn.disabled = true;
        insightsModeLabel.textContent = '';

        const saved = PhytoViewPrefs.load(tabKey);
        state.visibleMeasureKeys = (saved && saved.measureKeys && saved.measureKeys.length) ? saved.measureKeys : null;
        state.fullMeasureOrder = state.visibleMeasureKeys;

        runAnalysisAndRender();
        dashboard.classList.add('visible');
        exportBtn.disabled = false;
        exportViewBtn.disabled = false;
        dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (parsed.skippedRows > 0) {
          showToast(`${parsed.skippedRows} row(s) were skipped (no data in any confirmed column).`, true);
        }
      } catch (err) {
        console.error(err);
        showToast(err.message, true);
      } finally {
        setLoading(false);
      }
    }, 30);
  }

  /** Re-runs analyze() on the currently filtered record set and re-renders everything. */
  function runAnalysisAndRender() {
    const filteredParsed = PhytoFilters.applyFilters(state.baseParsed, state.filterSelections);
    state.result = PhytoAnalysis.analyze(filteredParsed);
    renderEverything();
  }

  function onFiltersChanged(selections) {
    state.filterSelections = selections;
    runAnalysisAndRender();
  }

  function renderEverything() {
    const result = state.result;
    PhytoDashboard.renderKPIs(result.kpis, result.primaryMeasureKey, ids.kpiGrid);
    PhytoDashboard.renderFilterPanel(state.baseParsed, ids.filterPanel, state.filterSelections, onFiltersChanged);
    PhytoDashboard.renderBreakdownSelector(result.dimensionSummaries, ids.breakdownSelect);

    if (!state.selectedDimensionKey || !result.dimensionSummaries.some(d => d.dimensionKey === state.selectedDimensionKey)) {
      state.selectedDimensionKey = result.dimensionSummaries.length ? result.dimensionSummaries[0].dimensionKey : null;
    }
    if (state.selectedDimensionKey) breakdownSelect.value = state.selectedDimensionKey;

    renderDerivedColumnsUI();
    renderColumnSelectorUI();
    renderPerformanceControls();
    renderBreakdownTableUI();
    renderPerformanceUI();
    renderGroupByOrderByUI();
    renderInsightsFocusControls();
    refreshFocusedInsights();
    renderManagementInsightsUI();
    populateChartSelects(result);
    renderChart();
  }

  // ---- "Evaluate insights column-wise": Management Insights (and, once
  // applied, the Visualize charts) can be re-narrated around a dimension +
  // measure the user picks, instead of always using the default. Nothing
  // changes on screen until "New Insights" is clicked; the toggle next to
  // "Break down by" only unlocks that button. Everything here is purely
  // additive — state.result.insights (the original) is never mutated, so
  // reverting is just "show that object again."
  function renderInsightsFocusControls() {
    const dims = state.result.dimensionSummaries;
    const measures = state.result.parsed.measures;
    const prevDim = insightsFocusDimensionSelect.value;
    const prevMeasure = insightsFocusMeasureSelect.value;

    insightsFocusDimensionSelect.innerHTML = dims.map(d => `<option value="${d.dimensionKey}">${d.dimensionLabel}</option>`).join('');
    insightsFocusMeasureSelect.innerHTML = measures.map(m => `<option value="${m.key}">${m.label}</option>`).join('');

    insightsFocusDimensionSelect.value = dims.some(d => d.dimensionKey === prevDim)
      ? prevDim
      : (dims[0] ? dims[0].dimensionKey : '');
    insightsFocusMeasureSelect.value = measures.some(m => m.key === prevMeasure)
      ? prevMeasure
      : (state.result.primaryMeasureKey || (measures[0] ? measures[0].key : ''));
  }

  /** Recomputes focusedKpis/focusedInsights from the CURRENT state.result so
   * an active focus stays accurate as filters/group-by/etc. change — this is
   * the "graphs and everything change dynamically" part. If the focused
   * dimension/measure no longer exists (e.g. after a schema re-analysis),
   * falls back to the original insights rather than erroring. */
  function refreshFocusedInsights() {
    if (!state.insightsFocus) return;
    const { dimensionKey, measureKey } = state.insightsFocus;
    const dimStillValid = state.result.dimensionSummaries.some(d => d.dimensionKey === dimensionKey);
    const measureStillValid = state.result.parsed.measures.some(m => m.key === measureKey);
    if (!dimStillValid || !measureStillValid) {
      state.insightsFocus = null;
      state.focusedKpis = null;
      state.focusedInsights = null;
      newInsightsBtn.textContent = 'New Insights';
      downloadNewInsightsBtn.disabled = true;
      return;
    }
    const { kpis, insights } = PhytoAnalysis.buildFocusedInsights(
      state.result.parsed, state.result.dimensionSummaries, dimensionKey, measureKey
    );
    state.focusedKpis = kpis;
    state.focusedInsights = insights;
  }

  function renderManagementInsightsUI() {
    if (state.insightsFocus) {
      PhytoDashboard.renderInsights(state.focusedInsights, ids.insightGrid);
      insightsModeLabel.textContent = `(showing: ${state.insightsFocus.dimensionLabel} / ${state.insightsFocus.measureLabel})`;
    } else {
      PhytoDashboard.renderInsights(state.result.insights, ids.insightGrid);
      insightsModeLabel.textContent = '';
    }
  }

  function updateNewInsightsBtnAvailability() {
    // Enabled once the toggle is on; stays enabled once a focus is actually
    // applied (now acting as "Revert") regardless of the toggle, so the
    // user can never get stuck unable to go back.
    newInsightsBtn.disabled = !state.insightsFocus && !insightsFocusToggle.checked;
  }

  // ---- Custom Columns: derive a new dimension by grouping an existing
  // column's values (e.g. "Zone" from "State") — generic for any column, any
  // tab. Purely additive: existing filter/group-by/breakdown selections stay
  // valid because derived columns only ADD dimensions, never rename/remove
  // the ones already there.
  function renderDerivedColumnsUI() {
    PhytoDashboard.renderDerivedColumnBuilder(state.baseParsed, ids.deriveColumnBuilder, (def) => {
      const existingKeys = new Set([
        ...state.baseParsed.dimensions.map(d => d.key),
        ...state.baseParsed.measures.map(m => m.key),
      ]);
      const key = PhytoDeriveColumn.makeColumnKey(def.label, existingKeys);
      const sourceDim = state.baseParsed.dimensions.find(d => d.key === def.sourceKey);
      state.derivedColumns.push({
        key, label: def.label, sourceKey: def.sourceKey,
        sourceLabel: sourceDim ? sourceDim.label : def.sourceKey,
        mapping: def.mapping, unmappedLabel: `(Unmapped ${def.label})`,
      });
      rebuildBaseParsed();
    });
    PhytoDashboard.renderActiveDerivedColumns(state.derivedColumns, ids.activeDerivedColumns, (key) => {
      state.derivedColumns = state.derivedColumns.filter(dc => dc.key !== key);
      rebuildBaseParsed();
    });
  }

  /** Recomputes baseParsed FROM the pristine rawParsed every time (never
   * compounds on top of a previous baseParsed), then re-runs analysis. */
  function rebuildBaseParsed() {
    state.baseParsed = PhytoDeriveColumn.applyDerivedColumns(state.rawParsed, state.derivedColumns);
    runAnalysisAndRender();
  }

  // ---- SQL-style Group By / Order By (additive to the single-dimension breakdown above) ----
  // Both are OPT-IN: nothing groups or sorts until the user explicitly checks
  // a field to group by (mirroring SQL, where GROUP BY / ORDER BY only apply
  // when a query actually specifies them) — no field auto-selected, no table
  // rendered, on load or on a fresh analysis run.
  function renderGroupByOrderByUI() {
    const dims = state.result.parsed.dimensions;
    if (!dims.length) {
      groupByControls.innerHTML = '<div class="empty-state">No dimension columns available.</div>';
      orderByControls.innerHTML = '';
      groupedTableWrap.innerHTML = '';
      return;
    }

    // Keep only keys that still exist in this result (e.g. after a schema
    // edit or re-analysis); never auto-fill a default selection.
    state.groupByKeys = (state.groupByKeys || []).filter(k => dims.some(d => d.key === k));
    exportGroupedBtn.disabled = !state.groupByKeys.length;

    PhytoDashboard.renderGroupByControls(dims, state.groupByKeys, ids.groupByControls, (chosen) => {
      state.groupByKeys = chosen;
      // The composite row identity changes whenever the grouped fields
      // change, so a row removed under the old grouping has no meaningful
      // match under the new one — start fresh rather than hide the wrong rows.
      state.excludedGroupedRowKeys = new Set();
      exportGroupedBtn.disabled = !chosen.length;
      renderOrderByUI();
      renderGroupedTableUI();
    });
    renderOrderByUI();
    renderGroupedTableUI();
  }

  function renderOrderByUI() {
    if (!state.groupByKeys.length) {
      orderByControls.innerHTML = '<div class="empty-state">Choose a Group By field first.</div>';
      return;
    }
    const dims = state.result.parsed.dimensions;
    const measures = state.result.parsed.measures;
    const groupDimsMeta = state.groupByKeys.map(k => dims.find(d => d.key === k)).filter(Boolean);
    PhytoDashboard.renderOrderByControls(groupDimsMeta, measures, state.sortConfig, ids.orderByControls, (sort) => {
      state.sortConfig = sort;
      renderGroupedTableUI();
    });
  }

  /** Recomputes the current grouped view fresh (not cached) — used by both
   * the render path and the export path so they can never drift apart. */
  function computeCurrentGrouped() {
    const filteredParsed = PhytoFilters.applyFilters(state.baseParsed, state.filterSelections);
    const grouped = PhytoAnalysis.buildGroupedSummary(filteredParsed, state.groupByKeys, state.sortConfig);
    const dims = state.result.parsed.dimensions;
    const dimsMeta = state.groupByKeys.map(k => dims.find(d => d.key === k)).filter(Boolean);
    return { grouped, dimsMeta };
  }

  function renderGroupedTableUI() {
    if (!state.groupByKeys.length) {
      groupedTableWrap.innerHTML = '<div class="empty-state">Select one or more fields above to group by — nothing is grouped until you choose a field, just like SQL\'s GROUP BY.</div>';
      return;
    }
    const { grouped, dimsMeta } = computeCurrentGrouped();
    PhytoDashboard.renderGroupedTable(grouped, dimsMeta, state.result.parsed.measures, ids.groupedTableWrap, {
      measureKeys: state.visibleMeasureKeys,
      primaryMeasureKey: state.result.primaryMeasureKey,
      excludedKeys: state.excludedGroupedRowKeys,
      onRemoveRow: (rowKey) => {
        state.excludedGroupedRowKeys.add(rowKey);
        renderGroupedTableUI();
      },
      onRestoreRows: () => {
        state.excludedGroupedRowKeys = new Set();
        renderGroupedTableUI();
      },
    });
  }

  // ---- Column customization ----
  function renderColumnSelectorUI() {
    const measures = state.result.parsed.measures;
    PhytoDashboard.renderColumnSelector(measures, state.visibleMeasureKeys, ids.columnSelector, (visible, fullOrder) => {
      state.visibleMeasureKeys = visible;
      state.fullMeasureOrder = fullOrder;
      renderBreakdownTableUI();
    });
  }

  // ---- Breakdown table (with column customization + performance threshold) ----
  function currentThresholdConfig() {
    // Only highlight thresholds on the table when it's showing the SAME
    // dimension the Performance Analysis panel is analyzing — otherwise a
    // Product breakdown could get colored by an Employee threshold, which
    // would be misleading.
    if (!perfDimensionSelect.value || state.selectedDimensionKey !== perfDimensionSelect.value) return null;
    const measureKey = perfMeasureSelect.value;
    const value = parseFloat(perfThresholdInput.value);
    if (!measureKey || isNaN(value)) return null;
    return { measureKey, value };
  }

  /** Lazily creates the manual edit-layer state for one dimension's view. */
  function getViewEdit(dimKey) {
    if (!state.viewEdits[dimKey]) {
      state.viewEdits[dimKey] = { editMode: false, addedRows: [], customColumns: [], overrides: {} };
    }
    return state.viewEdits[dimKey];
  }

  function renderBreakdownTableUI() {
    if (!state.selectedDimensionKey) return;
    const dimKey = state.selectedDimensionKey;
    const excludedKeys = state.excludedRowsByDimension[dimKey] || new Set();
    const ve = getViewEdit(dimKey);
    PhytoDashboard.renderBreakdownTable(state.result, dimKey, ids.breakdownTableWrap, {
      measureKeys: state.visibleMeasureKeys,
      threshold: currentThresholdConfig(),
      excludedKeys,
      onRemoveRow: (label) => {
        const set = state.excludedRowsByDimension[dimKey] || new Set();
        set.add(label);
        state.excludedRowsByDimension[dimKey] = set;
        renderBreakdownTableUI();
        // The chart/heatmap follow the same per-dimension exclusion set, so
        // a row removed here disappears from the graph too, dynamically —
        // but only when the chart is currently sourced from this dimension.
        if (chartSourceSelect.value === dimKey) renderChart();
      },
      onRestoreRows: () => {
        state.excludedRowsByDimension[dimKey] = new Set();
        renderBreakdownTableUI();
        if (chartSourceSelect.value === dimKey) renderChart();
      },
      editMode: ve.editMode,
      addedRows: ve.addedRows,
      customColumns: ve.customColumns,
      overrides: ve.overrides,
      onToggleEditMode: () => { ve.editMode = !ve.editMode; renderBreakdownTableUI(); },
      onAddRow: () => {
        ve.addedRows.push({ id: 'row' + (state.nextEditId++), label: 'New Row', values: {} });
        renderBreakdownTableUI();
      },
      onRemoveAddedRow: (id) => {
        ve.addedRows = ve.addedRows.filter(r => r.id !== id);
        renderBreakdownTableUI();
      },
      onRowLabelEdit: (id, label) => {
        const r = ve.addedRows.find(row => row.id === id);
        if (r) r.label = label;
      },
      onAddColumn: (label) => {
        ve.customColumns.push({ key: 'col' + (state.nextEditId++), label });
        renderBreakdownTableUI();
      },
      onRemoveColumn: (key) => {
        ve.customColumns = ve.customColumns.filter(c => c.key !== key);
        ve.addedRows.forEach(r => { delete r.values[key]; });
        Object.keys(ve.overrides).forEach(rowLabel => { delete ve.overrides[rowLabel][key]; });
        renderBreakdownTableUI();
      },
      onCellEdit: (rowKind, rowKey, colKey, value) => {
        if (rowKind === 'added') {
          const r = ve.addedRows.find(row => row.id === rowKey);
          if (r) r.values[colKey] = value;
        } else {
          if (!ve.overrides[rowKey]) ve.overrides[rowKey] = {};
          ve.overrides[rowKey][colKey] = value;
        }
      },
    });
  }

  // ---- Employee / Performance Analysis ----
  function renderPerformanceControls() {
    const dims = state.result.dimensionSummaries;
    const measures = state.result.parsed.measures;
    const prevDim = perfDimensionSelect.value;
    const prevMeasure = perfMeasureSelect.value;

    perfDimensionSelect.innerHTML = dims.map(d => `<option value="${d.dimensionKey}">${d.dimensionLabel}</option>`).join('');
    perfMeasureSelect.innerHTML = measures.map(m => `<option value="${m.key}">${m.label}</option>`).join('');

    const employeeDim = dims.find(d => /employee/i.test(d.dimensionLabel));
    perfDimensionSelect.value = dims.some(d => d.dimensionKey === prevDim)
      ? prevDim
      : (employeeDim ? employeeDim.dimensionKey : (dims[0] ? dims[0].dimensionKey : ''));
    perfMeasureSelect.value = measures.some(m => m.key === prevMeasure)
      ? prevMeasure
      : (state.result.primaryMeasureKey || (measures[0] ? measures[0].key : ''));
  }

  function renderPerformanceUI() {
    const ds = state.result.dimensionSummaries.find(d => d.dimensionKey === perfDimensionSelect.value);
    const measureKey = perfMeasureSelect.value;
    const threshold = parseFloat(perfThresholdInput.value);
    PhytoDashboard.renderPerformancePanel(ds, measureKey, isNaN(threshold) ? 0 : threshold, ids.performancePanel);
    renderBreakdownTableUI(); // refresh threshold highlighting on the breakdown table too
  }

  // ---- Charts (+ heatmap) ----
  function populateChartSelects(result) {
    chartMetricSelect.innerHTML = result.parsed.measures
      .map(m => `<option value="${m.key}">${m.label}</option>`).join('');
    if (result.primaryMeasureKey) chartMetricSelect.value = result.primaryMeasureKey;

    chartSourceSelect.innerHTML = result.dimensionSummaries
      .map(ds => `<option value="${ds.dimensionKey}">${ds.dimensionLabel}</option>`).join('');
  }

  function renderChart() {
    if (!state.result) return;
    const type = chartTypeSelect.value;
    const metric = chartMetricSelect.value;
    const source = chartSourceSelect.value;
    // Rows removed from the Detailed Summaries view for this SAME dimension
    // (e.g. an excluded "(Unspecified State)" outlier) drop out of the
    // chart/heatmap too, so the graph always matches what's on screen.
    const excludedKeys = state.excludedRowsByDimension[source] || new Set();

    renderChartExcludeUnspecifiedControl(source);

    if (type === 'heatmap') {
      chartCanvas.style.display = 'none';
      chartEmptyState.style.display = 'none';
      heatmapWrap.style.display = 'block';
      PhytoDashboard.renderHeatmap(state.result, source, metric, ids.heatmapWrap, excludedKeys);
      return;
    }

    heatmapWrap.style.display = 'none';
    const ok = PhytoCharts.render(ids.chartCanvas, type, metric, source, state.result, excludedKeys);
    chartEmptyState.style.display = ok ? 'none' : 'block';
    chartCanvas.style.display = ok ? 'block' : 'none';
  }

  /** Shows/hides the "Exclude Unspecified" quick-action next to the chart
   * controls, scoped to whichever dimension the chart currently sources
   * from — mirrors the Filters panel's per-dimension button, but reachable
   * straight from the Visualize section since blank/"Unspecified" values
   * are often outliers that skew a chart. */
  function renderChartExcludeUnspecifiedControl(sourceDimensionKey) {
    if (!sourceDimensionKey) { chartExcludeUnspecifiedBtn.style.display = 'none'; return; }
    const dim = state.result.parsed.dimensions.find(d => d.key === sourceDimensionKey);
    if (!dim) { chartExcludeUnspecifiedBtn.style.display = 'none'; return; }
    const unspecifiedLabel = `(Unspecified ${dim.label})`;
    const values = PhytoFilters.getDistinctValues(state.baseParsed, sourceDimensionKey);
    const alreadyExcluded = (state.excludedRowsByDimension[sourceDimensionKey] || new Set()).has(unspecifiedLabel);
    chartExcludeUnspecifiedBtn.style.display = (values.includes(unspecifiedLabel) && !alreadyExcluded) ? '' : 'none';
  }

  // ---- Export ----
  /** True if any dimension's view has a manual add-row/add-column/edit. */
  function hasAnyViewEdits() {
    return Object.values(state.viewEdits).some(ve =>
      ve.addedRows.length || ve.customColumns.length || Object.keys(ve.overrides).some(k => Object.keys(ve.overrides[k]).length)
    );
  }

  async function runExport() {
    if (!state.result) return;
    // The full multi-sheet workbook is generated from the real analysis by
    // default; manual edits from the Detailed Summaries view are only
    // folded in if the user explicitly confirms, since this download covers
    // every dimension's sheet, not just the one view being edited.
    let viewEditsByDimension;
    if (hasAnyViewEdits()) {
      const include = window.confirm(
        'You have manual row/column edits in the Detailed Summaries view.\n\n' +
        'Include those edits in this Download Insights workbook?'
      );
      if (include) viewEditsByDimension = state.viewEdits;
    }

    exportBtn.disabled = true;
    const originalLabel = exportBtn.innerHTML;
    exportBtn.innerHTML = '<div class="spinner"></div> Building file&hellip;';
    try {
      const filename = await PhytoExporter.exportWorkbook(state.result, state.fileName, state.sheetName, viewEditsByDimension);
      showToast(`Downloaded ${filename}`, false);
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, true);
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalLabel;
    }
  }

  async function runExportView() {
    if (!state.result || !state.selectedDimensionKey) return;
    exportViewBtn.disabled = true;
    const originalLabel = exportViewBtn.innerHTML;
    exportViewBtn.innerHTML = '<div class="spinner"></div> Building file&hellip;';
    try {
      const dimKey = state.selectedDimensionKey;
      const excludedKeys = state.excludedRowsByDimension[dimKey] || new Set();
      const filename = await PhytoExporter.exportBreakdownView(state.result, dimKey, state.fileName, state.sheetName, {
        measureKeys: state.visibleMeasureKeys,
        excludedKeys,
        manualExtra: getViewEdit(dimKey),
      });
      showToast(`Downloaded ${filename}`, false);
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, true);
    } finally {
      exportViewBtn.disabled = false;
      exportViewBtn.innerHTML = originalLabel;
    }
  }

  async function runExportGrouped() {
    if (!state.result || !state.groupByKeys.length) return;
    exportGroupedBtn.disabled = true;
    const originalLabel = exportGroupedBtn.innerHTML;
    exportGroupedBtn.innerHTML = '<div class="spinner"></div> Building file&hellip;';
    try {
      const { grouped, dimsMeta } = computeCurrentGrouped();
      const filename = await PhytoExporter.exportGroupedView(
        grouped, dimsMeta, state.result.parsed.measures, state.result.primaryMeasureKey,
        state.fileName, state.sheetName,
        { measureKeys: state.visibleMeasureKeys, excludedKeys: state.excludedGroupedRowKeys }
      );
      showToast(`Downloaded ${filename}`, false);
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, true);
    } finally {
      exportGroupedBtn.disabled = false;
      exportGroupedBtn.innerHTML = originalLabel;
    }
  }

  /** Applies the currently-selected dimension/measure as the new insights
   * focus, syncing the Visualize charts to match — or, if a focus is
   * already active, reverts back to the original insights/charts. Either
   * way is a single click, per the "go back to previous state on a click"
   * requirement. */
  function toggleNewInsights() {
    if (state.insightsFocus) {
      state.insightsFocus = null;
      state.focusedKpis = null;
      state.focusedInsights = null;
      newInsightsBtn.textContent = 'New Insights';
      downloadNewInsightsBtn.disabled = true;
      renderManagementInsightsUI();

      const dims = state.result.dimensionSummaries;
      if (state.result.primaryMeasureKey) chartMetricSelect.value = state.result.primaryMeasureKey;
      if (dims.length) chartSourceSelect.value = dims[0].dimensionKey;
      renderChart();
    } else {
      const dimensionKey = insightsFocusDimensionSelect.value;
      const measureKey = insightsFocusMeasureSelect.value;
      const dim = state.result.dimensionSummaries.find(d => d.dimensionKey === dimensionKey);
      const measure = state.result.parsed.measures.find(m => m.key === measureKey);
      if (!dim || !measure) return;

      state.insightsFocus = { dimensionKey, measureKey, dimensionLabel: dim.dimensionLabel, measureLabel: measure.label };
      refreshFocusedInsights();
      renderManagementInsightsUI();
      newInsightsBtn.textContent = 'Revert to Original Insights';
      downloadNewInsightsBtn.disabled = false;

      if ([...chartMetricSelect.options].some(o => o.value === measureKey)) chartMetricSelect.value = measureKey;
      if ([...chartSourceSelect.options].some(o => o.value === dimensionKey)) chartSourceSelect.value = dimensionKey;
      renderChart();
    }
    updateNewInsightsBtnAvailability();
  }

  async function runDownloadNewInsights() {
    if (!state.insightsFocus || !state.focusedKpis) return;
    downloadNewInsightsBtn.disabled = true;
    const originalLabel = downloadNewInsightsBtn.innerHTML;
    downloadNewInsightsBtn.innerHTML = '<div class="spinner"></div> Building file&hellip;';
    try {
      const focusLabel = `${state.insightsFocus.dimensionLabel}-${state.insightsFocus.measureLabel}`;
      const filename = await PhytoExporter.exportFocusedInsights(
        state.focusedKpis, state.focusedInsights, state.fileName, state.sheetName, focusLabel
      );
      showToast(`Downloaded ${filename}`, false);
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, true);
    } finally {
      downloadNewInsightsBtn.disabled = false;
      downloadNewInsightsBtn.innerHTML = originalLabel;
    }
  }

  // ---- Wiring ----
  function init() {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });
    removeFileBtn.addEventListener('click', resetFile);

    sheetSelect.addEventListener('change', runDetection);
    analyzeBtn.addEventListener('click', runAnalysis);
    exportBtn.addEventListener('click', runExport);
    exportViewBtn.addEventListener('click', runExportView);
    exportGroupedBtn.addEventListener('click', runExportGrouped);

    insightsFocusToggle.addEventListener('change', () => {
      const checked = insightsFocusToggle.checked;
      insightsFocusDimensionSelect.disabled = !checked;
      insightsFocusMeasureSelect.disabled = !checked;
      updateNewInsightsBtnAvailability();
    });
    newInsightsBtn.addEventListener('click', toggleNewInsights);
    downloadNewInsightsBtn.addEventListener('click', runDownloadNewInsights);

    breakdownSelect.addEventListener('change', () => {
      state.selectedDimensionKey = breakdownSelect.value;
      renderBreakdownTableUI();
    });

    saveViewBtn.addEventListener('click', () => {
      PhytoViewPrefs.save(tabKey, { measureKeys: state.fullMeasureOrder || state.visibleMeasureKeys });
      showToast('View saved for this tab.', false);
    });

    [perfDimensionSelect, perfMeasureSelect, perfThresholdInput].forEach(el => {
      el.addEventListener('change', renderPerformanceUI);
    });
    perfThresholdInput.addEventListener('input', renderPerformanceUI);

    [chartTypeSelect, chartMetricSelect, chartSourceSelect].forEach(el => {
      el.addEventListener('change', renderChart);
    });

    chartExcludeUnspecifiedBtn.addEventListener('click', () => {
      const sourceKey = chartSourceSelect.value;
      const dim = state.result.parsed.dimensions.find(d => d.key === sourceKey);
      if (!dim) return;
      const set = state.excludedRowsByDimension[sourceKey] || new Set();
      set.add(`(Unspecified ${dim.label})`);
      state.excludedRowsByDimension[sourceKey] = set;
      renderChart();
      if (state.selectedDimensionKey === sourceKey) renderBreakdownTableUI();
    });
  }

  return { init };
}

/**
 * DOM id sets for the 3 tabs. Tab 1 keeps its original, un-suffixed ids
 * (this is the pre-existing app — nothing about its markup/behavior changes).
 * Tabs 2 and 3 are identical structures with a numeric suffix.
 */
const TAB_ID_FIELDS = [
  'dropzone', 'fileInput', 'fileChip', 'fileChipName', 'removeFileBtn', 'controlsPanel', 'sheetSelect',
  'schemaReviewPanel', 'analyzeBtn', 'exportBtn', 'newInsightsBtn', 'downloadNewInsightsBtn', 'loadingBar', 'dashboard',
  'filterPanel', 'deriveColumnBuilder', 'activeDerivedColumns',
  'perfDimensionSelect', 'perfMeasureSelect', 'perfThresholdInput', 'performancePanel',
  'breakdownSelect', 'insightsFocusToggle', 'insightsFocusDimension', 'insightsFocusMeasure',
  'saveViewBtn', 'exportViewBtn', 'columnSelector', 'breakdownTableWrap', 'kpiGrid', 'insightGrid', 'insightsModeLabel',
  'groupByControls', 'orderByControls', 'exportGroupedBtn', 'groupedTableWrap',
  'chartTypeSelect', 'chartMetricSelect', 'chartSourceSelect', 'chartExcludeUnspecifiedBtn',
  'chartCanvas', 'chartEmptyState', 'heatmapWrap',
];

function buildTabIds(suffix) {
  const ids = {};
  TAB_ID_FIELDS.forEach(field => { ids[field] = field + suffix; });
  return ids;
}

const TAB_IDS = {
  tab1: buildTabIds(''),
  tab2: buildTabIds('2'),
  tab3: buildTabIds('3'),
};

function initTabNav() {
  const buttons = document.querySelectorAll('.tab-nav-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tabContent-' + btn.dataset.tab).classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  PhytoTheme.init();
  createTabController(TAB_IDS.tab1, 'tab1').init();
  createTabController(TAB_IDS.tab2, 'tab2').init();
  createTabController(TAB_IDS.tab3, 'tab3').init();
  initTabNav();
});
