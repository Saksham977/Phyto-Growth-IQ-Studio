/**
 * dashboard.js
 * ---------------------------------------------------------------------------
 * Renders analysis results (from analysis.js) into the DOM. Pure rendering —
 * no data crunching happens here. Adding a new visual section later means
 * adding a render* function here and calling it from renderAll().
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
   */
  function renderBreakdownTable(result, dimensionKey, containerId) {
    const el = document.getElementById(containerId);
    const ds = result.dimensionSummaries.find(d => d.dimensionKey === dimensionKey);
    if (!ds) { el.innerHTML = '<div class="empty-state">No data to display.</div>'; return; }

    const { dimensionLabel, timePeriods, rows } = ds;
    const measures = result.parsed.measures;
    const primaryMeasureKey = result.primaryMeasureKey;
    const timeSeriesMeasures = measures.filter(m => m.hasTimeSeries);
    const hasPeriods = timePeriods.length > 0 && timeSeriesMeasures.length > 0;

    const theadTop = `
      <th class="col-label" rowspan="2">${escapeHtml(dimensionLabel)}</th>
      ${hasPeriods ? timePeriods.map(p => `<th colspan="${timeSeriesMeasures.length}">${escapeHtml(p)}</th>`).join('') : ''}
      <th colspan="${measures.length}">Total</th>
      <th rowspan="2">% Contribution</th>
    `;
    const theadSub = `
      ${hasPeriods ? timePeriods.map(() => timeSeriesMeasures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')).join('') : ''}
      ${measures.map(m => `<th>${escapeHtml(m.label)}</th>`).join('')}
    `;

    const bodyRows = rows.map(row => {
      const periodCells = hasPeriods ? timePeriods.map((p, idx) => {
        const isLast = idx === timePeriods.length - 1;
        return timeSeriesMeasures.map(m => {
          const bm = row.byMeasure[m.key];
          const v = bm.byPeriod[idx].value;
          const cls = isLast ? cellClass(bm.trend) : '';
          return `<td class="${cls}">${v === null ? '—' : fmt(v)}</td>`;
        }).join('');
      }).join('') : '';

      const totalCells = measures.map(m => `<td>${fmt(row.byMeasure[m.key].total)}</td>`).join('');
      const pctBm = primaryMeasureKey ? row.byMeasure[primaryMeasureKey] : null;

      return `
        <tr>
          <td class="col-label">${escapeHtml(row.label)}</td>
          ${periodCells}
          ${totalCells}
          <td>${pctBm ? pctBm.pctContribution + '%' : '—'}</td>
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
      </div>
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

    const searchInput = el.querySelector(`[data-table-search="${containerId}"]`);
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const tbody = document.getElementById(`${containerId}-table`).querySelector('tbody');
      Array.from(tbody.rows).forEach(tr => {
        const label = tr.cells[0].textContent.toLowerCase();
        tr.style.display = label.includes(q) ? '' : 'none';
      });
    });
  }

  function renderAll(result) {
    renderKPIs(result.kpis, result.primaryMeasureKey, 'kpiGrid');
    renderInsights(result.insights, 'insightGrid');
    renderBreakdownSelector(result.dimensionSummaries, 'breakdownSelect');
    const firstKey = result.dimensionSummaries.length ? result.dimensionSummaries[0].dimensionKey : null;
    if (firstKey) renderBreakdownTable(result, firstKey, 'breakdownTableWrap');
  }

  return { renderAll, renderKPIs, renderInsights, renderBreakdownSelector, renderBreakdownTable, trendArrow, cellClass };
})();
