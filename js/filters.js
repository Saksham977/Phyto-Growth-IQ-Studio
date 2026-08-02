/**
 * filters.js
 * ---------------------------------------------------------------------------
 * Multi-select filtering over parsed records, applied BEFORE analysis. This
 * is what lets a tab support "Only Doctor", "Doctor + Party", "Doctor +
 * Party + Month", or any other combination of confirmed dimension columns —
 * generically, for whichever dimensions were detected, not any specific
 * hardcoded field.
 *
 * Filtering happens on the already-parsed data (parser.js's output), so
 * changing a filter selection just re-runs PhytoAnalysis.analyze() on the
 * narrowed record set — no re-parsing of the workbook needed.
 * ---------------------------------------------------------------------------
 */

const PhytoFilters = (() => {

  /** Distinct values for one dimension, sorted, for populating a filter's option list. */
  function getDistinctValues(parsed, dimensionKey) {
    const set = new Set();
    parsed.records.forEach((rec) => set.add(rec.dims[dimensionKey]));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }

  /**
   * selections: { [dimensionKey]: Set<string> } — a dimension absent from
   * `selections`, or present with an empty Set, is not filtered at all
   * (matches everything). Returns a new parsed object (same shape) with only
   * the matching records; dimensions/measures/timePeriods are unchanged.
   */
  function applyFilters(parsed, selections) {
    const activeDimensionKeys = Object.keys(selections || {}).filter(
      (k) => selections[k] && selections[k].size > 0
    );
    if (!activeDimensionKeys.length) return parsed;

    const records = parsed.records.filter((rec) =>
      activeDimensionKeys.every((k) => selections[k].has(rec.dims[k]))
    );

    return { ...parsed, records, rowCount: records.length };
  }

  return { getDistinctValues, applyFilters };
})();
