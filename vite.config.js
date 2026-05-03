import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "tiny-assistant-clean-output",
      apply: "build",
      // Vite sees the demo pages as HTML entries and normally emits tiny
      // per-page chunks. The public contract is simpler: every page loads the
      // stable ./tiny-assistant.js module, so we restore that script tag and
      // remove the unused page chunks from dist.
      transformIndexHtml: {
        order: "post",
        handler(html) {
          const withoutPreload = html.replace(
            /\s*<link rel="modulepreload" crossorigin href="\.\/tiny-assistant\.js">\n?/g,
            "",
          );

          if (withoutPreload.includes('src="./tiny-assistant.js"')) {
            return withoutPreload;
          }

          return withoutPreload.replace(
            "</head>",
            '    <script type="module" src="./tiny-assistant.js"></script>\n  </head>',
          );
        },
      },
      generateBundle(_, bundle) {
        Object.entries(bundle).forEach(([fileName, chunk]) => {
          if (chunk.type === "chunk" && chunk.name !== "tiny-assistant") {
            delete bundle[fileName];
          }
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "external-user": resolve(__dirname, "external-user.html"),
        "tiny-assistant": resolve(__dirname, "tiny-assistant.js"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "tiny-assistant"
            ? "tiny-assistant.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
