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
  let isEnabled = true; // piloté par premium1080 + enabled global
  let enabledGlobal = true;
  let targetQuality = 'auto';

  // === RÉCUPÉRER L'ÉTAT SAUVEGARDÉ ===
  chrome.storage.local.get(['enabled','premium1080', 'targetQuality'], (data) => {
    enabledGlobal = data.enabled !== false;
    isEnabled = (data.premium1080 !== false) && enabledGlobal;
    targetQuality = (data.targetQuality || 'auto');
  });

  // === ÉCOUTER LES CHANGEMENTS (popup, background, autre onglet) ===
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled !== undefined) {
      enabledGlobal = changes.enabled.newValue !== false;
      isEnabled = enabledGlobal && isEnabled; // recalculé ci-dessous si premium1080 change aussi
      if (!enabledGlobal) {
        const player = document.getElementById('movie_player');
        if (player && player.setPlaybackQuality) {
          try { player.setPlaybackQuality('auto'); } catch {}
        }
      }
    }
    if (changes.premium1080 !== undefined) {
      const premiumToggle = changes.premium1080.newValue !== false;
      isEnabled = premiumToggle && enabledGlobal;
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

  // Fallback menu supprimé: ne jamais cliquer sur l'UI du player
  function simulateMenu() {
    /* no-op: ne touche plus au menu paramètres */
  }

  // Observer + intervalle
  const observer = new MutationObserver(() => {
    if (isEnabled) {
      forcePremiumQuality();
      // ne pas appeler simulateMenu
    }
  });

  try {
    const target = document.body || document.documentElement;
    observer.observe(target, { childList: true, subtree: true });
  } catch (e) {
    // Attente DOM prêt
    document.addEventListener('DOMContentLoaded', () => {
      try {
        const target2 = document.body || document.documentElement;
        observer.observe(target2, { childList: true, subtree: true });
      } catch {}
    }, { once: true });
  }

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
