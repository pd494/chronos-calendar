type ChronosDesktopBridge = {
  openExternal: (url: string) => Promise<unknown>;
};

declare global {
  interface Window {
    __chronos?: ChronosDesktopBridge;
  }
}

export function getDesktopOAuthRedirectUrl(): string | undefined {
  if (typeof window === "undefined" || !window.__chronos) {
    return undefined;
  }
  const url = import.meta.env.VITE_DESKTOP_OAUTH_REDIRECT_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      "VITE_DESKTOP_OAUTH_REDIRECT_URL is required for desktop builds",
    );
  }
  return url;
}

export async function openExternal(url: string): Promise<void> {
  if (window.__chronos?.openExternal) {
    await window.__chronos.openExternal(url);
    return;
  }
  window.location.href = url;
}
