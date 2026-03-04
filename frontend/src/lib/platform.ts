export const DEEP_LINK_EVENT = "chronos:deep-link";

type ChronosDesktopBridge = {
  openExternal: (url: string) => Promise<unknown>;
  consumePendingDeepLinks?: () => string[];
};

declare global {
  interface Window {
    __ELECTROBUN__?: boolean;
    __chronos?: ChronosDesktopBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.__ELECTROBUN__ === true;
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
  if (isDesktop() && window.__chronos?.openExternal) {
    await window.__chronos.openExternal(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}

export function consumePendingDeepLinks(): string[] {
  if (!isDesktop()) return [];
  return window.__chronos?.consumePendingDeepLinks?.() ?? [];
}
