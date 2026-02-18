import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  DESKTOP_AUTH_DEEP_LINK_PATH,
  DESKTOP_DEEP_LINK_EVENT,
  isDesktop,
} from "../lib/platform";

const MAX_TRACKED_DEEP_LINKS = 100;

function normalizeDesktopDeepLinkPath(url: URL): string {
  if (url.hostname) {
    return `/${url.hostname}${url.pathname}`;
  }
  return url.pathname || "/";
}

type DeepLinkParseResult =
  | { kind: "ignore" }
  | { kind: "error" }
  | { kind: "code"; code: string };

function parseDesktopOAuthDeepLink(url: string): DeepLinkParseResult {
  try {
    const parsed = new URL(url);
    if (normalizeDesktopDeepLinkPath(parsed) !== DESKTOP_AUTH_DEEP_LINK_PATH) {
      return { kind: "ignore" };
    }

    const error = parsed.searchParams.get("error");
    if (error) {
      return { kind: "error" };
    }

    const code = parsed.searchParams.get("code");
    if (!code) {
      return { kind: "error" };
    }

    return { kind: "code", code };
  } catch {
    return { kind: "ignore" };
  }
}

export function useDesktopDeepLink() {
  const navigate = useNavigate();
  const { completeOAuth } = useAuth();
  const consumedUrls = useRef(new Set<string>());

  useEffect(() => {
    if (!isDesktop()) return;

    const processDeepLink = async (url: string) => {
      if (consumedUrls.current.has(url)) return;
      consumedUrls.current.add(url);
      if (consumedUrls.current.size > MAX_TRACKED_DEEP_LINKS) {
        consumedUrls.current.clear();
        consumedUrls.current.add(url);
      }

      const parsedDeepLink = parseDesktopOAuthDeepLink(url);
      if (parsedDeepLink.kind === "ignore") {
        return;
      }
      if (parsedDeepLink.kind === "error") {
        navigate("/login", { replace: true });
        return;
      }

      try {
        await completeOAuth(parsedDeepLink.code);
        navigate("/", { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    };

    const pendingDeepLinks =
      window.__chronos?.consumePendingDeepLinks?.() || [];
    for (const deepLink of pendingDeepLinks) {
      void processDeepLink(deepLink);
    }

    const handleDeepLinkEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ url?: string }>;
      const url = customEvent.detail?.url;
      if (url) {
        void processDeepLink(url);
      }
    };

    window.addEventListener(DESKTOP_DEEP_LINK_EVENT, handleDeepLinkEvent);
    return () => {
      window.removeEventListener(DESKTOP_DEEP_LINK_EVENT, handleDeepLinkEvent);
    };
  }, [completeOAuth, navigate]);
}
