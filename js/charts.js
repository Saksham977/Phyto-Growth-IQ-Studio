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
  let chartInstance = null;

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

  /**
   * Builds a Chart.js config given: chartType, measureKey, dimensionKey (the
   * selected "breakdown"), and the analysis result. Looks the relevant
   * dimension summary up by key instead of a binary product/division ternary,
   * so this works for any number of detected dimensions/measures.
   */
  function buildConfig(chartType, measureKey, dimensionKey, result) {
    const colors = getThemeColors();
    const summary = result.dimensionSummaries.find(s => s.dimensionKey === dimensionKey);
    const measure = result.parsed.measures.find(m => m.key === measureKey);
    if (!summary || !measure) return null;

    const label = summary.dimensionLabel;
    const topRows = [...summary.rows]
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

    if (chartType === 'line') {
      if (!measure.hasTimeSeries || summary.timePeriods.length === 0) return null;
      return {
        type: 'line',
        data: {
          labels: summary.timePeriods,
          datasets: topRows.slice(0, 6).map((r, i) => ({
            label: r.label,
            data: r.byMeasure[measureKey].byPeriod.map(p => p.value),
            borderColor: paletteColor(i),
            backgroundColor: paletteColor(i),
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

    if (chartType === 'pie') {
      return {
        type: 'pie',
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
      const allVals = summary.rows.map(r => r.byMeasure[measureKey].total).filter(v => v !== null && v !== undefined);
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

  function render(canvasId, chartType, measureKey, dimensionKey, result) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const config = buildConfig(chartType, measureKey, dimensionKey, result);
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    if (!config) return false;
    chartInstance = new Chart(ctx, config);
    return true;
  }

  function destroy() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  return { render, destroy };
})();
