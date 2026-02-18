import Electrobun, {
  BrowserWindow,
  BrowserView,
  Updater,
  Utils,
} from "electrobun/bun";
import { join, resolve } from "path";

const DEV_SERVER_URL = "http://localhost:5174";
const PROXY_PORT = 19274;
const DEEP_LINK_EVENT_NAME = "chronos:deep-link";
const OPEN_EXTERNAL_REQUEST_TYPE = "openExternal";
const OPEN_EXTERNAL_TIMEOUT_MS = 10000;
const OPEN_EXTERNAL_REQUEST_PREFIX = "open_external_";
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "accounts.google.com",
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);
const ALLOWED_EXTERNAL_HOST_SUFFIXES = ["supabase.co"];
const ALLOWED_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const WINDOW_DEFAULT_FRAME = {
  width: 1200,
  height: 800,
  x: 100,
  y: 100,
} as const;

const BACKEND_URL = (
  Bun.env.VITE_BACKEND_URL ??
  process.env.VITE_BACKEND_URL ??
  ""
).replace(/\/+$/, "");

const API_PREFIX = "/api";
const PROXIED_PREFIXES = ["/auth", "/calendar", "/todos", "/health"];
const STATIC_DIR = join(import.meta.dir, "../../dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

function shouldProxy(pathname: string): boolean {
  if (pathname.startsWith(API_PREFIX + "/") || pathname === API_PREFIX)
    return true;
  return PROXIED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

function resolveProxyUrl(pathname: string, search: string): string {
  const backendPath = pathname.startsWith(API_PREFIX)
    ? pathname.slice(API_PREFIX.length) || "/"
    : pathname;
  return `${BACKEND_URL}${backendPath}${search}`;
}

async function proxyRequest(
  req: Request,
  pathname: string,
  search: string,
): Promise<Response> {
  const targetUrl = resolveProxyUrl(pathname, search);
  const headers = new Headers(req.headers);
  headers.set("X-Forwarded-For", "127.0.0.1");
  headers.delete("host");

  const proxyReq = new Request(targetUrl, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "manual",
  });

  try {
    return await fetch(proxyReq);
  } catch {
    return new Response(JSON.stringify({ detail: "Backend unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  const resolvedStatic = resolve(STATIC_DIR);
  let filePath = resolve(STATIC_DIR, "." + pathname);

  if (
    !filePath.startsWith(resolvedStatic + "/") &&
    filePath !== resolvedStatic
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let file = Bun.file(filePath);
  if (!(await file.exists())) {
    filePath = join(resolvedStatic, "index.html");
    file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }
  }

  return new Response(file, {
    headers: { "Content-Type": getMimeType(filePath) },
  });
}

async function startLocalServer(): Promise<string> {
  const server = Bun.serve({
    port: PROXY_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (shouldProxy(url.pathname)) {
        return proxyRequest(req, url.pathname, url.search);
      }
      return serveStatic(url.pathname);
    },
  });
  console.log(`Local server running at http://127.0.0.1:${server.port}`);
  return `http://127.0.0.1:${server.port}`;
}

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Start it with: cd frontend && npm run dev",
      );
    }
  }
  return startLocalServer();
}

const rpc = BrowserView.defineRPC({
  maxRequestTime: OPEN_EXTERNAL_TIMEOUT_MS,
  handlers: {
    requests: {},
    messages: {},
  },
});

const url = await getMainViewUrl();

const PRELOAD = `
  (function() {
    var pendingDeepLinks = [];
    var openExternalRequests = {};

    var bridge = {
      openExternal: function(url) {
        if (typeof url !== "string" || !url) {
          return Promise.reject(new Error("Invalid URL"));
        }
        if (typeof window.__electrobunSendToHost !== "function") {
          return Promise.reject(new Error("Desktop bridge unavailable"));
        }
        var requestId = "${OPEN_EXTERNAL_REQUEST_PREFIX}" + Date.now() + "_" + Math.random().toString(36).slice(2);
        return new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() {
            delete openExternalRequests[requestId];
            reject(new Error("Timed out opening external URL"));
          }, ${OPEN_EXTERNAL_TIMEOUT_MS});
          openExternalRequests[requestId] = { resolve: resolve, reject: reject, timeout: timeout };
          window.__electrobunSendToHost({
            type: "${OPEN_EXTERNAL_REQUEST_TYPE}",
            requestId: requestId,
            url: url
          });
        });
      },
      resolveOpenExternal: function(requestId, success, error) {
        var pending = openExternalRequests[requestId];
        if (!pending) return;
        clearTimeout(pending.timeout);
        delete openExternalRequests[requestId];
        if (success) {
          pending.resolve({ success: true });
        } else {
          pending.reject(new Error(error || "Failed to open external URL"));
        }
      },
      receiveDeepLink: function(url) {
        if (typeof url !== "string") return;
        pendingDeepLinks.push(url);
        window.dispatchEvent(new CustomEvent("${DEEP_LINK_EVENT_NAME}", { detail: { url: url } }));
      },
      consumePendingDeepLinks: function() {
        var links = pendingDeepLinks.slice();
        pendingDeepLinks.length = 0;
        return links;
      }
    };

    Object.freeze(bridge);
    Object.defineProperty(window, "__ELECTROBUN__", { value: true, writable: false, configurable: false });
    Object.defineProperty(window, "__chronos", { value: bridge, writable: false, configurable: false });
  })();
`;

const DEEP_LINK_SCHEME = "chronoscalendar:";
const MAX_PENDING_DEEP_LINKS = 50;
const pendingDeepLinks: string[] = [];
let mainWindow: BrowserWindow | null = null;

const configuredBackendHost = BACKEND_URL
  ? (() => {
      try {
        return new URL(BACKEND_URL).hostname.toLowerCase();
      } catch {
        return null;
      }
    })()
  : null;

if (configuredBackendHost) {
  ALLOWED_EXTERNAL_HOSTS.add(configuredBackendHost);
}

type OpenExternalHostMessage = {
  type: string;
  requestId: string;
  url: string;
};

function isOpenExternalHostMessage(
  value: unknown,
): value is OpenExternalHostMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpenExternalHostMessage>;
  return (
    candidate.type === OPEN_EXTERNAL_REQUEST_TYPE &&
    typeof candidate.requestId === "string" &&
    typeof candidate.url === "string"
  );
}

function isAllowedExternalHost(hostname: string): boolean {
  if (ALLOWED_EXTERNAL_HOSTS.has(hostname)) return true;
  return ALLOWED_EXTERNAL_HOST_SUFFIXES.some(
    (suffix) =>
      hostname.endsWith(suffix) &&
      hostname[hostname.length - suffix.length - 1] === ".",
  );
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  const url = rawUrl.trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (protocol === "https:") {
      return isAllowedExternalHost(hostname);
    }

    if (protocol === "http:") {
      return ALLOWED_HTTP_HOSTS.has(hostname);
    }

    return false;
  } catch {
    return false;
  }
}

const forwardDeepLinkToRenderer = (url: string) => {
  if (!mainWindow) return;
  const serializedUrl = JSON.stringify(url);
  mainWindow.webview.executeJavascript(
    `window.__chronos?.receiveDeepLink?.(${serializedUrl});`,
  );
  mainWindow.focus();
};

function isValidDeepLink(url: string): boolean {
  try {
    return new URL(url).protocol === DEEP_LINK_SCHEME;
  } catch {
    return false;
  }
}

Electrobun.events.on("open-url", (event: { data?: { url?: string } }) => {
  const incomingUrl = event?.data?.url;
  if (!incomingUrl || !isValidDeepLink(incomingUrl)) return;
  if (pendingDeepLinks.length >= MAX_PENDING_DEEP_LINKS) return;
  pendingDeepLinks.push(incomingUrl);
  if (mainWindow) {
    while (pendingDeepLinks.length > 0) {
      const nextUrl = pendingDeepLinks.shift();
      if (nextUrl) forwardDeepLinkToRenderer(nextUrl);
    }
  }
});

mainWindow = new BrowserWindow({
  title: "Chronos Calendar",
  url,
  frame: WINDOW_DEFAULT_FRAME,
  preload: PRELOAD,
  rpc,
});

Electrobun.events.on(
  `host-message-${mainWindow.webview.id}`,
  (event: { data?: { detail?: unknown } }) => {
    const message = event?.data?.detail;
    if (!isOpenExternalHostMessage(message)) return;

    let success = true;
    let error = "";
    try {
      if (!isAllowedExternalUrl(message.url)) {
        throw new Error("Blocked external URL");
      }
      Utils.openExternal(message.url);
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : "Unknown error";
    }

    mainWindow?.webview.executeJavascript(
      `window.__chronos?.resolveOpenExternal?.(${JSON.stringify(message.requestId)}, ${success ? "true" : "false"}, ${JSON.stringify(error)});`,
    );
  },
);

mainWindow.on("close", () => {
  Utils.quit();
});

if (pendingDeepLinks.length > 0) {
  for (const deepLink of pendingDeepLinks.splice(0)) {
    forwardDeepLinkToRenderer(deepLink);
  }
}

console.log("Chronos Calendar started!");
