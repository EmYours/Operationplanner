import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5187, strictPort: true },
  preview: { port: 4187, strictPort: true },
});
