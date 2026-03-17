import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Toaster } from "react-hot-toast";
import { registerSW } from "virtual:pwa-register";
import { ThemeProvider } from "./context/ThemeContext";
import { AppProvider } from "./context/AppContext";
import App from "./App";
import "./index.css";

const isNativeShell =
  typeof window !== "undefined" &&
  (Capacitor.isNativePlatform() || "__TAURI_INTERNALS__" in window);

async function clearLocalDevServiceWorkers() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    window.location.hostname !== "localhost"
  ) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
  }
}

async function clearNativeShellCaches() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
  }
}

if (import.meta.env.PROD && !isNativeShell) {
  registerSW({ immediate: true });
} else {
  void (isNativeShell ? clearNativeShellCaches() : clearLocalDevServiceWorkers());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppProvider>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            className:
              "!bg-white dark:!bg-slate-800 !text-slate-900 dark:!text-slate-100 !shadow-xl !border !border-slate-200 dark:!border-slate-700 !rounded-xl",
            duration: 2500,
          }}
        />
      </AppProvider>
    </ThemeProvider>
  </StrictMode>
);
