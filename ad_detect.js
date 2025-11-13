// Generic content script across all sites: DOM parsing + adaptive ad detection
// NOTE: Content scripts cannot use top-level ESM imports. Use dynamic import with fallback.
let shouldBlockByHeuristics, nodeFeatures, isTrackerScript, AdDetectorModel, AdCache;
try {
  const heur = await import(chrome.runtime.getURL('ml/heuristics.js'));
  const modelMod = await import(chrome.runtime.getURL('ml/model_stub.js'));
  const cacheMod = await import(chrome.runtime.getURL('cache.js'));
  shouldBlockByHeuristics = heur.shouldBlockByHeuristics;
  nodeFeatures = heur.nodeFeatures;
  isTrackerScript = heur.isTrackerScript;
  AdDetectorModel = modelMod.AdDetectorModel;
  AdCache = cacheMod.AdCache;
} catch (_) {
  // Minimal inline fallbacks to stay operational
  shouldBlockByHeuristics = (el) => {
    try {
      const id = (el.id || '').toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      const txt = (el.textContent || '').toLowerCase();
      if (id.includes('ad') || cls.includes('ad')) return true;
      const hints = ['sponsor','promoted','advert','ads'];
      return hints.some(h => txt.includes(h));
    } catch { return false; }
  };
  nodeFeatures = (el) => {
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const cs = el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView.getComputedStyle(el) : { position: '', zIndex: '' };
    return {
      tag: (el.tagName || '').toLowerCase(),
      id: el.id || '',
      cls: (el.className || '').toString(),
      text: (el.textContent || '').slice(0, 512),
      w: rect.width || 0,
      h: rect.height || 0,
      pos: cs.position || '',
      z: parseInt(cs.zIndex || '0', 10) || 0,
      href: el.href || '',
      src: el.src || ''
    };
  };
  isTrackerScript = (el) => {
    const src = (el.src || '').toLowerCase();
    return !!src && (
      src.includes('doubleclick.net') || src.includes('googlesyndication.com') || src.includes('googleads.g.doubleclick.net')
    );
  };
  AdDetectorModel = class {
    constructor(){ this.threshold = 5; }
    predictFromFeatures(f){
      let s = 0; const t = (f.tag||'').toLowerCase(); const tokens = [f.id,f.cls,f.text].join(' ').toLowerCase();
      ['ad','ads','advert','sponsor','promoted','promo'].forEach(w => { if (tokens.includes(w)) s += 3; });
      if (f.w >= 728 && f.h >= 90) s += 2; if (f.w >= 300 && f.h >= 250) s += 2;
      if ((f.z||0) >= 1000 && ['fixed','sticky'].includes(f.pos)) s += 3;
      const href = String(f.href||'').toLowerCase(); const src = String(f.src||'').toLowerCase();
      if (href.includes('pagead') || href.includes('aclk')) s += 4;
      if (['doubleclick.net','googlesyndication.com','googleads.g.doubleclick.net'].some(h => src.includes(h))) s += 5;
      if (t === 'iframe') s += 2; if (t === 'img' && (src.includes('activeview')||src.includes('trackimp'))) s += 4;
      return s;
    }
  };
  AdCache = class {
    constructor(){ this._seen = new WeakSet(); this._memo = new Map(); }
    seenNode(el){ if (this._seen.has(el)) return true; this._seen.add(el); return false; }
    getSelector(k){ return this._memo.get(k); }
    setSelector(k,v){ this._memo.set(k,v); }
  };
}

const model = new AdDetectorModel();
const cache = new AdCache();
let strictMode = false;
let aiEnabled = true;
let blockedCount = 0;
let extEnabled = true; // Respecte le ON/OFF global
let mutObs = null; // Observateur mutations contrôlable

// Debug overlay & detailed logs
let debugDetailed = false;
let debugOverlayEnabled = false;
let debugOverlayToggle = false;
let debugLogs = [];
let debugOverlayEl = null;

function pushLog(entry) {
  try {
    const ts = new Date().toISOString();
    const line = typeof entry === 'string' ? { msg: entry } : (entry || {});
    debugLogs.push({ ts, ...line });
    if (debugLogs.length > 300) debugLogs.splice(0, debugLogs.length - 300);
    if (debugOverlayEnabled) renderDebugOverlay();
  } catch (_) {}
}

function createDebugOverlay() {
  const wrap = document.createElement('div');
  wrap.id = 'pb-debug-overlay';
  wrap.style.position = 'fixed';
  wrap.style.zIndex = '2147483646';
  wrap.style.right = '12px';
  wrap.style.bottom = '12px';
  wrap.style.width = '360px';
  wrap.style.maxHeight = '50vh';
  wrap.style.background = 'rgba(10,10,20,0.92)';
  wrap.style.border = '1px solid rgba(160,216,255,0.25)';
  wrap.style.borderRadius = '10px';
  wrap.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
  wrap.style.backdropFilter = 'blur(6px)';
  wrap.style.color = '#dfe6ff';
  wrap.style.fontFamily = 'monospace';
  wrap.style.fontSize = '11px';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.padding = '6px 8px';
  header.style.background = 'rgba(20,20,34,0.95)';
  const title = document.createElement('div');
  title.textContent = 'PureBlock • Logs';
  title.style.fontWeight = '600';
  title.style.letterSpacing = '0.2px';
  const btns = document.createElement('div');
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copier';
  copyBtn.style.marginRight = '8px';
  copyBtn.style.cursor = 'pointer';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Fermer';
  closeBtn.style.cursor = 'pointer';
  btns.appendChild(copyBtn);
  btns.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(btns);

  const body = document.createElement('div');
  body.style.padding = '6px 8px';
  body.style.overflow = 'auto';
  body.style.flex = '1';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';
  body.id = 'pb-debug-body';

  wrap.appendChild(header);
  wrap.appendChild(body);

  copyBtn.addEventListener('click', async () => {
    try {
      const text = debugLogs.map(l => `${l.ts} | ${JSON.stringify(l)}`).join('\n');
      await navigator.clipboard?.writeText?.(text);
    } catch (_) {}
  });
  closeBtn.addEventListener('click', () => {
    try { closeDebugOverlay(); } catch (_) {}
  });

  return wrap;
}

function renderDebugOverlay() {
  try {
    const body = debugOverlayEl && debugOverlayEl.querySelector('#pb-debug-body');
    if (!body) return;
    const lines = debugLogs.map(l => `${l.ts}  ${l.msg ? l.msg : ''}${l.reason ? ' ['+l.reason+']' : ''}${l.tag ? ' <'+l.tag+'#'+(l.id||'')+'>' : ''}`);
    body.textContent = lines.join('\n');
    body.scrollTop = body.scrollHeight;
  } catch (_) {}
}

function openDebugOverlay() {
  try {
    if (!debugOverlayEl) debugOverlayEl = createDebugOverlay();
    if (!debugOverlayEl.isConnected) document.documentElement.appendChild(debugOverlayEl);
    debugOverlayEnabled = true;
    renderDebugOverlay();
  } catch (_) {}
}

function closeDebugOverlay() {
  try {
    debugOverlayEnabled = false;
    if (debugOverlayEl && debugOverlayEl.parentNode) debugOverlayEl.parentNode.removeChild(debugOverlayEl);
  } catch (_) {}
}

function updateOverlayState() {
  try {
    const shouldOpen = !!(extEnabled && (debugOverlayToggle || debugDetailed));
    if (shouldOpen && !debugOverlayEnabled) {
      openDebugOverlay();
    } else if (!shouldOpen && debugOverlayEnabled) {
      closeDebugOverlay();
    }
  } catch (_) {}
}

function notifyBlocked(kind) {
  try { chrome.runtime?.sendMessage?.({ type: 'blocked', kind }); } catch {}
  if (debugDetailed) pushLog({ msg: 'blocked', reason: kind });
}

function removeNode(el, reason = 'ad') {
  if (!extEnabled || !el || cache.seenNode(el)) return;
  try {
    el.remove();
    blockedCount++;
    notifyBlocked(reason);
    if (debugDetailed) {
      try {
        const tag = (el.tagName||'').toLowerCase();
        pushLog({ msg: 'remove', reason, tag, id: el.id, cls: (el.className||'').toString() });
      } catch (_) {}
    }
  } catch {
    // fallback: hide
    el.style.setProperty('display', 'none', 'important');
  }
}

function processNode(el) {
  if (!extEnabled || !el || cache.seenNode(el)) return;
  try {
    const feat = nodeFeatures(el);
    const key = `${feat.tag}|${feat.id}|${feat.cls}`;
    const memo = cache.getSelector(key);
    if (memo === true) { removeNode(el, 'memo'); return; }
    const score = aiEnabled ? model.predictFromFeatures(feat) : 0;
    const heuristicHit = shouldBlockByHeuristics(el);
    const block = heuristicHit || (aiEnabled && score >= model.threshold) || (strictMode && score >= 4);
    if (block) {
      cache.setSelector(key, true);
      removeNode(el, heuristicHit ? 'heuristic' : 'ml');
      if (debugDetailed) pushLog({ msg: 'decision', tag: feat.tag, id: feat.id, cls: feat.cls, score, heuristicHit, strictMode, aiEnabled });
    }
  } catch {}
}

function scanInitial() {
  if (!extEnabled) return;
  const candidates = document.querySelectorAll('iframe, img, .ad, [class*="ad"], [id*="ad"], [class*="sponsor"], [id*="sponsor"], a[href*="pagead"], a[href*="aclk"], script[src]');
  candidates.forEach(el => {
    if (isTrackerScript(el)) removeNode(el, 'tracker'); else processNode(el);
  });
}

function observeMutations() {
  if (!extEnabled) return;
  mutObs = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.nodeType === 1) processNode(node);
      });
    }
  });
  try { mutObs.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch {}
}

// Offload scoring of heavy batches to worker
let worker;
function initWorker() {
  try {
    if (!extEnabled) return;
    // Try extension worker first
    worker = new Worker(chrome.runtime.getURL('workers/ad_worker.js'));
  } catch {
    // Fallback: inline blob worker for compatibility
    const code = `self.onmessage = (ev) => {
      try {
        const { type, features } = ev.data || {};
        if (type !== 'score') return;
        let score = 0;
        const AD_HOSTS = ['doubleclick.net','googlesyndication.com','googleads.g.doubleclick.net','adservice.google.com','adnxs.com','taboola.com','outbrain.com','criteo.net','pubmatic.com','rubiconproject.com','adsafeprotected.com'];
        const t = (features.tag || '').toLowerCase();
        const tokens = [features.id, features.cls, features.text].join(' ').toLowerCase();
        const adHints = ['ad','ads','advert','sponsor','promoted','promotion','promo'];
        for (const w of adHints) if (tokens.includes(w)) score += 3;
        if (features.w >= 728 && features.h >= 90) score += 2;
        if (features.w >= 300 && features.h >= 250) score += 2;
        if ((features.z || 0) >= 1000 && ['fixed','sticky'].includes(features.pos)) score += 3;
        const href = String(features.href || '').toLowerCase();
        if (href.includes('pagead') || href.includes('aclk')) score += 4;
        const src = String(features.src || '').toLowerCase();
        if (AD_HOSTS.some(h => src.includes(h))) score += 5;
        if (t === 'iframe') score += 2;
        if (t === 'img' && (src.includes('activeview') || src.includes('trackimp'))) score += 4;
        if ((features.pointer || '') === 'none' && (features.z || 0) >= 500) score += 2;
        self.postMessage({ type: 'score', score });
      } catch (e) { self.postMessage({ type: 'error', error: String(e) }); }
    };`;
    const blob = new Blob([code], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
  }
  try {
    worker.onmessage = (ev) => {
      const { type, score, node } = ev.data || {};
      if (type === 'score' && node) {
        const should = (score >= model.threshold) || (strictMode && score >= 4);
        if (should && node instanceof Element) removeNode(node, 'worker');
        if (debugDetailed) pushLog({ msg: 'worker-score', score, should });
      }
    };
  } catch {}
}

function batchScore(nodes) {
  if (!worker) return;
  for (const el of nodes) {
    try {
      const feat = nodeFeatures(el);
      worker.postMessage({ type: 'score', features: feat, node: el });
    } catch {}
  }
}

// Messaging for UI toggles and reports
chrome.runtime?.onMessage?.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'toggle_ai') aiEnabled = !!msg.enabled;
  if (msg.type === 'toggle_strict') strictMode = !!msg.enabled;
  if (msg.type === 'open_debug_overlay') openDebugOverlay();
  if (msg.type === 'close_debug_overlay') closeDebugOverlay();
  if (msg.type === 'report_ad') {
    // capture a snapshot of top suspicious nodes
    const nodes = Array.from(document.querySelectorAll('iframe, img, a, div, section'))
      .slice(0, 50)
      .map(n => ({
        tag: n.tagName, id: n.id, cls: n.className, src: n.getAttribute('src'), href: n.getAttribute('href')
      }));
    chrome.runtime?.sendMessage?.({ type: 'ad_report', url: location.href, nodes });
  }
});

// Init early
try {
  // Lecture initiale et écoute des réglages
  try {
    chrome.storage?.local?.get?.(['enabled','debugDetailed','debugOverlay']).then(({ enabled: en = true, debugDetailed: dd = false, debugOverlay: dover = false }) => {
      extEnabled = en !== false;
      debugDetailed = !!dd;
      debugOverlayToggle = !!dover;
      updateOverlayState();
      if (extEnabled) {
        initWorker();
        scanInitial();
        observeMutations();
        requestIdleCallback?.(() => {
          const batch = document.querySelectorAll('iframe, img, a[href*="pagead"], img[src*="doubleclick"], script[src]');
          batchScore(batch);
        }, { timeout: 1500 });
      }
    });

    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area === 'local' && changes) {
        if (changes.enabled) {
          const wasEnabled = extEnabled;
          extEnabled = changes.enabled.newValue !== false;
          updateOverlayState();
          if (!extEnabled) {
            try { mutObs?.disconnect?.(); } catch {}
            closeDebugOverlay();
          } else if (!wasEnabled && extEnabled) {
            initWorker();
            scanInitial();
            observeMutations();
          }
        }
        if (changes.debugDetailed) {
          debugDetailed = !!changes.debugDetailed.newValue;
          pushLog({ msg: 'debugDetailed-update', enabled: debugDetailed });
        }
        if (changes.debugOverlay) {
          debugOverlayToggle = !!changes.debugOverlay.newValue;
          pushLog({ msg: 'debugOverlay-update', enabled: debugOverlayToggle });
        }
        updateOverlayState();
      }
    });
  } catch (_) {}
} catch {}
