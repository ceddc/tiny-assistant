# Tiny Assistant

Tiny Assistant is a weekend AI experiment: can a Codex/ChatGPT-style "pet" become a tiny assistant that replaces the standard ArcGIS AI Assistant panel?

The project starts from:

- Esri [ArcGIS Maps SDK for JavaScript 5.0](https://developers.arcgis.com/javascript/latest/guide/)
- Esri [AI Assistant component sample](https://developers.arcgis.com/javascript/latest/sample-code/ai-assistant/)
- Esri [`arcgis-assistant` component reference](https://developers.arcgis.com/javascript/latest/references/ai-components/components/arcgis-assistant/)
- Codex/ChatGPT-style pets via [Codex settings](https://openai.com/academy/codex-settings/) and [the Codex app](https://openai.com/index/introducing-the-codex-app/)

It keeps the map and AI chat as real ArcGIS web components, then wraps them in Tiny Assistant, with a tiny movable assistant character named Globby.

## Try The Demo

Open the live demo:

[https://ceddc.github.io/tiny-assistant/](https://ceddc.github.io/tiny-assistant/)

Or run it locally:

```bash
npm install
npm run dev
```

Open the Vite URL printed in your terminal.

Tiny Assistant starts visible by default. You can explore the map and UI without signing in. The assistant chat only opens for real use after ArcGIS signs in an eligible account.

For GitHub Pages, build the project and publish `dist`:

```bash
npm run build
```

The built demo is designed to work under a project page such as:

```text
https://ceddc.github.io/tiny-assistant/
```

## Use Tiny Assistant

After publishing `dist`, another ArcGIS Maps SDK page can load the reusable module:

```html
<script type="module" src="https://js.arcgis.com/5.0/"></script>
<script type="module" src="https://ceddc.github.io/tiny-assistant/tiny-assistant.js"></script>

<arcgis-map id="map" item-id="YOUR_WEB_MAP_ITEM_ID"></arcgis-map>

<tiny-arcgis-assistant
  reference-element="#map"
  sprite-src="https://ceddc.github.io/tiny-assistant/assets/globby-spritesheet.webp"
  heading="My map assistant"
  description="Ask questions about this map"
  suggested-prompts='["Summarize this map.", "Zoom to the most important feature."]'>
  <arcgis-assistant-navigation-agent></arcgis-assistant-navigation-agent>
  <arcgis-assistant-data-exploration-agent></arcgis-assistant-data-exploration-agent>
  <arcgis-assistant-help-agent></arcgis-assistant-help-agent>
</tiny-arcgis-assistant>
```

GitHub Pages hosts your built `tiny-assistant.js` and sprite assets; `https://js.arcgis.com/5.0/` remains Esri's ArcGIS CDN. The public custom element is `tiny-arcgis-assistant`. It accepts `reference-element`, `sprite-src`, `heading`, `description`, optional `start-hidden`, and optional `suggested-prompts`.

## ArcGIS Account Requirement

You can load and inspect Tiny Assistant without signing in. To use AI assistant chat, you need the same kind of ArcGIS access required by Esri's AI Assistant sample:

- a signed-in named user in an ArcGIS Online organization; public accounts, trial accounts, and developer subscriptions are not supported;
- access to the web map and layers;
- AI assistants enabled in the ArcGIS Online organization settings;
- beta apps and capabilities allowed by the organization;
- the role privilege to use AI assistants.

If chat does not work after sign-in, check the [ArcGIS AI components FAQ](https://developers.arcgis.com/javascript/latest/agentic-apps/ai-faq/) or ask your ArcGIS Online administrator.

Do not commit real ArcGIS usernames, passwords, OAuth secrets, or tokens.
