export const DESKTOP_OAUTH_CALLBACK_PATH = "/auth/desktop/callback";
export const DESKTOP_AUTH_DEEP_LINK_PATH = "/auth/callback";
export const DESKTOP_DEEP_LINK_EVENT = "chronos:deep-link";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__ELECTROBUN__" in window;
}

export function hasDesktopBridge(): boolean {
  return isDesktop() && typeof window.__chronos?.openExternal === "function";
}

export function getDesktopOAuthRedirectUrl(): string {
  const backendUrl = (import.meta.env.VITE_BACKEND_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!backendUrl) {
    throw new Error("VITE_BACKEND_URL is required for desktop OAuth");
  }
  return `${backendUrl}${DESKTOP_OAUTH_CALLBACK_PATH}`;
}

export async function openExternal(url: string): Promise<void> {
  if (!url) {
    throw new Error("External URL is required");
  }

  if (isDesktop()) {
    const bridge = window.__chronos;
    if (bridge && typeof bridge.openExternal === "function") {
      await bridge.openExternal(url);
      return;
    }
    throw new Error("Desktop bridge unavailable");
  }

  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
