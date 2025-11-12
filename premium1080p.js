// premium1080p.js - Force 1080p Premium (VP9/AV1) — CORRIGÉ : désactivation persistante
(() => {
  'use strict';

  const QUALITY_MAP = {
    off: null,
    '1080p': 'hd1080',
    '2160p': 'hd2160',
    auto: 'auto'
  };
  const CHECK_INTERVAL = 1500;
  let isEnabled = true; // piloté par premium1080
  let targetQuality = 'auto';

  // === RÉCUPÉRER L'ÉTAT SAUVEGARDÉ ===
  chrome.storage.local.get(['premium1080', 'targetQuality'], (data) => {
    isEnabled = data.premium1080 !== false;
    targetQuality = (data.targetQuality || 'auto');
  });

  // === ÉCOUTER LES CHANGEMENTS (popup, background, autre onglet) ===
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.premium1080 !== undefined) {
      isEnabled = changes.premium1080.newValue;
      if (!isEnabled) {
        const player = document.getElementById('movie_player');
        if (player && player.setPlaybackQuality) {
          player.setPlaybackQuality('auto');
        }
      }
    }
    if (changes.targetQuality !== undefined) {
      targetQuality = changes.targetQuality.newValue || 'auto';
    }
  });

  // === ÉCOUTER LES MESSAGES DU BACKGROUND ===
  // Ancienne API non utilisée désormais (on s'appuie sur storage)

  const log = (msg) => {
    console.log('%c[PureBlock 1080p+] ' + msg, 'color: #00ff88; font-weight: bold;');
  };

  function forcePremiumQuality() {
    if (!isEnabled) return;

    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;

    const qualities = player.getAvailableQualityLevels();
    if (!qualities?.length) return;

    // Mode off
    if (targetQuality === 'off') {
      player.setPlaybackQuality('auto');
      return;
    }

    // Auto premium-friendly: privilégie 1080p Premium si dispo, sinon meilleure qualité
    if (targetQuality === 'auto') {
      if (qualities.includes('hd1080pPremium')) {
        player.setPlaybackQualityRange('hd1080pPremium');
        player.setPlaybackQuality('hd1080pPremium');
        log('1080p Premium activé (auto)');
        return;
      }
      const best = qualities[0];
      player.setPlaybackQualityRange(best);
      player.setPlaybackQuality(best);
      log(`Auto → ${best}`);
      return;
    }

    // Cibles explicites
    const desired = QUALITY_MAP[targetQuality];
    if (desired && qualities.includes(desired)) {
      player.setPlaybackQualityRange(desired);
      player.setPlaybackQuality(desired);
      log(`Qualité cible → ${targetQuality}`);
      return;
    }

    // Fallback raisonnable
    const fallback = qualities.includes('hd1080') ? 'hd1080' : qualities[0];
    player.setPlaybackQualityRange(fallback);
    player.setPlaybackQuality(fallback);
    log(`Fallback → ${fallback}`);
  }

  // Fallback menu
  function simulateMenu() {
    if (!isEnabled) return;
    const btn = document.querySelector('.ytp-settings-button');
    if (!btn) return;

    btn.click();
    setTimeout(() => {
      const items = document.querySelectorAll('.ytp-quality-menu .ytp-menuitem');
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes('1080p') || text.includes('Premium') || text.includes('2160p')) {
          item.click();
          log(`Menu → ${text}`);
          break;
        }
      }
      setTimeout(() => btn.click(), 200);
    }, 300);
  }

  // Observer + intervalle
  const observer = new MutationObserver(() => {
    if (isEnabled) {
      forcePremiumQuality();
      setTimeout(simulateMenu, 1000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    if (isEnabled) forcePremiumQuality();
  }, CHECK_INTERVAL);

  // Démarrage
  setTimeout(() => {
    if (isEnabled) {
      forcePremiumQuality();
      log('PureBlock 1080p+ activé');
    }
  }, 2000);
})();
