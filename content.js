(async () => {
  'use strict';

  let isPaused = false;
  let observer = null;
  let cleanupInterval = null;
  let cleanPending = false;
  let adMuteApplied = false;
  let cosmeticsStyleEl = null;
  let rootsObserver = null;

  const domain = location.hostname.replace(/^www\./, '');

  const cosmeticFilters = [
    { selector: '.ytp-ad-overlay-container', style: 'display: none !important; height: 0 !important;' },
    { selector: 'ytd-rich-item-renderer[is-promoted], ytd-ad-slot-renderer', style: 'display: none !important; height: 0 !important;' },
    { selector: '.badge-style-type-sponsor, [aria-label*="Sponsorisé"]', style: 'display: none !important;' },
    { selector: '.ytp-ad-module', style: 'display: none !important;' },
    { selector: 'yt-mealbar-promo-renderer, ytd-banner-promo-renderer', style: 'display: none !important; height: 0 !important;' },
    // YouTube in-player ad UI
    { selector: '.ytp-ad-player-overlay, .ytp-ad-skip-button-container, .ytp-ad-text, .ytp-ad-message-container, .ytp-ad-preview-container, .ytp-ad-progress-list, .ytp-ad-image-overlay, .ytp-ad-overlay-slot', style: 'display: none !important; height: 0 !important; opacity: 0 !important;' },
    // Feed/search/display ad renderers
    { selector: 'ytd-promoted-video-renderer, ytd-promoted-sparkles-text-search-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-in-feed-ad-layout-renderer, ytd-carousel-ad-renderer, ytd-ad-slot-renderer, ytd-action-companion-ad-renderer, ytd-search-pyv-renderer, ytd-companion-slot-renderer', style: 'display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important;' },
    // Bannières/primetime
    { selector: 'ytd-primetime-banner-renderer, ytd-statement-banner-renderer', style: 'display: none !important; height: 0 !important;' },
    // Badges sponsorisés
    { selector: '[aria-label*="Promoted"], [aria-label*="Sponsored"], .badge-style-type-ads', style: 'display: none !important;' }
  ];

  function injectCosmeticCSS() {
    if (cosmeticsStyleEl) return;
    const css = cosmeticFilters.map((f) => `${f.selector}{${f.style}}`).join('\n');
    cosmeticsStyleEl = document.createElement('style');
    cosmeticsStyleEl.id = 'pb-cosmetics';
    cosmeticsStyleEl.textContent = css;
    (document.head || document.documentElement).appendChild(cosmeticsStyleEl);
  }

  function applyCosmetic() {
    if (isPaused) return;
    injectCosmeticCSS();
  }

  function getRoots() {
    const roots = [];
    const push = (sel) => {
      const el = document.querySelector(sel);
      if (el) roots.push(el);
    };
    push('ytd-app');
    push('ytd-watch-flexy');
    push('#content');
    push('#primary');
    push('.html5-video-player');
    return roots.length ? roots : [document.documentElement];
  }

  function attachScopedObservers() {
    if (observer) {
      try { observer.disconnect(); } catch {}
    }
    observer = new MutationObserver(throttledClean);
    const roots = getRoots();
    for (const root of roots) {
      try {
        observer.observe(root, { childList: true, subtree: true });
      } catch {}
    }
  }

  function handleAds() {
    if (isPaused) return;
    const video = document.querySelector('video.html5-main-video');
    if (!video) return;

    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skipBtn) skipBtn.click();

    const isAd = document.body.querySelector('.ad-showing, .ad-interrupting');
    if (isAd) {
      if (!adMuteApplied) {
        video.muted = true;
        adMuteApplied = true;
      }
    } else {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      if (adMuteApplied) {
        video.muted = false;
        adMuteApplied = false;
      }
    }
  }

  function forcePremiumQuality() {
    if (isPaused) return;
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
    } catch {
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
    if (isPaused || cleanPending) return;
    cleanPending = true;
    requestIdleCallback(() => {
      try {
        applyCosmetic();
        purgeSponsoredCards();
        handleAds();
        forcePremiumQuality();
      } finally {
        cleanPending = false;
      }
    }, { timeout: 1000 });
  }

  function purgeSponsoredCards() {
    if (isPaused) return;
    try {
      const candidates = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-reel-shelf-renderer',
        'ytd-search-pyv-renderer',
        'ytd-promoted-video-renderer',
        'ytd-promoted-sparkles-text-search-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-display-ad-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-carousel-ad-renderer',
        'ytd-ad-slot-renderer'
      ];
      const isSponsored = (el) => {
        try {
          if (el.hasAttribute('is-promoted')) return true;
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('sponsorisé') || label.includes('promoted') || label.includes('sponsored')) return true;
          const txt = (el.textContent || '').toLowerCase();
          if (txt.includes('sponsorisé') || txt.includes('promoted') || txt.includes('sponsored')) return true;
        } catch {}
        return false;
      };
      for (const sel of candidates) {
        document.querySelectorAll(sel).forEach(node => {
          try { if (isSponsored(node)) node.remove(); } catch {}
        });
      }
    } catch {}
  }

  async function startBlocking() {
    const { pausedHosts = [] } = await chrome.storage.local.get('pausedHosts');
    isPaused = Array.isArray(pausedHosts) && pausedHosts.includes(domain);

    if (isPaused) {
      resetInjectedStyles();
      return;
    }

    if (observer) observer.disconnect();
    if (cleanupInterval) clearInterval(cleanupInterval);

    attachScopedObservers();

    applyCosmetic();
    handleAds();
    forcePremiumQuality();
  }

  // Réattache sur navigation SPA YouTube
  window.addEventListener('yt-navigate-finish', () => {
    if (!isPaused) {
      attachScopedObservers();
      throttledClean();
    }
  }, { passive: true });

  function resetInjectedStyles() {
    if (cosmeticsStyleEl && cosmeticsStyleEl.parentNode) {
      cosmeticsStyleEl.parentNode.removeChild(cosmeticsStyleEl);
      cosmeticsStyleEl = null;
    }
    if (observer) {
      try { observer.disconnect(); } catch {}
      observer = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'sitePaused' || msg.domain !== domain) return;

    isPaused = msg.paused;

    if (isPaused) {
      if (observer) observer.disconnect();
      if (cleanupInterval) clearInterval(cleanupInterval);
      resetInjectedStyles();
    } else {
      startBlocking();
    }
  });
  
  startBlocking();

  // Réagit aux changements de stockage pour une pause fiable
  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(async (changes) => {
      if (changes.pausedHosts) {
        try {
          const list = changes.pausedHosts.newValue || [];
          const nowPaused = Array.isArray(list) && list.includes(domain);
          if (nowPaused !== isPaused) {
            isPaused = nowPaused;
            if (isPaused) {
              if (observer) observer.disconnect();
              if (cleanupInterval) clearInterval(cleanupInterval);
              resetInjectedStyles();
            } else {
              await startBlocking();
            }
          }
        } catch {}
      }
    });
  }
})();
