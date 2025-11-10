// youtube.js
// Injecté sur *.youtube.com/*
// Objectifs :
// - Nettoyage DOM intelligent (bannières, overlays, suggestions sponsorisées)
// - Suppression rapide des pré/mid-rolls
// - Communication asynchrone avec le service worker

const api = typeof browser !== 'undefined' ? browser : chrome;

let enabled = true;
let alertsEnabled = true;
let cleanScheduled = false;
let observer = null;

// Récupération de l'état initial
api.storage.local.get(['enabled', 'alertsEnabled'], (data) => {
  enabled = data.enabled !== false;
  alertsEnabled = data.alertsEnabled !== false;
  if (enabled) bootstrap();
});

// Réaction aux changements dans le stockage
api.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    const wasEnabled = enabled;
    enabled = changes.enabled.newValue;
    if (enabled && !wasEnabled) bootstrap();
    else if (!enabled && observer) observer.disconnect();
  }
  if (changes.alertsEnabled) alertsEnabled = changes.alertsEnabled.newValue;
});

function bootstrap() {
  if (observer) observer.disconnect();
  observeAds();
  safeClean();
}

// MutationObserver limité et optimisé
function observeAds() {
  observer = new MutationObserver(() => {
    if (!enabled || cleanScheduled) return;
    cleanScheduled = true;
    requestIdleCallback(() => {
      safeClean();
      cleanScheduled = false;
    }, { timeout: 800 });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });
}

// Exécution sécurisée des nettoyages
function safeClean() {
  try {
    hideStaticAds();
    handlePlayerAds();
  } catch (e) {
    // Silence les erreurs sans gêner les performances
  }
}

// Suppression des éléments sponsorisés détectés
function hideStaticAds() {
  const selectors = [
    '#masthead-ad',
    'ytd-banner-promo-renderer',
    'ytd-display-ad-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytd-promoted-video-renderer',
    '.ytp-ad-overlay-container',
    '.ytp-ad-image-overlay',
    '#player-ads',
    '.ytp-ad-module',
    'ytd-companion-slot-renderer',
    'ytd-engagement-panel-section-list-renderer[target-id*="engagement-panel-ads"]'
  ];

  let removed = 0;
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      if (!el.dataset.pbHidden) {
        el.dataset.pbHidden = '1';
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        removed++;
      }
    }
  }

  if (removed > 0) reportBlocked(removed, removed * 10 * 1024);
}

// Gestion spécifique des publicités vidéo
function handlePlayerAds() {
  const video = document.querySelector('video.html5-main-video');
  if (!video) return;

  const player = document.querySelector('.html5-video-player');
  if (!player) return;

  const isAd =
    player.classList.contains('ad-showing') ||
    player.classList.contains('ad-interrupting') ||
    document.querySelector('.ytp-ad-player-overlay') ||
    document.querySelector('.ytp-ad-module');

  if (!isAd) return;

  const skipBtn =
    document.querySelector('.ytp-ad-skip-button') ||
    document.querySelector('.ytp-ad-skip-button-modern');

  if (skipBtn) {
    skipBtn.click();
    reportBlocked(1, Math.floor(video.duration || 5) * 50 * 1024);
    return;
  }

  try {
    if (video.duration && isFinite(video.duration)) {
      video.currentTime = video.duration;
    } else {
      video.currentTime += 15;
    }
    reportBlocked(1, 50 * 1024);
  } catch (_) {}
}

// Rapport minimaliste au service worker (asynchrone non bloquant)
function reportBlocked(count, bytes) {
  try {
    api.runtime.sendMessage(
      { action: 'incrementStats', count, bytes },
      () => {}
    );
  } catch (_) {}
}
