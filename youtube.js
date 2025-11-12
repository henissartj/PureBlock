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
let bitrateBoost = false;
let preferHDR = false;
let codecPref = 'auto';
// Réseau: paramètres par défaut (modulables via storage si besoin)
let gvMaxConcurrent = 1;         // Objectif A: limiter concurrence (queue simple)
let gvThrottleMbps = 5;          // Objectif A/B: pacing ~5 Mbps par défaut
let prebufferSeconds = 20;       // Objectif C: ne pas précharger trop loin
let gvMbps4K = 12;               // Débit différent si 4K détectée
let gvCurrentIs4K = false;       // Mis à jour par le gardien de qualité

// État de la queue googlevideo
let gvRunning = 0;
const gvQueue = [];
function gvSchedule() {
  while (gvRunning < gvMaxConcurrent && gvQueue.length) {
    const job = gvQueue.shift();
    gvRunning++;
    job.start();
  }
}
function gvEnqueue(run) {
  return new Promise((resolve, reject) => {
    const job = {
      start: async () => {
        try {
          const res = await run(() => { gvRunning--; gvSchedule(); });
          resolve(res);
        } catch (e) {
          reject(e);
          gvRunning--; gvSchedule();
        }
      }
    };
    gvQueue.push(job);
    gvSchedule();
  });
}
function sleepMs(ms){ return new Promise(r=>setTimeout(r, ms)); }
function getMainVideo(){ return document.querySelector('video.html5-main-video'); }
async function waitBufferAllowance() {
  // Attendre tant que le buffer dépasse prebufferSeconds
  try {
    const v = getMainVideo();
    if (!v || !v.buffered || v.buffered.length === 0) return; // rien à attendre si pas de buffer
    let safety = 0;
    while (safety < 300) { // max ~30s d'attente (300 * 100ms)
      const ct = v.currentTime || 0;
      let end = ct;
      for (let i=0;i<v.buffered.length;i++) {
        const s = v.buffered.start(i);
        const e = v.buffered.end(i);
        if (ct >= s && ct <= e) { end = e; break; }
        if (e > end) end = e; // fallback
      }
      const ahead = Math.max(0, end - ct);
      if (ahead <= prebufferSeconds) break;
      await sleepMs(100);
      safety++;
    }
  } catch (_) {}
}
function throttleStream(body, mbps, onDone){
  try {
    if (!body || typeof body.getReader !== 'function') return body;
    const reader = body.getReader();
    const bytesPerSec = Math.max(1, Math.floor(mbps * 125000)); // 1 Mbps = 125kB/s
    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done) { controller.close(); onDone && onDone(); break; }
            const chunk = value;
            const waitMs = Math.ceil((chunk.byteLength / bytesPerSec) * 1000);
            if (waitMs > 0) await sleepMs(waitMs);
            controller.enqueue(chunk);
          }
        } catch (e) {
          try { controller.error(e); } catch(_) {}
          onDone && onDone();
        }
      }
    });
  } catch (_) { return body; }
}

function isVideoResponse(url, res){
  try {
    const ct = res?.headers?.get?.('content-type') || '';
    if (/video\//i.test(ct)) return true;
    if (typeof url === 'string' && url.includes('mime=video/')) return true;
  } catch (_) {}
  return false;
}
function isAudioResponse(url, res){
  try {
    const ct = res?.headers?.get?.('content-type') || '';
    if (/audio\//i.test(ct)) return true;
    if (typeof url === 'string' && url.includes('mime=audio/')) return true;
  } catch (_) {}
  return false;
}

// Anti‑pub: assainir les réponses player et la variable ytInitialPlayerResponse
initAdResponseSanitizer();
initXHRAdSanitizer();

function initAdResponseSanitizer() {
  try {
    // 1) Hook fetch pour youtubei/v1/player – retirer les champs d’annonces
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch.__pbWrapped) {
      const wrapped = async function(input, init) {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        // Global OFF → ne rien modifier, renvoyer fetch original
        if (!enabled) return origFetch(input, init);
        // Objectif A/C: limiter bursts sur googlevideo et réduire prébuffer
        const isGV = typeof url === 'string' && url.includes('googlevideo.com/videoplayback');
        if (isGV) {
          if (!enabled) return origFetch(input, init);
          // Queue + pacing vidéo seulement; l'audio bypass pour démarrage rapide
          return gvEnqueue(async (release) => {
            await waitBufferAllowance();
            const res = await origFetch(input, init);
            try {
              const isVideo = isVideoResponse(url, res);
              const isAudio = !isVideo && isAudioResponse(url, res);
              if (!isVideo) {
                // Audio ou autre: pas de throttle, libérer la queue immédiatement
                release();
                return res;
              }
              const headers = new Headers();
              res.headers && res.headers.forEach((v,k)=>{ headers.set(k,v); });
              const targetMbps = gvCurrentIs4K ? gvMbps4K : gvThrottleMbps;
              const pacedBody = throttleStream(res.body, targetMbps, release);
              return new Response(pacedBody, { status: res.status, statusText: res.statusText, headers });
            } catch (_) {
              release();
              return res; // fallback safe
            }
          });
        }
        const res = await origFetch(input, init);
        try {
          if (url.includes('/youtubei/v1/player')) {
            const clone = res.clone();
            const json = await clone.json();
            const clean = sanitizePlayerJson(json);
            const body = JSON.stringify(clean);
            const headers = new Headers();
            // Reprendre un minimum d'en‑têtes utiles
            res.headers && res.headers.forEach((v,k)=>{ headers.set(k,v); });
            return new Response(body, { status: res.status, statusText: res.statusText, headers });
          }
        } catch (e) {
          // Si une erreur survient, on renvoie la réponse originale
        }
        return res;
      };
      wrapped.__pbWrapped = true;
      window.fetch = wrapped;
    }

    // 2) Setter pour ytInitialPlayerResponse – supprimer adPlacements/adBreaks/playerAds
    if (!('ytInitialPlayerResponse' in window)) {
      // Définir un proxy pour la future assignation
      let _val = undefined;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() { return _val; },
        set(v) { _val = sanitizePlayerJson(v); }
      });
    } else {
      try {
        window.ytInitialPlayerResponse = sanitizePlayerJson(window.ytInitialPlayerResponse);
      } catch (e) {}
    }

    // 3) Intervalle de garde: si YouTube réassigne, on nettoie
    if (!window.__pbSanitizeTicker) {
      window.__pbSanitizeTicker = setInterval(() => {
        try {
          if (window.ytInitialPlayerResponse) {
            window.ytInitialPlayerResponse = sanitizePlayerJson(window.ytInitialPlayerResponse);
          }
        } catch (e) {}
      }, 1200);
    }
  } catch (e) {}
}

function sanitizePlayerJson(obj) {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    const killKeys = ['adPlacements','adBreaks','playerAds','adSlots','adConfig','adFormats','adSignals'];
    for (const k of killKeys) {
      if (k in obj) {
        try { delete obj[k]; } catch (e) { obj[k] = undefined; }
      }
    }
    // Parfois présent sous obj.playerResponse
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      for (const k of killKeys) {
        if (k in obj.playerResponse) {
          try { delete obj.playerResponse[k]; } catch (e) { obj.playerResponse[k] = undefined; }
        }
      }
    }

    // Réordonne les formats selon la préférence codec pour influencer la sélection initiale
    try {
      const applySort = (sd) => {
        if (!sd) return;
        if (Array.isArray(sd.adaptiveFormats)) sd.adaptiveFormats = sortFormatsByCodecPreference(sd.adaptiveFormats);
        if (Array.isArray(sd.formats)) sd.formats = sortFormatsByCodecPreference(sd.formats);
      };
      if (obj.streamingData) applySort(obj.streamingData);
      if (obj.playerResponse && obj.playerResponse.streamingData) applySort(obj.playerResponse.streamingData);
    } catch (_) {}
  } catch (e) {}
  return obj;
}

function initXHRAdSanitizer() {
  try {
    const OrigXHR = window.XMLHttpRequest;
    if (!OrigXHR || OrigXHR.__pbWrapped) return;
    function PB_XHR() {
      const xhr = new OrigXHR();
      let url = '';
      const origOpen = xhr.open;
      xhr.open = function(method, u, async, user, pass) {
        url = u || '';
        return origOpen.apply(xhr, arguments);
      };
      function trySanitize() {
        try {
          if (!enabled) return; // Global OFF → pas de sanitation
          if (typeof url === 'string' && (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next'))) {
            if (xhr.responseType === '' || xhr.responseType === 'text') {
              const txt = xhr.responseText;
              const obj = JSON.parse(txt);
              const clean = sanitizePlayerJson(obj);
              const str = JSON.stringify(clean);
              try {
                Object.defineProperty(xhr, 'responseText', { configurable: true, get(){ return str; } });
                Object.defineProperty(xhr, 'response', { configurable: true, get(){ return str; } });
              } catch (e) {}
            } else if (xhr.responseType === 'json' && xhr.response) {
              const clean = sanitizePlayerJson(xhr.response);
              try {
                Object.defineProperty(xhr, 'response', { configurable: true, get(){ return clean; } });
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
      xhr.addEventListener('load', trySanitize);
      xhr.addEventListener('readystatechange', function(){ if (xhr.readyState === 4) trySanitize(); });
      return xhr;
    }
    PB_XHR.__pbWrapped = true;
    window.XMLHttpRequest = PB_XHR;
  } catch (e) {}
}

// — Préférence codec: tri doux des formats vidéo
function getCodecTagFromMime(mt) {
  mt = mt || '';
  // Exemples: 'video/webm; codecs="vp9"', 'video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="av01.0.08M.08"'
  const m = /codecs\s*=\s*"([^"]+)"/i.exec(mt);
  const c = (m && m[1] || '').toLowerCase();
  if (c.includes('av01')) return 'av1';
  if (c.includes('vp9')) return 'vp9';
  if (c.includes('avc1') || c.includes('h264')) return 'h264';
  return 'other';
}

function isVideoFormat(f) {
  const mt = f?.mimeType || '';
  return /video\//.test(mt);
}

function isAudioFormat(f) {
  const mt = f?.mimeType || '';
  return /audio\//.test(mt);
}

function scoreVideoFormat(f) {
  // Base sur résolution et fps
  const h = Number(f?.height || 0);
  const fps = Number(f?.fps || 0);
  let score = h * 10 + (fps >= 60 ? 300 : 0);
  // HDR (si préféré)
  const mt = f?.mimeType || '';
  const isHdr = /vp9\.2|hdr|hlg|pq|bt2020/i.test(mt) || /HDR/i.test(f?.qualityLabel || '');
  if (preferHDR && isHdr) score += 500;
  // Codec
  const tag = getCodecTagFromMime(mt);
  if (codecPref === 'av1') score += (tag === 'av1' ? 400 : 0);
  else if (codecPref === 'vp9') score += (tag === 'vp9' ? 300 : 0);
  else if (codecPref === 'h264') score += (tag === 'h264' ? 250 : 0);
  // Légère pénalité si autre que préféré lorsque préférence explicite
  if (codecPref !== 'auto' && tag !== codecPref) score -= 50;
  return score;
}

function sortFormatsByCodecPreference(arr) {
  try {
    if (!Array.isArray(arr) || arr.length === 0) return arr;
    const videos = [];
    const audios = [];
    for (const f of arr) {
      if (isVideoFormat(f)) videos.push(f); else if (isAudioFormat(f)) audios.push(f); else videos.push(f);
    }
    videos.sort((a,b) => scoreVideoFormat(b) - scoreVideoFormat(a));
    // Conserver ordre audio intouché
    return [...videos, ...audios];
  } catch (_) { return arr; }
}

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
}

// Défini au niveau supérieur pour éviter ReferenceError lors du bootstrap
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
        if (!enabled) return origAppend.call(this, node);
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
    // Retirer overlay skip si présent
    const overlay = player.querySelector('.pureblock-skip-overlay');
    if (overlay) {
      overlay.remove();
    }
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
  // Ne pas ajouter d'overlay personnalisé: on vise l'éradication en amont.
}
// Suppression de l’overlay personnalisé: aucune modification d’UI n’est injectée.

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
// === Bitrate Boost (YouTube) — qualité maximale constante + annotation Stats ===
(function initBitrateBoost(){
  try {
    // Charger les préférences
    api.storage?.local?.get?.(['bitrateBoost','preferHDR','youtubeCodecPref'], (data) => {
      bitrateBoost = data?.bitrateBoost === true;
      preferHDR = data?.preferHDR === true;
      codecPref = typeof data?.youtubeCodecPref === 'string' ? data.youtubeCodecPref : 'auto';
      if (bitrateBoost) {
        setupQualityKeeper();
      }
      // Précharge minimal
      try { const v = getMainVideo(); if (v) v.preload = 'metadata'; } catch(_){ }
    });

    // Observer les changements de storage
    api.storage?.onChanged?.addListener?.((changes) => {
      if (changes.bitrateBoost) {
        bitrateBoost = changes.bitrateBoost.newValue === true;
        setupQualityKeeper();
      }
      if (changes.preferHDR) {
        preferHDR = changes.preferHDR.newValue === true;
      }
      if (changes.youtubeCodecPref) {
        codecPref = typeof changes.youtubeCodecPref.newValue === 'string' ? changes.youtubeCodecPref.newValue : 'auto';
      }
      scheduleAnnotateStats();
    });

    // Observer léger: seulement apparition/disparition du panneau Stats
    if (!window.__pbStatsObserver) {
      const obs = new MutationObserver(() => scheduleAnnotateStats());
      obs.observe(document.body, { childList: true, subtree: true });
      window.__pbStatsObserver = obs;
    }
    scheduleAnnotateStats();
  } catch (e) {}
})();

function chooseBestQuality(levels) {
  const prefOrder = ['hd4320','hd2880','hd2160','hd1440','hd1080pPremium','hd1080','hd720','large','medium'];
  if (!levels || !levels.length) return null;
  // Si HDR préféré, tenter une étiquette Premium/HDR
  if (preferHDR) {
    const hdrCand = levels.find(q => /2160|1440|1080/.test(q) && /premium|hdr/i.test(q));
    if (hdrCand) return hdrCand;
  }
  for (const q of prefOrder) { if (levels.includes(q)) return q; }
  return levels[0];
}

function setupQualityKeeper(){
  try {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;
    if (!bitrateBoost || !enabled) return;
    // Préload metadata côté élément vidéo
    try { const v = getMainVideo(); if (v) v.preload = 'metadata'; } catch(_){ }

    // Patch setPlaybackQuality pour éviter retours auto involontaires
    if (!player.__pbQualityPatched && typeof player.setPlaybackQuality === 'function') {
      const origSPQ = player.setPlaybackQuality.bind(player);
      player.setPlaybackQuality = function(q){
        try {
          if (bitrateBoost) {
            const levels = player.getAvailableQualityLevels?.() || [];
            const best = chooseBestQuality(levels) || q;
            if (q === 'auto' || (levels.includes(q) && levels.indexOf(q) < levels.indexOf(best))) {
              q = best;
            }
            try { gvCurrentIs4K = /hd4320|hd2880|hd2160/.test(q); } catch(_){ }
          }
        } catch {}
        return origSPQ(q);
      };
      player.__pbQualityPatched = true;
    }

    const applyTop = () => {
      try {
        if (!enabled || !bitrateBoost) return;
        const levels = player.getAvailableQualityLevels?.() || [];
        const best = chooseBestQuality(levels);
        if (best) {
          try { gvCurrentIs4K = /hd4320|hd2880|hd2160/.test(best); } catch(_){ }
          player.setPlaybackQualityRange?.(best);
          player.setPlaybackQuality?.(best);
        }
      } catch (e) {}
    };

    applyTop();
    // Réappliquer à différents événements
    window.addEventListener('yt-navigate-finish', () => setTimeout(applyTop, 600), { passive: true });
    const qTick = setInterval(applyTop, 1200);
    player.addEventListener?.('onPlaybackQualityChange', applyTop);
  } catch (e) {}
}

let __pbAnnotQueued = false;
function scheduleAnnotateStats(){
  if (__pbAnnotQueued) return;
  __pbAnnotQueued = true;
  setTimeout(() => { __pbAnnotQueued = false; annotateStatsPanelSafe(); }, 150);
}

function annotateStatsPanelSafe(){
  try {
    const panel = document.querySelector('.html5-video-info-panel-content');
    if (!panel || !panel.isConnected) return;
    let line = panel.querySelector('.pureblock-stats-line');
    const text = enabled
      ? `PureBlock Bitrate Booster: ${bitrateBoost ? 'ON' : 'OFF'} · HDR: ${preferHDR ? 'ON' : 'OFF'} · Codec: ${codecPref.toUpperCase()}`
      : 'PureBlock: OFF';
    if (!line) {
      line = document.createElement('div');
      line.className = 'pureblock-stats-line';
      line.style.cssText = 'font-size:11px;color:#8ef;opacity:.9;padding:2px 0;';
      line.textContent = text;
      // Insérer en bas pour éviter de casser la mise en page
      panel.appendChild(line);
    } else {
      if (line.textContent !== text) line.textContent = text;
    }
  } catch (e) {}
}
