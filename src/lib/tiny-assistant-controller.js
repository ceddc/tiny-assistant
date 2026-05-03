export function initializeTinyAssistant(host) {
  // This controller is scoped to one <tiny-arcgis-assistant> host. Keep all UI
  // lookups under `host` so a CDN page can render more than one assistant.
  const assistantBubble = host.querySelector(".assistant-bubble");
  const assistantToggle = host.querySelector(".assistant-toggle");
  const assistantCard = host.querySelector(".assistant-card");
  const assistantHeader = host.querySelector(".assistant-header");
  const assistantElement = host.querySelector("arcgis-assistant");
  const demoIntroPanel = document.querySelector("#demo-intro-panel");
  const followCursorToggle = host.querySelector(".follow-cursor-toggle");
  const globbyMenu = host.querySelector(".globby-menu");
  const hideGlobbyButton = host.querySelector(".hide-tiny-assistant-button");
  const panelMenuToggle = host.querySelector(".panel-menu-toggle");
  const showGlobbyButton = host.querySelector(".show-tiny-assistant-button");
  const globby = host.querySelector("tiny-assistant-character");
  const globbyStatus = host.querySelector(".tiny-assistant-status");
  const mapElement = document.querySelector(
    assistantElement?.getAttribute("reference-element") ||
      host.getAttribute("reference-element") ||
      "arcgis-map",
  );
  const pageParams = new URLSearchParams(window.location.search);

  let globbyCenter = null;
  let groupDrag = null;
  let followCursorEnabled = false;
  let arcgisSignedIn = false;
  let arcgisSignInAllowed = false;
  let arcgisSignInBusy = false;
  let assistantBusy = false;
  let assistantBusyTimer = null;
  let globbyHelloTimer = null;
  let assistantPatchLoopTimer = null;
  let assistantSignatureBeforeSubmit = "";
  const watchedAssistantRoots = new WeakSet();
  const globbyStartupMode = pageParams.get("globby")?.toLowerCase();
  const startWithGlobbyHidden = [
    "0",
    "false",
    "hide",
    "hidden",
    "off",
  ].includes(globbyStartupMode || "");
  const INTRO_PANEL_STORAGE_KEY = "tinyAssistant.demoIntro.dismissed";
  const ARCGIS_SHARING_URL = "https://www.arcgis.com/sharing/rest";
  let arcgisIdentityManager = null;
  let arcgisIdentityGuardReady = false;

  // Layout numbers are deliberately centralized so the assistant/panel relationship
  // is easy to tune without spelunking through the interaction handlers.
  const CHAT_LAYOUT = {
    collapsed: {
      offset: { x: -176, y: -64 },
      panelHeight: 42,
      panelWidth: 172,
    },
    expanded: {
      gapFromGlobby: 4,
      offset: { x: -204, y: -82 },
      panelHeight: 446,
      panelWidth: 390,
    },
    globby: {
      centerOffsetX: 38.72,
      centerOffsetY: 41.14,
      width: 77.44,
    },
  };
  const VIEWPORT_MARGIN = 12;

  if (assistantElement && !assistantElement.suggestedPrompts?.length) {
    assistantElement.suggestedPrompts = [
      "Go to the county that produced the most wheat in 2022.",
      "How does that compare to the average county that produced wheat?",
      "How many counties produced less wheat in 2022 than in 2017?",
    ];
  }

  if (demoIntroPanel) {
    if (window.localStorage.getItem(INTRO_PANEL_STORAGE_KEY) === "true") {
      demoIntroPanel.hidden = true;
    }

    const rememberIntroDismissal = () => {
      try {
        window.localStorage.setItem(INTRO_PANEL_STORAGE_KEY, "true");
      } catch {
        // If storage is unavailable, Calcite still closes the panel for this page view.
      }
    };

    demoIntroPanel.addEventListener(
      "calcitePanelClose",
      rememberIntroDismissal,
    );
    new MutationObserver(() => {
      if (demoIntroPanel.hasAttribute("closed")) {
        rememberIntroDismissal();
      }
    }).observe(demoIntroPanel, {
      attributes: true,
      attributeFilter: ["closed"],
    });
  }

  patchArcgisMapSize();
  patchAssistantDensity();
  setupArcgisIdentityGuard();
  checkArcgisSignInStatus();

  assistantToggle?.addEventListener("click", async () => {
    if (assistantBubble?.dataset.mode === "full") {
      setPanelOpen(false);
      return;
    }

    await openChatOrSignIn();
  });

  assistantHeader?.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    startGroupDrag(event, assistantHeader);
  });

  assistantCard?.addEventListener("pointerdown", (event) => {
    if (assistantBubble?.dataset.mode !== "full" || isPanelControl(event)) {
      return;
    }

    startGroupDrag(event, assistantCard);
  });

  window.addEventListener("pointermove", (event) => {
    if (!groupDrag) {
      return;
    }

    const deltaX = event.clientX - groupDrag.lastX;
    const deltaY = event.clientY - groupDrag.lastY;

    groupDrag.lastX = event.clientX;
    groupDrag.lastY = event.clientY;
    globby?.moveBy(deltaX, deltaY);
    if (globbyCenter) {
      globbyCenter = {
        x: globbyCenter.x + deltaX,
        y: globbyCenter.y + deltaY,
      };
      placeGroupFromGlobby();
    }
  });

  window.addEventListener("pointerup", () => {
    groupDrag = null;
    assistantBubble?.removeAttribute("data-dragging");
    globby?.setFollowCursor(
      assistantBubble?.dataset.mode !== "full" && followCursorEnabled,
    );
  });

  function startGroupDrag(event, captureElement) {
    event.preventDefault();
    groupDrag = {
      lastX: event.clientX,
      lastY: event.clientY,
    };
    captureElement.setPointerCapture?.(event.pointerId);
    assistantBubble.dataset.dragging = "true";
    globby?.setFollowCursor(false);
  }

  function isPanelControl(event) {
    return event.composedPath().some((element) => {
      const tagName = element?.tagName?.toLowerCase();
      return [
        "a",
        "button",
        "calcite-button",
        "calcite-chip",
        "calcite-input",
        "calcite-text-area",
        "input",
        "textarea",
      ].includes(tagName);
    });
  }

  function setPanelOpen(open) {
    if (!assistantBubble || !assistantToggle) {
      return;
    }

    assistantBubble.dataset.mode = open ? "full" : "peek";
    assistantToggle.setAttribute("aria-expanded", String(open));
    globby?.setChatOpen(open);
    if (!assistantBusy) {
      if (open) {
        playGlobbyHelloOnce();
      } else {
        clearTimeout(globbyHelloTimer);
        globby?.setAvatarState(arcgisSignInBusy ? "waiting" : "idle");
      }
    }
    globby?.setFollowCursor(!open && followCursorEnabled);
    if (open) {
      dockGlobbyForExpandedPanel();
    }
    requestAnimationFrame(() => {
      runAssistantPatchPass();
      queueAssistantPatchLoop();
      placeGroupFromGlobby();
      updateGlobbyMenuLabels();
    });
  }

  function setAssistantBusy(busy) {
    assistantBusy = busy;
    if (assistantBubble) {
      assistantBubble.dataset.busy = String(busy);
      if (busy) {
        assistantBubble.dataset.chat = "active";
      }
    }

    clearTimeout(assistantBusyTimer);
    if (busy) {
      globby?.setAvatarState("working");
      queueAssistantPatchLoop(12000);
      assistantBusyTimer = setTimeout(() => setAssistantBusy(false), 45000);
      return;
    }

    globby?.setAvatarState(arcgisSignInBusy ? "waiting" : "idle");
  }

  function playGlobbyHelloOnce() {
    clearTimeout(globbyHelloTimer);
    globby?.setAvatarState("wave");
    globbyHelloTimer = setTimeout(() => {
      if (!assistantBusy) {
        globby?.setAvatarState("idle");
      }
    }, 1200);
  }

  async function getIdentityManager() {
    if (!arcgisIdentityManager) {
      if (!globalThis.$arcgis?.import) {
        return null;
      }

      const identityManagerModule = await globalThis.$arcgis.import(
        "@arcgis/core/identity/IdentityManager.js",
      );
      arcgisIdentityManager =
        identityManagerModule.default ?? identityManagerModule;
    }

    return arcgisIdentityManager;
  }

  async function setupArcgisIdentityGuard() {
    // ArcGIS may create an IdentityManager dialog as components initialize. Keep
    // those passive checks non-interactive; only the explicit Tiny Assistant
    // sign-in action is allowed to show the credential dialog.
    const identityManager = await getIdentityManager();
    if (!identityManager || arcgisIdentityGuardReady) {
      return;
    }

    arcgisIdentityGuardReady = true;
    identityManager.on?.("dialog-create", () => {
      window.setTimeout(() => {
        if (arcgisSignInAllowed) {
          showAllowedArcgisDialog();
          return;
        }

        cancelUnexpectedArcgisDialog();
      }, 0);
    });
    cancelUnexpectedArcgisDialog();
  }

  function showAllowedArcgisDialog() {
    const dialog = arcgisIdentityManager?.dialog;
    if (!dialog || !arcgisSignInAllowed) {
      return;
    }

    dialog.visible = true;
    dialog.open = true;
    document
      .querySelectorAll(".esri-identity-modal calcite-dialog")
      .forEach((element) => {
        element.open = true;
        element.hidden = false;
        element.style.display = "";
      });
  }

  function cancelUnexpectedArcgisDialog() {
    const dialog = arcgisIdentityManager?.dialog;
    if (!dialog || arcgisSignInAllowed) {
      return;
    }

    dialog.visible = false;
    dialog.open = false;
    dialog.content?.emit?.("cancel", {});
  }

  async function checkArcgisSignInStatus() {
    const identityManager = await getIdentityManager();
    if (!identityManager) {
      setArcgisSignedIn(false);
      return false;
    }

    try {
      await identityManager.checkSignInStatus(ARCGIS_SHARING_URL);
      setArcgisSignedIn(true);
      return true;
    } catch {
      setArcgisSignedIn(false);
      return false;
    }
  }

  async function signInToArcgis() {
    if (arcgisSignInBusy) {
      return false;
    }

    const identityManager = await getIdentityManager();
    if (!identityManager) {
      setArcgisSignedIn(false);
      return false;
    }

    arcgisSignInBusy = true;
    arcgisSignInAllowed = true;
    updateGlobbyStatus();
    globby?.setAvatarState("waiting");

    try {
      const credential = identityManager.getCredential(ARCGIS_SHARING_URL);
      window.setTimeout(showAllowedArcgisDialog, 0);
      window.setTimeout(showAllowedArcgisDialog, 250);
      await credential;
      setArcgisSignedIn(true);
      return true;
    } catch {
      setArcgisSignedIn(false);
      return false;
    } finally {
      arcgisSignInAllowed = false;
      arcgisSignInBusy = false;
      cancelUnexpectedArcgisDialog();
      updateGlobbyStatus();
      if (!assistantBusy) {
        globby?.setAvatarState("idle");
      }
    }
  }

  function setArcgisSignedIn(signedIn) {
    arcgisSignedIn = signedIn;
    updateGlobbyStatus();
  }

  function updateGlobbyStatus() {
    if (!globbyStatus) {
      return;
    }

    if (arcgisSignInBusy) {
      globbyStatus.textContent = "Opening ArcGIS sign-in";
      return;
    }

    globbyStatus.textContent = arcgisSignedIn
      ? "Ready on this map"
      : "ArcGIS sign-in required";
  }

  async function openChatOrSignIn() {
    // Opening chat is intentionally the single interactive auth path. The map and
    // collapsed assistant can load without forcing a credential prompt.
    if (!arcgisSignedIn) {
      const signedIn = await signInToArcgis();
      if (!signedIn) {
        return;
      }
    }

    setPanelOpen(true);
  }

  function setGlobbyVisible(visible) {
    if (globby) {
      globby.hidden = !visible;
      if (visible) {
        positionGlobbyAtDefault();
      }
      globby.setFollowCursor(
        visible &&
          assistantBubble?.dataset.mode !== "full" &&
          followCursorEnabled,
      );
    }
    if (assistantBubble) {
      assistantBubble.hidden = !visible;
    }
    if (showGlobbyButton) {
      showGlobbyButton.hidden = visible;
    }
    if (visible) {
      updateGlobbyStatus();
      requestAnimationFrame(placeGroupFromGlobby);
    }
  }

  function positionGlobbyAtDefault() {
    const center = {
      x: Math.max(64, window.innerWidth - 102),
      y: Math.max(68, window.innerHeight - 114),
    };
    globbyCenter = center;
    globby?.moveToCenter(center.x, center.y);
  }

  globby?.addEventListener("tiny-assistant-ready", (event) => {
    updateGlobbyStatus();
  });

  globby?.addEventListener("tiny-assistant-move", (event) => {
    globbyCenter = event.detail;
    placeGroupFromGlobby();
  });

  globby?.addEventListener("tiny-assistant-drag-end", () => {
    globby?.setFollowCursor(false);
    placeGroupFromGlobby();
  });

  globby?.addEventListener("tiny-assistant-click", async () => {
    globby?.setFollowCursor(false);
    if (assistantBubble?.dataset.mode === "full") {
      setPanelOpen(false);
      return;
    }

    await openChatOrSignIn();
  });

  window.addEventListener("resize", placeGroupFromGlobby);
  requestAnimationFrame(placeGroupFromGlobby);
  globby?.setFollowCursor(false);
  requestAnimationFrame(() => setGlobbyVisible(!startWithGlobbyHidden));

  globby?.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    globby?.setFollowCursor(false);
    showGlobbyMenu(event.clientX, event.clientY);
  });

  followCursorToggle?.addEventListener("click", () => {
    followCursorEnabled = !followCursorEnabled;
    globby?.setFollowCursor(
      assistantBubble?.dataset.mode !== "full" && followCursorEnabled,
    );
    hideGlobbyMenu();
  });

  panelMenuToggle?.addEventListener("click", async () => {
    if (assistantBubble?.dataset.mode === "full") {
      setPanelOpen(false);
      hideGlobbyMenu();
      return;
    }

    hideGlobbyMenu();
    await openChatOrSignIn();
  });

  hideGlobbyButton?.addEventListener("click", () => {
    hideGlobbyMenu();
    setGlobbyVisible(false);
  });

  showGlobbyButton?.addEventListener("click", () => {
    setGlobbyVisible(true);
  });

  window.addEventListener("pointerdown", (event) => {
    if (!globbyMenu || globbyMenu.hidden || globbyMenu.contains(event.target)) {
      return;
    }

    hideGlobbyMenu();
  });

  mapElement?.addEventListener("arcgisViewReadyChange", () => {
    globby?.setAvatarState("review");
    setTimeout(() => {
      if (!assistantBusy) {
        globby?.setAvatarState("idle");
      }
    }, 1100);
    patchArcgisMapSize();
  });

  window.addEventListener("load", patchArcgisMapSize);
  window.addEventListener("load", patchAssistantDensity);
  window.addEventListener("load", patchNestedAssistantControls);
  window.addEventListener("load", watchAssistantWork);

  function ensureGlobbyCenter() {
    if (!globbyCenter) {
      const runner = globby?.shadowRoot?.querySelector(".runner");
      const runnerRect = runner?.getBoundingClientRect();
      if (runnerRect) {
        globbyCenter = {
          x: runnerRect.left + runnerRect.width / 2,
          y: runnerRect.top + runnerRect.height / 2,
        };
      }
    }
  }

  function placeGroupFromGlobby() {
    // The chat bubble is positioned relative to the animated character, then
    // clamped to the viewport so dragging Globby keeps the panel usable.
    ensureGlobbyCenter();
    if (!globbyCenter || !assistantBubble || !assistantCard) {
      return;
    }

    const cardRect = assistantCard.getBoundingClientRect();
    const isFull = assistantBubble.dataset.mode === "full";
    const modeLayout = isFull ? CHAT_LAYOUT.expanded : CHAT_LAYOUT.collapsed;
    const activeWidth = isFull
      ? Math.max(cardRect.width, modeLayout.panelWidth)
      : modeLayout.panelWidth;
    const activeHeight = isFull
      ? Math.max(cardRect.height, modeLayout.panelHeight)
      : modeLayout.panelHeight;
    const activeOffset = modeLayout.offset;
    const desiredX = globbyCenter.x + activeOffset.x;
    const desiredY = globbyCenter.y + activeOffset.y;
    let x = clamp(
      desiredX,
      VIEWPORT_MARGIN,
      window.innerWidth - CHAT_LAYOUT.collapsed.panelWidth - VIEWPORT_MARGIN,
    );
    let y = clamp(
      desiredY,
      VIEWPORT_MARGIN,
      window.innerHeight - CHAT_LAYOUT.collapsed.panelHeight - VIEWPORT_MARGIN,
    );

    if (isFull) {
      // The expanded card is right/bottom-aligned inside the small bubble anchor.
      // Clamp the visible card rectangle first, then convert back to anchor
      // coordinates so the ArcGIS panel cannot be clipped at the viewport edge.
      const panelOverlapX = activeWidth - CHAT_LAYOUT.collapsed.panelWidth;
      const panelOverlapY = activeHeight - CHAT_LAYOUT.collapsed.panelHeight;
      const desiredPanelTop = desiredY - panelOverlapY;
      const panelLeft = placeExpandedPanelLeft(activeWidth);
      const panelTop = clamp(
        desiredPanelTop,
        VIEWPORT_MARGIN,
        Math.max(
          VIEWPORT_MARGIN,
          window.innerHeight - activeHeight - VIEWPORT_MARGIN,
        ),
      );

      x = panelLeft + panelOverlapX;
      y = panelTop + panelOverlapY;
    }

    assistantBubble.style.left = `${x}px`;
    assistantBubble.style.top = `${y}px`;
    assistantBubble.style.right = "auto";
    assistantBubble.style.bottom = "auto";
  }

  function placeExpandedPanelLeft(panelWidth) {
    const maxPanelLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - panelWidth - VIEWPORT_MARGIN,
    );
    const globbyLeft = globbyCenter.x - CHAT_LAYOUT.globby.centerOffsetX;
    const globbyRight = globbyLeft + CHAT_LAYOUT.globby.width;
    const panelLeftIfRight = globbyRight + CHAT_LAYOUT.expanded.gapFromGlobby;
    const panelRightIfLeft = globbyLeft - CHAT_LAYOUT.expanded.gapFromGlobby;
    const canPlaceRight =
      panelLeftIfRight + panelWidth <= window.innerWidth - VIEWPORT_MARGIN;
    const canPlaceLeft = panelRightIfLeft - panelWidth >= VIEWPORT_MARGIN;
    const preferRight = globbyCenter.x < window.innerWidth / 2;
    const placeRight = canPlaceRight && (preferRight || !canPlaceLeft);
    const panelLeft = placeRight
      ? panelLeftIfRight
      : panelRightIfLeft - panelWidth;

    return clamp(panelLeft, VIEWPORT_MARGIN, maxPanelLeft);
  }

  function clamp(value, min, max) {
    const safeMax = Math.max(min, max);
    return Math.min(Math.max(value, min), safeMax);
  }

  function dockGlobbyForExpandedPanel() {
    placeGroupFromGlobby();
  }

  function showGlobbyMenu(x, y) {
    if (!globbyMenu || !followCursorToggle) {
      return;
    }

    updateGlobbyMenuLabels();
    globbyMenu.hidden = false;
    globbyMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    globbyMenu.style.top = `${Math.min(y, window.innerHeight - 44)}px`;
  }

  function hideGlobbyMenu() {
    if (globbyMenu) {
      globbyMenu.hidden = true;
    }
  }

  function updateGlobbyMenuLabels() {
    followCursorToggle?.setAttribute(
      "aria-checked",
      String(followCursorEnabled),
    );
    if (panelMenuToggle) {
      panelMenuToggle.textContent =
        assistantBubble?.dataset.mode === "full" ? "Close chat" : "Open chat";
    }
  }

  async function patchArcgisMapSize() {
    if (!mapElement) {
      return;
    }

    await customElements.whenDefined("arcgis-map");
    await mapElement.componentOnReady?.();

    const shadowRoot = mapElement.shadowRoot;
    if (!shadowRoot) {
      return;
    }

    if (!shadowRoot.querySelector("#globby-map-size-patch")) {
      const style = document.createElement("style");
      style.id = "globby-map-size-patch";
      style.textContent = `
      :host,
      .arcgis-map,
      .esri-view,
      .esri-view-root,
      .esri-view-surface {
        block-size: 100%;
        inline-size: 100%;
      }
    `;
      shadowRoot.append(style);
    }

    const viewContainer = shadowRoot.querySelector(".arcgis-map");
    if (viewContainer) {
      viewContainer.style.width = "100%";
      viewContainer.style.height = `${Math.max(mapElement.clientHeight, window.innerHeight)}px`;
    }

    mapElement.view?.resize?.();
  }

  async function patchAssistantDensity() {
    // ArcGIS owns the assistant internals, including shadow roots. These patches
    // keep the stock component readable inside the compact Tiny Assistant panel.
    if (!assistantElement) {
      return;
    }

    await customElements.whenDefined("arcgis-assistant");
    await assistantElement.componentOnReady?.();

    const shadowRoot = assistantElement.shadowRoot;
    if (
      !shadowRoot ||
      shadowRoot.querySelector("#globby-assistant-density-patch")
    ) {
      return;
    }

    const style = document.createElement("style");
    style.id = "globby-assistant-density-patch";
    style.textContent = `
    :host {
      block-size: 100%;
      box-sizing: border-box;
      contain: content;
      font-size: 12px;
      inline-size: 100%;
      overflow: hidden;
      position: relative;
    }

    arcgis-assistant-shell {
      block-size: 100%;
      display: block;
      inline-size: 100%;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
      min-inline-size: 0;
    }

    .interaction-container,
    .container,
    article.container {
      inline-size: 100%;
      max-inline-size: 100%;
    }

    .interaction-container {
      block-size: 100%;
      overflow: auto;
      overscroll-behavior: contain;
    }

    article.container,
    .container {
      margin: 0;
      padding: 7px 9px;
    }

    h1,
    h2,
    h3 {
      font-size: 14px;
      line-height: 1.16;
      margin-block: 0 4px;
      overflow-wrap: anywhere;
    }

    p,
    span,
    calcite-button,
    calcite-input,
    calcite-input-text,
    calcite-text-area {
      font-size: 11px;
      line-height: 1.22;
      max-inline-size: 100%;
      overflow-wrap: anywhere;
    }

    calcite-button {
      --calcite-font-size--1: 10px;
      --calcite-font-size-0: 11px;
      display: block;
      inline-size: 100%;
      min-block-size: 24px;
    }

    calcite-button::part(button),
    calcite-action::part(button) {
      min-block-size: 24px;
      padding-block: 3px;
      padding-inline: 8px;
    }

    calcite-button[appearance="solid"] {
      inline-size: auto;
      min-inline-size: 50px;
    }
  `;
    shadowRoot.append(style);
    requestAnimationFrame(patchNestedAssistantControls);
    setTimeout(patchNestedAssistantControls, 500);
    setTimeout(patchNestedAssistantControls, 1500);
  }

  function patchNestedAssistantControls() {
    // Some controls render their own nested shadow roots after the first
    // component-ready tick, so this pass is rerun while chat content changes.
    if (!assistantElement) {
      return;
    }

    getOpenRoots(assistantElement).forEach((root) => {
      if (!root.querySelector("#globby-deep-density-patch")) {
        const style = document.createElement("style");
        style.id = "globby-deep-density-patch";
        style.textContent = `
        *,
        *::before,
        *::after {
          box-sizing: border-box;
          min-inline-size: 0;
        }

        .container,
        article.container,
        .interaction-container {
          inline-size: 100% !important;
          max-inline-size: 100% !important;
        }

        calcite-panel,
        article.container {
          block-size: 100% !important;
        }

        .container,
        article.container {
          padding: 4px 6px !important;
        }

        .header-content {
          padding: 7px 9px !important;
        }

        .header-content,
        .header-content * {
          font-size: 11px !important;
          line-height: 1.22 !important;
        }

        .header-content > *:first-child,
        .header-content h1,
        .header-content h2,
        .header-content h3,
        .header-content [class*="title"],
        .header-content [class*="heading"] {
          font-size: 12px !important;
          font-weight: 800 !important;
          line-height: 1.16 !important;
        }

        .assistant-shell__suggested-prompts {
          gap: 4px !important;
          padding: 5px 7px !important;
        }

        .content-wrapper {
          flex: 1 1 auto !important;
          min-block-size: 42px !important;
          overflow: auto !important;
          padding-block-start: 12px !important;
        }

        .assistant-shell__suggested-prompts-container {
          block-size: auto !important;
        }

        .assistant-chat-entry__input-container {
          display: grid !important;
          gap: 3px !important;
          grid-template-rows: 34px 22px !important;
          min-block-size: 59px !important;
        }

        .assistant-chat-entry__footer,
        .assistant-chat-entry__footer-end {
          align-items: center !important;
          block-size: 22px !important;
          display: flex !important;
          min-block-size: 22px !important;
          padding: 0 !important;
        }

        .assistant-chat-entry__footer {
          justify-content: stretch !important;
        }

        .assistant-chat-entry__footer-end {
          justify-content: flex-end !important;
        }

        .assistant-chat-entry__footer-end calcite-button {
          inline-size: auto !important;
          min-block-size: 18px !important;
          min-inline-size: 42px !important;
        }

        .assistant-chat-card,
        .assistant-chat-card-content,
        .assistant-chat-card__response-container,
        .assistant-chat-card__content-container,
        .assistant-chat-card-content__text-container {
          max-inline-size: 100% !important;
        }

        .assistant-chat-card {
          align-items: start !important;
          display: block !important;
          inline-size: 100% !important;
          justify-items: stretch !important;
          margin-block: 0 12px !important;
          min-block-size: 34px !important;
          padding-inline: 8px 12px !important;
          position: relative !important;
        }

        .assistant-chat-card:has(.assistant-chat-card__user-message):not(:has(.assistant-chat-card__response-container, .assistant-chat-card__content-container)),
        .assistant-chat-card:has(.assistant-chat-card__user):not(:has(.assistant-chat-card__response-container, .assistant-chat-card__content-container)) {
          display: flex !important;
          justify-content: flex-end !important;
          padding-inline: 28px 12px !important;
        }

        .assistant-chat-card.globby-loading-card {
          align-items: center !important;
          column-gap: 10px !important;
          inline-size: 100% !important;
          margin-block: 4px 8px !important;
          min-block-size: 34px !important;
          padding-inline: 8px 12px !important;
          position: relative !important;
        }

        .assistant-chat-card.globby-loading-card .assistant-chat-card__response-container {
          align-items: center !important;
          display: grid !important;
          grid-template-columns: 30px minmax(0, 1fr) !important;
          inline-size: 100% !important;
          justify-content: flex-start !important;
          min-block-size: 28px !important;
          min-inline-size: 0 !important;
        }

        .assistant-chat-card.globby-loading-card .assistant-chat-card__content-container,
        .assistant-chat-card.globby-loading-card .assistant-chat-card-content,
        .assistant-chat-card.globby-loading-card .assistant-chat-card-content__text-container {
          align-self: center !important;
          grid-column: 2 !important;
          min-block-size: 0 !important;
          min-inline-size: 0 !important;
        }

        .assistant-chat-card.globby-loading-card .assistant-chat-card-content__text-container {
          align-items: center !important;
          display: flex !important;
        }

        .assistant-chat-card.globby-loading-card > .assistant-chat-card__response-icon,
        .assistant-chat-card.globby-loading-card .assistant-chat-card__response-icon {
          display: none !important;
        }

        .assistant-chat-card.globby-loading-card ul,
        .assistant-chat-card.globby-loading-card ol {
          list-style: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        .assistant-chat-card.globby-loading-card li {
          list-style: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        .assistant-chat-card.globby-loading-card li::marker {
          content: "" !important;
        }

        .assistant-chat-card.globby-loading-card .globby-thinking-status {
          justify-self: start !important;
          margin-inline: 0 auto !important;
          inline-size: 100% !important;
          max-inline-size: 100% !important;
        }

        .assistant-chat-card-content,
        .assistant-chat-card__content-container,
        .assistant-chat-card-content__text-container {
          background: rgba(242, 248, 245, 0.88) !important;
          border: 1px solid rgba(31, 143, 133, 0.16) !important;
          border-radius: 8px 8px 8px 3px !important;
          color: #17211f !important;
          padding: 7px 8px !important;
          overflow-wrap: anywhere !important;
          box-shadow: 0 3px 8px rgba(23, 33, 31, 0.05) !important;
        }

        .assistant-chat-card-content.globby-loading-card-content {
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          padding: 0 !important;
        }

        .assistant-chat-card__response-container {
          background: transparent !important;
          border: 0 !important;
          display: grid !important;
          gap: 5px !important;
          grid-template-columns: 30px minmax(0, 1fr) !important;
          inline-size: 100% !important;
          justify-items: stretch !important;
          justify-self: stretch !important;
          padding: 0 !important;
        }

        .assistant-chat-card__response-container::before {
          align-items: center !important;
          align-self: start !important;
          background: #1f8f85 !important;
          block-size: 24px !important;
          border-radius: 999px !important;
          box-shadow: 0 3px 8px rgba(23, 33, 31, 0.12) !important;
          box-sizing: border-box !important;
          color: #ffffff !important;
          content: "AI" !important;
          display: inline-flex !important;
          font-size: 8px !important;
          font-weight: 800 !important;
          grid-column: 1 !important;
          inline-size: 24px !important;
          justify-content: center !important;
          justify-self: start !important;
          letter-spacing: 0 !important;
          line-height: 1 !important;
          margin-block-start: 1px !important;
        }

        .assistant-chat-card__response-container > .assistant-chat-card-content,
        .assistant-chat-card__response-container > .assistant-chat-card__content-container,
        .assistant-chat-card__response-container > .assistant-chat-card-content__text-container,
        .assistant-chat-card__content-container {
          background: rgba(242, 248, 245, 0.88) !important;
          border: 1px solid rgba(31, 143, 133, 0.16) !important;
          border-radius: 8px 8px 8px 3px !important;
          box-shadow: 0 3px 8px rgba(23, 33, 31, 0.05) !important;
          grid-column: 2 !important;
          inline-size: 100% !important;
          justify-self: stretch !important;
          margin-inline: 0 auto !important;
          max-inline-size: 100% !important;
          padding: 8px 9px !important;
        }

        .assistant-chat-card__response-container > *,
        .assistant-chat-card__content-container > * {
          grid-column: 2 !important;
          justify-self: start !important;
          margin-inline-start: 0 !important;
          margin-inline-end: auto !important;
          max-inline-size: 100% !important;
        }

        .assistant-chat-card__response-container calcite-card,
        .assistant-chat-card__response-container [class*="card"],
        .assistant-chat-card__content-container calcite-card,
        .assistant-chat-card__content-container [class*="card"] {
          inline-size: 100% !important;
          justify-self: stretch !important;
          margin-inline: 0 !important;
          max-inline-size: 100% !important;
        }

        .assistant-chat-card__response-icon {
          display: none !important;
        }

        .assistant-chat-card__response-icon calcite-icon,
        .assistant-chat-card__response-icon svg {
          block-size: 14px !important;
          inline-size: 14px !important;
        }

        .assistant-chat-card__response-container calcite-progress,
        .assistant-chat-card__response-container progress,
        .assistant-chat-card__response-container [role="progressbar"] {
          accent-color: #1f8f85 !important;
          block-size: 4px !important;
          border-radius: 999px !important;
          color: #1f8f85 !important;
        }

        .assistant-chat-card__content-container {
          inline-size: 100% !important;
          justify-self: stretch !important;
          min-block-size: 34px !important;
        }

        .assistant-chat-card__content-container .assistant-chat-card-content__text-container {
          background: transparent !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          padding: 0 !important;
        }

        .assistant-chat-card-content__text-container:has(.assistant-chat-card-content__loading-container) {
          background: transparent !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          display: block !important;
          min-block-size: 0 !important;
          overflow: visible !important;
          padding: 0 !important;
        }

        .assistant-chat-card-content__loading-container,
        .assistant-chat-card-content__loading {
          align-items: center !important;
          background: transparent !important;
          block-size: auto !important;
          border: 0 !important;
          display: flex !important;
          inline-size: auto !important;
          min-block-size: 0 !important;
          overflow: hidden !important;
          padding: 0 !important;
        }

        .assistant-chat-card-content__loading-container > :not(.assistant-chat-card-content__loading) {
          display: none !important;
        }

        .assistant-chat-card__response-container:empty,
        .assistant-chat-card-content__text-container:empty {
          min-block-size: 24px !important;
        }

        .assistant-chat-card__response-container p,
        .assistant-chat-card-content__text-container p,
        .assistant-chat-card__response-container li,
        .assistant-chat-card-content__text-container li {
          font-size: 12px !important;
          line-height: 1.34 !important;
          margin-block: 0 4px !important;
        }

        .assistant-chat-card__response-container ul,
        .assistant-chat-card-content__text-container ul,
        .assistant-chat-card__response-container ol,
        .assistant-chat-card-content__text-container ol {
          margin-block: 0 !important;
          padding-inline-start: 14px !important;
        }

        .assistant-chat-card__actions,
        .assistant-chat-card-content__footer,
        .assistant-chat-card__footer {
          align-items: center !important;
          display: flex !important;
          gap: 4px !important;
          justify-content: flex-start !important;
          padding-block-start: 4px !important;
        }

        .assistant-chat-card__footer {
          grid-column: 2 !important;
          padding-block-start: 3px !important;
        }

        .assistant-chat-card__avatar,
        .assistant-chat-card__avatar-container,
        .assistant-message-avatar,
        [class*="thinking"],
        [class*="loading"],
        [class*="spinner"] {
          color: #1f8f85 !important;
        }

        [class*="thinking"],
        [class*="loading"] {
          background: rgba(31, 143, 133, 0.12) !important;
          border-color: rgba(31, 143, 133, 0.32) !important;
        }

        .assistant-chat-card-content__loading-container,
        .assistant-chat-card-content__loading {
          background: transparent !important;
          border-color: transparent !important;
        }

        .globby-thinking-status {
          align-items: flex-start !important;
          background: rgba(31, 143, 133, 0.14) !important;
          border: 1px solid rgba(31, 143, 133, 0.24) !important;
          border-radius: 9px !important;
          color: #1f8f85 !important;
          display: inline-flex !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          gap: 6px !important;
          line-height: 1.18 !important;
          margin: 0 !important;
          max-inline-size: 100% !important;
          min-block-size: 29px !important;
          overflow: visible !important;
          padding: 6px 8px !important;
          white-space: normal !important;
        }

        .globby-thinking-status,
        .globby-thinking-status * {
          overflow: visible !important;
          text-overflow: clip !important;
          white-space: normal !important;
        }

        .globby-thinking-status::before {
          animation: assistant-spin 1s linear infinite;
          border: 2px solid rgba(31, 143, 133, 0.24);
          border-radius: 999px;
          border-top-color: #1f8f85;
          block-size: 9px;
          content: "";
          flex: 0 0 9px;
          inline-size: 9px;
          margin-block-start: 1px;
        }

        @keyframes assistant-spin {
          to {
            transform: rotate(360deg);
          }
        }

        [class*="spinner"] {
          border-color: rgba(31, 143, 133, 0.24) !important;
          border-top-color: #1f8f85 !important;
        }

        .assistant-chat-card__avatar,
        .assistant-chat-card__avatar-container,
        .assistant-message-avatar {
          align-items: center !important;
          background: #1f8f85 !important;
          block-size: 18px !important;
          border-radius: 999px !important;
          color: #ffffff !important;
          display: inline-flex !important;
          flex: 0 0 18px !important;
          inline-size: 18px !important;
          justify-content: center !important;
          overflow: hidden !important;
        }

        .assistant-chat-card__avatar::after,
        .assistant-chat-card__avatar-container::after,
        .assistant-message-avatar::after {
          background: currentColor;
          block-size: 7px;
          border-radius: 999px;
          content: "";
          inline-size: 7px;
        }

        .footer {
          flex: 0 0 auto !important;
          background: rgba(251, 250, 246, 0.94) !important;
          border-top: 1px solid rgba(31, 143, 133, 0.18) !important;
          padding: 5px 7px 6px !important;
        }

        .footer-content {
          gap: 3px !important;
        }

        calcite-accordion,
        calcite-accordion-item,
        details {
          border: 1px solid rgba(31, 143, 133, 0.14) !important;
          border-radius: 7px !important;
          background: rgba(242, 248, 245, 0.72) !important;
          overflow: hidden !important;
        }

        calcite-accordion-item::part(header),
        summary {
          min-block-size: 24px !important;
          padding: 4px 8px !important;
          font-size: 10px !important;
        }

        .notice-content {
          padding: 3px 6px 3px 0 !important;
        }

        /* The stock assistant welcome notice is useful in a full panel, but too
           tall for this Globby bubble. Prompts plus the input are enough here. */
        calcite-notice {
          display: none !important;
        }

        .notice-content > *,
        .message,
        .content {
          font-size: 12px !important;
          line-height: 1.18 !important;
        }

        h1,
        h2,
        h3 {
          font-size: 14px !important;
          line-height: 1.16 !important;
        }

        p,
        span,
        label,
        textarea,
        input {
          font-size: 12px !important;
          line-height: 1.24 !important;
        }

        button,
        [role="button"] {
          min-block-size: 16px !important;
          padding-block: 1px !important;
          padding-inline: 4px !important;
          font-size: 8px !important;
          line-height: 1 !important;
        }
      `;
        root.append(style);
      }

      root
        .querySelectorAll("calcite-button, calcite-action, calcite-chip")
        .forEach((control) => {
          const controlRoot = control.shadowRoot;
          if (
            !controlRoot ||
            controlRoot.querySelector("#globby-control-size-patch")
          ) {
            return;
          }

          const style = document.createElement("style");
          style.id = "globby-control-size-patch";
          style.textContent = `
        :host {
          --calcite-font-size--1: 10px;
          --calcite-font-size-0: 11px;
          inline-size: auto !important;
        }

        button,
        .button,
        .container {
          min-block-size: 18px !important;
          block-size: 18px !important;
          padding-block: 1px !important;
          padding-inline: 4px !important;
          font-size: 8px !important;
          line-height: 1 !important;
        }

        calcite-icon,
        svg {
          block-size: 10px !important;
          inline-size: 10px !important;
          max-block-size: 10px !important;
          max-inline-size: 10px !important;
        }

        calcite-icon {
          margin-inline-end: -1px !important;
          transform: scale(0.82) !important;
          transform-origin: center !important;
        }
      `;
          controlRoot.append(style);
        });

      root
        .querySelectorAll("calcite-text-area, calcite-input-text")
        .forEach((control) => {
          const controlRoot = control.shadowRoot;
          if (
            !controlRoot ||
            controlRoot.querySelector("#globby-input-size-patch")
          ) {
            return;
          }

          const style = document.createElement("style");
          style.id = "globby-input-size-patch";
          style.textContent = `
        textarea,
        input {
          font-size: 11px !important;
          min-block-size: 34px !important;
          padding: 4px 6px !important;
        }

        .footer {
          padding: 4px 7px !important;
        }

        .container {
          padding: 3px 5px !important;
        }

        article.container,
        .interaction-container > article.container {
          box-sizing: border-box !important;
          padding-block-end: 14px !important;
        }

        .interaction-container {
          box-sizing: border-box !important;
          padding-block-end: 10px !important;
        }
      `;
          controlRoot.append(style);
        });
    });
    normalizeAssistantResponseIcons();
    markAssistantThinkingStatus();
    watchAssistantWork();
  }

  function runAssistantPatchPass() {
    patchAssistantDensity();
    patchNestedAssistantControls();
    normalizeAssistantResponseIcons();
    markAssistantThinkingStatus();
    updateAssistantChatDensity();
    watchAssistantWork();
  }

  function queueAssistantPatchLoop(duration = 5000) {
    clearInterval(assistantPatchLoopTimer);
    const startedAt = performance.now();

    runAssistantPatchPass();
    assistantPatchLoopTimer = window.setInterval(() => {
      runAssistantPatchPass();
      if (performance.now() - startedAt > duration) {
        clearInterval(assistantPatchLoopTimer);
        assistantPatchLoopTimer = null;
      }
    }, 300);
  }

  function normalizeAssistantResponseIcons() {
    getOpenRoots(assistantElement).forEach((root) => {
      root
        .querySelectorAll(".globby-response-avatar")
        .forEach((avatar) => avatar.remove());
      root
        .querySelectorAll(".assistant-chat-card__response-icon")
        .forEach((icon) => {
          icon.setAttribute("scale", "s");
          icon.style.setProperty("display", "none", "important");
        });
    });
  }

  function markAssistantThinkingStatus() {
    const statusPattern =
      /asking llm|requesting llm|detect intents|similarity search|vector search|getting statistics|search to find|find layers|layer query|query results|thinking|working/i;

    getOpenRoots(assistantElement).forEach((root) => {
      root.querySelectorAll(".globby-thinking-status").forEach((element) => {
        element.classList.remove("globby-thinking-status");
      });
      root
        .querySelectorAll(".globby-loading-card, .globby-loading-card-content")
        .forEach((element) => {
          element.classList.remove(
            "globby-loading-card",
            "globby-loading-card-content",
          );
        });

      const candidates = Array.from(root.querySelectorAll("*"))
        .filter((element) => {
          if (["SCRIPT", "STYLE"].includes(element.tagName)) {
            return false;
          }

          const rect = element.getBoundingClientRect?.();
          if (
            !rect ||
            rect.width === 0 ||
            rect.height === 0 ||
            rect.height > 32 ||
            rect.width > 230
          ) {
            return false;
          }

          const text = element.textContent.replace(/\s+/g, " ").trim();

          if (
            text.length < 4 ||
            text.length > 140 ||
            !statusPattern.test(text)
          ) {
            return false;
          }

          return !Array.from(element.children).some((child) => {
            const childRect = child.getBoundingClientRect?.();
            const childText =
              child.textContent?.replace(/\s+/g, " ").trim() || "";
            return (
              childRect?.width > 0 &&
              childRect?.height > 0 &&
              childRect.height <= 32 &&
              childRect.width <= 230 &&
              childText.length <= 140 &&
              statusPattern.test(childText)
            );
          });
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (
            leftRect.width * leftRect.height -
            rightRect.width * rightRect.height
          );
        });

      candidates.slice(0, 3).forEach((element) => {
        element.classList?.add("globby-thinking-status");
        element
          .closest(".assistant-chat-card")
          ?.classList?.add("globby-loading-card");
        element
          .closest(".assistant-chat-card-content")
          ?.classList?.add("globby-loading-card-content");
      });
    });
  }

  function watchAssistantWork() {
    // Watch the assistant's shadow DOM for submit/progress/result changes so the
    // animated character can enter/leave the chat state with the real workflow.
    if (!assistantElement) {
      return;
    }

    getOpenRoots(assistantElement).forEach((root) => {
      if (watchedAssistantRoots.has(root)) {
        return;
      }

      watchedAssistantRoots.add(root);
      root.addEventListener("click", handleAssistantIntent, true);
      root.addEventListener("keydown", handleAssistantIntent, true);

      const observer = new MutationObserver(() => {
        requestAnimationFrame(() => {
          patchNestedAssistantControls();
          normalizeAssistantResponseIcons();
          markAssistantThinkingStatus();
          updateAssistantChatDensity();
        });
        if (!assistantBusy) {
          return;
        }

        const currentSignature = getAssistantResponseSignature();
        if (
          currentSignature &&
          currentSignature !== assistantSignatureBeforeSubmit
        ) {
          updateAssistantChatDensity();
          setTimeout(() => setAssistantBusy(false), 350);
        }
      });
      observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
  }

  function handleAssistantIntent(event) {
    if (isAssistantSubmit(event)) {
      assistantSignatureBeforeSubmit = getAssistantResponseSignature();
      setAssistantBusy(true);
    }
  }

  function isAssistantSubmit(event) {
    if (event.type === "keydown") {
      const targetName = event.target?.tagName?.toLowerCase();
      return (
        event.key === "Enter" &&
        !event.shiftKey &&
        ["textarea", "input", "calcite-text-area"].includes(targetName)
      );
    }

    return event.composedPath().some((element) => {
      const tagName = element?.tagName?.toLowerCase();
      const label = `${element?.textContent || ""} ${element?.ariaLabel || ""}`
        .trim()
        .toLowerCase();
      return (
        ["button", "calcite-button"].includes(tagName) && /\bask\b/.test(label)
      );
    });
  }

  function getAssistantResponseSignature() {
    return getOpenRoots(assistantElement)
      .flatMap((root) => [
        ...root.querySelectorAll(
          ".assistant-chat-card__response-container, .assistant-chat-card-content__text-container",
        ),
      ])
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("|");
  }

  function updateAssistantChatDensity() {
    if (!assistantBubble) {
      return;
    }

    if (assistantBusy || getAssistantResponseSignature()) {
      assistantBubble.dataset.chat = "active";
      return;
    }

    delete assistantBubble.dataset.chat;
  }

  function getOpenRoots(rootHost) {
    const roots = [];
    const seen = new Set();
    const visit = (node) => {
      if (node.shadowRoot && !seen.has(node.shadowRoot)) {
        seen.add(node.shadowRoot);
        roots.push(node.shadowRoot);
        node.shadowRoot.querySelectorAll("*").forEach(visit);
      }
      node.querySelectorAll?.("*").forEach(visit);
    };

    visit(rootHost);
    return roots;
  }
}
