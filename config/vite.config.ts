import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    process.env.ALLOW_INSECURE_DEV_AUTH ??= "true";
    process.env.DEV_AUTH_USER_ID ??= "local-dev-user";
    process.env.ADMIN_USER_IDS ??= "local-dev-user";
  }

  return {
    plugins: [react()],
    worker: {
      format: "es",
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      watch: {
        usePolling: true,
        interval: 100,
      },
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8788",
          changeOrigin: true,
        },
        "/meshmap": {
          target: "https://meshmap.net",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/meshmap/, ""),
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
      },
    },
  };
});
