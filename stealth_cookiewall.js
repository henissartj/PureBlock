// PureBlock – Anti Cookie‑Wall / Overlay News
(() => {
  try {
    const SELECTORS = [
      // CMPs courants
      "#sp_message_container", ".sp-message", "#qc-cmp2-container", ".qc-cmp2-container",
      "#onetrust-consent-sdk", "#onetrust-banner-sdk", ".ot-sdk-container", ".optanon-modal",
      ".osano-cm-dialog", ".osano-cm-widget", ".didomi-popup", ".didomi-consent-popup",
      ".fc-consent-root", ".fc-ab-root", "#consent", ".consent-modal", ".gdpr-consent",
      ".cc-window", ".eu-cookie-compliance", ".cookie-consent", ".cookiebanner", ".truste-cookie",
      // News overlays / Paywalls
      ".tp-iframe-wrapper", ".tp-modal", ".paywall", ".meteredContent", ".premium-overlay",
      ".newsletter-modal", ".subscribe-overlay", ".modal-backdrop", ".backdrop"
    ];

    const STYLE = `
      html, body { overflow: auto !important; height: auto !important; }
      .no-scroll, .modal-open { overflow: auto !important; }
      .modal-backdrop, .backdrop { display: none !important; }
    `;

    function injectStyle() {
      if (document.getElementById("pb-cookiewall-css")) return;
      const style = document.createElement("style");
      style.id = "pb-cookiewall-css";
      style.textContent = STYLE;
      document.documentElement.appendChild(style);
    }

    function enableScroll() {
      try {
        document.documentElement.style.overflow = "auto";
        document.documentElement.style.position = "static";
        document.body.style.overflow = "auto";
        document.body.style.position = "static";
        ["no-scroll","modal-open","overflow-hidden"].forEach(c => {
          document.documentElement.classList.remove(c);
          document.body.classList.remove(c);
        });
      } catch {}
    }

    function isBlockingOverlay(el) {
      try {
        const rect = el.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        const area = rect.width * rect.height;
        const screen = vw * vh;
        const style = getComputedStyle(el);
        const fixed = style.position === "fixed" || style.position === "sticky";
        const z = parseInt(style.zIndex || "0", 10);
        return fixed && area > screen * 0.35 && z >= 1000; // large couverture, z élevé
      } catch { return false; }
    }

    function cleanupOnce() {
      try {
        injectStyle();
        enableScroll();
        // Supprime par sélecteurs connus
        for (const sel of SELECTORS) {
          document.querySelectorAll(sel).forEach(n => {
            try { n.remove(); } catch {}
          });
        }
        // Heuristique: supprimer overlays bloquants
        document.querySelectorAll("div, section, aside").forEach(n => {
          if (isBlockingOverlay(n)) {
            try { n.remove(); } catch {}
          }
        });
      } catch {}
    }

    // Lecture état stockage pour permettre désactivation depuis l’extension
    try {
      chrome.storage?.local?.get(["enabled","antiCookieWallEnabled"]).then(s => {
        if (s && s.enabled === false) return;
        if (s && s.antiCookieWallEnabled === false) return;
        cleanupOnce();
        let pending = false;
        const obs = new MutationObserver(() => {
          if (pending) return;
          pending = true;
          setTimeout(() => { pending = false; cleanupOnce(); }, 250);
        });
        try { obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); } catch {}
        document.addEventListener("visibilitychange", () => { if (!document.hidden) cleanupOnce(); }, { passive: true });
      }).catch(() => {
        cleanupOnce();
        let pending = false;
        const obs = new MutationObserver(() => {
          if (pending) return;
          pending = true;
          setTimeout(() => { pending = false; cleanupOnce(); }, 250);
        });
        try { obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true }); } catch {}
      });
    } catch {
      cleanupOnce();
    }
  } catch {}
})();
