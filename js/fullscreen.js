// fullscreen.js — cross-browser element fullscreen.
// iPad Safari only ships the webkit-prefixed API and home-screen PWAs have
// neither, so callers get a CSS maximize fallback instead of a TypeError.

const FALLBACK_CLASS = 'mb-fs-fallback';

export function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/** True when el is fullscreen (native or CSS fallback). */
export function isFullscreen(el) {
  return fullscreenElement() === el || el.classList.contains(FALLBACK_CLASS);
}

/** Toggle fullscreen for el; returns the intended new state. */
export function toggleFullscreen(el) {
  if (!el) return false;
  if (isFullscreen(el)) {
    if (fullscreenElement() === el) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { exit?.call(document)?.catch?.(() => {}); } catch { /* ok */ }
    }
    el.classList.remove(FALLBACK_CLASS);
    return false;
  }
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => el.classList.add(FALLBACK_CLASS));
  } else if (el.webkitRequestFullscreen) {
    try { el.webkitRequestFullscreen(); } catch { el.classList.add(FALLBACK_CLASS); }
  } else {
    el.classList.add(FALLBACK_CLASS);
  }
  return true;
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
