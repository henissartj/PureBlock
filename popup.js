// PureBlock popup logic
const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
// Détection prudente pour l'environnement extension
const hasApi = !!(api && api.storage && api.runtime);

let blockedCount = 0;
let savedData = 0;
let currentHost = null;
let pausedHosts = [];

function updateStats() {
  document.getElementById('blocked-count').textContent = blockedCount;
  document.getElementById('saved-data').textContent = Math.round(savedData / 1024);
}

function updateTheme(enabled) {
  document.body.classList.toggle('off', !enabled);
}

function updatePauseButton() {
  const btn = document.getElementById('pause-site-btn');
  const text = document.getElementById('pause-btn-text');
  if (!currentHost) {
    btn.disabled = true;
    btn.classList.add('paused');
    text.textContent = "Onglet inconnu";
    return;
  }
  const isPaused = pausedHosts.includes(currentHost);
  btn.disabled = false;
  btn.classList.toggle('paused', isPaused);
  text.textContent = isPaused ? "Reprendre sur ce site" : "Pause sur ce site";
}

// Load initial state
if (hasApi) {
  try {
    api.storage?.local?.get(
    [
      'enabled',
      'blocked',
      'saved',
      'alertsEnabled',
      'selectedUA',
      'premium1080',
      'pausedHosts'
    ],
    (data) => {
      const isEnabled = data.enabled !== false;
      document.getElementById('checkbox').checked = isEnabled;
      updateTheme(isEnabled);

      blockedCount = data.blocked || 0;
      savedData = data.saved || 0;
      updateStats();

      const ua = data.selectedUA || 'random';
      const uaSelect = document.getElementById('ua-select');
      if (uaSelect) uaSelect.value = ua;

      document.getElementById('alert-checkbox').checked =
        data.alertsEnabled !== false;

      document.getElementById('premium-toggle').checked =
        data.premium1080 === true;

      pausedHosts = Array.isArray(data.pausedHosts) ? data.pausedHosts : [];

      // Get current tab host for pause button
      api.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          try {
            const url = new URL(tabs[0].url);
            currentHost = url.hostname;
          } catch (e) {
            currentHost = null;
          }
        }
        updatePauseButton();
      });
    }
  );
  } catch (e) {
    // Fallback preview si une API manquante provoque une erreur
    document.getElementById('checkbox').checked = true;
    updateTheme(true);
    blockedCount = 0;
    savedData = 0;
    updateStats();
    const uaSelect = document.getElementById('ua-select');
    if (uaSelect) uaSelect.value = 'random';
    const alertEl = document.getElementById('alert-checkbox');
    if (alertEl) alertEl.checked = true;
    const premiumEl = document.getElementById('premium-toggle');
    if (premiumEl) premiumEl.checked = true;
    updatePauseButton();
  }
} else {
  // Preview fallback (hors contexte extension): valeurs sobres par défaut
  document.getElementById('checkbox').checked = true;
  updateTheme(true);
  blockedCount = 0;
  savedData = 0;
  updateStats();
  const uaSelect = document.getElementById('ua-select');
  if (uaSelect) uaSelect.value = 'random';
  const alertEl = document.getElementById('alert-checkbox');
  if (alertEl) alertEl.checked = true;
  const premiumEl = document.getElementById('premium-toggle');
  if (premiumEl) premiumEl.checked = true;
  updatePauseButton();
}

// Listen for stats updates
if (hasApi && api.storage?.onChanged?.addListener) {
  api.storage.onChanged.addListener((changes) => {
    if (changes.blocked) {
      blockedCount = changes.blocked.newValue || 0;
    }
    if (changes.saved) {
      savedData = changes.saved.newValue || 0;
    }
    if (changes.pausedHosts) {
      pausedHosts = changes.pausedHosts.newValue || [];
      updatePauseButton();
    }
    updateStats();
  });
}

// Global enable/disable
document.getElementById('checkbox').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  if (hasApi) {
    api.storage?.local?.set?.({ enabled });
    api.runtime?.sendMessage?.({ action: 'toggle', enabled });
  }
  updateTheme(enabled);
});

// UA selection
document.getElementById('ua-select').addEventListener('change', (e) => {
  const selectedUA = e.target.value;
  if (hasApi) {
    api.storage?.local?.set?.({ selectedUA });
    api.runtime?.sendMessage?.({ action: 'updateUA', selectedUA });
  }
});

// Alert anti-adblock
document.getElementById('alert-checkbox').addEventListener('change', (e) => {
  const alertsEnabled = e.target.checked;
  if (hasApi) api.storage?.local?.set?.({ alertsEnabled });
});

// Premium / 1080p-ish helper
document.getElementById('premium-toggle').addEventListener('change', (e) => {
  const premium1080 = e.target.checked;
  if (hasApi) {
    api.storage?.local?.set?.({ premium1080 });
    api.runtime?.sendMessage?.({ action: 'updatePremium', premium1080 });
  }
});

// Pause on this site
document.getElementById('pause-site-btn').addEventListener('click', () => {
  if (!currentHost) return;
  const idx = pausedHosts.indexOf(currentHost);
  if (idx === -1) {
    pausedHosts.push(currentHost);
  } else {
    pausedHosts.splice(idx, 1);
  }
  if (hasApi) api.storage?.local?.set?.({ pausedHosts });
  updatePauseButton();
});

// Refresh current tab
document.getElementById('refresh-btn').addEventListener('click', () => {
  if (!hasApi) return;
  api.tabs?.query?.({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id) {
      api.tabs?.reload?.(tabs[0].id);
    }
  });
});

// Open Options page
document.getElementById('options-btn').addEventListener('click', () => {
  if (!hasApi) return;
  if (api.runtime?.openOptionsPage) {
    api.runtime.openOptionsPage();
  } else {
    api.tabs?.create?.({ url: 'options.html' });
  }
});
