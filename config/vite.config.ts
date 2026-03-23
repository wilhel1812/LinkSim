import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    proxy: {
      "/meshmap": {
        target: "https://meshmap.net",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meshmap/, ""),
      },
      "/ve2dbe": {
        target: "https://www.ve2dbe.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ve2dbe/, ""),
      },
    },
  },
  preview: {
    proxy: {
      "/meshmap": {
        target: "https://meshmap.net",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meshmap/, ""),
      },
      "/ve2dbe": {
        target: "https://www.ve2dbe.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ve2dbe/, ""),
      },
    },
  },
});
