import { isTauri } from "@tauri-apps/api/core";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && isTauri();
}

export function getDesktopOAuthRedirectUrl(): string {
  const configured = import.meta.env.VITE_DESKTOP_OAUTH_REDIRECT_URL;
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  if (backendUrl && backendUrl.trim().length > 0) {
    return `${backendUrl}/auth/desktop/callback`;
  }
  return "chronos://auth/callback";
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
