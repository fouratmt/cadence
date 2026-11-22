import "./version.js";

export function setupPwa({ canReload, openInstallGuide, installDismissed, onDismissInstall, announce }) {
  const byId = (id) => document.getElementById(id);
  const installNotice = byId("install-notice");
  const updateNotice = byId("update-notice");
  const updateButton = byId("update-button");
  const standaloneMode = matchMedia("(display-mode: standalone)");
  const agent = navigator.userAgent;
  const appleMobile = /iPhone|iPad|iPod/.test(agent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(agent);
  const chromium = /Chrome|Chromium|Edg/i.test(agent);
  const desktopSafari = /Safari/i.test(agent) && !chromium && !appleMobile;
  const serviceWorker = navigator.serviceWorker;
  let controller = serviceWorker?.controller;
  let registration;
  let installPrompt;
  let installed = false;
  let offlineStatus = "Preparing offline access";
  let updatedController;
  let dismissedUpdate;
  let applyingUpdate;

  const isInstalled = () => installed || standaloneMode.matches || navigator.standalone;

  function pendingUpdate() {
    const waiting = registration?.waiting;
    return controller && waiting && waiting !== controller ? waiting : updatedController;
  }

  function refresh() {
    const pending = pendingUpdate();
    const canPrompt = canReload();
    const offerInstall = window.isSecureContext && (installPrompt || appleMobile || android || chromium || desktopSafari);
    const showUpdate = canPrompt && pending && pending !== dismissedUpdate;
    if (showUpdate && updateNotice.hidden) announce("A Cadence update is available.");
    updateNotice.hidden = !showUpdate;
    updateButton.disabled = Boolean(applyingUpdate);
    installNotice.hidden = !canPrompt || !offerInstall || installDismissed || isInstalled() || !updateNotice.hidden;
  }

  function drawInstall() {
    let steps = "Look for Install app or Add to Home Screen in your browser menu.";
    if (isInstalled()) steps = "Cadence is open as an installed app.";
    else if (appleMobile) steps = "Open the browser’s Share menu and choose Add to Home Screen. Leave Open as Web App enabled if shown.";
    else if (android && /Firefox/i.test(agent)) steps = "Open the Firefox menu, tap Install, then add Cadence to your Home Screen.";
    else if (android) steps = "Open the Chrome menu and select Install and create shortcut, then Install. Some versions show Add to Home screen.";
    else if (desktopSafari) steps = "In Safari, choose File → Add to Dock.";
    else if (installPrompt) steps = "Install Cadence to open it in its own window.";

    byId("install-steps").textContent = steps;
    byId("install-button").hidden = isInstalled() || !installPrompt;
    byId("install-notice-action").textContent = installPrompt ? "Install" : "Show steps";
    byId("offline-status").textContent = offlineStatus;
    refresh();
  }

  function dismissInstall() {
    installDismissed = true;
    onDismissInstall();
    refresh();
  }

  async function install() {
    const prompt = installPrompt;
    installPrompt = undefined;
    dismissInstall();
    drawInstall();
    if (!prompt) {
      openInstallGuide();
      return;
    }
    try {
      await prompt.prompt();
    } catch {
      openInstallGuide();
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
      const next = serviceWorker.controller;
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
      registration = await serviceWorker.register("./sw.js", { updateViaCache: "none" });
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
      if (!serviceWorker.controller) offlineStatus = "Offline access unavailable";
      drawInstall();
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    drawInstall();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    installed = true;
    dismissInstall();
    drawInstall();
  });
  standaloneMode.addEventListener("change", drawInstall);
  byId("app-version").textContent = `v${globalThis.CADENCE_VERSION}`;
  drawInstall();
  setupOffline();

  return { refresh, install, dismissInstall, applyUpdate, dismissUpdate };
}
