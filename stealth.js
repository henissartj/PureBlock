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

  // Param Scrubber en secours (au cas où transform ne s’applique pas sur certains flux internes)
  (function initParamScrubberFallback(){
    try {
      const removeList = new Set([
        'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','utm_name','utm_creative','utm_referrer','utm_social','utm_social-type',
        'gclid','fbclid','yclid','mc_eid','vero_id','ref'
      ]);
      function scrub(url) {
        try {
          const u = new URL(url, location.href);
          let changed = false;
          for (const p of Array.from(u.searchParams.keys())) {
            if (removeList.has(p) || p.startsWith('utm_')) {
              u.searchParams.delete(p); changed = true;
            }
          }
          return changed ? u.toString() : url;
        } catch { return url; }
      }

      const ofetch = window.fetch;
      if (typeof ofetch === 'function' && !ofetch.__pbScrubbed) {
        const wrapped = function(input, init){
          try {
            const url = (typeof input === 'string') ? input : (input && input.url) || '';
            const clean = scrub(url);
            if (typeof input === 'string') return ofetch(clean, init);
            if (input && typeof Request !== 'undefined' && input instanceof Request) {
              const req = new Request(clean, input);
              return ofetch(req, init);
            }
          } catch {}
          return ofetch(input, init);
        };
        wrapped.__pbScrubbed = true;
        window.fetch = wrapped;
      }

      const OXHR = window.XMLHttpRequest;
      if (OXHR && !OXHR.__pbScrubbed) {
        function PBXHR(){
          const xhr = new OXHR();
          const open = xhr.open;
          xhr.open = function(method, url){
            try { arguments[1] = scrub(url); } catch {}
            return open.apply(xhr, arguments);
          };
          return xhr;
        }
        PBXHR.__pbScrubbed = true;
        window.XMLHttpRequest = PBXHR;
      }
    } catch {}
  })();

  // Scriptlets anti‑anti‑ad: stubs pour SDK pub courants
  (function initAntiAntiAd(){
    try {
      // canRunAds (certaines pages vérifient sa présence)
      try { Object.defineProperty(window, 'canRunAds', { configurable: true, get(){ return true; }, set(){ } }); } catch {}

      // googletag / GPT
      if (!window.googletag) {
        window.googletag = { cmd: [], apiReady: true, pubads(){ return {
          addEventListener(){}, enableVideoAds(){}, setRequestNonPersonalizedAds(){}, setTargeting(){}, getSlots(){ return []; }
        }; } };
      }
      // adsbygoogle
      if (!window.adsbygoogle) {
        const arr = [];
        arr.push = function(){ return Promise.resolve(); };
        window.adsbygoogle = arr;
      }
      // Prebid
      if (!window.pbjs) {
        window.pbjs = { que: [], addAdUnits(){}, requestBids(){}, setConfig(){}, onEvent(){}, getBidResponses(){ return {}; } };
      }
      // Détections triviales
      try { Object.defineProperty(window, 'adblockDetected', { configurable: true, get(){ return false; }, set(){ } }); } catch {}
    } catch {}
  })();

  // Player Data Sanitizer généralisé: retire les champs d’annonces connus des JSON
  (function initGlobalAdSanitizer(){
    try {
      const killKeys = ['adPlacements','adBreaks','playerAds','ads','vast','ima','preroll','midroll','postroll','adSchedule','ad_config','adParams'];
      function cleanse(obj){
        try {
          if (!obj || typeof obj !== 'object') return obj;
          for (const k of killKeys) { if (k in obj) { try { delete obj[k]; } catch { obj[k] = undefined; } } }
          if (obj.playerResponse && typeof obj.playerResponse === 'object') {
            for (const k of killKeys) { if (k in obj.playerResponse) { try { delete obj.playerResponse[k]; } catch { obj.playerResponse[k] = undefined; } } }
          }
        } catch {}
        return obj;
      }

      const ofetch = window.fetch;
      if (typeof ofetch === 'function' && !ofetch.__pbGlobalWrapped) {
        const wrapped = async function(input, init){
          const url = (typeof input === 'string') ? input : (input && input.url) || '';
          const res = await ofetch(input, init);
          try {
            if (/ads|advert|vast|ima|doubleclick|googlesyndication/i.test(url)) {
              const clone = res.clone();
              const json = await clone.json();
              const body = JSON.stringify(cleanse(json));
              return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
            }
          } catch {}
          return res;
        };
        wrapped.__pbGlobalWrapped = true;
        window.fetch = wrapped;
      }

      const OXHR = window.XMLHttpRequest;
      if (OXHR && !OXHR.__pbGlobalWrapped) {
        function PBXHR(){
          const xhr = new OXHR();
          let url = '';
          const open = xhr.open;
          xhr.open = function(method, u){ url = u || ''; return open.apply(xhr, arguments); };
          function sanitize(){
            try {
              if (/ads|advert|vast|ima|doubleclick|googlesyndication/i.test(url)) {
                if (xhr.responseType === '' || xhr.responseType === 'text') {
                  const txt = xhr.responseText; const obj = JSON.parse(txt);
                  const str = JSON.stringify(cleanse(obj));
                  Object.defineProperty(xhr, 'responseText', { configurable: true, get(){ return str; } });
                  Object.defineProperty(xhr, 'response', { configurable: true, get(){ return str; } });
                } else if (xhr.responseType === 'json' && xhr.response) {
                  const clean = cleanse(xhr.response);
                  Object.defineProperty(xhr, 'response', { configurable: true, get(){ return clean; } });
                }
              }
            } catch {}
          }
          xhr.addEventListener('load', sanitize);
          xhr.addEventListener('readystatechange', function(){ if (xhr.readyState === 4) sanitize(); });
          return xhr;
        }
        PBXHR.__pbGlobalWrapped = true;
        window.XMLHttpRequest = PBXHR;
      }
    } catch {}
  })();

  // Guardian de bitrate générique (simple heuristique JWPlayer/Plyr)
  (function initBitrateGuardian(){
    try {
      function bumpJW(){
        try {
          if (typeof window.jwplayer === 'function') {
            const players = document.querySelectorAll('[id^="jwplayer"]');
            players.forEach(el => {
              try {
                const p = window.jwplayer(el.id);
                const q = p.getQualityLevels?.() || [];
                const idx = q.length ? q.length - 1 : -1;
                if (idx >= 0) p.setCurrentQuality?.(idx);
              } catch {}
            });
          }
        } catch {}
      }
      function bumpPlyr(){
        try {
          const nodes = document.querySelectorAll('.plyr');
          nodes.forEach(n => {
            try {
              const inst = n.plyr || (window.Plyr && window.Plyr.setup && window.Plyr.setup(n));
              if (inst && inst.supported && inst.config && inst.config.quality) {
                if (inst.elements?.quality?.menu) {
                  // tente de choisir la plus haute valeur
                  const opts = Object.keys(inst.config.quality.options || {}).map(Number).sort((a,b)=>b-a);
                  const top = opts[0];
                  if (top) inst.quality = top;
                }
              }
            } catch {}
          });
        } catch {}
      }
      const tick = () => { bumpJW(); bumpPlyr(); };
      tick();
      setInterval(tick, 2000);
    } catch {}
  })();
}
