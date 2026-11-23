import "./version.js";

export function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function installInstructions(agent, appleMobile) {
  const firefox = /Firefox|FxiOS/i.test(agent);
  const edge = /Edg/i.test(agent);
  const chrome = /Chrome|Chromium|CriOS/i.test(agent);
  if (appleMobile) {
    const share = firefox || chrome || edge ? "Tap Share in the address bar." : "Tap Share in Safari’s toolbar or Page Menu.";
    return `${share} Choose Add to Home Screen, turn on Open as Web App if shown, then tap Add.`;
  }
  if (/Android/i.test(agent)) {
    if (firefox) return "Open Firefox’s three-dot menu, tap Install, then tap Add automatically.";
    if (chrome && !edge) return "Open Chrome’s three-dot menu. Choose Install and create shortcut → Install, or Add to Home screen if shown.";
    return "Open your browser’s menu and choose Install or Add to Home screen.";
  }
  if (edge) return "In Edge, open ⋯ → More tools → Apps → Install this site as an app.";
  if (chrome) return "Click Install in the address bar, or open Chrome’s ⋮ menu → Cast, save, and share → Install page as app.";
  if (firefox && /Windows/i.test(agent)) return "Click the Web Apps button in the Firefox address bar to add Cadence to your taskbar. If it’s unavailable, use Chrome or Edge.";
  if (firefox) return "Open Cadence in Chrome or Edge to install it, or use Safari’s File → Add to Dock on a Mac.";
  if (/Safari/i.test(agent)) return "In Safari, choose File → Add to Dock, then click Add.";
  return "Look for an install option in your browser’s address bar or menu. If it’s unavailable, open Cadence in Chrome or Edge.";
}

export function setupPwa({ canReload, openInstallGuide, announce }) {
  const byId = (id) => document.getElementById(id);
  const installNotice = byId("install-notice");
  const installAction = byId("install-notice-action");
  const installButton = byId("install-button");
  const installSteps = byId("install-steps");
  const updateNotice = byId("update-notice");
  const updateButton = byId("update-button");
  const standaloneMode = matchMedia("(display-mode: standalone)");
  const instructions = installInstructions(navigator.userAgent, isAppleMobile());
  const serviceWorker = navigator.serviceWorker;
  const workerUrl = new URL("./sw.js", import.meta.url).href;
  const cadenceController = () => {
    const worker = serviceWorker?.controller;
    return worker?.scriptURL === workerUrl ? worker : null;
  };
  let controller = cadenceController();
  let registration;
  let installPrompt;
  let webInstallAvailable = typeof navigator.install === "function";
  let installing = false;
  let installDismissed = false;
  let installed = false;
  let offlineStatus = "Preparing offline access";
  let updatedController;
  let dismissedUpdate;
  let applyingUpdate;

  const isStandalone = () => standaloneMode.matches || navigator.standalone;
  const isInstalled = () => installed || isStandalone();

  function pendingUpdate() {
    const waiting = registration?.waiting;
    return controller && waiting && waiting !== controller ? waiting : updatedController;
  }

  function refresh() {
    const pending = pendingUpdate();
    const canPrompt = canReload();
    const showUpdate = canPrompt && pending && pending !== dismissedUpdate;
    if (showUpdate && updateNotice.hidden) announce("A Cadence update is available.");
    updateNotice.hidden = !showUpdate;
    updateButton.disabled = Boolean(applyingUpdate);
    installNotice.hidden = !canPrompt || !window.isSecureContext || installDismissed || isInstalled() || !updateNotice.hidden;
  }

  function drawInstall() {
    const canInstall = window.isSecureContext && (installPrompt || webInstallAvailable);
    const action = canInstall ? "Install" : "How to install";
    let steps = instructions;
    if (isStandalone()) steps = "Cadence is open as an installed app.";
    else if (installed) steps = "Cadence is installed. Launch it from your Home Screen or app launcher.";
    else if (!window.isSecureContext) steps = "Open Cadence over HTTPS to install it.";

    if (installSteps.textContent !== steps) installSteps.textContent = steps;
    installButton.hidden = isInstalled() || !canInstall;
    installButton.disabled = installing;
    if (installAction.textContent !== action) installAction.textContent = action;
    byId("offline-status").textContent = offlineStatus;
    refresh();
  }

  function dismissInstall() {
    installDismissed = true;
    refresh();
  }

  async function install() {
    if (installing || isInstalled()) return;
    const prompt = installPrompt;
    dismissInstall();
    if (!prompt && !webInstallAvailable) {
      openInstallGuide();
      return;
    }
    installPrompt = undefined;
    installing = true;
    drawInstall();
    try {
      if (prompt) {
        const result = await prompt.prompt();
        const choice = result ?? await prompt.userChoice;
        if (choice?.outcome === "accepted") installed = true;
      } else {
        await navigator.install();
        installed = true;
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (!prompt) webInstallAvailable = false;
        openInstallGuide();
      }
    } finally {
      installing = false;
      drawInstall();
    }
  }

  function dismissUpdate() {
    dismissedUpdate = pendingUpdate();
    refresh();
  }

  function applyUpdate() {
    const worker = pendingUpdate();
    if (!worker || !canReload() || applyingUpdate) return;
    if (worker === updatedController) {
      location.reload();
      return;
    }
    try {
      applyingUpdate = worker;
      const watchActivation = () => {
        if (worker.state === "activated" || worker.state === "redundant") {
          worker.removeEventListener("statechange", watchActivation);
        }
        if (worker.state === "redundant" && applyingUpdate === worker) {
          applyingUpdate = undefined;
          refresh();
        }
      };
      worker.addEventListener("statechange", watchActivation);
      worker.postMessage("activate-update");
      refresh();
    } catch {
      applyingUpdate = undefined;
      refresh();
      announce("The update couldn’t start. Try again.");
    }
  }

  function checkForUpdate() {
    if (!document.hidden && navigator.onLine && registration?.active && !registration.installing) {
      registration.update().catch(() => {});
    }
  }

  async function setupOffline() {
    if (!serviceWorker) {
      offlineStatus = "Offline access unavailable";
      drawInstall();
      return;
    }

    if (controller) {
      offlineStatus = "Available offline";
      drawInstall();
    }
    serviceWorker.addEventListener("controllerchange", () => {
      const next = cadenceController();
      if (!next || next === controller) return;
      if (controller) updatedController = next;
      controller = next;
      const reload = applyingUpdate === next && canReload();
      applyingUpdate = undefined;
      offlineStatus = "Available offline";
      if (reload) location.reload();
      else drawInstall();
    });

    try {
      registration = await serviceWorker.register(workerUrl, { updateViaCache: "none" });
      if (registration.active) offlineStatus = "Available offline";
      const watchInstalling = () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "redundant" && !registration.active) offlineStatus = "Offline setup failed";
          drawInstall();
        });
      };
      registration.addEventListener("updatefound", watchInstalling);
      watchInstalling();
      drawInstall();
      checkForUpdate();
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("online", checkForUpdate);
      window.setInterval(checkForUpdate, 15 * 60_000);
    } catch {
      if (!cadenceController()) offlineStatus = "Offline access unavailable";
      drawInstall();
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    if (isInstalled() || typeof event.prompt !== "function") return;
    installPrompt = event;
    drawInstall();
    event.userChoice?.catch(() => null).then((choice) => {
      if (installPrompt !== event) return;
      installPrompt = undefined;
      if (choice?.outcome === "accepted") installed = true;
      drawInstall();
    });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    installed = true;
    drawInstall();
  });
  standaloneMode.addEventListener("change", drawInstall);
  byId("app-version").textContent = `v${globalThis.CADENCE_VERSION}`;
  drawInstall();
  setupOffline();

  return { refresh, install, dismissInstall, applyUpdate, dismissUpdate };
}
