// Worker to offload scoring for DOM nodes
// Receives { type: 'score', features } and returns { type: 'score', score }

self.onmessage = (ev) => {
  try {
    const { type, features } = ev.data || {};
    if (type !== 'score') return;
    let score = 0;
    // Inline scorer mirrors heuristicScore to avoid import limitations in workers for MV3
    const AD_HOSTS = [
      'doubleclick.net','googlesyndication.com','googleads.g.doubleclick.net',
      'adservice.google.com','adnxs.com','taboola.com','outbrain.com',
      'criteo.net','pubmatic.com','rubiconproject.com','adsafeprotected.com'
    ];
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
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e) });
  }
};
