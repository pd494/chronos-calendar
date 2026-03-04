import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../contexts/useAuth";
import { DEEP_LINK_EVENT, getDesktopBridge } from "../lib/platform";

type AuthCallbackParams = {
  code?: string;
  error?: string;
  errorDescription?: string;
};

function normalizePath(url: URL): string {
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (isHttp) {
    return url.pathname || "/";
  }
  if (url.hostname) {
    return `/${url.hostname}${url.pathname}`;
  }
  return url.pathname || "/";
}

function parseAuthCallback(urlString: string): AuthCallbackParams | null {
  try {
    const url = new URL(urlString);
    const path = normalizePath(url);
    if (path !== "/auth/callback") return null;
    return {
      code: url.searchParams.get("code") || undefined,
      error: url.searchParams.get("error") || undefined,
      errorDescription: url.searchParams.get("error_description") || undefined,
    };
  } catch {
    return null;
  }
}

export function useDesktopDeepLink() {
  const { completeOAuth } = useAuth();
  const navigate = useNavigate();
  const lastProcessed = useRef<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;

    const handleUrls = async (urls: string[]) => {
      for (const url of urls) {
        if (lastProcessed.current === url) continue;
        lastProcessed.current = url;
        const parsed = parseAuthCallback(url);
        if (!parsed) continue;

        if (parsed.error) {
          toast.error(parsed.errorDescription || parsed.error);
          navigate("/login", { replace: true });
          continue;
        }

        if (!parsed.code) {
          toast.error("No authorization code found");
          navigate("/login", { replace: true });
          continue;
        }

        try {
          await completeOAuth(parsed.code);
          navigate("/", { replace: true });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Authentication failed";
          toast.error(message);
          navigate("/login", { replace: true });
        }
      }
    };

    const start = async () => {
      const pending = bridge.consumePendingDeepLinks();
      if (!cancelled && pending.length) {
        await handleUrls(pending);
      }
    };
    const onDeepLink = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (!detail?.url) return;
      void handleUrls([detail.url]);
    };

    void start();
    window.addEventListener(DEEP_LINK_EVENT, onDeepLink as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener(DEEP_LINK_EVENT, onDeepLink as EventListener);
    };
  }, [completeOAuth, navigate]);
}
