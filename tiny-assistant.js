// Dev-time shim: Vite serves this path from the repo root so the demo and the
// external-user example can both import ./tiny-assistant.js. The production
// build replaces this shim with the bundled CDN module at the same URL.
import "./src/tiny-assistant.js";
