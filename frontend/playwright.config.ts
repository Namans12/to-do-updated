import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      cwd: __dirname,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
        VITE_E2E: "true",
      },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:8080/health",
      cwd: path.resolve(__dirname, "../app"),
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
