// privacy.js
// Règles dynamiques declarativeNetRequest pour:
//  - Camoufler le User-Agent par famille de domaines
//  - Supprimer sec-ch-ua*, x-client-data
//  - Réduire le Referer sur les ressources vidéos
//
// Pas d'anonymat absolu garanti, mais réduction nette de surface.

const api = typeof browser !== "undefined" ? browser : chrome;

const RULES = {
  UA_YT: 300001,
  UA_GOOGLEVIDEO: 300002,
  SECCH: 300003,
  XCLIENT: 300004,
  REFERER_YT: 300005
};

const UAS = {
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  mobileChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
};

export async function initPrivacy() {
  if (!api.declarativeNetRequest || !api.declarativeNetRequest.updateDynamicRules) {
    console.warn("PureBlock privacy: DNR non dispo");
    return;
  }

  const { stealthStrong = false } = await api.storage.local.get(['stealthStrong']);
  const removeRuleIds = Object.values(RULES);
  const addRules = [];

  // UA pour YouTube web
  addRules.push({
    id: RULES.UA_YT,
    priority: 40,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "User-Agent",
          operation: "set",
          value: UAS.desktopFirefox // YouTube voit un profil Firefox desktop
        }
      ]
    },
    condition: {
      urlFilter: "||youtube.com|||youtu.be",
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "xmlhttprequest",
        "media",
        "script"
      ]
    }
  });

  // UA pour flux vidéo / CDN (googlevideo, ytimg)
  addRules.push({
    id: RULES.UA_GOOGLEVIDEO,
    priority: 40,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "User-Agent",
          operation: "set",
          value: UAS.mobileChrome // profil différent pour rendre le lien plus difficile
        }
      ]
    },
    condition: {
      urlFilter: "||googlevideo.com|||ytimg.com",
      resourceTypes: ["media", "image", "xmlhttprequest"]
    }
  });

  // Suppression des Client Hints (sec-ch-ua*)
  addRules.push({
    id: RULES.SECCH,
    priority: 50,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "sec-ch-ua", operation: "remove" },
        { header: "sec-ch-ua-mobile", operation: "remove" },
        { header: "sec-ch-ua-platform", operation: "remove" },
        { header: "sec-ch-ua-platform-version", operation: "remove" },
        { header: "sec-ch-ua-model", operation: "remove" },
        { header: "sec-ch-ua-full-version-list", operation: "remove" }
      ]
    },
    condition: {
      urlFilter: "youtube.com|youtu.be|googlevideo.com|ytimg.com",
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "xmlhttprequest",
        "media",
        "script",
        "image"
      ]
    }
  });

  // Suppression X-Client-Data
  addRules.push({
    id: RULES.XCLIENT,
    priority: 50,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "x-client-data", operation: "remove" }
      ]
    },
    condition: {
      urlFilter: "youtube.com|googlevideo.com|google.com",
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "xmlhttprequest",
        "script"
      ]
    }
  });

  // Referer minimisé pour médias YT
  addRules.push({
    id: RULES.REFERER_YT,
    priority: 30,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Referer",
          operation: "set",
          value: "https://www.youtube.com/"
        }
      ]
    },
    condition: {
      urlFilter: "googlevideo.com|ytimg.com",
      resourceTypes: ["media", "image", "xmlhttprequest"]
    }
  });

  // Mode stealth renforcé (optionnel)
  if (stealthStrong) {
    // Supprime Origin pour médias CDN (réduit le lien au contexte YT)
    addRules.push({
      id: 300006,
      priority: 35,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "remove" }
        ]
      },
      condition: {
        urlFilter: "googlevideo.com|ytimg.com",
        resourceTypes: ["media", "image", "xmlhttprequest"]
      }
    });

    // Supprime quelques entêtes client YouTube (sans casser la lecture)
    addRules.push({
      id: 300007,
      priority: 35,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "x-youtube-client-name", operation: "remove" },
          { header: "x-youtube-client-version", operation: "remove" }
        ]
      },
      condition: {
        urlFilter: "youtube.com|youtubei|googleapis.com",
        resourceTypes: ["xmlhttprequest", "script"]
      }
    });
  }

  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (e) {
    console.warn("PureBlock privacy: échec updateDynamicRules", e);
  }
}

// Nettoyage universel des overlays publicitaires sur lecteurs vidéo (hors YouTube/Twitch spécifiques)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function initGlobalAdCosmetics() {
    try {
      const SELECTORS = [
        '.ima-ads-container',
        '.google-ima',
        '.vjs-ads-label',
        '.vjs-ads-overlay',
        '.vjs-ima-ad-container',
        '.jw-flag-ads',
        '.jw-ads',
        '.ad-overlay',
        '.ad-banner',
        '.ad-container'
      ];

      function hide(el) {
        try {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        } catch (e) {}
      }

      function cleanOnce(root) {
        try {
          for (const sel of SELECTORS) {
            root.querySelectorAll(sel).forEach(hide);
          }
          // Heuristique: éléments overlay absolus au-dessus d'un player
          document.querySelectorAll('video').forEach((v) => {
            const parent = v.closest('.jwplayer, .video-js, .plyr, .vjs-player, .html5-video-player, .player, [class*="player"]') || v.parentElement;
            if (!parent) return;
            parent.querySelectorAll('*').forEach((n) => {
              const cs = window.getComputedStyle(n);
              if (cs.position === 'absolute' || cs.position === 'fixed') {
                // masque les overlays non interactifs contenant des mots clés pub
                const t = (n.textContent || '').toLowerCase();
                if (t.includes('pub') || t.includes('advert') || t.includes('sponsor') || t.includes('ads')) {
                  hide(n);
                }
              }
            });
          });
        } catch (e) {}
      }

      const mo = new MutationObserver((muts) => {
        cleanOnce(document);
      });
      try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
      cleanOnce(document);
    } catch (e) {}
  })();
}
