import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 线上签名 URL 与页面同源；本地 fixture 的假存储路径（/fake-storage/*）需一并代理到 8123
const proxy = { "/functions/v1/app": "http://127.0.0.1:8123", "/fake-storage": "http://127.0.0.1:8123" };

// 本站固定端口：5373（前端 dev/preview）+ 8123（fixture）。strictPort=端口被占用时直接报错，绝不顺延换端口。
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 5373, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 5373, strictPort: true, proxy },
  build: { outDir: "dist" },
});
