import "./tiny-assistant-character.js";
import { initializeTinyAssistant } from "../lib/tiny-assistant-controller.js";

let assistantInstanceCount = 0;

// The public element is intentionally light-DOM based. ArcGIS assistant agents
// are slotted as children by the page author, then moved into the internal
// <arcgis-assistant> so Esri's component owns the actual AI workflow.
const booleanAttribute = (element, name) => element.hasAttribute(name);

function createElement(tagName, attributes = {}, children = []) {
  const element = document.createElement(tagName);

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === false || value == null) {
      return;
    }

    if (value === true) {
      element.setAttribute(name, "");
      return;
    }

    element.setAttribute(name, value);
  });

  children.forEach((child) => {
    element.append(child);
  });

  return element;
}

function createAssistantHeader() {
  const title = createElement("strong", { class: "tiny-assistant-title" }, [
    document.createTextNode("Tiny Assistant"),
  ]);
  const status = createElement("small", { class: "tiny-assistant-status" }, [
    document.createTextNode("ArcGIS sign-in required"),
  ]);
  const text = createElement("span", {}, [title, status]);
  const spinner = createElement("span", {
    class: "assistant-spinner",
    "aria-hidden": "true",
  });

  return createElement("header", { class: "assistant-header" }, [
    text,
    spinner,
  ]);
}

function createMenuButton(attributes, label) {
  return createElement(
    "button",
    { type: "button", role: "menuitem", ...attributes },
    [document.createTextNode(label)],
  );
}

function parseSuggestedPrompts(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    // Pipe-separated prompts are a lightweight fallback for hand-written HTML.
    return value
      .split("|")
      .map((prompt) => prompt.trim())
      .filter(Boolean);
  }
}

class TinyArcgisAssistant extends HTMLElement {
  #controller = null;

  connectedCallback() {
    if (this.dataset.ready === "true") {
      return;
    }

    const agents = Array.from(this.children);
    const startHidden = booleanAttribute(this, "start-hidden");
    const spriteSrc = this.getAttribute("sprite-src") || "";
    const referenceElement =
      this.getAttribute("reference-element") || "arcgis-map";
    const heading = this.getAttribute("heading") || "ArcGIS AI Assistant";
    const description = this.getAttribute("description") || "";
    const suggestedPrompts = parseSuggestedPrompts(
      this.getAttribute("suggested-prompts"),
    );
    const instanceId = `tiny-assistant-${++assistantInstanceCount}`;
    const cardId = `${instanceId}-card`;

    // Fixed document IDs would make two Tiny Assistants collide. The only ID we
    // generate is unique and used by aria-controls on this instance's toggle.
    this.dataset.ready = "true";
    this.replaceChildren();

    const globby = createElement("tiny-assistant-character", {
      class: "tiny-assistant-character",
      title: "Globby",
      "sprite-src": spriteSrc,
      hidden: startHidden,
    });

    const assistant = createElement("arcgis-assistant", {
      "log-enabled": true,
      "copy-enabled": true,
      "reference-element": referenceElement,
      heading,
      description,
    });
    agents.forEach((agent) => assistant.append(agent));
    if (suggestedPrompts.length > 0) {
      assistant.suggestedPrompts = suggestedPrompts;
    }

    const card = createElement(
      "section",
      {
        id: cardId,
        class: "assistant-card",
        "aria-label": "Tiny ArcGIS assistant",
      },
      [createAssistantHeader(), assistant],
    );

    const toggleIcon = createElement("span", { "aria-hidden": "true" });
    const toggle = createElement(
      "button",
      {
        class: "assistant-toggle",
        type: "button",
        "aria-expanded": "false",
        "aria-controls": cardId,
        "aria-label": "Expand Tiny Assistant chat",
      },
      [toggleIcon],
    );

    const bubble = createElement(
      "aside",
      {
        class: "assistant-bubble",
        "aria-label": "Tiny Assistant chat",
        "data-mode": "peek",
        hidden: startHidden,
      },
      [card, toggle],
    );

    const menu = createElement("menu", { class: "globby-menu", hidden: true }, [
      createMenuButton(
        {
          class: "follow-cursor-toggle",
          role: "menuitemcheckbox",
          "aria-checked": "true",
        },
        "Follow cursor",
      ),
      createMenuButton({ class: "panel-menu-toggle" }, "Open chat"),
      createMenuButton(
        { class: "hide-tiny-assistant-button" },
        "Hide Tiny Assistant",
      ),
    ]);

    const showButton = createElement(
      "button",
      {
        class: "show-globby-button show-tiny-assistant-button",
        type: "button",
        hidden: !startHidden,
      },
      [document.createTextNode("Show Tiny Assistant")],
    );

    this.append(globby, bubble, menu, showButton);

    // Everything after DOM creation is per instance: auth gating, dragging,
    // panel layout, and ArcGIS assistant styling patches.
    this.#controller = initializeTinyAssistant(this);
    this.dispatchEvent(
      new CustomEvent("tiny-assistant-ready", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  disconnectedCallback() {
    this.#controller?.disconnect?.();
    this.#controller = null;
  }
}

if (!customElements.get("tiny-arcgis-assistant")) {
  customElements.define("tiny-arcgis-assistant", TinyArcgisAssistant);
}
