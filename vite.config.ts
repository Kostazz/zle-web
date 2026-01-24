import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const projectRoot = process.cwd();
const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  plugins: [react()],

  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "client", "src"),
      "@shared": path.resolve(projectRoot, "shared"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
  },

  // Vite app je v /client
  root: path.resolve(projectRoot, "client"),

  build: {
    // ✅ build do root /dist (aby server našel dist/index.html)
    outDir: path.resolve(projectRoot, "dist"),
    emptyOutDir: true,
    sourcemap: !isProd,
  },

  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
