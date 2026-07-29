/**
 * analysis.js
 * ---------------------------------------------------------------------------
 * Turns parsed records (from parser.js) into business-friendly aggregates:
 *   - One summary per detected dimension column (grouped rows + per-measure
 *     totals, trend, % contribution)
 *   - Top-level KPIs (one set of totals per detected measure)
 *   - Narrative insights — month-over-month growth/decline when the sheet has
 *     a time-period structure, or flat top-N/concentration insights when it
 *     doesn't (no fabricated trends from single-period data)
 *
 * Growth/decline rule (unchanged from the original spec): a row is "growth"
 * (green) if its LATEST period value is greater than its PREVIOUS period
 * value; "decline" (red) if latest < previous. Ties / insufficient data are
 * neutral.
 *
 * This module is deliberately decoupled from rendering (dashboard.js) and
 * from export (exporter.js) so new analytics can be added by adding a new
 * function here and wiring it up, without touching the rest of the app.
 * ---------------------------------------------------------------------------
 */

const PhytoAnalysis = (() => {

  function sum(nums) {
    return nums.reduce((a, b) => a + (b || 0), 0);
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Determines trend direction between the last two non-null values in a series.
   * Returns 'up' | 'down' | 'flat' | null (not enough data).
   */
  function trendDirection(series) {
    const withData = series.filter(v => v !== null && v !== undefined);
    if (withData.length < 2) return null;
    const latest = withData[withData.length - 1];
    const prev = withData[withData.length - 2];
    if (latest > prev) return 'up';
    if (latest < prev) return 'down';
    return 'flat';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatNum(n) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /**
   * Builds the summary for ONE detected dimension: one row per unique value
   * of that dimension (exact, trimmed match), with every measure summed
   * across all records in the group. Replaces the old fixed
   * buildProductSummary/buildDivisionSummary pair — called once per detected
   * dimension (or once for a synthetic "All Data" dimension if the sheet has
   * no dimension columns at all).
   */
  function buildDimensionSummary(parsed, dimensionKey, dimensionLabel) {
    const { measures, timePeriods, records } = parsed;
    const groups = new Map();

    records.forEach(rec => {
      const label = dimensionKey === '__all__' ? 'All Data' : rec.dims[dimensionKey];
      if (!groups.has(label)) {
        const byMeasure = {};
        measures.forEach(m => {
          byMeasure[m.key] = m.hasTimeSeries
            ? { hasTimeSeries: true, byPeriod: timePeriods.map(p => ({ period: p, value: null })), total: 0, pctContribution: 0, trend: null }
            : { hasTimeSeries: false, total: 0, pctContribution: 0, trend: null };
        });
        groups.set(label, { label, recordCount: 0, byMeasure });
      }
      const entry = groups.get(label);
      entry.recordCount++;
      measures.forEach(m => {
        const recMeasure = rec.measures[m.key];
        if (m.hasTimeSeries) {
          recMeasure.periods.forEach((p, idx) => {
            if (p.value !== null) {
              entry.byMeasure[m.key].byPeriod[idx].value = (entry.byMeasure[m.key].byPeriod[idx].value || 0) + p.value;
            }
          });
        } else if (recMeasure.value !== null) {
          entry.byMeasure[m.key].total += recMeasure.value;
        }
      });
    });

    // Grand totals are computed from the unrounded accumulated values BEFORE
    // any per-row rounding happens below. Rounding each group's total first
    // and then summing those rounded totals would compound rounding error —
    // negligibly with a handful of groups, but materially once a dimension
    // has many groups (e.g. a near-unique "Name" column: ~1 record per
    // group means every row's rounding error feeds straight into the total).
    const grandTotals = {};
    measures.forEach(m => {
      let total = 0;
      groups.forEach(entry => {
        const bm = entry.byMeasure[m.key];
        total += m.hasTimeSeries ? sum(bm.byPeriod.map(p => p.value)) : bm.total;
      });
      grandTotals[m.key] = round2(total);
    });

    const rows = Array.from(groups.values()).map(entry => {
      measures.forEach(m => {
        const bm = entry.byMeasure[m.key];
        if (m.hasTimeSeries) {
          bm.total = round2(sum(bm.byPeriod.map(p => p.value)));
          bm.byPeriod = bm.byPeriod.map(p => ({ ...p, value: p.value !== null ? round2(p.value) : null }));
          bm.trend = timePeriods.length >= 2 ? trendDirection(bm.byPeriod.map(p => p.value)) : null;
        } else {
          bm.total = round2(bm.total);
        }
      });
      return entry;
    });

    measures.forEach(m => {
      const grandTotal = grandTotals[m.key];
      rows.forEach(r => {
        r.byMeasure[m.key].pctContribution = grandTotal !== 0
          ? Math.round((r.byMeasure[m.key].total / grandTotal) * 100)
          : 0;
      });
    });

    const primaryMeasureKey = parsed.primaryMeasureKey;
    if (primaryMeasureKey && measures.some(m => m.key === primaryMeasureKey)) {
      rows.sort((a, b) => b.byMeasure[primaryMeasureKey].total - a.byMeasure[primaryMeasureKey].total);
    }

    return { dimensionKey, dimensionLabel, timePeriods, rows, grandTotals };
  }

  /**
   * Top-level KPIs for the dashboard header — one entry per detected measure,
   * plus a "top row" per detected dimension (capped for card real estate) and
   * overall coverage counts.
   */
  function buildKPIs(parsed, dimensionSummaries, primaryMeasureKey) {
    const { measures, timePeriods, records } = parsed;
    const MAX_TOP_CARDS = 4;

    const measureTotals = measures.map(m => {
      const grandTotal = dimensionSummaries.length ? dimensionSummaries[0].grandTotals[m.key] : 0;
      const item = { measureKey: m.key, label: m.label, total: grandTotal, hasTimeSeries: m.hasTimeSeries };
      if (m.hasTimeSeries && timePeriods.length) {
        const periodTotals = timePeriods.map((p, idx) => {
          let total = 0;
          records.forEach(rec => {
            const val = rec.measures[m.key].periods[idx].value;
            if (val !== null) total += val;
          });
          return { period: p, value: round2(total) };
        });
        const latest = periodTotals[periodTotals.length - 1];
        const prev = periodTotals.length > 1 ? periodTotals[periodTotals.length - 2] : null;
        item.latestPeriod = latest;
        item.momChangePct = prev && prev.value !== 0
          ? round2(((latest.value - prev.value) / Math.abs(prev.value)) * 100)
          : null;
      }
      return item;
    });

    const topByDimension = dimensionSummaries.slice(0, MAX_TOP_CARDS).map(ds => ({
      dimensionKey: ds.dimensionKey,
      dimensionLabel: ds.dimensionLabel,
      row: ds.rows.length ? ds.rows[0] : null,
    }));

    const primaryDim = dimensionSummaries[0];
    let growers = 0, decliners = 0;
    if (primaryDim && primaryMeasureKey) {
      primaryDim.rows.forEach(r => {
        const bm = r.byMeasure[primaryMeasureKey];
        if (bm && bm.trend === 'up') growers++;
        if (bm && bm.trend === 'down') decliners++;
      });
    }

    const coverage = dimensionSummaries.map(ds => ({
      dimensionKey: ds.dimensionKey,
      label: ds.dimensionLabel,
      distinctCount: ds.rows.length,
    }));

    return { measureTotals, topByDimension, growers, decliners, coverage, primaryDimensionLabel: primaryDim ? primaryDim.dimensionLabel : null };
  }

  /**
   * Growth/decline/notable narratives when the sheet has a time-period
   * structure (>=2 periods) — generalizes the original product/division
   * wording to whatever dimension(s)/measure the user confirmed.
   */
  function buildTrendInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey) {
    const growth = [], decline = [], notable = [];
    const primaryMeasure = parsed.measures.find(m => m.key === primaryMeasureKey);
    const measureLabel = primaryMeasure ? primaryMeasure.label : 'value';
    const primaryDim = dimensionSummaries[0];

    if (primaryDim && primaryMeasureKey) {
      const withMeasure = primaryDim.rows
        .map(row => ({ row, bm: row.byMeasure[primaryMeasureKey] }))
        .filter(x => x.bm);
      const topGrowers = withMeasure.filter(x => x.bm.trend === 'up').sort((a, b) => b.bm.total - a.bm.total).slice(0, 5);
      const topDecliners = withMeasure.filter(x => x.bm.trend === 'down').sort((a, b) => a.bm.total - b.bm.total).slice(0, 5);

      topGrowers.forEach(({ row, bm }) => {
        growth.push(`<b>${escapeHtml(row.label)}</b> improved period-over-period in ${escapeHtml(measureLabel)}, contributing ${bm.pctContribution}% of total ${escapeHtml(measureLabel)}.`);
      });
      topDecliners.forEach(({ row, bm }) => {
        decline.push(`<b>${escapeHtml(row.label)}</b> declined in the latest period (total ${escapeHtml(measureLabel)}: ${formatNum(bm.total)}).`);
      });
    }

    const primaryMeasureTotals = kpis.measureTotals.find(m => m.measureKey === primaryMeasureKey);
    if (primaryMeasureTotals && primaryMeasureTotals.momChangePct !== null && primaryMeasureTotals.momChangePct !== undefined) {
      const dir = primaryMeasureTotals.momChangePct >= 0 ? 'up' : 'down';
      const latestLabel = primaryMeasureTotals.latestPeriod ? primaryMeasureTotals.latestPeriod.period : parsed.timePeriods[parsed.timePeriods.length - 1];
      notable.push(`Overall ${escapeHtml(measureLabel)} moved <b>${dir} ${Math.abs(primaryMeasureTotals.momChangePct)}%</b> from the prior period to ${escapeHtml(latestLabel)}.`);
    }

    dimensionSummaries.forEach(ds => {
      if (!ds.rows.length || !primaryMeasureKey) return;
      const top = ds.rows[0];
      const bm = top.byMeasure[primaryMeasureKey];
      if (!bm) return;
      notable.push(`<b>${escapeHtml(top.label)}</b> is the top ${escapeHtml(ds.dimensionLabel)} by ${escapeHtml(measureLabel)}, contributing ${bm.pctContribution}% (${formatNum(bm.total)}).`);
    });

    notable.push(`${kpis.growers} entry(s) trending up vs. ${kpis.decliners} trending down in the most recent period.`);

    return {
      mode: 'trend',
      growth: growth.length ? growth : [`No entries showed clear period-over-period growth in ${escapeHtml(measureLabel)}.`],
      decline: decline.length ? decline : [`No entries showed clear period-over-period decline in ${escapeHtml(measureLabel)}.`],
      notable,
    };
  }

  /**
   * Top-N / concentration narratives when there's no time-period structure
   * to compare against — deliberately has no growth/decline language, since
   * a single snapshot can't support a trend claim.
   */
  function buildFlatInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey) {
    const notable = [];
    const primaryMeasure = parsed.measures.find(m => m.key === primaryMeasureKey);
    const measureLabel = primaryMeasure ? primaryMeasure.label : 'value';

    dimensionSummaries.forEach(ds => {
      if (!ds.rows.length || !primaryMeasureKey) return;
      const top = ds.rows[0];
      const bm = top.byMeasure[primaryMeasureKey];
      if (!bm) return;
      notable.push(`<b>${escapeHtml(top.label)}</b> leads by ${escapeHtml(measureLabel)} among ${escapeHtml(ds.dimensionLabel)} (${bm.pctContribution}%, ${formatNum(bm.total)}).`);

      if (ds.rows.length >= 5) {
        const topCount = Math.max(1, Math.ceil(ds.rows.length * 0.2));
        const topTotal = sum(ds.rows.slice(0, topCount).map(r => (r.byMeasure[primaryMeasureKey] || {}).total || 0));
        const grandTotal = ds.grandTotals[primaryMeasureKey] || 0;
        const pct = grandTotal !== 0 ? Math.round((topTotal / grandTotal) * 100) : 0;
        notable.push(`The top ${topCount} ${escapeHtml(ds.dimensionLabel)}(s) account for ${pct}% of total ${escapeHtml(measureLabel)}.`);
      }
    });

    if (!notable.length) {
      notable.push('Not enough data to generate insights for this sheet.');
    }

    return { mode: 'flat', growth: [], decline: [], notable };
  }

  function buildInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey) {
    return parsed.timePeriods.length >= 2
      ? buildTrendInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey)
      : buildFlatInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey);
  }

  /**
   * Runs the full analysis pipeline for a parsed sheet.
   */
  function analyze(parsed) {
    const dims = parsed.dimensions.length ? parsed.dimensions : [{ key: '__all__', label: 'All Data' }];
    const dimensionSummaries = dims.map(d => buildDimensionSummary(parsed, d.key, d.label));
    const primaryMeasureKey = parsed.primaryMeasureKey;
    const kpis = buildKPIs(parsed, dimensionSummaries, primaryMeasureKey);
    const insights = buildInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey);
    return { parsed, dimensionSummaries, primaryMeasureKey, kpis, insights };
  }

  return {
    analyze,
    buildDimensionSummary,
    buildKPIs,
    buildInsights,
    trendDirection,
    formatNum,
  };
})();
