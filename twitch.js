const api = typeof browser !== 'undefined' ? browser : chrome;

let enabled = true;
let overlay = null;
let prevMuted = null;

function createOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'pb-twitch-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';
  overlay.style.background = 'linear-gradient(135deg, rgba(15,15,26,0.85), rgba(26,26,46,0.85))';
  overlay.style.color = '#e0e0ff';
  overlay.style.fontFamily = 'Inter, sans-serif';
  overlay.style.backdropFilter = 'blur(4px)';
  overlay.style.border = '1px solid rgba(160,216,255,0.25)';
  overlay.style.pointerEvents = 'none';

  const badge = document.createElement('div');
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '8px';
  badge.style.padding = '10px 12px';
  badge.style.borderRadius = '8px';
  badge.style.background = 'rgba(255,255,255,0.08)';
  badge.style.border = '1px solid rgba(255,255,255,0.15)';
  badge.innerHTML = '<span style="font-weight:600;letter-spacing:.4px">PureBlock masque la pub Twitch</span>';

  overlay.appendChild(badge);
  return overlay;
}

function showOverlay(container) {
  try {
    const ov = createOverlay();
    if (!container) return;
    if (!ov.isConnected) container.appendChild(ov);
  } catch (e) {}
}

function hideOverlay() {
  try {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  } catch (e) {}
}

function isAdOverlayPresent() {
  // Heuristiques légères pour Twitch overlay
  if (document.querySelector('[data-test-selector="ad-banner-default-message"]')) return true;
  const playerOverlay = document.querySelector('[data-a-target="player-overlay"]');
  if (playerOverlay && /ad|publicit/i.test(playerOverlay.textContent || '')) return true;
  // Certains états ajoutent des classes sur le container
  const cont = document.querySelector('.video-player__container, .sc-AxhCb');
  if (cont && /ad/i.test(cont.className)) return true;
  return false;
}

function handleTwitchAds() {
  if (!enabled) return;
  const container = document.querySelector('.video-player__container') || document.querySelector('#root');
  const video = document.querySelector('video');
  if (!container || !video) return;

  const ad = isAdOverlayPresent();
  if (ad) {
    try {
      // Rend l’expérience fluide: masque overlay, mute, accélère si possible
      showOverlay(container);
      if (prevMuted === null) prevMuted = video.muted;
      video.muted = true;
      if ((video.playbackRate || 1) < 2) {
        try { video.playbackRate = 2; } catch (_) {}
      }
    } catch (e) {}
  } else {
    hideOverlay();
    try {
      if (prevMuted !== null) { video.muted = prevMuted; prevMuted = null; }
      if (video.playbackRate !== 1) video.playbackRate = 1;
    } catch (e) {}
  }
}

function bootstrap() {
  api.storage.local.get(['enabled', 'pausedHosts'], (data) => {
    enabled = data.enabled !== false;
    const pausedHosts = Array.isArray(data.pausedHosts) ? data.pausedHosts : [];
    const host = location.hostname;
    if (pausedHosts.includes(host)) enabled = false;
    if (!enabled) return;

    const root = document.getElementById('root') || document.body;
    const mo = new MutationObserver(() => {
      try { handleTwitchAds(); } catch (e) {}
    });
    mo.observe(root, { childList: true, subtree: true });

    // Tick de sécurité
    setInterval(() => { try { handleTwitchAds(); } catch (e) {} }, 1000);
    // Première passe
    handleTwitchAds();
  });
}

try {
  if (location.hostname.includes('twitch.tv')) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      bootstrap();
    } else {
      document.addEventListener('DOMContentLoaded', bootstrap);
    }
  }
} catch (e) {}

