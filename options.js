const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
const hasApi = !!(api && api.storage && api.storage.local);

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
  const qualitySelectEl = document.getElementById('quality-select');
  const stealthToggleEl = document.getElementById('stealth-strong-toggle');

  if (!hasApi) {
    // Mode aperçu hors contexte extension: valeurs par défaut, pas de persistance
    const pf = document.getElementById('purefocus-toggle');
    const sp = document.getElementById('sponsor-toggle');
    const dbg = document.getElementById('debug-toggle');
    if (pf) pf.checked = false;
    if (sp) sp.checked = false;
    if (dbg) dbg.checked = false;
    if (qualitySelectEl) qualitySelectEl.value = 'auto';
    if (stealthToggleEl) stealthToggleEl.checked = false;

    // N'attache que des listeners UI no-op
    document.getElementById('purefocus-toggle')?.addEventListener('change', () => {});
    document.getElementById('sponsor-toggle')?.addEventListener('change', () => {});
    document.getElementById('debug-toggle')?.addEventListener('change', () => {});
    qualitySelectEl?.addEventListener('change', () => {});
    stealthToggleEl?.addEventListener('change', () => {});

    // Listes locales vides en aperçu
    renderChannels();
    renderPausedHosts();
    document.getElementById('add-channel-btn')?.addEventListener('click', () => {});
    document.getElementById('channel-input')?.addEventListener('keydown', () => {});
    document.getElementById('reset-stats-btn')?.addEventListener('click', () => {});
    return;
  }

  api.storage.local.get(
    [
      'pureFocus',
      'sponsorSkip',
      'debugOverlay',
      'allowedChannels',
      'pausedHosts',
      'blocked',
      'saved',
      'targetQuality',
      'stealthStrong',
      'premium1080',
      'bitrateBoost',
      'preferHDR',
      'youtubeCodecPref'
    ],
    (data) => {
      document.getElementById('purefocus-toggle').checked =
        data.pureFocus === true;
      document.getElementById('sponsor-toggle').checked =
        data.sponsorSkip === true;
      document.getElementById('debug-toggle').checked =
        data.debugOverlay === true;

      if (qualitySelectEl) {
        qualitySelectEl.value = data.targetQuality || 'auto';
      }

      if (stealthToggleEl) {
        stealthToggleEl.checked = data.stealthStrong === true;
      }

      const bitrateBoostEl = document.getElementById('bitrate-boost-toggle');
      if (bitrateBoostEl) {
        bitrateBoostEl.checked = data.bitrateBoost === true;
      }

      const hdrToggleEl = document.getElementById('hdr-toggle');
      if (hdrToggleEl) {
        hdrToggleEl.checked = data.preferHDR === true;
      }

      const codecSelectEl = document.getElementById('codec-select');
      if (codecSelectEl) {
        codecSelectEl.value = data.youtubeCodecPref || 'auto';
      }

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

  if (qualitySelectEl) {
    qualitySelectEl.addEventListener('change', (e) => {
      const val = e.target.value;
      api.storage.local.set({ targetQuality: val });
      api.storage.local.set({ premium1080: val !== 'off' });
    });
  }

  if (stealthToggleEl) {
    stealthToggleEl.addEventListener('change', (e) => {
      api.storage.local.set({ stealthStrong: e.target.checked }, () => {
        api.runtime.sendMessage({ action: 'updateStealth' });
      });
    });
  }

  const bitrateBoostEl = document.getElementById('bitrate-boost-toggle');
  bitrateBoostEl?.addEventListener('change', (e) => {
    api.storage.local.set({ bitrateBoost: e.target.checked });
  });

  const hdrToggleEl = document.getElementById('hdr-toggle');
  hdrToggleEl?.addEventListener('change', (e) => {
    api.storage.local.set({ preferHDR: e.target.checked });
  });

  const codecSelectEl = document.getElementById('codec-select');
  codecSelectEl?.addEventListener('change', (e) => {
    const val = e.target.value || 'auto';
    api.storage.local.set({ youtubeCodecPref: val });
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
