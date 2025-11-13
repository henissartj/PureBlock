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

function notifyBlocked(kind) {
  try { chrome.runtime?.sendMessage?.({ type: 'blocked', kind }); } catch {}
}

function removeNode(el, reason = 'ad') {
  if (!el || cache.seenNode(el)) return;
  try {
    el.remove();
    blockedCount++;
    notifyBlocked(reason);
  } catch {
    // fallback: hide
    el.style.setProperty('display', 'none', 'important');
  }
}

function processNode(el) {
  if (!el || cache.seenNode(el)) return;
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
    }
  } catch {}
}

function scanInitial() {
  const candidates = document.querySelectorAll('iframe, img, .ad, [class*="ad"], [id*="ad"], [class*="sponsor"], [id*="sponsor"], a[href*="pagead"], a[href*="aclk"], script[src]');
  candidates.forEach(el => {
    if (isTrackerScript(el)) removeNode(el, 'tracker'); else processNode(el);
  });
}

function observeMutations() {
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.nodeType === 1) processNode(node);
      });
    }
  });
  obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
}

// Offload scoring of heavy batches to worker
let worker;
function initWorker() {
  try {
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
  initWorker();
  scanInitial();
  observeMutations();
  // Opportunistic batch scoring on idle
  requestIdleCallback?.(() => {
    const batch = document.querySelectorAll('iframe, img, a[href*="pagead"], img[src*="doubleclick"], script[src]');
    batchScore(batch);
  }, { timeout: 1500 });
} catch {}
