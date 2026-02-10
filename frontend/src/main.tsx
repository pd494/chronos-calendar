import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "sonner";
import { queryClient, persister } from "./lib/queryClient";
import { AuthProvider } from "./contexts/AuthContext";
import { initTokenStorage } from "./lib/tokenStorage";
import { isDesktop } from "./lib/platform";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

const render = (error?: string) => {
  createRoot(rootEl).render(
    <StrictMode>
      {error ? (
        <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <h1>Failed to start Chronos</h1>
          <p>{error}</p>
          <p>
            Try restarting the app. If the problem persists, your system
            keychain may be locked or unavailable.
          </p>
        </div>
      ) : (
        <BrowserRouter>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister }}
          >
            <AuthProvider>
              <App />
              <Toaster position="top-right" />
            </AuthProvider>
          </PersistQueryClientProvider>
        </BrowserRouter>
      )}
    </StrictMode>,
  );
};

initTokenStorage()
  .then(() => render())
  .catch((err) => {
    if (isDesktop()) {
      render(
        `Could not access the system keychain: ${err instanceof Error ? err.message : String(err)}`,
      );
    } else {
      render();
    }
  });
