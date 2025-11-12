// Lightweight heuristic detectors for ad elements in the DOM
export const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleads.g.doubleclick.net',
  'adservice.google.com', 'adnxs.com', 'taboola.com', 'outbrain.com',
  'criteo.net', 'pubmatic.com', 'rubiconproject.com', 'adsafeprotected.com'
];

export const ANALYTICS_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'hotjar.com', 'mixpanel.com',
  'segment.com', 'snowplowanalytics.com', 'matomo.cloud', 'amplitude.com'
];

export function isAdIframe(el) {
  try {
    if (!(el && el.tagName === 'IFRAME')) return false;
    const src = String(el.src || '');
    return AD_HOSTS.some(h => src.includes(h));
  } catch { return false; }
}

export function isTrackerScript(el) {
  try {
    if (!(el && el.tagName === 'SCRIPT')) return false;
    const src = String(el.src || '');
    return ANALYTICS_HOSTS.some(h => src.includes(h));
  } catch { return false; }
}

export function nodeFeatures(el) {
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0 };
  const styles = window.getComputedStyle ? window.getComputedStyle(el) : null;
  const cls = (el.className || '').toString().toLowerCase();
  const id = (el.id || '').toLowerCase();
  const tag = (el.tagName || '').toLowerCase();
  const text = (el.textContent || '').toLowerCase().slice(0, 512);
  const src = (el.getAttribute('src') || '').toLowerCase();
  const href = (el.getAttribute('href') || '').toLowerCase();
  const z = styles ? parseInt(styles.zIndex || '0', 10) || 0 : 0;
  const pos = styles ? (styles.position || '') : '';
  const pointer = styles ? (styles.pointerEvents || '') : '';
  return {
    tag, id, cls,
    w: Math.round(rect.width), h: Math.round(rect.height),
    top: Math.round(rect.top), left: Math.round(rect.left),
    z, pos, pointer, text, src, href
  };
}

export function heuristicScore(feat) {
  let s = 0;
  const t = feat.tag;
  // Common ad words
  const tokens = [feat.id, feat.cls, feat.text].join(' ');
  const adHints = ['ad', 'ads', 'advert', 'sponsor', 'promoted', 'promotion', 'promo'];
  for (const w of adHints) if (tokens.includes(w)) s += 3;
  // Big overlay or banner
  if (feat.w >= 728 && feat.h >= 90) s += 2;
  if (feat.w >= 300 && feat.h >= 250) s += 2;
  if (feat.z >= 1000 && ['fixed','sticky'].includes(feat.pos)) s += 3;
  // Click trackers
  if (feat.href.includes('pagead') || feat.href.includes('aclk')) s += 4;
  // Known ad hosts in src
  if (AD_HOSTS.some(h => feat.src.includes(h))) s += 5;
  // Iframes are strong signals
  if (t === 'iframe') s += 2;
  // Images with tracking pixels
  if (t === 'img' && (feat.src.includes('activeview') || feat.src.includes('trackimp'))) s += 4;
  // Cloaking-like pointer-events none but above content
  if (feat.pointer === 'none' && feat.z >= 500) s += 2;
  return s;
}

export function shouldBlockByHeuristics(el) {
  try {
    if (isAdIframe(el) || isTrackerScript(el)) return true;
    const feat = nodeFeatures(el);
    const s = heuristicScore(feat);
    return s >= 6;
  } catch { return false; }
}
