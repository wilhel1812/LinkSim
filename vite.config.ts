import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ve2dbe": {
        target: "https://www.ve2dbe.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ve2dbe/, ""),
      },
    },
  },
  preview: {
    proxy: {
      "/ve2dbe": {
        target: "https://www.ve2dbe.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ve2dbe/, ""),
      },
    },
  },
});
