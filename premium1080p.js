// premium1080p.js - Force 1080p Premium (VP9/AV1) — CORRIGÉ : désactivation persistante
(() => {
  'use strict';

  const QUALITY_MAP = {
    off: null,
    '720p': 'hd720',
    '1080p': 'hd1080',
    '1440p': 'hd1440',
    '2160p': 'hd2160',
    '4320p': 'hd4320',
    auto: 'auto'
  };
  const PREFERENCE = ['hd4320', 'hd2880', 'hd2160', 'hd1440', 'hd1080pPremium', 'hd1080', 'hd720', 'large', 'medium'];
  const CHECK_INTERVAL = 1200;
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

    // Auto agressif: privilégie la résolution/bitrate maximal disponible
    if (targetQuality === 'auto') {
      let best = null;
      for (const pref of PREFERENCE) {
        if (qualities.includes(pref)) { best = pref; break; }
      }
      if (!best) best = qualities[0];
      player.setPlaybackQualityRange(best);
      player.setPlaybackQuality(best);
      log(`Auto (agressif) → ${best}`);
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
      const items = Array.from(document.querySelectorAll('.ytp-quality-menu .ytp-menuitem'));
      const order = ['4320p', '2160p', '1440p', '1080p Premium', '1080p'];
      for (const qual of order) {
        const found = items.find(i => (i.textContent||'').includes(qual));
        if (found) { found.click(); log(`Menu → ${qual}`); break; }
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

  // Réappliquer après navigation interne YouTube
  window.addEventListener('yt-navigate-finish', () => {
    if (isEnabled) {
      setTimeout(() => { forcePremiumQuality(); simulateMenu(); }, 800);
    }
  }, { passive: true });

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
