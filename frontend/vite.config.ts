import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function requireEnv(
  env: Record<string, string>,
  name: "VITE_BACKEND_URL",
): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..");
  const backendUrl = requireEnv(env, "VITE_BACKEND_URL");

  return {
    plugins: [react()],
    envDir: "..",
    clearScreen: false,
    server: {
      port: 5174,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes) => {
              const setCookie = proxyRes.headers["set-cookie"];
              if (setCookie) {
                proxyRes.headers["set-cookie"] = (
                  Array.isArray(setCookie) ? setCookie : [setCookie]
                ).map((cookie) => cookie.replace(/Domain=[^;]+;?\s*/gi, ""));
              }
            });
          },
        },
      },
    },
    build: {
      target: "es2021",
      minify: process.env.TAURI_DEBUG ? false : "esbuild",
      sourcemap: !!process.env.TAURI_DEBUG,
    },
  };
});
