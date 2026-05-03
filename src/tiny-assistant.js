import tinyAssistantStyles from "./styles.css?inline";
import "./components/tiny-arcgis-assistant.js";

// CDN consumers load only this module. It registers the custom elements and
// injects the shared light-DOM CSS once, even if the script is imported twice.
if (!document.querySelector("style[data-tiny-assistant-styles]")) {
  const style = document.createElement("style");
  style.dataset.tinyAssistantStyles = "";
  style.textContent = tinyAssistantStyles;
  document.head.append(style);
}
