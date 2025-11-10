// background.js (service worker, MV3) - Version optimisée
// Gère : activation/désactivation, règles DNR, user-agent et statistiques locales

const api = typeof browser !== 'undefined' ? browser : chrome;

const UA_RULE_ID = 100001;
const DEFAULT_ENABLED = true;

const UA_PROFILES = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'chrome-mobile': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'firefox-mobile': 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
  'safari-mobile': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

// Utilitaire : UA aléatoire
function getRandomUA() {
  const keys = Object.keys(UA_PROFILES);
  return UA_PROFILES[keys[Math.floor(Math.random() * keys.length)]];
}

// Assure un état initial propre au démarrage
async function ensureInitialState() {
  const stored = await api.storage.local.get(['enabled', 'blocked', 'saved', 'selectedUA', 'alertsEnabled']);

  if (typeof stored.enabled === 'undefined') {
    await api.storage.local.set({
      enabled: DEFAULT_ENABLED,
      blocked: 0,
      saved: 0,
      alertsEnabled: true,
      selectedUA: 'random'
    });
  }

  await syncEnabledRuleset(stored.enabled ?? DEFAULT_ENABLED);
  await applyUARule(stored.selectedUA || 'random');
}

// Active ou désactive le ruleset statique
async function syncEnabledRuleset(enabled) {
  try {
    await api.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ['yt-static-rules'] : [],
      disableRulesetIds: enabled ? [] : ['yt-static-rules']
    });
  } catch (e) {
    console.warn('PureBlock: Erreur lors de la mise à jour du ruleset', e);
  }
}

// Applique une règle dynamique User-Agent pour YouTube
async function applyUARule(mode) {
  if (!api.declarativeNetRequest?.updateDynamicRules) return;

  const ua = mode === 'random' ? getRandomUA() : UA_PROFILES[mode] || getRandomUA();

  const removeRuleIds = [UA_RULE_ID];
  const addRules = [{
    id: UA_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'User-Agent',
        operation: 'set',
        value: ua
      }]
    },
    condition: {
      urlFilter: '||youtube.com',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media']
    }
  }];

  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (e) {
    console.warn('PureBlock: UA rule non appliquée (permissions ou contexte MV3 limités)', e);
  }
}

// Suivi des requêtes bloquées : stats locales
if (api.declarativeNetRequest?.onRuleMatchedDebug) {
  api.declarativeNetRequest.onRuleMatchedDebug.addListener(async () => {
    try {
      const delta = 25 * 1024;
      const stats = await api.storage.local.get(['blocked', 'saved']);
      await api.storage.local.set({
        blocked: (stats.blocked || 0) + 1,
        saved: (stats.saved || 0) + delta
      });
    } catch (e) {
      console.warn('PureBlock: Erreur mise à jour stats', e);
    }
  });
}

// Initialisation extension
api.runtime.onInstalled.addListener(ensureInitialState);
api.runtime.onStartup.addListener(ensureInitialState);

// Communication avec popup et content scripts
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case 'toggle': {
        await api.storage.local.set({ enabled: msg.enabled });
        await syncEnabledRuleset(msg.enabled);
        sendResponse({ ok: true });
        break;
      }
      case 'updateUA': {
        await api.storage.local.set({ selectedUA: msg.selectedUA });
        await applyUARule(msg.selectedUA);
        sendResponse({ ok: true });
        break;
      }
      case 'incrementStats': {
        const current = await api.storage.local.get(['blocked', 'saved']);
        await api.storage.local.set({
          blocked: (current.blocked || 0) + (msg.count || 1),
          saved: (current.saved || 0) + (msg.bytes || 25 * 1024)
        });
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();

  return true; // Garde le canal ouvert
});
