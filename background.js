import { initPrivacy } from "./stealth.js";

const api = typeof browser !== "undefined" ? browser : chrome;
const UA_RULE_ID = 100001;
const DEFAULT_ENABLED = true;

const UA_PROFILES = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "chrome-mobile": "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  "firefox-mobile": "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
  "safari-mobile": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
};

function getRandomUA() {
  const keys = Object.keys(UA_PROFILES);
  return UA_PROFILES[keys[Math.floor(Math.random() * keys.length)]];
}

async function ensureInitialState() {
  const stored = await api.storage.local.get(["enabled", "blocked", "saved", "selectedUA", "alertsEnabled", "stealthStrong", "targetQuality", "premium1080"]);

  if (typeof stored.enabled === "undefined") {
    await api.storage.local.set({
      enabled: DEFAULT_ENABLED,
      blocked: 0,
      saved: 0,
      alertsEnabled: true,
      selectedUA: "random",
      stealthStrong: false,
      targetQuality: "auto",
      premium1080: true
    });
  }

  await syncEnabledRuleset(stored.enabled ?? DEFAULT_ENABLED);
  await applyUARule(stored.selectedUA || "random");
  await initPrivacy();
  // Init minimal uBlock-style filters
  try {
    const { loadBundledFilters, applyDynamicFiltersFromText } = await import('./ublock_engine.js');
    const text = await loadBundledFilters('filters/base.txt');
    if (text && (stored.enabled ?? DEFAULT_ENABLED)) {
      await applyDynamicFiltersFromText(text);
    }
  } catch (e) {
    console.warn('PureBlock: uBlock engine init failed', e);
  }
}

async function syncEnabledRuleset(enabled) {
  try {
    await api.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? [
        "yt-static-rules",
        "global-ads-rules",
        "param-scrubber-rules"
      ] : [],
      disableRulesetIds: enabled ? [] : [
        "yt-static-rules",
        "global-ads-rules",
        "param-scrubber-rules"
      ]
    });
  } catch (e) {
    console.warn("PureBlock: sync ruleset échec", e);
  }
}

async function applyUARule(mode) {
  if (!api.declarativeNetRequest?.updateDynamicRules) return;

  const ua = mode === "random" ? getRandomUA() : (UA_PROFILES[mode] || getRandomUA());
  const removeRuleIds = [UA_RULE_ID];
  const addRules = [{
    id: UA_RULE_ID,
    priority: 10,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "User-Agent", operation: "set", value: ua }]
    },
    condition: {
      urlFilter: "||youtube.com",
      resourceTypes: ["main_frame", "sub_frame"]
    }
  }];

  try {
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.warn("PureBlock: UA rule non appliquée", e);
  }
}

if (api.declarativeNetRequest?.onRuleMatchedDebug) {
  const tabCounters = new Map(); // tabId -> { count, windowStart }
  const STRICT_THRESHOLD = 12;    // nombre d'événements règles dans la fenêtre
  const WINDOW_MS = 30000;        // fenêtre glissante pour densité pub

  async function applyStrictSessionRules(tabId, enable) {
    try {
      const strictRules = enable ? [
        {
          id: 500001,
          priority: 2,
          action: { type: "block" },
          condition: { urlFilter: "*://*/*ad*", resourceTypes: ["script","xmlhttprequest","image","media"] }
        },
        {
          id: 500002,
          priority: 2,
          action: { type: "block" },
          condition: { urlFilter: "*://*/*advert*", resourceTypes: ["script","xmlhttprequest","image","media"] }
        },
        {
          id: 500003,
          priority: 2,
          action: { type: "block" },
          condition: { urlFilter: "*://*/*sponsor*", resourceTypes: ["script","xmlhttprequest","image","media"] }
        }
      ] : [];
      await api.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [500001,500002,500003],
        addRules: strictRules
      }, { tabId });
    } catch (e) {
      console.warn("PureBlock: échec session strict rules", e);
    }
  }

  api.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    try {
      const delta = 25 * 1024;
      const data = await api.storage.local.get(["blocked", "saved"]);
      await api.storage.local.set({
        blocked: (data.blocked || 0) + 1,
        saved: (data.saved || 0) + delta
      });

      // Profil par site auto‑adaptatif: bascule "strict" par onglet si densité élevée
      const tabId = info?.request?.tabId;
      if (typeof tabId === 'number' && tabId >= 0) {
        const now = Date.now();
        const state = tabCounters.get(tabId) || { count: 0, windowStart: now, strict: false };
        // reset fenêtre si expirée
        if (now - state.windowStart > WINDOW_MS) {
          state.windowStart = now;
          state.count = 0;
        }
        state.count += 1;

        // Active strict si seuil atteint et pas déjà actif
        if (!state.strict && state.count >= STRICT_THRESHOLD) {
          await applyStrictSessionRules(tabId, true);
          state.strict = true;
          // Planifie une désactivation douce après la fenêtre suivante si activité baisse
          setTimeout(async () => {
            try {
              const s = tabCounters.get(tabId);
              if (!s) return;
              // si pas de nouvelle explosion, relâche
              if (Date.now() - s.windowStart > WINDOW_MS && s.count < STRICT_THRESHOLD / 2) {
                await applyStrictSessionRules(tabId, false);
                s.strict = false;
              }
            } catch {}
          }, WINDOW_MS + 5000);
        }

        tabCounters.set(tabId, state);
      }
    } catch {}
  });
}

// Enregistre dynamiquement un script de contenu pour Anti Cookie‑Wall / Overlay News
(async function registerCookieWallContentScript() {
  try {
    const scripting = chrome.scripting;
    if (!scripting?.registerContentScripts) return;
    const id = "cookiewall";
    let existing = [];
    try {
      existing = await scripting.getRegisteredContentScripts({ ids: [id] });
    } catch {}
    if (!existing || existing.length === 0) {
      await scripting.registerContentScripts([
        {
          id,
          js: ["stealth_cookiewall.js"],
          matches: ["<all_urls>"],
          runAt: "document_start"
        }
      ]);
    }
  } catch (e) {
    console.warn("PureBlock: échec enregistrement content script cookiewall", e);
  }
})();

// Désactive réellement le blocage réseau sur les onglets en pause via une règle session allowAllRequests
const ALLOW_ALL_SESSION_ID = 500010;
async function applyPauseAllowAllForTab(tabId, enable) {
  try {
    const addRules = enable ? [{
      id: ALLOW_ALL_SESSION_ID,
      priority: 1000,
      action: { type: "allowAllRequests" },
      condition: { resourceTypes: ["main_frame","sub_frame","script","xmlhttprequest","image","media","stylesheet","font"] }
    }] : [];
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ALLOW_ALL_SESSION_ID],
      addRules
    }, { tabId });
  } catch (e) {
    console.warn("PureBlock: échec allowAllRequests session pause", e);
  }
}

// Sur changement de pausedHosts, applique/désactive allowAllRequests par onglet correspondant
if (api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener(async (changes) => {
    try {
      if (changes.pausedHosts) {
        const list = changes.pausedHosts.newValue || [];
        const tabs = await api.tabs.query({});
        for (const t of tabs) {
          if (!t?.url || typeof t.id !== 'number') continue;
          let host = null;
          try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch {}
          const shouldPause = Array.isArray(list) && !!host && list.includes(host);
          await applyPauseAllowAllForTab(t.id, shouldPause);
        }
      }
      if (changes.enabled && changes.enabled.newValue === false) {
        // OFF global: retirer aussi rules strict session éventuelles
        try {
          const tabs = await api.tabs.query({});
          for (const t of tabs) {
            if (typeof t.id !== 'number') continue;
            await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [500001,500002,500003, ALLOW_ALL_SESSION_ID], addRules: [] }, { tabId: t.id });
          }
        } catch {}
      }
    } catch (e) {
      console.warn("PureBlock: storage.onChanged handler error", e);
    }
  });
}

api.runtime.onInstalled.addListener(ensureInitialState);
api.runtime.onStartup.addListener(ensureInitialState);

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.action === "toggle") {
      await api.storage.local.set({ enabled: msg.enabled });
      await syncEnabledRuleset(msg.enabled);
      sendResponse({ ok: true });
    }

    if (msg.action === "updateUA") {
      await api.storage.local.set({ selectedUA: msg.selectedUA });
      await applyUARule(msg.selectedUA);
      sendResponse({ ok: true });
    }

    if (msg.action === "incrementStats") {
      const data = await api.storage.local.get(["blocked", "saved"]);
      await api.storage.local.set({
        blocked: (data.blocked || 0) + (msg.count || 1),
        saved: (data.saved || 0) + (msg.bytes || 25 * 1024)
      });
      sendResponse({ ok: true });
    }
  })();
  return true;
});

// Rafraîchit les règles de confidentialité quand le réglage Stealth change
api.runtime.onMessage.addListener((msg) => {
  (async () => {
    if (msg.action === "updateStealth") {
      await initPrivacy();
    }
  })();
});

// === AJOUT DANS background.js ===
async function shouldBlockOnTab(tabId) {
  const tab = await api.tabs.get(tabId);
  if (!tab?.url) return true;

  const url = new URL(tab.url);
  const domain = url.hostname.replace(/^www\./, '');
  const { pausedSites = {} } = await api.storage.local.get('pausedSites');
  
  return !pausedSites[domain];
}

// Remplace syncEnabledRuleset pour vérifier par onglet
async function syncEnabledRulesetForTab(tabId, enabled) {
  const shouldBlock = await shouldBlockOnTab(tabId);
  if (!shouldBlock) {
    // Désactive les règles pour ce tab
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: []
    }, { tabId });
    return;
  }

  // Sinon, applique normalement
  await syncEnabledRuleset(enabled);
}
