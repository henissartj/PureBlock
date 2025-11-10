// content.js - Version optimisée (cosmétique + skip ads + boost 1080p)
(() => {
  'use strict';

  const cosmeticFilters = [
    { selector: '.ytp-ad-overlay-container, .ytp-ad-player-overlay', style: 'display: none !important; height: 0 !important;' },
    { selector: 'ytd-rich-item-renderer[is-promoted], ytd-ad-slot-renderer', style: 'display: none !important; height: 0 !important;' },
    { selector: '.badge-style-type-sponsor, [aria-label*="Sponsorisé"]', style: 'display: none !important;' },
    { selector: '.ytp-ad-module', style: 'display: none !important;' },
    { selector: 'yt-mealbar-promo-renderer, ytd-banner-promo-renderer', style: 'display: none !important; height: 0 !important;' }
  ];

  let cleanPending = false;

  function applyCosmetic() {
    for (const f of cosmeticFilters) {
      const els = document.querySelectorAll(f.selector);
      for (const el of els) {
        if (!el.dataset.pbHidden) {
          el.dataset.pbHidden = '1';
          el.style.cssText += f.style;
          if (el.parentElement) el.parentElement.style.flexWrap = 'wrap';
        }
      }
    }
  }

  function handleAds() {
    const video = document.querySelector('video.html5-main-video');
    if (!video) return;

    // Skip bouton
    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skipBtn) skipBtn.click();

    // Si pub en cours
    const isAd = document.body.querySelector('.ad-showing, .ad-interrupting');
    if (isAd) {
      video.playbackRate = 16;
      video.muted = true;
    } else {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      if (video.muted) video.muted = false;
    }
  }

  function forcePremiumQuality() {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;

    try {
      const available = player.getAvailableQualityLevels();
      if (!available || !available.length) return;

      const preferred = ['hd2160', 'hd1080pPremium', 'hd1080'];
      for (const quality of preferred) {
        if (available.includes(quality)) {
          player.setPlaybackQuality(quality);
          return;
        }
      }
    } catch (e) {
      // Fallback clic menu
      const settings = document.querySelector('.ytp-settings-button');
      if (!settings) return;
      settings.click();
      setTimeout(() => {
        const labels = document.querySelectorAll('.ytp-quality-menu .ytp-menuitem-label');
        for (const label of labels) {
          const txt = label.textContent.toLowerCase();
          if (txt.includes('1080p premium') || txt.includes('2160p') || txt.includes('1080p')) {
            label.closest('.ytp-menuitem')?.click();
            break;
          }
        }
        settings.click();
      }, 200);
    }
  }

  function throttledClean() {
    if (cleanPending) return;
    cleanPending = true;
    requestIdleCallback(() => {
      try {
        applyCosmetic();
        handleAds();
        forcePremiumQuality();
      } finally {
        cleanPending = false;
      }
    }, { timeout: 1000 });
  }

  const observer = new MutationObserver(throttledClean);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initialisation immédiate
  applyCosmetic();
  handleAds();
  forcePremiumQuality();

  // Rafraîchissement périodique pour contenu dynamique
  setInterval(forcePremiumQuality, 3000);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle') throttledClean();
  });
})();