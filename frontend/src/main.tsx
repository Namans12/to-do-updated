import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./context/ThemeContext";
import { AppProvider } from "./context/AppContext";
import App from "./App";
import "./index.css";

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
