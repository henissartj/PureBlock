const api = typeof browser !== "undefined" ? browser : chrome;

let enabled = true;
let alertsEnabled = true;
let observer = null;
let playerObserver = null;
let idleScheduled = false;
let sleeping = false;
let lastAdTs = Date.now();

const SLEEP_AFTER_MS = 3 * 60 * 1000; // 3 minutes d'inactivité pub

// Chargement initial des paramètres
api.storage.local.get(["enabled", "alertsEnabled"], (data) => {
  enabled = data.enabled !== false;
  alertsEnabled = data.alertsEnabled !== false;

  if (enabled) {
    bootstrap();
  } else {
    sleeping = true;
  }
});

// Réagit aux changements de storage (popup / options)
api.storage.onChanged.addListener((changes) => {
  if ("enabled" in changes) {
    const newVal = changes.enabled.newValue !== false;
    enabled = newVal;

    if (!newVal) {
      // Désactivation → on se met en sommeil proprement
      sleep();
    } else {
      // Activation → si jamais lancé, on réveille, sinon on bootstrap
      sleeping = false;
      if (!observer) {
        bootstrap();
      } else {
        wake(true);
      }
    }
  }

  if ("alertsEnabled" in changes) {
    alertsEnabled = changes.alertsEnabled.newValue !== false;
  }
});

function bootstrap() {
  if (!enabled) return;
  initPreloadGuard();
  observeAds();
  attachPlayerObserver();
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
      if (enabled && !sleeping) {
        safeClean();
      }
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(cb, { timeout: 120 });
    } else {
      setTimeout(cb, 80);
    }

    // Observer ciblé sur le player pour changements de classe (ad-showing)
    attachPlayerObserver();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false
  });

  // Réduire la portée réelle d'observation aux conteneurs clés
  try {
    const roots = getRoots();
    for (const root of roots) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: false
      });
    }
  } catch (e) {}
}

function stopObserver() {
  if (observer) {
    try {
      observer.disconnect();
    } catch (e) {}
    observer = null;
  }
  if (playerObserver) {
    try {
      playerObserver.disconnect();
    } catch (e) {}
    playerObserver = null;
  }
}

function sleep() {
  sleeping = true;
  stopObserver();
}

function wake(fromNav = false) {
  if (!enabled) return;

  if (sleeping || fromNav || !observer) {
    sleeping = false;
    lastAdTs = Date.now();
    observeAds();
    attachPlayerObserver();
    safeClean();
  }
}

function hookNavigationWake() {
  // Evénement interne YouTube SPA
  window.addEventListener("yt-navigate-finish", () => wake(true), {
    passive: true
  });

  // Fallback: interception des changements d'URL SPA
  let lastUrl = location.href;

  const onUrlChange = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      wake(true);
    }
  };

  const wrapHistory = (fnName) => {
    try {
      const orig = history[fnName];
      if (typeof orig !== "function") return;
      history[fnName] = function (...args) {
        const res = orig.apply(this, args);
        try {
          onUrlChange();
        } catch (e) {}
        return res;
      };
    } catch (e) {}
  };

  wrapHistory("pushState");
  wrapHistory("replaceState");

  window.addEventListener("popstate", () => {
    try {
      onUrlChange();
    } catch (e) {}
  }, { passive: true });
}

function getRoots() {
  const roots = [];
  const push = (sel) => {
    const el = document.querySelector(sel);
    if (el) roots.push(el);
  };
  push("ytd-app");
  push("ytd-watch-flexy");
  push("#content");
  push("#primary");
  push(".html5-video-player");
  return roots;
}

function attachPlayerObserver() {
  try {
    if (playerObserver) return;
    const player = document.querySelector(".html5-video-player");
    if (!player) return;

    playerObserver = new MutationObserver(() => {
      if (!enabled || sleeping || idleScheduled) return;
      idleScheduled = true;
      const cb = () => {
        idleScheduled = false;
        if (enabled && !sleeping) safeClean();
      };
      if ("requestIdleCallback" in window) {
        requestIdleCallback(cb, { timeout: 120 });
      } else {
        setTimeout(cb, 80);
      }
    });

    playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ["class"]
    });
  } catch (e) {}
}

function initPreloadGuard() {
  try {
    const head = document.head || document.documentElement;
    if (!head) return;

    const origAppend = head.appendChild;
    if (head._pureblockGuardPatched) return;
    head._pureblockGuardPatched = true;

    head.appendChild = function (node) {
      try {
        if (
          node?.tagName === "LINK" &&
          /^(preload|prefetch)$/i.test(node.rel || "") &&
          /pagead|doubleclick|googlesyndication|adservice/i.test(node.href || "")
        ) {
          // On bloque silencieusement ces préloads publicitaires
          return node;
        }
      } catch (e) {}
      return origAppend.call(this, node);
    };
  } catch (e) {}
}

function safeClean() {
  try {
    hideStaticAds();
    handlePlayerAds();
    maybeSleep();
  } catch (e) {
    // On reste silencieux pour ne pas spammer la console utilisateur
  }
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
    const nodes = document.querySelectorAll(sel);
    if (!nodes.length) continue;

    nodes.forEach((el) => {
      if (!el.dataset.pureblockHidden) {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.dataset.pureblockHidden = "1";
        removed++;
      }
    });
  }

  if (removed > 0) {
    // estimation ultra-simple: 10KB par bloc supprimé
    reportBlocked(removed, removed * 10 * 1024);
  }
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
    // estimation : durée vidéo * 50KB "économisés"
    const est = Math.floor(video.duration || 5) * 50 * 1024;
    reportBlocked(1, est);
    return;
  }

  // Si pas de bouton skip, on réduit un peu la douleur en avançant légèrement
  try {
    const remaining = (video.duration || 0) - (video.currentTime || 0);
    if (remaining > 5 && remaining < 15) {
      video.currentTime = Math.min(
        video.duration || video.currentTime + 2,
        (video.currentTime || 0) + 2
      );
      lastAdTs = Date.now();
      reportBlocked(1, 50 * 1024);
    }
  } catch (e) {}
}

function maybeSleep() {
  if (!sleeping && Date.now() - lastAdTs > SLEEP_AFTER_MS) {
    sleep();
  }
}

// Aligne avec background.js : { action: "incrementStats", blocked, bytes }
function reportBlocked(count, bytes) {
  if (!count && !bytes) return;
  try {
    api.runtime.sendMessage(
      {
        action: "incrementStats",
        blocked: count || 0,
        bytes: bytes || 0
      },
      () => {}
    );
  } catch (e) {}
}