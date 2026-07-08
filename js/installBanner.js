// installBanner.js — iOS/iPad "Add to Home Screen" coach mark + Android install prompt.

const DISMISS_KEY = 'mb-a2hs-dismiss';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafari() {
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}

function showBanner(banner, msgEl, ios) {
  if (!banner) return;
  if (msgEl && ios) {
    msgEl.innerHTML = 'Tap <strong>Share</strong> <span aria-hidden="true">⬆</span> then '
      + '<strong>Add to Home Screen</strong> for full-screen offline use on iPad.';
  }
  banner.classList.remove('hidden');
}

export function setupInstallBanner() {
  if (isStandalone()) return;
  if (localStorage.getItem(DISMISS_KEY)) return;

  const banner = document.getElementById('install-banner');
  const dismiss = document.getElementById('install-dismiss');
  const installBtn = document.getElementById('install-accept');
  const msgEl = document.getElementById('install-banner-msg');

  dismiss?.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    banner?.classList.add('hidden');
  });

  if (isIOS() && isSafari()) {
    showBanner(banner, msgEl, true);
    return;
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (msgEl) {
      msgEl.textContent = 'Install MathBoard for full-screen offline use on this device.';
    }
    installBtn?.classList.remove('hidden');
    banner?.classList.remove('hidden');
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    banner?.classList.add('hidden');
    localStorage.setItem(DISMISS_KEY, '1');
  });
}
