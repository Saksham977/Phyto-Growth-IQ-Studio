/**
 * theme.js
 * ---------------------------------------------------------------------------
 * Handles theme toggling between "nature" (default light, forest green) and
 * "dusk" (dark botanical variant). Persists choice in-memory only for the
 * session (no localStorage per artifact/runtime constraints in some hosts;
 * here we use localStorage since this is a standalone deployable app, with
 * a safe fallback if storage is unavailable).
 * ---------------------------------------------------------------------------
 */

const PhytoTheme = (() => {
  const STORAGE_KEY = 'phyto-theme';

  function safeGet() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function safeSet(v) {
    try { localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* ignore */ }
  }

  function apply(theme) {
    if (theme === 'dusk') {
      document.documentElement.setAttribute('data-theme', 'dusk');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateToggleLabel(theme);
    safeSet(theme);
  }

  function updateToggleLabel(theme) {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const label = btn.querySelector('.theme-toggle-label');
    if (label) label.textContent = theme === 'dusk' ? 'Dusk Grove' : 'Nature';
  }

  function toggle() {
    const current = document.documentElement.getAttribute('data-theme') === 'dusk' ? 'dusk' : 'nature';
    apply(current === 'dusk' ? 'nature' : 'dusk');
  }

  function init() {
    const saved = safeGet();
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(saved || (prefersDark ? 'dusk' : 'nature'));

    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.addEventListener('click', toggle);
  }

  return { init, apply, toggle };
})();
