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
}

async function syncEnabledRuleset(enabled) {
  try {
    await api.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ["yt-static-rules"] : [],
      disableRulesetIds: enabled ? [] : ["yt-static-rules"]
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
  api.declarativeNetRequest.onRuleMatchedDebug.addListener(async () => {
    try {
      const delta = 25 * 1024;
      const data = await api.storage.local.get(["blocked", "saved"]);
      await api.storage.local.set({
        blocked: (data.blocked || 0) + 1,
        saved: (data.saved || 0) + delta
      });
    } catch {}
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
