/**
 * dashboard.js
 * ---------------------------------------------------------------------------
 * Renders analysis results (from analysis.js) into the DOM. Pure rendering —
 * no data crunching happens here (filters.js/analysis.js do that). Adding a
 * new visual section later means adding a render* function here and calling
 * it from renderAll() or app.js.
 * ---------------------------------------------------------------------------
 */

const PhytoDashboard = (() => {

  const fmt = PhytoAnalysis.formatNum;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function trendArrow(dir) {
    if (dir === 'up') return '<span class="trend-arrow" style="color:var(--color-good)">&#9650;</span>';
    if (dir === 'down') return '<span class="trend-arrow" style="color:var(--color-bad)">&#9660;</span>';
    return '';
  }

  function cellClass(dir) {
    if (dir === 'up') return 'cell-good';
    if (dir === 'down') return 'cell-bad';
    return '';
  }

  /**
   * KPI cards are entirely loop-driven over whatever measures/dimensions were
   * confirmed — one "Total {measure}" card per measure, an optional "Latest
   * Period" card if the primary measure has a time series, one "Top
   * {dimension}" card per dimension (capped upstream at 4 by analysis.js),
   * a trend card for the first dimension, and one coverage card per dimension.
   */
  function renderKPIs(kpis, primaryMeasureKey, containerId) {
    const el = document.getElementById(containerId);
    const cards = [];

    kpis.measureTotals.forEach(mt => {
      const sub = mt.hasTimeSeries && mt.latestPeriod
        ? `${fmt(mt.latestPeriod.value)} in ${escapeHtml(mt.latestPeriod.period)}`
        : '';
      cards.push(`
        <div class="kpi-card">
          <div class="kpi-label">Total ${escapeHtml(mt.label)}</div>
          <div class="kpi-value">${fmt(mt.total)}</div>
          <div class="kpi-sub">${sub}</div>
        </div>
      `);
    });

    const primaryTotals = kpis.measureTotals.find(m => m.measureKey === primaryMeasureKey);
    if (primaryTotals && primaryTotals.hasTimeSeries && primaryTotals.latestPeriod) {
      const momBad = primaryTotals.momChangePct !== null && primaryTotals.momChangePct < 0;
      cards.push(`
        <div class="kpi-card ${momBad ? 'kpi-bad' : ''}">
          <div class="kpi-label">Latest Period (${escapeHtml(primaryTotals.latestPeriod.period)})</div>
          <div class="kpi-value ${momBad ? 'bad' : 'good'}">${fmt(primaryTotals.latestPeriod.value)}</div>
          <div class="kpi-sub">${primaryTotals.momChangePct === null ? 'No prior period to compare' : (primaryTotals.momChangePct >= 0 ? '&#9650; +' : '&#9660; ') + Math.abs(primaryTotals.momChangePct) + '% vs previous period'}</div>
        </div>
      `);
    }

    kpis.topByDimension.forEach(t => {
      if (!t.row) return;
      const bm = primaryMeasureKey ? t.row.byMeasure[primaryMeasureKey] : null;
      cards.push(`
        <div class="kpi-card">
          <div class="kpi-label">Top ${escapeHtml(t.dimensionLabel)}</div>
          <div class="kpi-value" style="font-size:1.1rem">${escapeHtml(t.row.label)}</div>
          <div class="kpi-sub">${bm ? bm.pctContribution + '% of total' : ''}</div>
        </div>
      `);
    });

    if (primaryMeasureKey && kpis.primaryDimensionLabel) {
      const totalCount = kpis.coverage.length ? kpis.coverage[0].distinctCount : 0;
      cards.push(`
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(kpis.primaryDimensionLabel)} Trending Up / Down</div>
          <div class="kpi-value"><span style="color:var(--color-good)">${kpis.growers}</span> / <span style="color:var(--color-bad)">${kpis.decliners}</span></div>
          <div class="kpi-sub">of ${totalCount} total</div>
        </div>
      `);
    }

    kpis.coverage.forEach(c => {
      cards.push(`
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(c.label)} Coverage</div>
          <div class="kpi-value">${c.distinctCount}</div>
          <div class="kpi-sub">distinct value(s)</div>
        </div>
      `);
    });

    el.innerHTML = cards.join('');
  }

  function renderInsights(insights, containerId) {
    const el = document.getElementById(containerId);
    if (insights.mode === 'flat') {
      el.innerHTML = `
        <div class="insight-card">
          <h4><span class="dot" style="background:var(--color-secondary)"></span>Key Insights</h4>
          <ul>${insights.notable.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
      `;
      return;
    }
    el.innerHTML = `
      <div class="insight-card">
        <h4><span class="dot" style="background:var(--color-good)"></span>Growth Highlights</h4>
        <ul>${insights.growth.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>
      <div class="insight-card">
        <h4><span class="dot" style="background:var(--color-bad)"></span>Areas of Concern</h4>
        <ul>${insights.decline.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>
      <div class="insight-card">
        <h4><span class="dot" style="background:var(--color-secondary)"></span>Key Takeaways</h4>
        <ul>${insights.notable.map(t => `<li>${t}</li>`).join('')}</ul>
      </div>
    `;
  }

  /**
   * Populates the "Break down by" selector with whatever dimensions were
   * confirmed — replaces the old fixed 2-tab UI.
   */
  function renderBreakdownSelector(dimensionSummaries, selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = dimensionSummaries
      .map(ds => `<option value="${escapeHtml(ds.dimensionKey)}">${escapeHtml(ds.dimensionLabel)}</option>`)
      .join('');
  }

  /**
   * Renders the breakdown table for ONE selected dimension. Time-series
   * measures get one column per period (plus a Total column); standalone
   * (non-time-series) measures get just their one Total column — this is
   * what makes flat-mode sheets (no time periods at all) degrade cleanly to
   * "[label] [measure totals...] [% contribution]" with no period columns.
   *
   * options:
   *   measureKeys   — ordered subset of measure keys to show (column
   *                   customization); defaults to every detected measure.
   *   threshold     — {measureKey, value} — highlights each row's Total cell
   *                   for that measure green/red vs the threshold (Employee
   *                   Performance Analysis); omit to disable.
   *   excludedKeys  — Set<string> of row labels removed from THIS view (not
   *                   from the underlying data — KPIs/insights/charts are
   *                   unaffected, this only hides rows from this one table
   *                   and its own export).
   *   onRemoveRow(label) — called when the row's remove button is clicked.
   *   onRestoreRows()     — called when "Restore removed rows" is clicked;
   *                         omit both to render a read-only table with no
   *                         remove/restore UI at all.
   *   editMode, addedRows, customColumns, overrides, onToggleEditMode,
   *   onAddRow, onRemoveAddedRow, onRowLabelEdit, onAddColumn,
   *   onRemoveColumn, onCellEdit — the manual "add row / add column / edit"
   *   layer, see the comment further down above the added-row rendering;
   *   omit onToggleEditMode to disable this layer entirely (view-only
   *   table). `overrides` is {[existingRowLabel]: {[customColumnKey]:
   *   value}} — only custom-column cells on real rows are ever editable,
   *   never a real computed Total/period cell.
   */
  function renderBreakdownTable(result, dimensionKey, containerId, options) {
    options = options || {};
    const el = document.getElementById(containerId);
    const ds = result.dimensionSummaries.find(d => d.dimensionKey === dimensionKey);
    if (!ds) { el.innerHTML = '<div class="empty-state">No data to display.</div>'; return; }

    const { dimensionLabel, timePeriods } = ds;
    const excludedKeys = options.excludedKeys || new Set();
    const canRemoveRows = typeof options.onRemoveRow === 'function';
    const rows = ds.rows.filter(r => !excludedKeys.has(r.label));
    const allMeasures = result.parsed.measures;
    const measures = (options.measureKeys && options.measureKeys.length)
      ? options.measureKeys.map(k => allMeasures.find(m => m.key === k)).filter(Boolean)
      : allMeasures;
    const primaryMeasureKey = result.primaryMeasureKey;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;
    const threshold = options.threshold;

    // % Contribution is recomputed against the VISIBLE rows' own total, not
    // the fixed grand total analyze() precomputed — so removing an outlier
    // row (e.g. "(Unspecified State)") reflows the remaining percentages up
    // to 100%, instead of leaving them stuck adding up to less. Equals the
    // original precomputed values whenever nothing's been removed.
    const visibleTotal = primaryMeasureKey
      ? rows.reduce((sum, r) => sum + ((r.byMeasure[primaryMeasureKey] || {}).total || 0), 0)
      : 0;
    function pctOfVisible(row) {
      if (!primaryMeasureKey) return null;
      const bm = row.byMeasure[primaryMeasureKey];
      if (!bm) return null;
      return visibleTotal !== 0 ? Math.round((bm.total / visibleTotal) * 100) : 0;
    }

    // ---- Manual "add row / add column / edit" layer ----
    // Deliberately NOT a way to override a real computed total — every
    // number here still comes straight from the uploaded data. Added rows
    // and columns are blank, user-typed annotations layered on top (a
    // "Remarks" column, a manual subtotal row, etc.); they display and
    // export with this one table/view but never feed into KPIs, Management
    // Insights, charts, or any other tab — same non-destructive spirit as
    // row removal above.
    const canEdit = typeof options.onToggleEditMode === 'function';
    const editMode = canEdit && !!options.editMode;
    const addedRows = options.addedRows || [];
    const customColumns = options.customColumns || [];

    const theadTop = `
      <th class="col-label" rowspan="2">${escapeHtml(dimensionLabel)}</th>
      ${hasPeriods ? timePeriods.map(p => `<th colspan="${timeSeriesMeasures.length}">${escapeHtml(p)}</th>`).join('') : ''}
      <th colspan="${measures.length}">Total</th>
      <th rowspan="2">% Contribution</th>
      ${customColumns.map(c => `
        <th rowspan="2">${escapeHtml(c.label)}${canEdit ? `<button type="button" class="col-remove-btn" data-col-key="${escapeHtml(c.key)}" title="Remove this column" aria-label="Remove column">&times;</button>` : ''}</th>
      `).join('')}
      ${canRemoveRows ? '<th rowspan="2"></th>' : ''}
    `;
    const theadSub = `
      ${hasPeriods ? timePeriods.map(() => timeSeriesMeasures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')).join('') : ''}
      ${measures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')}
    `;

    function customCell(rowKind, rowKey, col, currentValue) {
      if (editMode) {
        return `<td><input type="text" class="cell-edit-input" data-row-kind="${rowKind}" data-row-key="${escapeHtml(rowKey)}" data-col-key="${escapeHtml(col.key)}" value="${escapeHtml(currentValue || '')}"></td>`;
      }
      return `<td class="${currentValue ? 'cell-overridden' : ''}">${currentValue ? escapeHtml(currentValue) : '—'}</td>`;
    }

    const bodyRows = rows.map(row => {
      const periodCells = hasPeriods ? timePeriods.map((p, idx) => {
        return timeSeriesMeasures.map(m => {
          const bm = row.byMeasure[m.key];
          const v = bm.byPeriod[idx].value;
          const cls = bm.periodTrends ? cellClass(bm.periodTrends[idx]) : '';
          return `<td class="${cls}">${v === null ? '—' : fmt(v)}</td>`;
        }).join('');
      }).join('') : '';

      const totalCells = measures.map(m => {
        const total = row.byMeasure[m.key].total;
        let cls = '';
        if (threshold && threshold.measureKey === m.key) {
          cls = total >= threshold.value ? 'cell-good' : 'cell-bad';
        }
        return `<td class="${cls}">${fmt(total)}</td>`;
      }).join('');
      const pct = pctOfVisible(row);
      const rowOverrides = (options.overrides && options.overrides[row.label]) || {};
      const customCells = customColumns.map(c => customCell('existing', row.label, c, rowOverrides[c.key])).join('');

      return `
        <tr>
          <td class="col-label">${escapeHtml(row.label)}</td>
          ${periodCells}
          ${totalCells}
          <td>${pct !== null ? pct + '%' : '—'}</td>
          ${customCells}
          ${canRemoveRows ? `<td><button type="button" class="row-remove-btn" data-row-key="${escapeHtml(row.label)}" title="Remove this row from view" aria-label="Remove row">&times;</button></td>` : ''}
        </tr>
      `;
    }).join('');

    const addedBodyRows = addedRows.map(ar => {
      const periodBlankCells = hasPeriods
        ? timePeriods.map(() => timeSeriesMeasures.map(() => '<td>—</td>').join('')).join('')
        : '';
      const totalCells = measures.map(m => {
        const v = ar.values[m.key];
        if (editMode) {
          return `<td><input type="text" class="cell-edit-input" data-row-kind="added" data-row-key="${escapeHtml(ar.id)}" data-col-key="${escapeHtml(m.key)}" value="${escapeHtml(v || '')}"></td>`;
        }
        return `<td class="${v ? 'cell-overridden' : ''}">${v ? escapeHtml(v) : '—'}</td>`;
      }).join('');
      const customCells = customColumns.map(c => customCell('added', ar.id, c, ar.values[c.key])).join('');
      const labelCell = editMode
        ? `<input type="text" class="cell-edit-input row-label-input" data-row-key="${escapeHtml(ar.id)}" value="${escapeHtml(ar.label)}">`
        : escapeHtml(ar.label);

      return `
        <tr class="added-row">
          <td class="col-label">${labelCell}</td>
          ${periodBlankCells}
          ${totalCells}
          <td>—</td>
          ${customCells}
          ${canRemoveRows ? `<td><button type="button" class="row-remove-btn" data-added-row-key="${escapeHtml(ar.id)}" title="Remove this row" aria-label="Remove row">&times;</button></td>` : ''}
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <div class="table-toolbar">
        <input type="text" class="search-box" placeholder="Search ${escapeHtml(dimensionLabel.toLowerCase())}..." data-table-search="${containerId}">
        ${hasPeriods ? `
        <div class="legend">
          <span><span class="legend-swatch" style="background:var(--color-good-bg);border:1px solid var(--color-good)"></span>Growth vs prior period</span>
          <span><span class="legend-swatch" style="background:var(--color-bad-bg);border:1px solid var(--color-bad)"></span>Decline vs prior period</span>
        </div>` : ''}
        ${canRemoveRows && excludedKeys.size ? `<button type="button" class="row-restore-btn">Restore ${excludedKeys.size} removed row(s)</button>` : ''}
        ${canEdit ? `
          <button type="button" class="edit-mode-toggle btn btn-secondary">${editMode ? 'Done Editing' : 'Edit / Add Rows &amp; Columns'}</button>
          ${editMode ? `
            <button type="button" class="add-row-btn btn btn-secondary">+ Add Row</button>
            <span class="add-col-inline">
              <input type="text" class="add-col-input" placeholder="New column name">
              <button type="button" class="add-col-btn btn btn-secondary">+ Add Column</button>
            </span>
          ` : ''}
        ` : ''}
      </div>
      <div class="table-scroll">
        <table class="data-table" id="${containerId}-table">
          <thead>
            <tr>${theadTop}</tr>
            <tr class="subhead">${theadSub}</tr>
          </thead>
          <tbody>${bodyRows}${addedBodyRows}</tbody>
        </table>
      </div>
    `;

    const searchInput = el.querySelector(`[data-table-search="${containerId}"]`);
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const tbody = document.getElementById(`${containerId}-table`).querySelector('tbody');
      Array.from(tbody.rows).forEach(tr => {
        const label = tr.cells[0].textContent.toLowerCase();
        tr.style.display = label.includes(q) ? '' : 'none';
      });
    });
    if (canRemoveRows) {
      el.querySelectorAll('.row-remove-btn[data-row-key]').forEach(btn => {
        btn.addEventListener('click', () => options.onRemoveRow(btn.dataset.rowKey));
      });
      el.querySelectorAll('.row-remove-btn[data-added-row-key]').forEach(btn => {
        btn.addEventListener('click', () => options.onRemoveAddedRow(btn.dataset.addedRowKey));
      });
      const restoreBtn = el.querySelector('.row-restore-btn');
      if (restoreBtn) restoreBtn.addEventListener('click', () => options.onRestoreRows());
    }
    if (canEdit) {
      el.querySelector('.edit-mode-toggle').addEventListener('click', () => options.onToggleEditMode());
      const addRowBtn = el.querySelector('.add-row-btn');
      if (addRowBtn) addRowBtn.addEventListener('click', () => options.onAddRow());
      const addColBtn = el.querySelector('.add-col-btn');
      if (addColBtn) {
        addColBtn.addEventListener('click', () => {
          const input = el.querySelector('.add-col-input');
          const label = input.value.trim();
          if (!label) { input.focus(); return; }
          options.onAddColumn(label);
        });
      }
      el.querySelectorAll('.col-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => options.onRemoveColumn(btn.dataset.colKey));
      });
      el.querySelectorAll('.cell-edit-input').forEach(input => {
        input.addEventListener('change', () => {
          if (input.classList.contains('row-label-input')) {
            options.onRowLabelEdit(input.dataset.rowKey, input.value.trim() || 'New Row');
          } else {
            options.onCellEdit(input.dataset.rowKind, input.dataset.rowKey, input.dataset.colKey, input.value);
          }
        });
      });
    }
  }

  /**
   * SQL-style "Group By" control: one independently-clickable checkbox per
   * detected dimension. Any combination (including all of them) composes a
   * multi-dimension grouping via PhytoAnalysis.buildGroupedSummary — e.g.
   * checking both "Dr Name" and "Month" groups by the Dr Name + Month pair,
   * matching how GROUP BY col1, col2 behaves in SQL. onChange receives the
   * ordered array of currently-checked dimension keys.
   */
  function renderGroupByControls(dimensions, selectedKeys, containerId, onChange) {
    const el = document.getElementById(containerId);
    if (!dimensions.length) { el.innerHTML = '<div class="empty-state">No dimension columns available.</div>'; return; }
    const selected = new Set(selectedKeys || []);

    el.innerHTML = `
      <div class="groupby-list">
        ${dimensions.map(d => `
          <label class="groupby-item">
            <input type="checkbox" value="${escapeHtml(d.key)}" ${selected.has(d.key) ? 'checked' : ''}>
            <span>${escapeHtml(d.label)}</span>
          </label>
        `).join('')}
      </div>
    `;

    el.querySelectorAll('.groupby-item input').forEach(cb => {
      cb.addEventListener('change', () => {
        // Preserve the on-screen order (matches the dimension list order)
        // rather than click order, so the composite key stays predictable.
        const chosen = dimensions.map(d => d.key).filter(k =>
          el.querySelector(`.groupby-item input[value="${CSS.escape(k)}"]`).checked
        );
        onChange(chosen);
      });
    });
  }

  /**
   * SQL-style "Order By" control: a column (any currently grouped-by
   * dimension, or any measure) + Ascending/Descending direction, feeding
   * buildGroupedSummary's `sort` option. onChange receives {key, direction}
   * or null to fall back to the default (primary measure, descending).
   */
  function renderOrderByControls(groupDimensionsMeta, measures, currentSort, containerId, onChange) {
    const el = document.getElementById(containerId);
    const dimOptions = groupDimensionsMeta
      .map(d => `<option value="dim:${escapeHtml(d.key)}">${escapeHtml(d.label)}</option>`).join('');
    const measureOptions = measures
      .map(m => `<option value="measure:${escapeHtml(m.key)}">${escapeHtml(m.label)}</option>`).join('');
    const currentKey = currentSort ? currentSort.key : '';
    const currentDir = currentSort ? currentSort.direction : 'desc';

    el.innerHTML = `
      <select class="orderby-column" aria-label="Order by column">
        <option value="">Default order</option>
        ${dimOptions ? `<optgroup label="Group Fields">${dimOptions}</optgroup>` : ''}
        <optgroup label="Measures">${measureOptions}</optgroup>
      </select>
      <select class="orderby-direction" aria-label="Order direction">
        <option value="desc" ${currentDir === 'desc' ? 'selected' : ''}>Descending</option>
        <option value="asc" ${currentDir === 'asc' ? 'selected' : ''}>Ascending</option>
      </select>
    `;
    const colSel = el.querySelector('.orderby-column');
    const dirSel = el.querySelector('.orderby-direction');
    if ([...colSel.options].some(o => o.value === currentKey)) colSel.value = currentKey;

    function emit() {
      const key = colSel.value;
      onChange(key ? { key, direction: dirSel.value } : null);
    }
    colSel.addEventListener('change', emit);
    dirSel.addEventListener('change', emit);
  }

  /**
   * Renders the output of buildGroupedSummary — one label column PER grouped
   * dimension (unlike renderBreakdownTable's single label column), then the
   * same period/total/% contribution columns. This is what makes "group by
   * Dr Name, Month" show a Dr Name column AND a Month column together.
   *
   * options mirror renderBreakdownTable's: measureKeys, primaryMeasureKey,
   * excludedKeys (Set<string> of row.key values removed from THIS view),
   * onRemoveRow(rowKey), onRestoreRows().
   */
  function renderGroupedTable(groupedResult, dimensionsMeta, allMeasures, containerId, options) {
    options = options || {};
    const el = document.getElementById(containerId);
    if (!groupedResult || !groupedResult.rows.length) { el.innerHTML = '<div class="empty-state">No data to display.</div>'; return; }

    const { timePeriods } = groupedResult;
    const excludedKeys = options.excludedKeys || new Set();
    const canRemoveRows = typeof options.onRemoveRow === 'function';
    const rows = groupedResult.rows.filter(r => !excludedKeys.has(r.key));
    const measures = (options.measureKeys && options.measureKeys.length)
      ? options.measureKeys.map(k => allMeasures.find(m => m.key === k)).filter(Boolean)
      : allMeasures;
    const primaryMeasureKey = options.primaryMeasureKey;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;
    const labelCols = dimensionsMeta.length ? dimensionsMeta : [{ key: '__all__', label: 'All Data' }];

    // Same dynamic recompute as renderBreakdownTable: % of the visible rows'
    // own total, not the fixed grand total, so removing an outlier row
    // reflows the rest back up to 100%.
    const visibleTotal = primaryMeasureKey
      ? rows.reduce((sum, r) => sum + ((r.byMeasure[primaryMeasureKey] || {}).total || 0), 0)
      : 0;
    function pctOfVisible(row) {
      if (!primaryMeasureKey) return null;
      const bm = row.byMeasure[primaryMeasureKey];
      if (!bm) return null;
      return visibleTotal !== 0 ? Math.round((bm.total / visibleTotal) * 100) : 0;
    }

    const theadTop = `
      ${labelCols.map(d => `<th class="col-label" rowspan="2">${escapeHtml(d.label)}</th>`).join('')}
      ${hasPeriods ? timePeriods.map(p => `<th colspan="${timeSeriesMeasures.length}">${escapeHtml(p)}</th>`).join('') : ''}
      <th colspan="${measures.length}">Total</th>
      <th rowspan="2">% Contribution</th>
      ${canRemoveRows ? '<th rowspan="2"></th>' : ''}
    `;
    const theadSub = `
      ${hasPeriods ? timePeriods.map(() => timeSeriesMeasures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')).join('') : ''}
      ${measures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')}
    `;

    const bodyRows = rows.map(row => {
      const labelCells = labelCols.map(d => `<td class="col-label">${escapeHtml(row.groupValues[d.key])}</td>`).join('');
      const periodCells = hasPeriods ? timePeriods.map((p, idx) => {
        return timeSeriesMeasures.map(m => {
          const bm = row.byMeasure[m.key];
          const v = bm.byPeriod[idx].value;
          const cls = bm.periodTrends ? cellClass(bm.periodTrends[idx]) : '';
          return `<td class="${cls}">${v === null ? '—' : fmt(v)}</td>`;
        }).join('');
      }).join('') : '';

      const totalCells = measures.map(m => `<td>${fmt(row.byMeasure[m.key].total)}</td>`).join('');
      const pct = pctOfVisible(row);

      return `
        <tr>
          ${labelCells}
          ${periodCells}
          ${totalCells}
          <td>${pct !== null ? pct + '%' : '—'}</td>
          ${canRemoveRows ? `<td><button type="button" class="row-remove-btn" data-row-key="${escapeHtml(row.key)}" title="Remove this row from view" aria-label="Remove row">&times;</button></td>` : ''}
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      ${canRemoveRows && excludedKeys.size ? `<div class="table-toolbar"><button type="button" class="row-restore-btn">Restore ${excludedKeys.size} removed row(s)</button></div>` : ''}
      <div class="table-scroll">
        <table class="data-table" id="${containerId}-table">
          <thead>
            <tr>${theadTop}</tr>
            <tr class="subhead">${theadSub}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;

    if (canRemoveRows) {
      el.querySelectorAll('.row-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => options.onRemoveRow(btn.dataset.rowKey));
      });
      const restoreBtn = el.querySelector('.row-restore-btn');
      if (restoreBtn) restoreBtn.addEventListener('click', () => options.onRestoreRows());
    }
  }

  /**
   * Editable column list: checkbox to show/hide + up/down to reorder.
   * onChange(visibleKeysInOrder, fullKeysInOrder) fires on every change —
   * fullKeysInOrder (including hidden ones) is what gets persisted via
   * viewPrefs.js so re-showing a column later remembers its position.
   */
  function renderColumnSelector(measures, visibleKeys, containerId, onChange) {
    const el = document.getElementById(containerId);
    const initialOrder = (visibleKeys && visibleKeys.length) ? visibleKeys.slice() : measures.map(m => m.key);
    measures.forEach(m => { if (!initialOrder.includes(m.key)) initialOrder.push(m.key); });
    const orderedMeasures = initialOrder.map(k => measures.find(m => m.key === k)).filter(Boolean);
    const visibleSet = new Set((visibleKeys && visibleKeys.length) ? visibleKeys : measures.map(m => m.key));

    function render() {
      const items = el.querySelectorAll('.column-selector-item');
      el.innerHTML = `
        <div class="column-selector-list">
          ${orderedMeasures.map((m, i) => `
            <div class="column-selector-item" data-key="${escapeHtml(m.key)}">
              <label>
                <input type="checkbox" class="col-visible-toggle" ${visibleSet.has(m.key) ? 'checked' : ''}>
                ${escapeHtml(m.label)}
              </label>
              <span class="column-selector-move">
                <button type="button" class="col-move-up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
                <button type="button" class="col-move-down" ${i === orderedMeasures.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
              </span>
            </div>
          `).join('')}
        </div>
      `;
      void items;
      wire();
    }

    function emitChange() {
      const visible = orderedMeasures.filter(m => visibleSet.has(m.key)).map(m => m.key);
      onChange(visible, orderedMeasures.map(m => m.key));
    }

    function wire() {
      const itemEls = Array.from(el.querySelectorAll('.column-selector-item'));
      itemEls.forEach((item, i) => {
        const key = item.dataset.key;
        item.querySelector('.col-visible-toggle').addEventListener('change', (e) => {
          if (e.target.checked) visibleSet.add(key); else visibleSet.delete(key);
          emitChange();
        });
        item.querySelector('.col-move-up').addEventListener('click', () => {
          if (i === 0) return;
          const idx = orderedMeasures.findIndex(m => m.key === key);
          [orderedMeasures[idx - 1], orderedMeasures[idx]] = [orderedMeasures[idx], orderedMeasures[idx - 1]];
          render();
          emitChange();
        });
        item.querySelector('.col-move-down').addEventListener('click', () => {
          if (i === itemEls.length - 1) return;
          const idx = orderedMeasures.findIndex(m => m.key === key);
          [orderedMeasures[idx + 1], orderedMeasures[idx]] = [orderedMeasures[idx], orderedMeasures[idx + 1]];
          render();
          emitChange();
        });
      });
    }

    render();
  }

  /**
   * One independently-clickable checkbox list per detected dimension — the
   * "Only Doctor" / "Doctor + Party" / "Doctor + Party + Month" style
   * combinations, any number of values within each. Deliberately NOT a
   * native `<select multiple>`: that requires holding Ctrl/Cmd to select
   * more than one option, which reads as "multi-select is broken" to most
   * users since a plain click deselects everything else. onChange receives
   * {[dimensionKey]: Set<string>} for the currently-selected values.
   */
  /**
   * Builder for PhytoDeriveColumn's generic "create a new column by grouping
   * an existing column's values" feature (e.g. State -> Zone). Collapsed
   * behind a toggle so it stays out of the way until wanted. Shows every
   * distinct value of the chosen source column with an editable group-name
   * input, pre-filled via PhytoDeriveColumn.suggestGroup() where it
   * recognizes the value (only India state names today) — every value stays
   * fully user-editable, so this works for any column, not just State/Zone.
   * onCreate receives {sourceKey, label, mapping: {value: groupName}}.
   */
  function renderDerivedColumnBuilder(parsed, containerId, onCreate) {
    const el = document.getElementById(containerId);
    const dims = parsed.dimensions;
    if (!dims.length) { el.innerHTML = '<div class="empty-state">No dimension columns available to group from.</div>'; return; }

    el.innerHTML = `
      <button type="button" class="btn btn-secondary derive-col-toggle">+ Add Grouped Column</button>
      <div class="derive-col-builder" style="display:none">
        <div class="controls-row">
          <div class="control-group" style="max-width:220px">
            <label>Group values from</label>
            <select class="derive-source-select">
              ${dims.map(d => `<option value="${escapeHtml(d.key)}">${escapeHtml(d.label)}</option>`).join('')}
            </select>
          </div>
          <div class="control-group" style="max-width:220px">
            <label>New column name</label>
            <input type="text" class="derive-label-input" placeholder="e.g. Zone">
          </div>
        </div>
        <div class="derive-value-list"></div>
        <div class="derive-col-actions">
          <button type="button" class="btn btn-primary derive-create-btn">Create Column</button>
          <button type="button" class="btn btn-secondary derive-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    const toggleBtn = el.querySelector('.derive-col-toggle');
    const builder = el.querySelector('.derive-col-builder');
    const sourceSelect = el.querySelector('.derive-source-select');
    const labelInput = el.querySelector('.derive-label-input');
    const valueListEl = el.querySelector('.derive-value-list');

    function renderValueList() {
      const values = PhytoFilters.getDistinctValues(parsed, sourceSelect.value);
      valueListEl.innerHTML = `
        <div class="derive-value-grid">
          ${values.map(v => `
            <div class="derive-value-row" data-value="${escapeHtml(v)}">
              <span class="derive-value-label">${escapeHtml(v)}</span>
              <input type="text" class="derive-group-input" placeholder="Group name" value="${escapeHtml(PhytoDeriveColumn.suggestGroup(v) || '')}">
            </div>
          `).join('')}
        </div>
      `;
    }

    function closeBuilder() {
      builder.style.display = 'none';
      toggleBtn.style.display = '';
    }

    toggleBtn.addEventListener('click', () => {
      builder.style.display = 'block';
      toggleBtn.style.display = 'none';
      renderValueList();
    });
    el.querySelector('.derive-cancel-btn').addEventListener('click', closeBuilder);
    sourceSelect.addEventListener('change', renderValueList);

    el.querySelector('.derive-create-btn').addEventListener('click', () => {
      const label = labelInput.value.trim();
      if (!label) { labelInput.focus(); return; }
      const mapping = {};
      valueListEl.querySelectorAll('.derive-value-row').forEach(row => {
        const group = row.querySelector('.derive-group-input').value.trim();
        if (group) mapping[row.dataset.value] = group;
      });
      onCreate({ sourceKey: sourceSelect.value, label, mapping });
      closeBuilder();
    });
  }

  /**
   * Small removable-chip list of already-created derived columns (mirrors
   * the look of renderColumnSelector's pills). onRemove(key) fires when a
   * chip's remove button is clicked.
   */
  function renderActiveDerivedColumns(derivedColumns, containerId, onRemove) {
    const el = document.getElementById(containerId);
    if (!derivedColumns.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="column-selector-list">
        ${derivedColumns.map(dc => `
          <div class="column-selector-item" data-key="${escapeHtml(dc.key)}">
            <span>${escapeHtml(dc.label)} <small style="opacity:.7">(from ${escapeHtml(dc.sourceLabel)})</small></span>
            <button type="button" class="derive-remove-btn" title="Remove this custom column" aria-label="Remove column">&times;</button>
          </div>
        `).join('')}
      </div>
    `;
    el.querySelectorAll('.derive-remove-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => onRemove(derivedColumns[i].key));
    });
  }

  /** The exact placeholder parser.js fills in for a blank dimension cell —
   * see js/parser.js's `dims[d.key] = text || \`(Unspecified ${d.label})\``. */
  function unspecifiedLabelFor(label) {
    return `(Unspecified ${label})`;
  }

  function renderFilterPanel(parsed, containerId, currentSelections, onChange) {
    const el = document.getElementById(containerId);
    const dims = parsed.dimensions;
    if (!dims.length) { el.innerHTML = '<div class="empty-state">No dimension columns to filter by.</div>'; return; }

    el.innerHTML = `
      <div class="filter-grid">
        ${dims.map(d => {
          const values = PhytoFilters.getDistinctValues(parsed, d.key);
          const selected = currentSelections[d.key] || new Set();
          const hasUnspecified = values.includes(unspecifiedLabelFor(d.label));
          return `
            <div class="filter-group" data-dim-key="${escapeHtml(d.key)}">
              <label>${escapeHtml(d.label)} ${selected.size ? `<span class="filter-count">(${selected.size})</span>` : ''}</label>
              <div class="filter-group-actions">
                <button type="button" class="filter-link filter-select-all">Select All</button>
                ${hasUnspecified ? `<button type="button" class="filter-link filter-exclude-unspecified">Exclude Unspecified</button>` : ''}
              </div>
              <input type="text" class="filter-search" placeholder="Search ${escapeHtml(d.label.toLowerCase())}...">
              <div class="filter-checkbox-list">
                ${values.map(v => `
                  <label class="filter-checkbox-item" data-value-text="${escapeHtml(v.toLowerCase())}">
                    <input type="checkbox" value="${escapeHtml(v)}" ${selected.has(v) ? 'checked' : ''}>
                    <span>${escapeHtml(v)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
        <div class="filter-group filter-actions">
          <label>&nbsp;</label>
          <button type="button" class="btn btn-secondary filter-clear-btn">Clear Filters</button>
        </div>
      </div>
    `;

    function currentSelectionState() {
      const selections = {};
      el.querySelectorAll('.filter-group[data-dim-key]').forEach(group => {
        const chosen = Array.from(group.querySelectorAll('.filter-checkbox-item input:checked')).map(cb => cb.value);
        if (chosen.length) selections[group.dataset.dimKey] = new Set(chosen);
      });
      return selections;
    }

    el.querySelectorAll('.filter-checkbox-item input').forEach(cb => {
      cb.addEventListener('change', () => onChange(currentSelectionState()));
    });
    el.querySelectorAll('.filter-search').forEach(input => {
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        const list = input.nextElementSibling;
        list.querySelectorAll('.filter-checkbox-item').forEach(item => {
          item.style.display = item.dataset.valueText.includes(q) ? '' : 'none';
        });
      });
    });
    // "Select All" checks every value for that ONE dimension — a shortcut for
    // "I want to filter this field but not exclude anything yet", since
    // checking dozens of values by hand defeats the point of a filter.
    el.querySelectorAll('.filter-select-all').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.filter-group');
        group.querySelectorAll('.filter-checkbox-item input').forEach(input => { input.checked = true; });
        onChange(currentSelectionState());
      });
    });
    // "Exclude Unspecified" selects every value EXCEPT the blank-cell
    // placeholder — the inclusion-only filter model (a Set of allowed
    // values) has no separate "exclude" concept, so "select everything but
    // this one" is how a single value gets dropped from the result.
    el.querySelectorAll('.filter-exclude-unspecified').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.filter-group');
        const dimLabel = dims.find(d => d.key === group.dataset.dimKey).label;
        const unspecified = unspecifiedLabelFor(dimLabel);
        group.querySelectorAll('.filter-checkbox-item input').forEach(input => {
          input.checked = input.value !== unspecified;
        });
        onChange(currentSelectionState());
      });
    });
    el.querySelector('.filter-clear-btn').addEventListener('click', () => {
      el.querySelectorAll('.filter-checkbox-item input').forEach(cb => { cb.checked = false; });
      onChange({});
    });
  }

  /**
   * Employee/Performance Analysis: flags rows of a dimension below a
   * threshold for a chosen measure, plus highest/lowest performer summary.
   * Row-level red/green highlighting is applied via renderBreakdownTable's
   * `threshold` option, driven by the same {measureKey, value} pair.
   */
  function renderPerformancePanel(dimensionSummary, measureKey, threshold, containerId) {
    const el = document.getElementById(containerId);
    if (!dimensionSummary || !measureKey) { el.innerHTML = ''; return; }
    const rows = dimensionSummary.rows.filter(r => r.byMeasure[measureKey]);
    if (!rows.length) { el.innerHTML = ''; return; }

    const flagged = rows.filter(r => r.byMeasure[measureKey].total < threshold);
    const sorted = [...rows].sort((a, b) => b.byMeasure[measureKey].total - a.byMeasure[measureKey].total);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    el.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card ${flagged.length ? 'kpi-bad' : ''}">
          <div class="kpi-label">Flagged Below Threshold</div>
          <div class="kpi-value ${flagged.length ? 'bad' : 'good'}">${flagged.length}</div>
          <div class="kpi-sub">of ${rows.length} total, threshold ${fmt(threshold)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Highest Performer</div>
          <div class="kpi-value" style="font-size:1.1rem">${escapeHtml(highest.label)}</div>
          <div class="kpi-sub">${fmt(highest.byMeasure[measureKey].total)} (${highest.byMeasure[measureKey].pctContribution}%)</div>
        </div>
        <div class="kpi-card ${lowest.byMeasure[measureKey].total < threshold ? 'kpi-bad' : ''}">
          <div class="kpi-label">Lowest Performer</div>
          <div class="kpi-value" style="font-size:1.1rem">${escapeHtml(lowest.label)}</div>
          <div class="kpi-sub">${fmt(lowest.byMeasure[measureKey].total)} (${lowest.byMeasure[measureKey].pctContribution}%)</div>
        </div>
      </div>
      ${flagged.length ? `
      <div class="flagged-list">
        <strong>Flagged:</strong> ${flagged.slice(0, 25).map(r => escapeHtml(r.label)).join(', ')}${flagged.length > 25 ? ` and ${flagged.length - 25} more` : ''}
      </div>` : ''}
    `;
  }

  /**
   * Lightweight custom heatmap (dimension rows x time-period columns,
   * color-intensity by value) — Chart.js core has no matrix/heatmap chart
   * type without an extra plugin, so this renders a plain colored table
   * instead of pulling in an unvetted dependency.
   *
   * excludedKeys (optional): same per-dimension row exclusion Set used by
   * renderBreakdownTable/charts.js — an excluded row disappears from the
   * heatmap too instead of only from the Detailed Summaries table.
   */
  function renderHeatmap(result, dimensionKey, measureKey, containerId, excludedKeys) {
    const el = document.getElementById(containerId);
    const ds = result.dimensionSummaries.find(d => d.dimensionKey === dimensionKey);
    const measure = result.parsed.measures.find(m => m.key === measureKey);
    if (!ds || !measure || !measure.hasTimeSeries || !ds.timePeriods.length) {
      el.innerHTML = '<div class="empty-state">Heatmap needs a time-series measure and at least one period.</div>';
      return;
    }
    const excluded = excludedKeys || new Set();
    const visibleDsRows = ds.rows.filter(r => !excluded.has(r.label));
    const rows = visibleDsRows.slice(0, 30); // cap for a readable grid
    let max = 0;
    rows.forEach(r => r.byMeasure[measureKey].byPeriod.forEach(p => { if (p.value !== null) max = Math.max(max, p.value); }));

    const header = `<tr><th class="col-label">${escapeHtml(ds.dimensionLabel)}</th>${ds.timePeriods.map(p => `<th>${escapeHtml(p)}</th>`).join('')}</tr>`;
    const body = rows.map(r => {
      const cells = r.byMeasure[measureKey].byPeriod.map(p => {
        const ratio = max > 0 && p.value !== null ? p.value / max : 0;
        const bg = p.value === null ? 'transparent' : `color-mix(in srgb, var(--color-primary) ${Math.round(ratio * 90)}%, var(--color-bg-elevated))`;
        const fg = ratio > 0.55 ? '#fff' : 'var(--color-text)';
        return `<td style="background:${bg};color:${fg}">${p.value === null ? '—' : fmt(p.value)}</td>`;
      }).join('');
      return `<tr><td class="col-label">${escapeHtml(r.label)}</td>${cells}</tr>`;
    }).join('');

    el.innerHTML = `
      <div class="table-scroll">
        <table class="data-table heatmap-table">
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${visibleDsRows.length > 30 ? `<div class="heatmap-note">Showing top 30 of ${visibleDsRows.length} rows by ${escapeHtml(measure.label)}.</div>` : ''}
    `;
  }

  /**
   * ids: {kpiGrid, insightGrid, breakdownSelect, breakdownTableWrap} — lets
   * multiple independent tab instances (see app.js's createTabController)
   * render into their own DOM subtree instead of a single hardcoded set of
   * container ids, while sharing this exact same rendering logic.
   */
  function renderAll(result, ids) {
    renderKPIs(result.kpis, result.primaryMeasureKey, ids.kpiGrid);
    renderInsights(result.insights, ids.insightGrid);
    renderBreakdownSelector(result.dimensionSummaries, ids.breakdownSelect);
    const firstKey = result.dimensionSummaries.length ? result.dimensionSummaries[0].dimensionKey : null;
    if (firstKey) renderBreakdownTable(result, firstKey, ids.breakdownTableWrap);
  }

  return {
    renderAll, renderKPIs, renderInsights, renderBreakdownSelector, renderBreakdownTable,
    renderColumnSelector, renderFilterPanel, renderPerformancePanel, renderHeatmap,
    renderGroupByControls, renderOrderByControls, renderGroupedTable,
    renderDerivedColumnBuilder, renderActiveDerivedColumns,
    trendArrow, cellClass,
  };
})();
