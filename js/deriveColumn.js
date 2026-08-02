/**
 * deriveColumn.js
 * ---------------------------------------------------------------------------
 * Lets a user create a brand-new DIMENSION column by grouping the distinct
 * values of an existing column (e.g. "Zone" from "State": Punjab -> North,
 * Bihar -> East, ...). This is deliberately generic — it works on any
 * dimension column, in any of the 3 tabs, not just State/Zone — because the
 * grouping is just a plain {value: groupName} map the user builds via the UI
 * (schemaReview-style review step, not fixed logic).
 *
 * The one hardcoded lookup here (INDIA_STATE_ZONE_LOOKUP) is ONLY a
 * convenience pre-fill suggestion for the common India State -> Zone case —
 * every value is still shown to the user and fully editable/overridable
 * before the column is created, so an unusual state name or a completely
 * different kind of column (Product -> Category, etc.) still works.
 * ---------------------------------------------------------------------------
 */

const PhytoDeriveColumn = (() => {

  // Standard Indian Zonal Council groupings, collapsed to the 4 zones the
  // business actually uses (North/East/West/South) — Central-zone states
  // (Madhya Pradesh, Chhattisgarh) and Northeast states are folded into the
  // nearest of those 4 by common distribution-territory convention. This is
  // a SUGGESTION only: shown pre-filled per value, but the user can retype
  // any of them before creating the column.
  const INDIA_STATE_ZONE_LOOKUP = {
    'jammu and kashmir': 'North', 'ladakh': 'North', 'himachal pradesh': 'North',
    'punjab': 'North', 'haryana': 'North', 'delhi': 'North', 'nct of delhi': 'North',
    'chandigarh': 'North', 'uttarakhand': 'North', 'uttar pradesh': 'North', 'rajasthan': 'North',
    'bihar': 'East', 'west bengal': 'East', 'odisha': 'East', 'orissa': 'East', 'jharkhand': 'East',
    'assam': 'East', 'meghalaya': 'East', 'manipur': 'East', 'mizoram': 'East', 'nagaland': 'East',
    'tripura': 'East', 'arunachal pradesh': 'East', 'sikkim': 'East',
    'gujarat': 'West', 'maharashtra': 'West', 'goa': 'West',
    'madhya pradesh': 'West', 'chhattisgarh': 'West',
    'dadra and nagar haveli and daman and diu': 'West',
    'andhra pradesh': 'South', 'telangana': 'South', 'karnataka': 'South',
    'tamil nadu': 'South', 'kerala': 'South', 'puducherry': 'South',
    'andaman and nicobar islands': 'South', 'lakshadweep': 'South',
  };

  function normalizeValueKey(v) {
    return String(v == null ? '' : v).trim().toLowerCase();
  }

  /** Best-effort pre-fill suggestion for one distinct value; null if unknown. */
  function suggestGroup(value) {
    return INDIA_STATE_ZONE_LOOKUP[normalizeValueKey(value)] || null;
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

  /** Makes a dimension key for a new derived column, unique against every
   * existing dimension/measure key on the sheet. */
  function makeColumnKey(label, existingKeys) {
    let key = slugify(label);
    let base = key, i = 2;
    while (existingKeys.has(key)) { key = base + i; i++; }
    return key;
  }

  /**
   * Applies every derived-column definition on top of a parsed sheet,
   * returning a NEW parsed object (same shape as parser.js's output) with
   * one extra dimension per definition. Pure and non-mutating so it can be
   * re-run from scratch whenever the user adds/removes a derived column,
   * always starting from the original parseSheet() output.
   *
   * derivedColumns: [{ key, label, sourceKey, mapping: {value: group},
   *                     unmappedLabel }]
   */
  function applyDerivedColumns(parsed, derivedColumns) {
    if (!derivedColumns || !derivedColumns.length) return parsed;

    const dimensions = parsed.dimensions.concat(
      derivedColumns.map(dc => ({ key: dc.key, label: dc.label }))
    );
    const records = parsed.records.map(rec => {
      const dims = Object.assign({}, rec.dims);
      derivedColumns.forEach(dc => {
        const sourceValue = rec.dims[dc.sourceKey];
        dims[dc.key] = (dc.mapping && Object.prototype.hasOwnProperty.call(dc.mapping, sourceValue))
          ? dc.mapping[sourceValue]
          : (dc.unmappedLabel || `(Unmapped ${dc.label})`);
      });
      return Object.assign({}, rec, { dims });
    });

    return Object.assign({}, parsed, { dimensions, records });
  }

  return { INDIA_STATE_ZONE_LOOKUP, suggestGroup, makeColumnKey, applyDerivedColumns };
})();
