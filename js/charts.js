/**
 * charts.js
 * ---------------------------------------------------------------------------
 * Optional visualizations, driven by a chart-type dropdown + a measure
 * dropdown + a breakdown (dimension) dropdown — all three populated at
 * runtime from whatever the confirmed schema detected. Uses Chart.js (vendored
 * locally). Adding a new chart type = add a case in buildConfig().
 * ---------------------------------------------------------------------------
 */

const PhytoCharts = (() => {
  // Keyed by canvasId so multiple independent chart instances (one per tab)
  // can coexist without tearing down each other's canvas.
  const chartInstances = {};

  function getThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      primary: styles.getPropertyValue('--color-primary').trim(),
      primaryLight: styles.getPropertyValue('--color-primary-light').trim(),
      secondary: styles.getPropertyValue('--color-secondary').trim(),
      accent: styles.getPropertyValue('--color-accent').trim(),
      good: styles.getPropertyValue('--color-good').trim(),
      bad: styles.getPropertyValue('--color-bad').trim(),
      text: styles.getPropertyValue('--color-text').trim(),
      border: styles.getPropertyValue('--color-border').trim(),
    };
  }

  const PALETTE_EXTRA = ['#8FA876', '#C9A227', '#5A9463', '#B3261E', '#6E8459', '#2F6B3C', '#D9C36A', '#4C7A5A'];

  function paletteColor(i) {
    return PALETTE_EXTRA[i % PALETTE_EXTRA.length];
  }

  function colorWithAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Builds a Chart.js config given: chartType, measureKey, dimensionKey (the
   * selected "breakdown"), and the analysis result. Looks the relevant
   * dimension summary up by key instead of a binary product/division ternary,
   * so this works for any number of detected dimensions/measures.
   *
   * excludedKeys (optional): Set<string> of row labels removed from the
   * Detailed Summaries view for this SAME dimension (see dashboard.js's
   * renderBreakdownTable) — dropped here too so the chart always matches
   * what's showing on screen, e.g. an excluded "(Unspecified State)" outlier
   * disappears from the chart the same way it disappears from the table.
   */
  function buildConfig(chartType, measureKey, dimensionKey, result, excludedKeys) {
    const colors = getThemeColors();
    const summary = result.dimensionSummaries.find(s => s.dimensionKey === dimensionKey);
    const measure = result.parsed.measures.find(m => m.key === measureKey);
    if (!summary || !measure) return null;

    const excluded = excludedKeys || new Set();
    const visibleRows = summary.rows.filter(r => !excluded.has(r.label));

    const label = summary.dimensionLabel;
    const topRows = [...visibleRows]
      .sort((a, b) => b.byMeasure[measureKey].total - a.byMeasure[measureKey].total)
      .slice(0, 10);

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.text } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: undefined,
    };

    if (chartType === 'bar') {
      return {
        type: 'bar',
        data: {
          labels: topRows.map(r => r.label),
          datasets: [{
            label: `Total ${measure.label}`,
            data: topRows.map(r => r.byMeasure[measureKey].total),
            backgroundColor: topRows.map((_, i) => paletteColor(i)),
            borderRadius: 6,
          }],
        },
        options: {
          ...commonOptions,
          indexAxis: 'y',
          scales: {
            x: { grid: { color: colors.border }, ticks: { color: colors.text } },
            y: { grid: { display: false }, ticks: { color: colors.text } },
          },
        },
      };
    }

    if (chartType === 'line' || chartType === 'area') {
      if (!measure.hasTimeSeries || summary.timePeriods.length === 0) return null;
      const isArea = chartType === 'area';
      return {
        type: 'line',
        data: {
          labels: summary.timePeriods,
          datasets: topRows.slice(0, 6).map((r, i) => ({
            label: r.label,
            data: r.byMeasure[measureKey].byPeriod.map(p => p.value),
            borderColor: paletteColor(i),
            backgroundColor: isArea ? colorWithAlpha(paletteColor(i), 0.28) : paletteColor(i),
            fill: isArea ? (i === 0 ? 'origin' : '-1') : false,
            tension: 0.35,
            spanGaps: true,
          })),
        },
        options: {
          ...commonOptions,
          scales: {
            x: { grid: { color: colors.border }, ticks: { color: colors.text } },
            y: { grid: { color: colors.border }, ticks: { color: colors.text } },
          },
        },
      };
    }

    if (chartType === 'pie' || chartType === 'donut') {
      return {
        type: chartType === 'donut' ? 'doughnut' : 'pie',
        data: {
          labels: topRows.map(r => r.label),
          datasets: [{
            data: topRows.map(r => r.byMeasure[measureKey].total),
            backgroundColor: topRows.map((_, i) => paletteColor(i)),
          }],
        },
        options: commonOptions,
      };
    }

    if (chartType === 'histogram') {
      const allVals = visibleRows.map(r => r.byMeasure[measureKey].total).filter(v => v !== null && v !== undefined);
      if (allVals.length === 0) return null;
      const min = Math.min(...allVals), max = Math.max(...allVals);
      const bucketCount = 8;
      const span = (max - min) || 1;
      const bucketSize = span / bucketCount;
      const buckets = new Array(bucketCount).fill(0);
      allVals.forEach(v => {
        let idx = Math.floor((v - min) / bucketSize);
        if (idx >= bucketCount) idx = bucketCount - 1;
        if (idx < 0) idx = 0;
        buckets[idx]++;
      });
      const labels = buckets.map((_, i) => {
        const lo = min + i * bucketSize;
        const hi = lo + bucketSize;
        return `${lo.toFixed(0)}–${hi.toFixed(0)}`;
      });
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: `${label} count by ${measure.label} range`,
            data: buckets,
            backgroundColor: colors.primary,
            borderRadius: 4,
          }],
        },
        options: {
          ...commonOptions,
          scales: {
            x: { grid: { display: false }, ticks: { color: colors.text } },
            y: { grid: { color: colors.border }, ticks: { color: colors.text }, beginAtZero: true },
          },
        },
      };
    }

    return null;
  }

  function render(canvasId, chartType, measureKey, dimensionKey, result, excludedKeys) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const config = buildConfig(chartType, measureKey, dimensionKey, result, excludedKeys);
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
    if (!config) return false;
    chartInstances[canvasId] = new Chart(ctx, config);
    return true;
  }

  function destroy(canvasId) {
    if (chartInstances[canvasId]) {
      chartInstances[canvasId].destroy();
      delete chartInstances[canvasId];
    }
  }

  return { render, destroy };
})();
