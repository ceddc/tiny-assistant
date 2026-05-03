const DEFAULT_FRAME = {
  columns: 8,
  rows: 9,
  idleRow: 0,
  walkRightRow: 1,
  walkLeftRow: 2,
  waveRow: 3,
  jumpRow: 4,
  failedRow: 5,
  waitingRow: 6,
  runRow: 7,
  reviewRow: 8,
};

const FOLLOW_CURSOR = {
  // Distance is measured from Globby's center. 76px leaves about 30px of air
  // outside the sprite body, so the cursor never lands on top of Globby.
  distance: 92,
  minStep: 0.05,
  speed: 2.04,
};

const ASSISTANT_SIZE = {
  width: 77.44,
  height: 83.893,
  centerOffsetX: 38.72,
  centerOffsetY: 41.14,
};

const IDLE_FRAMES = [
  { frame: 0, duration: 280 },
  { frame: 1, duration: 110 },
  { frame: 2, duration: 110 },
  { frame: 3, duration: 140 },
  { frame: 4, duration: 140 },
  { frame: 5, duration: 320 },
];
const OPEN_IDLE_MULTIPLIER = 0.65;
const WAITING_IDLE_FRAMES = [
  { frame: 0, duration: 220 },
  { frame: 1, duration: 150 },
  { frame: 2, duration: 150 },
  { frame: 3, duration: 170 },
  { frame: 4, duration: 170 },
  { frame: 5, duration: 240 },
  { frame: 4, duration: 170 },
  { frame: 3, duration: 170 },
  { frame: 2, duration: 150 },
  { frame: 1, duration: 150 },
  { row: DEFAULT_FRAME.idleRow, frame: 0, duration: 2600 },
];
const WORKING_LOOP = [
  // Keep processing on one sprite row. Mixing rows looked like a visual blink
  // because each row has a slightly different silhouette and registration.
  { row: DEFAULT_FRAME.waitingRow, frame: 0, duration: 190 },
  { row: DEFAULT_FRAME.waitingRow, frame: 1, duration: 130 },
  { row: DEFAULT_FRAME.waitingRow, frame: 2, duration: 130 },
  { row: DEFAULT_FRAME.waitingRow, frame: 3, duration: 150 },
  { row: DEFAULT_FRAME.waitingRow, frame: 4, duration: 150 },
  { row: DEFAULT_FRAME.waitingRow, frame: 5, duration: 240 },
  { row: DEFAULT_FRAME.waitingRow, frame: 4, duration: 150 },
  { row: DEFAULT_FRAME.waitingRow, frame: 3, duration: 150 },
  { row: DEFAULT_FRAME.waitingRow, frame: 2, duration: 130 },
  { row: DEFAULT_FRAME.waitingRow, frame: 1, duration: 130 },
];
const IDLE_LOOPS = [
  {
    row: DEFAULT_FRAME.idleRow,
    frames: [...IDLE_FRAMES, { frame: 0, duration: 2400 }],
  },
  {
    row: DEFAULT_FRAME.waitingRow,
    frames: WAITING_IDLE_FRAMES,
  },
  {
    row: DEFAULT_FRAME.idleRow,
    frames: [...IDLE_FRAMES, { frame: 0, duration: 2100 }],
  },
  {
    row: DEFAULT_FRAME.waitingRow,
    frames: WAITING_IDLE_FRAMES,
  },
  {
    row: DEFAULT_FRAME.waitingRow,
    frames: WAITING_IDLE_FRAMES,
  },
  {
    row: DEFAULT_FRAME.waveRow,
    frames: [
      { frame: 0, duration: 260 },
      { frame: 1, duration: 140 },
      { frame: 2, duration: 140 },
      { frame: 3, duration: 180 },
      { frame: 2, duration: 140 },
      { frame: 1, duration: 140 },
      { row: DEFAULT_FRAME.idleRow, frame: 0, duration: 6200 },
    ],
  },
];

function getTimelineFrame(timeline, time = Date.now()) {
  const period = timeline.reduce((total, frame) => total + frame.duration, 0);
  let elapsed = time % period;
  let currentFrame = timeline[0];

  for (const frame of timeline) {
    currentFrame = frame;
    if (elapsed < frame.duration) {
      break;
    }
    elapsed -= frame.duration;
  }

  return currentFrame;
}

const template = document.createElement("template");
template.innerHTML = `
  <style>
    @property --frame {
      syntax: "<integer>";
      inherits: false;
      initial-value: 0;
    }

    :host {
      --assistant-accent: #1f8f85;
      --assistant-ink: #17211f;
      --assistant-panel: color-mix(in srgb, white 92%, var(--assistant-accent));
      display: block;
      font: 14px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      inset: 0;
      pointer-events: none;
      position: fixed;
      z-index: 7;
    }

    .sprite {
      background-image: var(--sprite);
      background-position: calc(var(--frame, 0) * var(--cell-w, 64px) * -1) calc(var(--row, 0) * var(--cell-h, 69.333px) * -1);
      background-repeat: no-repeat;
      background-size: calc(var(--columns, 8) * var(--cell-w, 64px)) calc(var(--rows, 9) * var(--cell-h, 69.333px));
      height: var(--cell-h, 69.333px);
      image-rendering: pixelated;
      width: var(--cell-w, 64px);
    }

    .runner {
      cursor: grab;
      filter: drop-shadow(0 10px 12px color-mix(in srgb, var(--assistant-ink), transparent 72%));
      left: 0;
      pointer-events: auto;
      position: absolute;
      touch-action: none;
      top: 0;
      transform: translate3d(var(--assistant-x, 50vw), var(--assistant-y, 50vh), 0);
      transform-origin: center bottom;
      width: var(--cell-w, 64px);
      will-change: transform, background-position;
      z-index: 4;
    }

    .runner:active {
      cursor: grabbing;
    }

    :host([moving][direction="right"]) .runner {
      --row: var(--walk-right-row, 1);
      filter: drop-shadow(0 14px 16px color-mix(in srgb, var(--assistant-ink), transparent 68%));
    }

    :host([moving][direction="left"]) .runner {
      --row: var(--walk-left-row, 2);
      filter: drop-shadow(0 14px 16px color-mix(in srgb, var(--assistant-ink), transparent 68%));
    }

    :host(:not([moving])) .runner {
      --row: var(--idle-row, 0);
    }

    :host(:not([moving])[state="waiting"]) .runner {
      --row: var(--waiting-row, 6);
    }

    :host(:not([moving])[state="wave"]) .runner {
      --row: var(--wave-row, 3);
    }

    :host(:not([moving])[state="jump"]) .runner {
      --row: var(--jump-row, 4);
    }

    :host(:not([moving])[state="failed"]) .runner {
      --row: var(--failed-row, 5);
    }

    :host(:not([moving])[state="review"]) .runner {
      --row: var(--review-row, 8);
    }

    :host(:not([moving])[state="chat"]) .runner {
      --row: var(--waiting-row, 6);
    }

    :host(:not([moving])[state="working"]) .runner {
      --row: var(--waiting-row, 6);
    }
  </style>

  <div class="runner sprite" part="runner" aria-hidden="true"></div>
`;

export class TinyAssistantCharacter extends HTMLElement {
  static observedAttributes = ["sprite-src", "title"];

  #dragOffset = { x: 0, y: 0 };
  #frameIndex = 0;
  #frameTimer = null;
  #followAnimation = null;
  #followCursor = null;
  #followEnabled = false;
  #isDragging = false;
  #lastDirection = "right";
  #pointerStart = null;
  #pointerMoved = false;
  #runner = { x: 96, y: 96 };
  #settleTimer = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.append(template.content.cloneNode(true));
  }

  connectedCallback() {
    this.#renderShell();
    this.#centerRunner();
    this.dispatchEvent(
      new CustomEvent("tiny-assistant-ready", {
        bubbles: true,
        composed: true,
      }),
    );
    this.shadowRoot
      .querySelector(".runner")
      .addEventListener("pointerdown", this.#handlePointerDown);
    window.addEventListener("pointermove", this.#handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", this.#handlePointerUp);
    window.addEventListener("resize", this.#centerRunner);
    this.#frameTimer = window.setInterval(() => this.#tickSpriteFrame(), 120);
  }

  disconnectedCallback() {
    clearInterval(this.#frameTimer);
    cancelAnimationFrame(this.#followAnimation);
    clearTimeout(this.#settleTimer);
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    window.removeEventListener("resize", this.#centerRunner);
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.#renderShell();
    }
  }

  moveBy(deltaX, deltaY) {
    this.#runner = {
      x: this.#runner.x + deltaX,
      y: this.#runner.y + deltaY,
    };
    this.#setMotion(deltaX);
    this.#paintRunner();
  }

  moveToCenter(x, y) {
    this.#runner = {
      x: x - ASSISTANT_SIZE.centerOffsetX,
      y: y - ASSISTANT_SIZE.centerOffsetY,
    };
    this.#paintRunner();
  }

  setAvatarState(state) {
    if (
      [
        "idle",
        "waiting",
        "wave",
        "jump",
        "failed",
        "review",
        "chat",
        "working",
      ].includes(state)
    ) {
      this.setAttribute("state", state);
    }
  }

  setChatOpen(open) {
    this.toggleAttribute("chat-open", open);
  }

  setFollowCursor(enabled) {
    this.#followEnabled = enabled;
    if (enabled) {
      this.#startFollowingCursor();
      return;
    }

    cancelAnimationFrame(this.#followAnimation);
    this.#followAnimation = null;
    this.#followCursor = null;
    this.toggleAttribute("moving", false);
  }

  #renderShell() {
    const spriteSrc = this.getAttribute("sprite-src") || "";
    this.style.setProperty("--sprite", `url("${spriteSrc}")`);
    this.style.setProperty("--columns", DEFAULT_FRAME.columns);
    this.style.setProperty("--rows", DEFAULT_FRAME.rows);
    this.style.setProperty("--cell-w", `${ASSISTANT_SIZE.width}px`);
    this.style.setProperty("--cell-h", `${ASSISTANT_SIZE.height}px`);
    this.style.setProperty("--idle-row", DEFAULT_FRAME.idleRow);
    this.style.setProperty("--walk-right-row", DEFAULT_FRAME.walkRightRow);
    this.style.setProperty("--walk-left-row", DEFAULT_FRAME.walkLeftRow);
    this.style.setProperty("--wave-row", DEFAULT_FRAME.waveRow);
    this.style.setProperty("--jump-row", DEFAULT_FRAME.jumpRow);
    this.style.setProperty("--failed-row", DEFAULT_FRAME.failedRow);
    this.style.setProperty("--waiting-row", DEFAULT_FRAME.waitingRow);
    this.style.setProperty("--run-row", DEFAULT_FRAME.runRow);
    this.style.setProperty("--review-row", DEFAULT_FRAME.reviewRow);
  }

  #handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const runner = this.shadowRoot.querySelector(".runner");
    runner.setPointerCapture?.(event.pointerId);
    this.#isDragging = true;
    this.#pointerMoved = false;
    this.#pointerStart = { x: event.clientX, y: event.clientY };
    this.#setMotion(0);
    this.#dragOffset = {
      x: event.clientX - this.#runner.x,
      y: event.clientY - this.#runner.y,
    };
  };

  #handlePointerMove = (event) => {
    if (this.#isDragging) {
      if (
        this.#pointerStart &&
        Math.hypot(
          event.clientX - this.#pointerStart.x,
          event.clientY - this.#pointerStart.y,
        ) > 4
      ) {
        this.#pointerMoved = true;
      }
      this.#runner = {
        x: event.clientX - this.#dragOffset.x,
        y: event.clientY - this.#dragOffset.y,
      };
      this.#setMotion(event.movementX);
      this.#paintRunner();
      return;
    }

    if (this.#followEnabled) {
      this.#followCursor = { x: event.clientX, y: event.clientY };
      this.#startFollowingCursor();
      return;
    }

    const centerX = this.#runner.x + ASSISTANT_SIZE.centerOffsetX;
    if (Math.abs(event.clientX - centerX) > 18) {
      this.#lastDirection = event.clientX < centerX ? "left" : "right";
      this.setAttribute("direction", this.#lastDirection);
    }
  };

  #handlePointerUp = (event) => {
    const wasDragging = this.#isDragging;
    const wasClick = wasDragging && !this.#pointerMoved;
    this.#isDragging = false;
    this.#pointerStart = null;
    this.toggleAttribute("moving", false);
    if (wasClick) {
      this.dispatchEvent(
        new CustomEvent("tiny-assistant-click", {
          bubbles: true,
          composed: true,
          detail: { pointerId: event.pointerId },
        }),
      );
    } else if (wasDragging) {
      this.dispatchEvent(
        new CustomEvent("tiny-assistant-drag-end", {
          bubbles: true,
          composed: true,
          detail: { pointerId: event.pointerId },
        }),
      );
    }
  };

  #centerRunner = () => {
    this.#runner = {
      x: Math.max(24, window.innerWidth - 134),
      y: Math.max(24, window.innerHeight - 148),
    };
    this.#paintRunner();
  };

  #paintRunner() {
    const x = Math.min(
      Math.max(8, this.#runner.x),
      window.innerWidth - ASSISTANT_SIZE.width - 8,
    );
    const y = Math.min(
      Math.max(8, this.#runner.y),
      window.innerHeight - ASSISTANT_SIZE.height - 8,
    );
    this.#runner = { x, y };
    this.style.setProperty("--assistant-x", `${x}px`);
    this.style.setProperty("--assistant-y", `${y}px`);
    this.dispatchEvent(
      new CustomEvent("tiny-assistant-move", {
        bubbles: true,
        composed: true,
        detail: {
          direction: this.#lastDirection,
          x: x + ASSISTANT_SIZE.centerOffsetX,
          y: y + ASSISTANT_SIZE.centerOffsetY,
        },
      }),
    );
  }

  #setMotion(deltaX) {
    if (Math.abs(deltaX) > 0.4) {
      this.#lastDirection = deltaX < 0 ? "left" : "right";
      this.setAttribute("direction", this.#lastDirection);
    } else if (!this.hasAttribute("direction")) {
      this.setAttribute("direction", this.#lastDirection);
    }

    this.toggleAttribute("moving", true);
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      if (!this.#isDragging) {
        this.toggleAttribute("moving", false);
      }
    }, 180);
  }

  #startFollowingCursor() {
    if (this.#followAnimation) {
      return;
    }

    this.#followAnimation = requestAnimationFrame(this.#stepTowardCursor);
  }

  #stepTowardCursor = () => {
    this.#followAnimation = null;
    if (!this.#followEnabled || this.#isDragging || !this.#followCursor) {
      return;
    }

    const center = {
      x: this.#runner.x + ASSISTANT_SIZE.centerOffsetX,
      y: this.#runner.y + ASSISTANT_SIZE.centerOffsetY,
    };
    const delta = {
      x: this.#followCursor.x - center.x,
      y: this.#followCursor.y - center.y,
    };
    const distance = Math.hypot(delta.x, delta.y);

    if (distance <= FOLLOW_CURSOR.distance) {
      this.toggleAttribute("moving", false);
      return;
    }

    const targetCenter = {
      x: this.#followCursor.x - (delta.x / distance) * FOLLOW_CURSOR.distance,
      y: this.#followCursor.y - (delta.y / distance) * FOLLOW_CURSOR.distance,
    };
    const targetDistance = Math.hypot(
      targetCenter.x - center.x,
      targetCenter.y - center.y,
    );
    if (targetDistance <= FOLLOW_CURSOR.minStep) {
      this.toggleAttribute("moving", false);
      return;
    }

    const stepLength = Math.min(FOLLOW_CURSOR.speed, targetDistance);
    const step = {
      x: ((targetCenter.x - center.x) / targetDistance) * stepLength,
      y: ((targetCenter.y - center.y) / targetDistance) * stepLength,
    };

    if (Math.hypot(step.x, step.y) < FOLLOW_CURSOR.minStep) {
      this.toggleAttribute("moving", false);
      return;
    }

    this.#runner = {
      x: this.#runner.x + step.x,
      y: this.#runner.y + step.y,
    };
    this.#setMotion(step.x);
    this.#paintRunner();
    this.#followAnimation = requestAnimationFrame(this.#stepTowardCursor);
  };

  #clearSpriteRow() {
    this.shadowRoot.querySelector(".runner")?.style.removeProperty("--row");
  }

  #setSpriteFrame(frame, row = null) {
    if (row == null) {
      this.#clearSpriteRow();
    } else {
      this.shadowRoot.querySelector(".runner")?.style.setProperty("--row", row);
    }
    this.#frameIndex = frame;
    this.style.setProperty("--frame", this.#frameIndex);
  }

  #tickSpriteFrame() {
    if (this.#isDragging || this.hasAttribute("moving")) {
      this.#setSpriteFrame((this.#frameIndex + 1) % DEFAULT_FRAME.columns);
      return;
    }

    const state = this.getAttribute("state") || "idle";
    const animatedRows = {
      failed: [0, 1, 2, 3, 4, 5, 4, 3],
      jump: [0, 1, 2, 3, 4, 5, 6, 7],
      review: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1],
    };

    if (animatedRows[state]) {
      const frames = animatedRows[state];
      this.#setSpriteFrame(
        frames[Math.floor(Date.now() / 130) % frames.length],
      );
      return;
    }

    if (state === "wave") {
      const waveFrames = [0, 1, 2, 3, 2, 1];
      this.#setSpriteFrame(
        waveFrames[Math.floor(Date.now() / 120) % waveFrames.length],
      );
      return;
    }

    if (state === "working") {
      const frame = getTimelineFrame(WORKING_LOOP);
      this.#setSpriteFrame(frame.frame, frame.row);
      return;
    }

    if (state === "waiting" || state === "chat") {
      const waitingFrames = [0, 1, 2, 3, 4, 5];
      const frameTime = state === "chat" ? 150 : 180;
      this.#setSpriteFrame(
        waitingFrames[
          Math.floor(Date.now() / frameTime) % waitingFrames.length
        ],
      );
      return;
    }

    if (this.getAttribute("direction") && state === "idle") {
      this.removeAttribute("direction");
    }

    const openMultiplier = this.hasAttribute("chat-open")
      ? OPEN_IDLE_MULTIPLIER
      : 1;
    const idleTimeline = IDLE_LOOPS.flatMap((sequence) =>
      sequence.frames.map((frame) => ({
        ...frame,
        row: frame.row ?? sequence.row,
        duration: Math.round(frame.duration * openMultiplier),
      })),
    );
    const idlePeriod = idleTimeline.reduce(
      (total, frame) => total + frame.duration,
      0,
    );
    let elapsed = Date.now() % idlePeriod;
    let currentFrame = idleTimeline[0];
    for (const frame of idleTimeline) {
      currentFrame = frame;
      if (elapsed < frame.duration) {
        break;
      }
      elapsed -= frame.duration;
    }
    this.#setSpriteFrame(currentFrame.frame, currentFrame.row);
  }
}

if (!customElements.get("tiny-assistant-character")) {
  customElements.define("tiny-assistant-character", TinyAssistantCharacter);
}
