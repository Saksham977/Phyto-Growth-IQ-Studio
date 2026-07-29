/**
 * app.js
 * ---------------------------------------------------------------------------
 * Top-level orchestration: wires file upload -> sheet selection -> schema
 * detection/review -> analysis -> rendering -> export/chart controls. All
 * processing happens client-side in memory; nothing is ever sent to a server.
 * ---------------------------------------------------------------------------
 */

(function () {
  let state = {
    workbook: null,
    fileName: '',       // without extension
    sheetName: null,
    schema: null,       // current confirmed (possibly user-edited) DetectedSchema
    parsed: null,
    result: null,       // output of PhytoAnalysis.analyze()
  };

  // ---- DOM refs ----
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileChip = document.getElementById('fileChip');
  const fileChipName = document.getElementById('fileChipName');
  const removeFileBtn = document.getElementById('removeFileBtn');
  const controlsPanel = document.getElementById('controlsPanel');
  const sheetSelect = document.getElementById('sheetSelect');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const exportBtn = document.getElementById('exportBtn');
  const loadingBar = document.getElementById('loadingBar');
  const dashboard = document.getElementById('dashboard');
  const breakdownSelect = document.getElementById('breakdownSelect');
  const chartTypeSelect = document.getElementById('chartTypeSelect');
  const chartMetricSelect = document.getElementById('chartMetricSelect');
  const chartSourceSelect = document.getElementById('chartSourceSelect');
  const chartCanvas = document.getElementById('chartCanvas');
  const chartEmptyState = document.getElementById('chartEmptyState');

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
        state.parsed = null;
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
    state = { workbook: null, fileName: '', sheetName: null, schema: null, parsed: null, result: null };
    fileInput.value = '';
    fileChip.style.display = 'none';
    dropzone.style.display = 'block';
    controlsPanel.classList.remove('visible');
    dashboard.classList.remove('visible');
    PhytoCharts.destroy();
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
      PhytoSchemaReview.render(detected, 'schemaReviewPanel', onSchemaChanged);
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
        const result = PhytoAnalysis.analyze(parsed);
        state.sheetName = sheetName;
        state.parsed = parsed;
        state.result = result;

        PhytoDashboard.renderAll(result);
        populateChartSelects(result);
        dashboard.classList.add('visible');
        exportBtn.disabled = false;

        renderChart();
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

  // ---- Breakdown table ----
  function renderBreakdown() {
    if (!state.result) return;
    PhytoDashboard.renderBreakdownTable(state.result, breakdownSelect.value, 'breakdownTableWrap');
  }

  // ---- Charts ----
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
    const ok = PhytoCharts.render('chartCanvas', type, metric, source, state.result);
    chartEmptyState.style.display = ok ? 'none' : 'block';
    chartCanvas.style.display = ok ? 'block' : 'none';
  }

  // ---- Export ----
  async function runExport() {
    if (!state.result) return;
    exportBtn.disabled = true;
    const originalLabel = exportBtn.innerHTML;
    exportBtn.innerHTML = '<div class="spinner"></div> Building file&hellip;';
    try {
      const filename = await PhytoExporter.exportWorkbook(state.result, state.fileName, state.sheetName);
      showToast(`Downloaded ${filename}`, false);
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, true);
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalLabel;
    }
  }

  // ---- Wiring ----
  function init() {
    PhytoTheme.init();

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
    breakdownSelect.addEventListener('change', renderBreakdown);

    [chartTypeSelect, chartMetricSelect, chartSourceSelect].forEach(el => {
      el.addEventListener('change', renderChart);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
