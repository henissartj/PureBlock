// premium1080p.js - Force 1080p Premium (VP9/AV1) — CORRIGÉ : désactivation persistante
(() => {
  'use strict';

  const PREFERRED_QUALITY = 'hd1080';
  const CHECK_INTERVAL = 1500;
  let isEnabled = true; // État local du Premium

  // === RÉCUPÉRER L'ÉTAT SAUVEGARDÉ ===
  chrome.storage.local.get(['premiumEnabled'], (data) => {
    isEnabled = data.premiumEnabled !== false;
  });

  // === ÉCOUTER LES CHANGEMENTS (popup, background, autre onglet) ===
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.premiumEnabled !== undefined) {
      isEnabled = changes.premiumEnabled.newValue;
      if (!isEnabled) {
        // Optionnel : réinitialise la qualité si désactivé
        const player = document.getElementById('movie_player');
        if (player && player.setPlaybackQuality) {
          player.setPlaybackQuality('auto');
        }
      }
    }
  });

  // === ÉCOUTER LES MESSAGES DU BACKGROUND ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'togglePremium') {
      isEnabled = msg.enabled;
      if (!isEnabled) {
        const player = document.getElementById('movie_player');
        if (player && player.setPlaybackQuality) {
          player.setPlaybackQuality('auto');
        }
      }
    }
  });

  const log = (msg) => {
    console.log('%c[PureBlock 1080p+] ' + msg, 'color: #00ff88; font-weight: bold;');
  };

  function forcePremiumQuality() {
    if (!isEnabled) return;

    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;

    const qualities = player.getAvailableQualityLevels();
    if (!qualities?.length) return;

    if (qualities.includes('hd1080pPremium')) {
      player.setPlaybackQualityRange('hd1080pPremium');
      player.setPlaybackQuality('hd1080pPremium');
      log('1080p Premium activé (VP9)');
      return;
    }

    if (qualities.includes(PREFERRED_QUALITY)) {
      player.setPlaybackQualityRange(PREFERRED_QUALITY);
      player.setPlaybackQuality(PREFERRED_QUALITY);
      log(`${PREFERRED_QUALITY} forcé`);
      return;
    }

    const best = qualities[0];
    player.setPlaybackQualityRange(best);
    player.setPlaybackQuality(best);
    log(`Fallback: ${best}`);
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
