import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_PROXY || "http://localhost:3000";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": { target, changeOrigin: true },
        "/auth-config": { target, changeOrigin: true },
      },
    },
  };
});
