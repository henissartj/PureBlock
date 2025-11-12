// Minimal uBlock-style filter engine: parse a small subset and compile to MV3 DNR rules
// Supported patterns:
// - Network: "||domain^" and path hints, optional "$types" where types ∈ {script, image, media, ping, xhr, sub_frame, all}
// - Cosmetic: "domain##selector" recorded for future injection (not applied here)

const api = typeof browser !== 'undefined' ? browser : chrome;

const TYPE_MAP = {
  script: 'script',
  image: 'image',
  media: 'media',
  ping: 'ping',
  xhr: 'xmlhttprequest',
  sub_frame: 'sub_frame',
  all: null
};

function parseTypesToken(token) {
  const parts = token.split(',').map(s => s.trim()).filter(Boolean);
  const types = [];
  for (const p of parts) {
    const mapped = TYPE_MAP[p];
    if (!mapped && p === 'all') return null; // null → all types
    if (mapped) types.push(mapped);
  }
  return types.length ? types : null;
}

function patternToUrlFilter(pattern) {
  // Handle ||domain^ optionally with a path hint like ?param=
  // Examples:
  //   ||doubleclick.net^           → *://*.doubleclick.net/*
  //   ||google.com/pagead^         → *://*.google.com/pagead/*
  //   ||googlevideo.com/videoplayback?adformat=^ → *://*.googlevideo.com/videoplayback*adformat=*
  let p = pattern.replace(/^\|\|/, '');
  p = p.replace(/\^$/, '');
  // If has query/path part, keep it
  const qm = p.indexOf('?');
  const slash = p.indexOf('/');
  let host = p;
  let tail = '';
  if (slash >= 0) {
    host = p.slice(0, slash);
    tail = p.slice(slash);
  } else if (qm >= 0) {
    host = p.slice(0, qm);
    tail = p.slice(qm); // like ?adformat=
  }
  const hostFilter = `*://*.${host}/*`;
  if (!tail) return hostFilter;
  // Build filter with tail wildcard-friendly
  if (tail.startsWith('/')) {
    return `*://*.${host}${tail}*`;
  }
  if (tail.startsWith('?')) {
    return `*://*.${host}/*${tail.slice(1)}*`;
  }
  return hostFilter;
}

function compileLineToRule(line, idBase, nextIndex) {
  // Returns { rule, cosmetic } where rule is DNR rule or null
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('!')) return { rule: null, cosmetic: null };
  // Cosmetic filter: domain##selector
  const cosIdx = trimmed.indexOf('##');
  if (cosIdx > 0) {
    const domain = trimmed.slice(0, cosIdx).trim();
    const selector = trimmed.slice(cosIdx + 2).trim();
    return { rule: null, cosmetic: { domain, selector } };
  }
  // Network filter with optional $types
  const optIdx = trimmed.indexOf('$');
  const pattern = optIdx >= 0 ? trimmed.slice(0, optIdx).trim() : trimmed;
  const typesToken = optIdx >= 0 ? trimmed.slice(optIdx + 1).trim() : '';
  if (!pattern.startsWith('||')) return { rule: null, cosmetic: null };
  const urlFilter = patternToUrlFilter(pattern);
  const resourceTypes = typesToken ? parseTypesToken(typesToken) : null;
  const rule = {
    id: idBase + nextIndex,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter }
  };
  if (resourceTypes) rule.condition.resourceTypes = resourceTypes;
  return { rule, cosmetic: null };
}

export async function compileFiltersToDNR(text, idBase = 700000) {
  const lines = text.split(/\r?\n/);
  const rules = [];
  const cosmetics = [];
  let idx = 1;
  for (const line of lines) {
    const { rule, cosmetic } = compileLineToRule(line, idBase, idx);
    if (rule) { rules.push(rule); idx += 1; }
    if (cosmetic) cosmetics.push(cosmetic);
  }
  return { rules, cosmetics };
}

export async function loadBundledFilters(path = 'filters/base.txt') {
  try {
    const url = api.runtime.getURL(path);
    const res = await fetch(url);
    return await res.text();
  } catch (e) {
    console.warn('PureBlock: failed to load filters', e);
    return '';
  }
}

export async function applyDynamicFiltersFromText(text) {
  if (!api.declarativeNetRequest?.updateDynamicRules) return { count: 0 };
  const { rules } = await compileFiltersToDNR(text);
  const removeRuleIds = rules.map(r => r.id);
  try {
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
    return { count: rules.length };
  } catch (e) {
    console.warn('PureBlock: updateDynamicRules failed', e);
    return { count: 0 };
  }
}
