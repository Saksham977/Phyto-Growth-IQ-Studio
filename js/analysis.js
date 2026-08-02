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

  /**
   * Per-column month-over-month coloring: index 0 (the first period, e.g.
   * April) has no prior period so it's never colored; each later index is
   * 'up'/'down'/'flat' against the period immediately before it (May vs
   * April, June vs May, ...), independent of every other column — not just
   * the single latest-vs-previous comparison `trendDirection` gives.
   */
  function periodOverPeriodTrends(byPeriod) {
    return byPeriod.map((p, idx) => {
      if (idx === 0) return null;
      const prevValue = byPeriod[idx - 1].value;
      if (p.value === null || prevValue === null) return null;
      if (p.value > prevValue) return 'up';
      if (p.value < prevValue) return 'down';
      return 'flat';
    });
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

  /** Matches parser.js's blank-cell placeholder, e.g. "(Unspecified State)" —
   * generic across any dimension label, not hardcoded to one column name. */
  function isUnspecifiedLabel(label) {
    return /^\(Unspecified .+\)$/.test(String(label || ''));
  }

  /**
   * Naming "(Unspecified State)" as a "Top X" or a growth/decline highlight
   * is not a useful insight — it just means the source data had a blank
   * cell there, not that anything meaningful happened. Picks the first row
   * that ISN'T the unspecified placeholder from an already best-first-sorted
   * list, falling back to the literal first row only if every single row is
   * unspecified (better to show something than nothing).
   */
  function firstSpecifiedRow(rows) {
    return rows.find(r => !isUnspecifiedLabel(r.label)) || rows[0] || null;
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
          bm.periodTrends = periodOverPeriodTrends(bm.byPeriod);
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
   * SQL-style "GROUP BY dim1, dim2, ... ORDER BY col" — groups records by a
   * COMPOSITE key across one or more dimensions (e.g. group by Dr Name AND
   * Month, producing one row per Dr Name/Month combination) rather than
   * buildDimensionSummary's single dimension. Used by the Detailed Summaries
   * "Group by" control; `dimensionSummaries` (single-dimension) stays
   * untouched for KPIs/insights/charts, so this is purely additive.
   *
   * sort: { key: 'dim:<dimensionKey>' | 'measure:<measureKey>', direction: 'asc'|'desc' }
   * — omit to sort by the primary measure descending (matches
   * buildDimensionSummary's default).
   */
  function buildGroupedSummary(parsed, dimensionKeys, sort) {
    const { measures, timePeriods, records } = parsed;
    const keys = dimensionKeys && dimensionKeys.length ? dimensionKeys : ['__all__'];
    const groups = new Map();
    const SEP = '';

    records.forEach(rec => {
      const values = keys.map(dk => (dk === '__all__' ? 'All Data' : rec.dims[dk]));
      const compositeKey = values.join(SEP);
      if (!groups.has(compositeKey)) {
        const byMeasure = {};
        measures.forEach(m => {
          byMeasure[m.key] = m.hasTimeSeries
            ? { hasTimeSeries: true, byPeriod: timePeriods.map(p => ({ period: p, value: null })), total: 0, pctContribution: 0, trend: null }
            : { hasTimeSeries: false, total: 0, pctContribution: 0, trend: null };
        });
        const groupValues = {};
        keys.forEach((dk, i) => { groupValues[dk] = values[i]; });
        groups.set(compositeKey, { key: compositeKey, groupValues, recordCount: 0, byMeasure });
      }
      const entry = groups.get(compositeKey);
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

    // Same unrounded-then-round-once approach as buildDimensionSummary, for
    // the same reason (avoids compounding rounding error across many groups).
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
          bm.periodTrends = periodOverPeriodTrends(bm.byPeriod);
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
    const effectiveSort = sort || (primaryMeasureKey ? { key: `measure:${primaryMeasureKey}`, direction: 'desc' } : null);
    if (effectiveSort) {
      const dir = effectiveSort.direction === 'asc' ? 1 : -1;
      if (effectiveSort.key.startsWith('dim:')) {
        const dk = effectiveSort.key.slice(4);
        rows.sort((a, b) => dir * String(a.groupValues[dk]).localeCompare(String(b.groupValues[dk]), undefined, { numeric: true }));
      } else if (effectiveSort.key.startsWith('measure:')) {
        const mk = effectiveSort.key.slice(8);
        rows.sort((a, b) => dir * ((a.byMeasure[mk] ? a.byMeasure[mk].total : 0) - (b.byMeasure[mk] ? b.byMeasure[mk].total : 0)));
      }
    }

    return { dimensionKeys: keys, timePeriods, rows, grandTotals };
  }

  /**
   * Top-level KPIs for the dashboard header — one entry per detected measure,
   * plus a "top row" per detected dimension (capped for card real estate) and
   * overall coverage counts.
   *
   * primaryDimensionKey (optional): which dimensionSummary's rows drive the
   * growers/decliners count and primaryDimensionLabel — defaults to the
   * first detected dimension (dimensionSummaries[0]), same as always, unless
   * a caller explicitly picks a different one (the "evaluate insights
   * column-wise" feature — see buildFocusedInsights below).
   */
  function buildKPIs(parsed, dimensionSummaries, primaryMeasureKey, primaryDimensionKey) {
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
      row: ds.rows.length ? firstSpecifiedRow(ds.rows) : null,
    }));

    const primaryDim = primaryDimensionKey
      ? (dimensionSummaries.find(d => d.dimensionKey === primaryDimensionKey) || dimensionSummaries[0])
      : dimensionSummaries[0];
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
   *
   * primaryDimensionKey (optional): see buildKPIs — which dimension's rows
   * drive the Growth/Decline highlight cards specifically.
   */
  function buildTrendInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey, primaryDimensionKey) {
    const growth = [], decline = [], notable = [];
    const primaryMeasure = parsed.measures.find(m => m.key === primaryMeasureKey);
    const measureLabel = primaryMeasure ? primaryMeasure.label : 'value';
    const primaryDim = primaryDimensionKey
      ? (dimensionSummaries.find(d => d.dimensionKey === primaryDimensionKey) || dimensionSummaries[0])
      : dimensionSummaries[0];

    if (primaryDim && primaryMeasureKey) {
      const withMeasure = primaryDim.rows
        .map(row => ({ row, bm: row.byMeasure[primaryMeasureKey] }))
        .filter(x => x.bm && !isUnspecifiedLabel(x.row.label));
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
      const top = firstSpecifiedRow(ds.rows);
      const bm = top && top.byMeasure[primaryMeasureKey];
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
      const specifiedRows = ds.rows.filter(r => !isUnspecifiedLabel(r.label));
      const top = firstSpecifiedRow(ds.rows);
      const bm = top && top.byMeasure[primaryMeasureKey];
      if (!bm) return;
      notable.push(`<b>${escapeHtml(top.label)}</b> leads by ${escapeHtml(measureLabel)} among ${escapeHtml(ds.dimensionLabel)} (${bm.pctContribution}%, ${formatNum(bm.total)}).`);

      if (specifiedRows.length >= 5) {
        const topCount = Math.max(1, Math.ceil(specifiedRows.length * 0.2));
        const topTotal = sum(specifiedRows.slice(0, topCount).map(r => (r.byMeasure[primaryMeasureKey] || {}).total || 0));
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

  function buildInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey, primaryDimensionKey) {
    return parsed.timePeriods.length >= 2
      ? buildTrendInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey, primaryDimensionKey)
      : buildFlatInsights(parsed, dimensionSummaries, kpis, primaryMeasureKey);
  }

  /**
   * "Evaluate insights column-wise": recomputes Management Insights (and the
   * KPI fields insights depend on — growers/decliners/momChangePct) around a
   * DIFFERENT dimension+measure than analyze()'s default (dimensionSummaries[0]
   * + primaryMeasureKey), without re-deriving dimensionSummaries themselves
   * (those don't change — only which one is treated as "primary" for the
   * narrative does). Used by the dashboard's "New Insights" control; the
   * default analyze() output is always left untouched so reverting is just
   * "go back to using that original object."
   */
  function buildFocusedInsights(parsed, dimensionSummaries, dimensionKey, measureKey) {
    const kpis = buildKPIs(parsed, dimensionSummaries, measureKey, dimensionKey);
    const insights = buildInsights(parsed, dimensionSummaries, kpis, measureKey, dimensionKey);
    return { kpis, insights };
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
    buildGroupedSummary,
    buildKPIs,
    buildInsights,
    buildFocusedInsights,
    trendDirection,
    formatNum,
  };
})();
