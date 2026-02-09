import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "sonner";
import { queryClient, persister } from "./lib/queryClient";
import { AuthProvider } from "./contexts/AuthContext";
import { initTokenStorage } from "./lib/tokenStorage";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

const render = () => {
  createRoot(rootEl).render(
    <StrictMode>
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
    </StrictMode>,
  );
};

initTokenStorage()
  .catch((err) => {
    console.warn("Failed to init token storage:", err);
  })
  .finally(() => {
    render();
  });
