export const DEEP_LINK_EVENT = "chronos:deep-link";

type DesktopBridge = {
  openExternal: (url: string) => Promise<unknown>;
  consumePendingDeepLinks: () => string[];
};

declare global {
  interface Window {
    __ELECTROBUN__?: boolean;
    __chronos?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.__chronos;
  if (!bridge) return null;
  if (typeof bridge.openExternal !== "function") return null;
  if (typeof bridge.consumePendingDeepLinks !== "function") return null;
  return bridge;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== null;
}

export function getDesktopOAuthRedirectUrl(): string {
  const url = import.meta.env.VITE_DESKTOP_OAUTH_REDIRECT_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      "VITE_DESKTOP_OAUTH_REDIRECT_URL is required for desktop builds",
    );
  }
  return url;
}

export async function openExternal(url: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge) {
    await bridge.openExternal(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
