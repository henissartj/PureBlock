// PureBlock popup logic
// Compatible Chrome / Firefox via api shim

const api = typeof browser !== 'undefined' ? browser : chrome;

let blockedCount = 0;
let savedData = 0;

function updateStats() {
  document.getElementById('blocked-count').textContent = blockedCount;
  document.getElementById('saved-data').textContent = Math.round(savedData / 1024);
}

function updateTheme(enabled) {
  document.body.classList.toggle('off', !enabled);
}

api.storage.local.get(['enabled', 'blocked', 'saved', 'alertsEnabled', 'selectedUA'], (data) => {
  const isEnabled = data.enabled !== false;
  document.getElementById('checkbox').checked = isEnabled;
  document.getElementById('ua-select').value = data.selectedUA || 'random';
  document.getElementById('alert-checkbox').checked = data.alertsEnabled !== false;

  blockedCount = data.blocked || 0;
  savedData = data.saved || 0;

  updateStats();
  updateTheme(isEnabled);
});

api.storage.onChanged.addListener((changes) => {
  if (changes.blocked) blockedCount = changes.blocked.newValue;
  if (changes.saved) savedData = changes.saved.newValue;
  updateStats();
});

document.getElementById('checkbox').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  api.storage.local.set({ enabled });
  api.runtime.sendMessage({ action: 'toggle', enabled });
  updateTheme(enabled);
});

document.getElementById('ua-select').addEventListener('change', (e) => {
  const selectedUA = e.target.value;
  api.storage.local.set({ selectedUA });
  api.runtime.sendMessage({ action: 'updateUA', selectedUA });
});

document.getElementById('alert-checkbox').addEventListener('change', (e) => {
  const alertsEnabled = e.target.checked;
  api.storage.local.set({ alertsEnabled });
});
