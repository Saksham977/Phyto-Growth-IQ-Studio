/**
 * viewPrefs.js
 * ---------------------------------------------------------------------------
 * Persists a tab's preferred breakdown-table column set/order and threshold
 * setting to localStorage ("save preferred view" per spec) — the only
 * persistence mechanism available in this app (no backend/accounts), same
 * pattern as theme.js's theme preference. A saved view is per-browser/per-
 * device, keyed by tab, and applies to whichever measures exist on whatever
 * file is analyzed next in that tab (measures are matched by key, so it
 * degrades gracefully if a future file doesn't have every saved measure).
 * ---------------------------------------------------------------------------
 */

const PhytoViewPrefs = (() => {
  const PREFIX = 'phyto-view-';

  function save(tabKey, prefs) {
    try {
      localStorage.setItem(PREFIX + tabKey, JSON.stringify(prefs));
    } catch (e) { /* ignore (private browsing / storage disabled) */ }
  }

  function load(tabKey) {
    try {
      const raw = localStorage.getItem(PREFIX + tabKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clear(tabKey) {
    try { localStorage.removeItem(PREFIX + tabKey); } catch (e) { /* ignore */ }
  }

  return { save, load, clear };
})();
