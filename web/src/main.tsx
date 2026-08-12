import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { queryClient, persister } from "./lib/queryClient";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister }}
      >
        <AuthProvider>
          <App />
          <Agentation endpoint={import.meta.env.VITE_AGENTATION_ENDPOINT} />
          <Toaster position="top-right" />
        </AuthProvider>
      </PersistQueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
