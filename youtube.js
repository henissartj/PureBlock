const api = typeof browser !== "undefined" ? browser : chrome;

let enabled = true;
let alertsEnabled = true;
let observer = null;
let playerObserver = null;
let idleScheduled = false;
let sleeping = false;
let lastAdTs = Date.now();
let prevMuted = null;
let boostedPlayback = false;

// === Téléchargement YouTube: bouton et menu qualité ===
function injectDownloadButton() {
  // Téléchargement désactivé
  return;
  try {
    const controls = document.querySelector('.html5-video-player .ytp-right-controls');
    const player = document.querySelector('.html5-video-player');
    if (!player) return;
    if (document.querySelector('.pureblock-download-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ytp-button pureblock-download-btn';
    btn.setAttribute('aria-label', 'Télécharger (PureBlock)');
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);color:#fff;background:rgba(20,20,32,0.35);backdrop-filter:saturate(120%) blur(2px);font-size:12px;letter-spacing:.2px;';
    // Icône SVG + libellé
    {
      const svgNS = 'http://www.w3.org/2000/svg';
      const icon = document.createElementNS(svgNS, 'svg');
      icon.setAttribute('width', '16');
      icon.setAttribute('height', '16');
      icon.setAttribute('viewBox', '0 0 24 24');
      const path1 = document.createElementNS(svgNS, 'path');
      path1.setAttribute('d', 'M12 3a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4.293 4.293a1 1 0 0 1-1.414 0L6.707 11.707a1 1 0 1 1 1.414-1.414L10.414 12.586V4a1 1 0 0 1 1-1z');
      path1.setAttribute('fill', '#ffffff');
      const path2 = document.createElementNS(svgNS, 'path');
      path2.setAttribute('d', 'M5 18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z');
      path2.setAttribute('fill', '#ffffff');
      icon.appendChild(path1);
      icon.appendChild(path2);
      const labelSpan = document.createElement('span');
      labelSpan.textContent = 'Télécharger';
      btn.appendChild(icon);
      btn.appendChild(labelSpan);
    }

    const menu = document.createElement('div');
    menu.className = 'pureblock-download-menu';
    menu.style.cssText = 'position:absolute;bottom:40px;right:6px;min-width:180px;background:rgba(22,22,34,0.95);color:#eef;border:1px solid rgba(255,255,255,0.15);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.35);padding:6px;display:none;z-index:9999;';

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    menu.appendChild(list);

    const closeOnOutside = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== btn) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeOnOutside, true);
      }
    };

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Rebuild list at each open to keep formats fresh
      list.innerHTML = '';
      const formats = getDownloadableFormats();
      if (!formats.length) {
        // Fallback: proposer vidéo seule (MP4) et audio seul (M4A)
        const fb = getAdaptiveFallbackFormats();
        if (fb.video.length || fb.audio.length) {
          const noAv = document.createElement('div');
          noAv.textContent = 'Pas de format combiné mp4 (AV) — fallbacks:';
          noAv.style.cssText = 'font-size:12px;opacity:.85;padding:4px 6px;';
          list.appendChild(noAv);
          if (fb.video.length) {
            const headV = document.createElement('div');
            headV.textContent = 'Vidéo seule:';
            headV.style.cssText = 'font-size:11px;opacity:.8;padding:2px 6px;';
            list.appendChild(headV);
            for (const f of fb.video) {
              const item = document.createElement('button');
              const qLabel = f.qualityLabel || (f.height ? f.height+'p' : 'Auto');
              item.textContent = `${qLabel} · mp4 · vidéo seule`;
              item.style.cssText = 'text-align:left;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(32,32,44,0.85);color:#eef;font-size:12px;cursor:pointer;';
              item.addEventListener('click', () => {
                try {
                  const title = getVideoTitleSafe();
                  const filename = `${title} - ${qLabel}.mp4`.replace(/[\\/:*?\"<>|]+/g, '_');
                  if (chrome?.downloads?.download && f.url) {
                    chrome.downloads.download({ url: f.url, filename }, () => {});
                  } else {
                    if (f.url) window.open(f.url, '_blank');
                  }
                } catch (e) {}
                menu.style.display = 'none';
              });
              list.appendChild(item);
            }
          }
          if (fb.audio.length) {
            const headA = document.createElement('div');
            headA.textContent = 'Audio seul:';
            headA.style.cssText = 'font-size:11px;opacity:.8;padding:2px 6px;';
            list.appendChild(headA);
            for (const f of fb.audio) {
              const item = document.createElement('button');
              const qLabel = f.qualityLabel || 'Audio';
              item.textContent = `${qLabel} · m4a · audio seul`;
              item.style.cssText = 'text-align:left;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(32,32,44,0.85);color:#eef;font-size:12px;cursor:pointer;';
              item.addEventListener('click', () => {
                try {
                  const title = getVideoTitleSafe();
                  const filename = `${title}.m4a`.replace(/[\\/:*?\"<>|]+/g, '_');
                  if (chrome?.downloads?.download && f.url) {
                    chrome.downloads.download({ url: f.url, filename }, () => {});
                  } else {
                    if (f.url) window.open(f.url, '_blank');
                  }
                } catch (e) {}
                menu.style.display = 'none';
              });
              list.appendChild(item);
            }
          }
        } else {
          const empty = document.createElement('div');
          empty.textContent = 'Formats indisponibles. YouTube requiert un déchiffrement (non pris en charge).';
          empty.style.cssText = 'font-size:12px;opacity:.8;padding:6px;';
          list.appendChild(empty);
        }
      } else {
        for (const f of formats) {
          const item = document.createElement('button');
          const label = `${f.qualityLabel || (f.height ? f.height+'p' : 'Auto')} · mp4`;
          item.textContent = label;
          item.style.cssText = 'text-align:left;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(32,32,44,0.85);color:#eef;font-size:12px;cursor:pointer;';
          item.addEventListener('click', () => {
            try {
              const title = getVideoTitleSafe();
              const filename = `${title} - ${label}.mp4`.replace(/[\\/:*?"<>|]+/g, '_');
              if (chrome?.downloads?.download) {
                chrome.downloads.download({ url: f.url, filename }, () => {});
              } else {
                window.open(f.url, '_blank');
              }
            } catch (e) {}
            menu.style.display = 'none';
          });
          list.appendChild(item);
        }
      }
      const rect = btn.getBoundingClientRect();
      menu.style.right = '6px';
      menu.style.bottom = '40px';
      menu.style.display = 'block';
      setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
    });

    // Mount menu near controls (overlay layer) avec fallback overlay si controls indisponibles
    if (controls) {
      controls.appendChild(btn);
      controls.style.position = 'relative';
      controls.appendChild(menu);
    } else {
      // Fallback overlay: coin supérieur droit du player
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;top:8px;right:8px;z-index:9999;';
      wrap.appendChild(btn);
      wrap.appendChild(menu);
      player.style.position = 'relative';
      player.appendChild(wrap);
    }
  } catch (e) {}
}

function getVideoTitleSafe() {
  try {
    const el = document.querySelector('h1.title yt-formatted-string, h1.ytd-watch-metadata, #title h1');
    const txt = (el?.textContent || '').trim();
    if (txt) return txt;
  } catch (e) {}
  try {
    const player = document.getElementById('movie_player');
    const data = player?.getVideoData?.();
    const title = data?.title || '';
    if (title) return title.trim();
  } catch (e) {}
  return 'video';
}

function getDownloadableFormats() {
  // Téléchargement désactivé
  return [];
  const res = [];
  try {
    const spr = window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.player_response && JSON.parse(window.ytplayer.config.args.player_response);
    const sd = spr?.streamingData;
    const all = [];
    if (sd?.formats) all.push(...sd.formats);
    if (sd?.adaptiveFormats) all.push(...sd.adaptiveFormats);
    for (const f of all) {
      // Skip ciphered formats (signatureCipher) to avoid decipher complexity
      const mt = f.mimeType || '';
      const hasAv = mt.includes('video/mp4') && mt.includes('codecs');
      if (!f.url) continue;
      if (hasAv && mt.includes('audio')) {
        res.push({ url: f.url, qualityLabel: f.qualityLabel, height: f.height });
      }
    }
  } catch (e) {}
  return res;
}

function getAdaptiveFallbackFormats() {
  // Téléchargement désactivé
  return { video: [], audio: [] };
  const res = { video: [], audio: [] };
  try {
    const spr = window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.player_response && JSON.parse(window.ytplayer.config.args.player_response);
    const sd = spr?.streamingData;
    const all = [];
    if (sd?.formats) all.push(...sd.formats);
    if (sd?.adaptiveFormats) all.push(...sd.adaptiveFormats);
    for (const f of all) {
      const mt = f.mimeType || '';
      const url = f.url || null;
      if (!url) continue;
      if (mt.includes('video/mp4') && !mt.includes('audio')) {
        res.video.push({ url, qualityLabel: f.qualityLabel, height: f.height });
      } else if (mt.includes('audio/mp4') || mt.includes('audio/m4a')) {
        res.audio.push({ url, qualityLabel: f.qualityLabel, height: f.height });
      }
    }
    res.video.sort((a,b) => (b.height||0)-(a.height||0));
  } catch (e) {}
  return res;
}

const SLEEP_AFTER_MS = 3 * 60 * 1000; // 3 minutes d'inactivité pub

// Chargement initial des paramètres
api.storage.local.get(["enabled", "alertsEnabled"], (data) => {
  enabled = data.enabled !== false;
  alertsEnabled = data.alertsEnabled !== false;

  if (enabled) {
    bootstrap();
  } else {
    sleeping = true;
  }
});

// Réagit aux changements de storage (popup / options)
api.storage.onChanged.addListener((changes) => {
  if ("enabled" in changes) {
    const newVal = changes.enabled.newValue !== false;
    enabled = newVal;

    if (!newVal) {
      // Désactivation → on se met en sommeil proprement
      sleep();
    } else {
      // Activation → si jamais lancé, on réveille, sinon on bootstrap
      sleeping = false;
      if (!observer) {
        bootstrap();
      } else {
        wake(true);
      }
    }
  }

  if ("alertsEnabled" in changes) {
    alertsEnabled = changes.alertsEnabled.newValue !== false;
  }
});

function bootstrap() {
  if (!enabled) return;
  initPreloadGuard();
  observeAds();
  attachPlayerObserver();
  try { document.querySelector('video')?.play?.(); } catch (_) {}
  safeClean();
  hookNavigationWake();
  injectDownloadButton();
  observeControlsForDownloadButton();
}

function observeAds() {
  if (observer || !enabled) return;

  observer = new MutationObserver(() => {
    if (!enabled || sleeping || idleScheduled) return;

    idleScheduled = true;
    const cb = () => {
      idleScheduled = false;
      if (enabled && !sleeping) {
        safeClean();
      }
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(cb, { timeout: 120 });
    } else {
      setTimeout(cb, 80);
    }

    // Observer ciblé sur le player pour changements de classe (ad-showing)
    attachPlayerObserver();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false
  });

  // Réduire la portée réelle d'observation aux conteneurs clés
  try {
    const roots = getRoots();
    for (const root of roots) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: false
      });
    }
  } catch (e) {}
}

function stopObserver() {
  if (observer) {
    try {
      observer.disconnect();
    } catch (e) {}
    observer = null;
  }
  if (playerObserver) {
    try {
      playerObserver.disconnect();
    } catch (e) {}
    playerObserver = null;
  }
}

function sleep() {
  sleeping = true;
  stopObserver();
}

function wake(fromNav = false) {
  if (!enabled) return;

  if (sleeping || fromNav || !observer) {
    sleeping = false;
    lastAdTs = Date.now();
    observeAds();
    attachPlayerObserver();
    safeClean();
  }
}

function hookNavigationWake() {
  // Evénement interne YouTube SPA
  window.addEventListener("yt-navigate-finish", () => wake(true), {
    passive: true
  });

  // Fallback: interception des changements d'URL SPA
  let lastUrl = location.href;

  const onUrlChange = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      wake(true);
    }
  };

  const wrapHistory = (fnName) => {
    try {
      const orig = history[fnName];
      if (typeof orig !== "function") return;
      history[fnName] = function (...args) {
        const res = orig.apply(this, args);
        try {
          onUrlChange();
        } catch (e) {}
        return res;
      };
    } catch (e) {}
  };

  wrapHistory("pushState");
  wrapHistory("replaceState");

  window.addEventListener("popstate", () => {
    try {
      onUrlChange();
    } catch (e) {}
  }, { passive: true });

  // Réinjection du bouton après navigation SPA
  window.addEventListener('yt-navigate-finish', () => {
    try { injectDownloadButton(); } catch (e) {}
    try { observeControlsForDownloadButton(); } catch (e) {}
  }, { passive: true });

function observeControlsForDownloadButton() {
  // Téléchargement désactivé
  return;
  try {
    const bottom = document.querySelector('.html5-video-player .ytp-chrome-bottom');
    if (!bottom) return;
    if (bottom.__pbObserver) return;
    const mo = new MutationObserver(() => {
      try {
        if (!document.querySelector('.pureblock-download-btn')) {
          injectDownloadButton();
        }
      } catch (e) {}
    });
    mo.observe(bottom, { childList: true, subtree: true });
    bottom.__pbObserver = mo;
  } catch (e) {}
}
}

function getRoots() {
  const roots = [];
  const push = (sel) => {
    const el = document.querySelector(sel);
    if (el) roots.push(el);
  };
  push("ytd-app");
  push("ytd-watch-flexy");
  push("#content");
  push("#primary");
  push(".html5-video-player");
  return roots;
}

function attachPlayerObserver() {
  try {
    if (playerObserver) return;
    const player = document.querySelector(".html5-video-player");
    if (!player) return;

    playerObserver = new MutationObserver(() => {
      if (!enabled || sleeping || idleScheduled) return;
      idleScheduled = true;
      const cb = () => {
        idleScheduled = false;
        if (enabled && !sleeping) safeClean();
      };
      if ("requestIdleCallback" in window) {
        requestIdleCallback(cb, { timeout: 120 });
      } else {
        setTimeout(cb, 80);
      }
    });

    playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ["class"]
    });
  } catch (e) {}
}

function initPreloadGuard() {
  try {
    const head = document.head || document.documentElement;
    if (!head) return;

    const origAppend = head.appendChild;
    if (head._pureblockGuardPatched) return;
    head._pureblockGuardPatched = true;

    head.appendChild = function (node) {
      try {
        if (
          node?.tagName === "LINK" &&
          /^(preload|prefetch)$/i.test(node.rel || "") &&
          /pagead|doubleclick|googlesyndication|adservice/i.test(node.href || "")
        ) {
          // On bloque silencieusement ces préloads publicitaires
          return node;
        }
      } catch (e) {}
      return origAppend.call(this, node);
    };
  } catch (e) {}
}

function safeClean() {
  try {
    hideStaticAds();
    handlePlayerAds();
    maybeSleep();
  } catch (e) {
    // On reste silencieux pour ne pas spammer la console utilisateur
  }
}

function hideStaticAds() {
  const selectors = [
    "#masthead-ad",
    "ytd-banner-promo-renderer",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    ".ytd-promoted-video-renderer",
    ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay",
    ".ytp-ad-player-overlay",
    "#player-ads",
    ".ytp-ad-module",
    "ytd-companion-slot-renderer",
    'ytd-engagement-panel-section-list-renderer[target-id*="engagement-panel-ads"]'
  ];

  let removed = 0;
  for (const sel of selectors) {
    const nodes = document.querySelectorAll(sel);
    if (!nodes.length) continue;

    nodes.forEach((el) => {
      if (!el.dataset.pureblockHidden) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.dataset.pureblockHidden = "1";
        removed++;
      }
    });
  }

  if (removed > 0) {
    // estimation ultra-simple: 10KB par bloc supprimé
    reportBlocked(removed, removed * 10 * 1024);
  }
}

function handlePlayerAds() {
  const player = document.querySelector(".html5-video-player");
  const video = document.querySelector("video.html5-main-video");
  if (!video || !player) return;

  const isAd =
    player.classList.contains("ad-showing") ||
    player.classList.contains("ad-interrupting") ||
    document.querySelector(".ytp-ad-player-overlay") ||
    document.querySelector(".ytp-ad-module");

  if (!isAd) {
    // Revert any ad-time tweaks for fluidity
    try {
      if (boostedPlayback && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
      boostedPlayback = false;
      if (prevMuted !== null) {
        video.muted = prevMuted;
        prevMuted = null;
      }
      // Ensure video plays promptly after ad ends
      video.play?.();
    } catch (e) {}
    return;
  }

  const skipBtn =
    document.querySelector(".ytp-ad-skip-button") ||
    document.querySelector(".ytp-ad-skip-button-modern");

  if (skipBtn) {
    skipBtn.click();
    lastAdTs = Date.now();
    // estimation : durée vidéo * 50KB "économisés"
    const est = Math.floor(video.duration || 5) * 50 * 1024;
    reportBlocked(1, est);
    return;
  }

  // Si pas de bouton skip, on reste minimal: mute sans modifier la vitesse
  try {
    if (!boostedPlayback) {
      prevMuted = video.muted;
      video.muted = true;
      boostedPlayback = true;
    }
  } catch (e) {}
}

function maybeSleep() {
  if (!sleeping && Date.now() - lastAdTs > SLEEP_AFTER_MS) {
    sleep();
  }
}

// Aligne avec background.js : { action: "incrementStats", blocked, bytes }
function reportBlocked(count, bytes) {
  if (!count && !bytes) return;
  try {
    api.runtime.sendMessage(
      {
        action: "incrementStats",
        blocked: count || 0,
        bytes: bytes || 0
      },
      () => {}
    );
  } catch (e) {}
}
