import { isTauri } from "@tauri-apps/api/core";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && isTauri();
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
  if (isDesktop()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
