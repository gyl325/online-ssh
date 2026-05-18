import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";
  const wsTarget = env.VITE_WS_PROXY_TARGET || "ws://127.0.0.1:8080";

  return {
    plugins: [react()],
    test: {
      environment: "happy-dom",
      setupFiles: "./src/test/setup.ts",
      css: true,
      clearMocks: true,
      restoreMocks: true
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false
        },
        "/ws": {
          target: wsTarget,
          changeOrigin: true,
          secure: false,
          ws: true
        }
      }
    }
  };
});
