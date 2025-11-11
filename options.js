const api = typeof browser !== 'undefined' ? browser : chrome;

let allowedChannels = [];
let pausedHosts = [];

function normalizeChannelIdOrUrl(input) {
  input = input.trim();
  if (!input) return null;

  // URL -> extrait le handle ou l'id basique
  try {
    if (input.startsWith('http')) {
      const url = new URL(input);
      if (url.hostname.includes('youtube.com')) {
        if (url.pathname.startsWith('/channel/')) {
          return url.pathname.replace('/channel/', '').split('/')[0];
        }
        if (url.pathname.startsWith('/@')) {
          return url.pathname.split('/')[0]; // handle complet
        }
      }
    }
  } catch (_) { /* ignore */ }

  return input;
}

function renderChannels() {
  const list = document.getElementById('channels-list');
  list.innerHTML = '';
  allowedChannels.forEach((ch, index) => {
    const li = document.createElement('li');
    li.textContent = ch;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      allowedChannels.splice(index, 1);
      api.storage.local.set({ allowedChannels });
      renderChannels();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderPausedHosts() {
  const list = document.getElementById('paused-hosts-list');
  list.innerHTML = '';
  pausedHosts.forEach((host, index) => {
    const li = document.createElement('li');
    li.textContent = host;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      pausedHosts.splice(index, 1);
      api.storage.local.set({ pausedHosts });
      renderPausedHosts();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function init() {
  api.storage.local.get(
    [
      'pureFocus',
      'sponsorSkip',
      'debugOverlay',
      'allowedChannels',
      'pausedHosts',
      'blocked',
      'saved'
    ],
    (data) => {
      document.getElementById('purefocus-toggle').checked =
        data.pureFocus === true;
      document.getElementById('sponsor-toggle').checked =
        data.sponsorSkip === true;
      document.getElementById('debug-toggle').checked =
        data.debugOverlay === true;

      allowedChannels = Array.isArray(data.allowedChannels)
        ? data.allowedChannels
        : [];
      pausedHosts = Array.isArray(data.pausedHosts)
        ? data.pausedHosts
        : [];

      renderChannels();
      renderPausedHosts();
    }
  );

  // Toggles
  document.getElementById('purefocus-toggle').addEventListener('change', (e) => {
    api.storage.local.set({ pureFocus: e.target.checked });
  });

  document.getElementById('sponsor-toggle').addEventListener('change', (e) => {
    api.storage.local.set({ sponsorSkip: e.target.checked });
  });

  document.getElementById('debug-toggle').addEventListener('change', (e) => {
    api.storage.local.set({ debugOverlay: e.target.checked });
  });

  // Add channel
  document.getElementById('add-channel-btn').addEventListener('click', () => {
    const input = document.getElementById('channel-input');
    const value = normalizeChannelIdOrUrl(input.value);
    if (!value) return;
    if (!allowedChannels.includes(value)) {
      allowedChannels.push(value);
      api.storage.local.set({ allowedChannels });
      renderChannels();
    }
    input.value = '';
  });

  document
    .getElementById('channel-input')
    .addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('add-channel-btn').click();
      }
    });

  // Reset stats
  document.getElementById('reset-stats-btn').addEventListener('click', () => {
    api.storage.local.set({ blocked: 0, saved: 0 }, () => {
      // Pas de toast lourd, l'info est simple.
    });
  });
}

document.addEventListener('DOMContentLoaded', init);