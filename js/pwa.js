import { registerSW } from "virtual:pwa-register";
import { LOCAL_TILE_COUNT, REMOTE_TREK_BASE, localTileUrl, remoteTileUrl } from "./nasa-source.js";

const RUNTIME_CACHE_NAME = "nasa-trek-runtime-cache";
const HIRISE_LAYER = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";
const HIRISE_EXTENT = [77.2229331, 18.3067994, 77.583964, 18.669315];

const INSTALLED_STORAGE_KEY = "obsidian_pwa_installed";

function isWebPageContext() {
  const protocol = window.location.protocol;
  return protocol === "https:" || protocol === "http:";
}

function detectStandaloneOrNative() {
  const displayModes = [
    "(display-mode: standalone)",
    "(display-mode: fullscreen)",
    "(display-mode: minimal-ui)",
    "(display-mode: window-controls-overlay)",
  ];
  const matchesDisplayMode = displayModes.some((q) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  });
  const iosStandalone = window.navigator.standalone === true;
  const androidAppReferrer =
    typeof document.referrer === "string" &&
    document.referrer.startsWith("android-app://");
  const ua = window.navigator.userAgent || "";
  const isWebView =
    /\bwv\b|; wv\)/i.test(ua) ||
    Boolean(window.ReactNativeWebView || window.Capacitor || window.cordova);

  return matchesDisplayMode || iosStandalone || androidAppReferrer || isWebView;
}

function readInstalledStorage() {
  try {
    return localStorage.getItem(INSTALLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeInstalledStorage(installed) {
  try {
    if (installed) localStorage.setItem(INSTALLED_STORAGE_KEY, "1");
    else localStorage.removeItem(INSTALLED_STORAGE_KEY);
  } catch {
    /* ignore storage restrictions */
  }
}

export function setupPWA() {
  let deferredPrompt = null;
  const isWebPage = isWebPageContext();
  let isStandalone = detectStandaloneOrNative();
  let isInstalled = isStandalone || readInstalledStorage();
  if (isStandalone) {
    writeInstalledStorage(true);
  }
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const installStrip = document.getElementById("install-strip");
  const stripInstallBtn = document.getElementById("strip-install-btn");
  const stripCloseBtn = document.getElementById("strip-close-btn");
  const panelInstallTitle = document.getElementById("panel-install-title");
  const panelInstallHint = document.getElementById("panel-install-hint");
  const panelDownloadZip = document.getElementById("panel-download-zip");
  const panelInstallBtn = document.getElementById("panel-install-app");
  const panelCopyLinkBtn = document.getElementById("panel-copy-link");
  const panelShareFeedback = document.getElementById("panel-share-feedback");
  const iosModal = document.getElementById("ios-install-modal");
  const modalGuide = document.getElementById("install-modal-guide");
  const modalNativeInstall = document.getElementById("modal-native-install");
  const iosClose = document.getElementById("ios-install-close");
  const linkStatus = document.getElementById("link-status");
  const offlineBanner = document.getElementById("offline-banner");
  const sourceStatusEl = document.getElementById("nasa-source-status");
  const cacheExtraBtn = document.getElementById("btn-cache-extra");
  const cacheProgressEl = document.getElementById("nasa-cache-progress");

  // Resolve absolute OpenGraph / canonical URLs for social sharing cards when hosted anywhere.
  try {
    const pageUrl = window.location.origin + window.location.pathname;
    const ensureMeta = (attr, key, val) => {
      let tag = document.querySelector(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", val);
    };
    ensureMeta("property", "og:url", pageUrl);
    const imgUrl = new URL("./pwa-512x512.png", window.location.href).href;
    ensureMeta("property", "og:image", imgUrl);
    ensureMeta("name", "twitter:image", imgUrl);
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;
  } catch { /* ignore in restricted environments */ }

  let swReady = false;
  let stripDismissed = false;
  try { stripDismissed = sessionStorage.getItem("obsidian_install_strip_closed") === "1"; } catch { /* ignore */ }

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      swReady = true;
      renderStatus();
    },
    onNeedRefresh() {
      updateSW(true);
    },
  });

  function shouldShowDownloadOption() {
    return isWebPage && !isStandalone && !isInstalled;
  }

  function renderInstallButton() {
    const showDownload = shouldShowDownloadOption();
    if (installStrip) {
      installStrip.hidden = !showDownload || stripDismissed;
    }
    if (stripInstallBtn) {
      stripInstallBtn.textContent = deferredPrompt ? "⬇ Instalar ObsidIAn Navigator" : "⬇ Descargar App";
    }
    if (panelDownloadZip) {
      panelDownloadZip.hidden = !showDownload;
    }
    if (panelInstallBtn) {
      panelInstallBtn.hidden = !showDownload;
      panelInstallBtn.disabled = !showDownload;
      panelInstallBtn.textContent = deferredPrompt ? "⬇ Instalar ObsidIAn Navigator" : "⬇ Cómo instalar ObsidIAn Navigator";
    }
    if (panelInstallTitle) {
      panelInstallTitle.textContent = showDownload
        ? "ObsidIAn Navigator · Subir a GitHub e instalar"
        : "ObsidIAn Navigator · Compartir página";
    }
    if (panelInstallHint) {
      panelInstallHint.hidden = !showDownload;
    }
    if (modalNativeInstall) {
      modalNativeInstall.hidden = !showDownload || !deferredPrompt;
    }
    if (!showDownload && iosModal) {
      iosModal.hidden = true;
    }
  }

  async function countRuntimeTiles() {
    if (!("caches" in window)) return 0;
    try {
      let total = 0;
      for (const name of [RUNTIME_CACHE_NAME, "nasa-onmars-runtime-cache"]) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        total += keys.length;
      }
      return total;
    } catch {
      return 0;
    }
  }

  // navigator.onLine solo indica que hay red, no que NASA Trek responda: se comprueba de verdad.
  let trekReachable = null;
  let trekCheckedAt = 0;
  async function probeTrek() {
    if (!navigator.onLine) return false;
    if (trekReachable !== null && Date.now() - trekCheckedAt < 60000) return trekReachable;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const url = remoteTileUrl("Mars_MGS_MOLA_ClrShade_merge_global_463m", 0, 0, 0, "jpg");
      await fetch(`${url}?probe=${Date.now()}`, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      trekReachable = true;
    } catch {
      trekReachable = false;
    } finally {
      clearTimeout(timer);
      trekCheckedAt = Date.now();
    }
    return trekReachable;
  }

  async function renderStatus() {
    const online = navigator.onLine;
    const trek = online ? await probeTrek() : false;
    if (linkStatus) {
      linkStatus.classList.toggle("is-offline", !trek);
      linkStatus.innerHTML = !online
        ? '◈ MODO SIN CONEXIÓN<small>TESELAS LOCALES</small>'
        : trek
          ? '◉ LINK ACTIVO<small>NASA TREK + LOCAL</small>'
          : '◈ NASA TREK NO RESPONDE<small>SOLO TESELAS LOCALES</small>';
    }
    if (offlineBanner) {
      offlineBanner.hidden = trek;
      const bannerText = offlineBanner.querySelector("span");
      if (bannerText) {
        bannerText.textContent = !online
          ? "◈ Sin conexión a internet — usando teselas locales integradas y caché. El detalle fino solo existe en la zona de Jezero."
          : "◈ Hay internet, pero NASA Trek no responde — usando teselas locales integradas y caché. El detalle fino solo existe en la zona de Jezero.";
      }
    }
    if (cacheExtraBtn) {
      cacheExtraBtn.disabled = !trek;
    }
    if (sourceStatusEl) {
      const extraCount = await countRuntimeTiles();
      const swText = swReady ? "Caché PWA lista" : "Caché PWA activa";
      sourceStatusEl.textContent = !online
        ? `Sin conexión · Solo teselas locales (${LOCAL_TILE_COUNT} integradas + ${extraCount} en caché web). Fuera de Jezero solo hay vistas globales de baja resolución.`
        : trek
          ? `NASA Trek responde · ${LOCAL_TILE_COUNT} teselas locales + ${extraCount} en caché web · ${swText}.`
          : `Hay internet pero NASA Trek no responde · Solo teselas locales (${LOCAL_TILE_COUNT}) + ${extraCount} en caché web.`;
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    // Browsers only fire beforeinstallprompt when the PWA is not currently installed.
    if (!isStandalone) {
      isInstalled = false;
      writeInstalledStorage(false);
    }
    renderInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    isInstalled = true;
    deferredPrompt = null;
    writeInstalledStorage(true);
    renderInstallButton();
  });

  ["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"].forEach((query) => {
    try {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", () => {
        isStandalone = detectStandaloneOrNative();
        if (isStandalone) {
          isInstalled = true;
          writeInstalledStorage(true);
        }
        renderInstallButton();
      });
    } catch { /* ignore older browsers */ }
  });

  if (typeof navigator.getInstalledRelatedApps === "function") {
    navigator.getInstalledRelatedApps().then((apps) => {
      if (Array.isArray(apps) && apps.length > 0) {
        isInstalled = true;
        writeInstalledStorage(true);
        renderInstallButton();
      }
    }).catch(() => { /* ignore */ });
  }

  window.addEventListener("online", renderStatus);
  window.addEventListener("offline", renderStatus);
  setInterval(renderStatus, 60000);

  async function triggerInstallOrDownload() {
    if (!shouldShowDownloadOption()) return;
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        isInstalled = true;
        deferredPrompt = null;
        writeInstalledStorage(true);
        renderInstallButton();
      }
      return;
    }
    if (modalGuide) {
      modalGuide.innerHTML = isIOS
        ? '1. En Safari, pulsa el botón <strong>Compartir</strong>.<br>2. Desliza y elige <strong>Añadir a pantalla de inicio</strong> para instalar <strong>ObsidIAn Navigator</strong> con modo offline.'
        : '1. En Chrome o Edge, pulsa el icono de <strong>Instalar ObsidIAn Navigator</strong> en la barra de direcciones (o menú <strong>⋮ → Instalar aplicación</strong>).<br>2. También puedes descargar el proyecto completo listo para GitHub en formato <strong>.zip</strong>:';
    }
    if (modalNativeInstall) modalNativeInstall.hidden = !deferredPrompt;
    if (iosModal) iosModal.hidden = false;
  }

  stripInstallBtn?.addEventListener("click", triggerInstallOrDownload);
  panelInstallBtn?.addEventListener("click", triggerInstallOrDownload);
  modalNativeInstall?.addEventListener("click", triggerInstallOrDownload);

  stripCloseBtn?.addEventListener("click", () => {
    stripDismissed = true;
    try { sessionStorage.setItem("obsidian_install_strip_closed", "1"); } catch { /* ignore */ }
    renderInstallButton();
  });

  panelCopyLinkBtn?.addEventListener("click", async () => {
    const shareUrl = window.location.origin + window.location.pathname;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "ObsidIAn Navigator",
          text: "Explora Marte (Cráter Jezero) en 2D/3D e instala ObsidIAn Navigator:",
          url: shareUrl,
        });
        if (panelShareFeedback) {
          panelShareFeedback.textContent = "Página de ObsidIAn Navigator compartida.";
          panelShareFeedback.hidden = false;
        }
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (panelShareFeedback) {
        panelShareFeedback.textContent = `Enlace copiado: ${shareUrl}`;
        panelShareFeedback.hidden = false;
      }
    } catch {
      if (panelShareFeedback) {
        panelShareFeedback.textContent = `Enlace de ObsidIAn Navigator: ${shareUrl}`;
        panelShareFeedback.hidden = false;
      }
    }
  });

  iosClose?.addEventListener("click", () => {
    if (iosModal) iosModal.hidden = true;
  });
  iosModal?.addEventListener("click", (event) => {
    if (event.target === iosModal) iosModal.hidden = true;
  });

  cacheExtraBtn?.addEventListener("click", async () => {
    if (!navigator.onLine || !("caches" in window)) return;
    cacheExtraBtn.disabled = true;
    const [w, s, e, n] = HIRISE_EXTENT;
    const z = 13;
    const deg = 180 / 2 ** z;
    const x0 = Math.floor((w + 180) / deg);
    const x1 = Math.floor((e + 180) / deg);
    const y0 = Math.floor((90 - n) / deg);
    const y1 = Math.floor((90 - s) / deg);
    const urls = [];
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        if (!localTileUrl(HIRISE_LAYER, z, y, x, "png")) {
          urls.push(`${REMOTE_TREK_BASE}/${HIRISE_LAYER}/1.0.0/default/default028mm/${z}/${y}/${x}.png`);
        }
      }
    }
    const cache = await caches.open(RUNTIME_CACHE_NAME);
    let done = 0;
    let saved = 0;
    const batchSize = 8;
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      await Promise.all(batch.map(async (url) => {
        try {
          const hit = await cache.match(url);
          if (hit) {
            saved += 1;
          } else {
            const resp = await fetch(url, { mode: "cors" });
            if (resp.ok) {
              await cache.put(url, resp);
              saved += 1;
            }
          }
        } catch { /* ignore individual tile errors */ }
        done += 1;
      }));
      if (cacheProgressEl) {
        cacheProgressEl.hidden = false;
        cacheProgressEl.textContent = `Descargando HiRISE z13 para uso offline: ${done}/${urls.length} teselas…`;
      }
    }
    if (cacheProgressEl) {
      cacheProgressEl.textContent = `Listo: ${saved}/${urls.length} teselas HiRISE z13 disponibles sin conexión.`;
    }
    cacheExtraBtn.disabled = !navigator.onLine;
    renderStatus();
  });

  renderInstallButton();
  renderStatus();
}
