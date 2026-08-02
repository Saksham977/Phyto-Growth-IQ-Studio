/**
 * auth.js
 * ---------------------------------------------------------------------------
 * A simple lock screen gating access to the app. This is a UX deterrent
 * against casual/accidental access, NOT real security — this is a static
 * site with no server, so a determined user can always bypass a client-side
 * check via browser dev tools. The password is intentionally a plain
 * constant, not fetched or validated anywhere else.
 *
 * "Session remains active until browser refresh/logout" is implemented with
 * no persistence at all (no localStorage/sessionStorage): the unlocked state
 * lives only in this module's in-memory flag, so a refresh naturally
 * re-locks the app, and the Logout button does the same without a refresh.
 * ---------------------------------------------------------------------------
 */

const PhytoAuth = (() => {
  const PASSWORD = '1201P'; // capital P is enforced simply by using a case-sensitive === check

  let unlocked = false;

  function showLock(show) {
    const lockScreen = document.getElementById('lockScreen');
    lockScreen.style.display = show ? 'flex' : 'none';
    document.body.classList.toggle('app-locked', show);
  }

  function attemptUnlock(password) {
    const errorEl = document.getElementById('lockError');
    if (password === PASSWORD) {
      unlocked = true;
      errorEl.style.display = 'none';
      showLock(false);
      return true;
    }
    errorEl.style.display = 'block';
    const card = document.querySelector('.lock-card');
    card.classList.remove('lock-shake');
    // Re-trigger the shake animation even on repeated wrong attempts.
    void card.offsetWidth;
    card.classList.add('lock-shake');
    return false;
  }

  function logout() {
    unlocked = false;
    const input = document.getElementById('lockPasswordInput');
    input.value = '';
    showLock(true);
    input.focus();
  }

  function init() {
    showLock(true);

    const form = document.getElementById('lockForm');
    const input = document.getElementById('lockPasswordInput');
    const logoutBtn = document.getElementById('logoutBtn');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attemptUnlock(input.value);
    });

    logoutBtn.addEventListener('click', logout);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { logout };
})();
