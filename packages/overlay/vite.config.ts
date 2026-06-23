import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Library build: a single self-contained overlay.js with the CSS bundled in
// (injected into a Shadow DOM at runtime). React is external (host provides it).
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@react-grab/cli"] },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "overlay.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "@react-grab/cli"],
      output: {
        // keep a single vendorable file even though html2canvas is dynamically imported
        inlineDynamicImports: true,
      },
    },
  },
});
