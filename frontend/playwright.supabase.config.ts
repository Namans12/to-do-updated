import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const viteEnv = loadEnv("", __dirname, "");

function readEnvExampleValue(key: string): string | undefined {
  const envExamplePath = path.resolve(__dirname, ".env.example");
  if (!fs.existsSync(envExamplePath)) return undefined;
  const content = fs.readFileSync(envExamplePath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() || undefined;
}

const mergedEnv: Record<string, string | undefined> = {
  ...viteEnv,
  ...process.env,
};

if (!mergedEnv.VITE_SUPABASE_URL) {
  mergedEnv.VITE_SUPABASE_URL = readEnvExampleValue("VITE_SUPABASE_URL");
}

if (!mergedEnv.VITE_SUPABASE_ANON_KEY) {
  mergedEnv.VITE_SUPABASE_ANON_KEY = readEnvExampleValue("VITE_SUPABASE_ANON_KEY");
}

const requiredEnvVars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;
const missingEnvVars = requiredEnvVars.filter((key) => {
  const value = mergedEnv[key];
  return !value || value.trim().length === 0;
});

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required env vars for Supabase e2e: ${missingEnvVars.join(", ")}. ` +
      "Set them before running: npm run test:e2e:supabase"
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.supabase.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    cwd: __dirname,
    env: {
      ...process.env,
      ...mergedEnv,
      VITE_E2E: "true",
    },
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
