import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /** 5173 사용 중이면 5174… 로 자동 전환 (주소창은 터미널에 표시된 URL 사용) */
    strictPort: false,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});
