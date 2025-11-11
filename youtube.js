const api = typeof browser !== "undefined" ? browser : chrome;

let enabled = true;
let alertsEnabled = true;
let observer = null;
let idleScheduled = false;
let sleeping = false;
let lastAdTs = Date.now();

const SLEEP_AFTER_MS = 3 * 60 * 1000;

api.storage.local.get(["enabled", "alertsEnabled"], (data) => {
  enabled = data.enabled !== false;
  alertsEnabled = data.alertsEnabled !== false;
  if (enabled) bootstrap();
});

api.storage.onChanged.addListener((changes) => {
  if ("enabled" in changes) {
    enabled = changes.enabled.newValue;
    enabled ? wake() : sleep();
  }
  if ("alertsEnabled" in changes) alertsEnabled = changes.alertsEnabled.newValue;
});

function bootstrap() {
  initPreloadGuard();
  observeAds();
  safeClean();
  hookNavigationWake();
}

function observeAds() {
  if (observer || !enabled) return;
  observer = new MutationObserver(() => {
    if (!enabled || sleeping || idleScheduled) return;
    idleScheduled = true;
    const cb = () => {
      idleScheduled = false;
      if (enabled && !sleeping) safeClean();
    };
    if ("requestIdleCallback" in window) requestIdleCallback(cb, { timeout: 120 });
    else setTimeout(cb, 80);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function sleep() {
  sleeping = true;
  stopObserver();
}

function wake() {
  if (!enabled || !sleeping) return;
  sleeping = false;
  lastAdTs = Date.now();
  observeAds();
  safeClean();
}

function hookNavigationWake() {
  window.addEventListener("yt-navigate-finish", wake, { passive: true });

  let lastUrl = location.href;
  const onUrlChange = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      wake();
    }
  };

  const wrapHistory = (fnName) => {
    const orig = history[fnName];
    history[fnName] = function (...args) {
      const res = orig.apply(this, args);
      onUrlChange();
      return res;
    };
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");

  window.addEventListener("popstate", onUrlChange, { passive: true });
}

function initPreloadGuard() {
  try {
    const head = document.head || document.documentElement;
    if (!head) return;
    const origAppend = head.appendChild;
    head.appendChild = function (node) {
      try {
        if (
          node?.tagName === "LINK" &&
          /^(preload|prefetch)$/i.test(node.rel) &&
          /pagead|doubleclick|googlesyndication|adservice/i.test(node.href)
        ) return node;
      } catch {}
      return origAppend.call(this, node);
    };
  } catch {}
}

function safeClean() {
  try {
    hideStaticAds();
    handlePlayerAds();
    maybeSleep();
  } catch {}
}

function hideStaticAds() {
  const selectors = [
    "#masthead-ad",
    "ytd-banner-promo-renderer",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    ".ytd-promoted-video-renderer",
    ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay",
    "#player-ads",
    ".ytp-ad-module",
    "ytd-companion-slot-renderer",
    'ytd-engagement-panel-section-list-renderer[target-id*="engagement-panel-ads"]'
  ];
  let removed = 0;
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.dataset.pureblockHidden) {
        el.style.display = "none";
        el.style.visibility = "hidden";
        el.dataset.pureblockHidden = "1";
        removed++;
      }
    });
  }
  if (removed > 0) reportBlocked(removed, removed * 10 * 1024);
}

function handlePlayerAds() {
  const player = document.querySelector(".html5-video-player");
  const video = document.querySelector("video.html5-main-video");
  if (!video || !player) return;

  const isAd =
    player.classList.contains("ad-showing") ||
    player.classList.contains("ad-interrupting") ||
    document.querySelector(".ytp-ad-player-overlay") ||
    document.querySelector(".ytp-ad-module");

  if (!isAd) return;

  const skipBtn =
    document.querySelector(".ytp-ad-skip-button") ||
    document.querySelector(".ytp-ad-skip-button-modern");

  if (skipBtn) {
    skipBtn.click();
    lastAdTs = Date.now();
    reportBlocked(1, Math.floor(video.duration || 5) * 50 * 1024);
    return;
  }

  try {
    const remaining = video.duration - video.currentTime;
    if (remaining > 5 && remaining < 15) {
      video.currentTime += 2;
      lastAdTs = Date.now();
      reportBlocked(1, 50 * 1024);
    }
  } catch {}
}

function maybeSleep() {
  if (!sleeping && Date.now() - lastAdTs > SLEEP_AFTER_MS) sleep();
}

function reportBlocked(count, bytes) {
  api.runtime.sendMessage({ action: "incrementStats", count, bytes }, () => {});
}
