const API_BASE_URL = requireEnv("VITE_API_URL").replace(/\/+$/, "");
const CSRF_COOKIE_NAME = requireEnv("VITE_CSRF_COOKIE_NAME");
let authRequestController = new AbortController();
let refreshSessionRequest: Promise<boolean> | null = null;

function requireEnv(name: "VITE_API_URL" | "VITE_CSRF_COOKIE_NAME"): string {
  const value = import.meta.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export function getApiUrl(): string {
  return API_BASE_URL;
}

export function resetAuthRequests(): void {
  authRequestController.abort();
  authRequestController = new AbortController();
}

export function notifyUnauthorizedIfActive(signal: AbortSignal): void {
  if (signal === authRequestController.signal && !signal.aborted) {
    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
  }
}

export function withAuthSignal(signal?: AbortSignal | null): AbortSignal {
  const authSignal = authRequestController.signal;
  if (!signal) return authSignal;
  return AbortSignal.any([signal, authSignal]);
}

export async function refreshAuthSession(): Promise<boolean> {
  if (refreshSessionRequest) {
    return refreshSessionRequest;
  }

  refreshSessionRequest = (async () => {
    const csrfResponse = await fetch(`${API_BASE_URL}/auth/csrf`, {
      method: "GET",
      credentials: "include",
      signal: authRequestController.signal,
    });
    if (!csrfResponse.ok) {
      return false;
    }

    const headers = new Headers();
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }

    const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers,
      signal: authRequestController.signal,
    });

    return refreshResponse.ok;
  })().finally(() => {
    refreshSessionRequest = null;
  });

  return refreshSessionRequest;
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isMutatingMethod(method?: string): boolean {
  return Boolean(method && MUTATING_METHODS.has(method.toUpperCase()));
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

export function getCsrfToken(): string | null {
  return getCookie(CSRF_COOKIE_NAME);
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getErrorDetail(details: unknown): string | null {
  if (
    typeof details !== "object" ||
    details === null ||
    !("detail" in details)
  ) {
    return null;
  }

  const detail = details.detail;
  if (typeof detail === "string") {
    return detail;
  }
  return JSON.stringify(detail);
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { params, ...init } = options;
  const requestAuthSignal = authRequestController.signal;

  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }
  let csrfTokenOverride: string | null | undefined;

  const execute = async (
    hasRetriedCsrf: boolean,
    hasRetriedAuth: boolean,
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (isMutatingMethod(init.method)) {
      const csrfToken =
        csrfTokenOverride === undefined ? getCsrfToken() : csrfTokenOverride;
      if (csrfToken) {
        headers.set("X-CSRF-Token", csrfToken);
      }
    }

    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers,
      signal: withAuthSignal(init.signal),
    });

    if (!response.ok) {
      let details: unknown;
      try {
        details = await response.json();
      } catch {
        details = await response.text().catch(() => null);
      }

      const detail = getErrorDetail(details);

      if (
        response.status === 403 &&
        !hasRetriedCsrf &&
        detail &&
        detail.includes("CSRF")
      ) {
        const csrfResponse = await fetch(`${API_BASE_URL}/auth/csrf`, {
          method: "GET",
          credentials: "include",
        });
        if (csrfResponse.ok) {
          csrfTokenOverride = getCsrfToken();
          return execute(true, hasRetriedAuth);
        }
      }

      if (response.status === 401) {
        if (!hasRetriedAuth && endpoint !== "/auth/refresh") {
          let refreshed = false;
          try {
            refreshed = await refreshAuthSession();
          } catch {
            refreshed = false;
          }
          if (refreshed) {
            csrfTokenOverride = getCsrfToken();
            return execute(hasRetriedCsrf, true);
          }
        }
        notifyUnauthorizedIfActive(requestAuthSignal);
        throw new ApiError("Unauthorized", 401, details);
      }

      const message =
        detail ?? `API Error: ${response.status} ${response.statusText}`;

      throw new ApiError(message, response.status, details);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  };

  return execute(false, false);
}

export const api = {
  get: <T>(endpoint: string, params?: Record<string, string>) =>
    request<T>(endpoint, { method: "GET", params }),

  post: <T>(
    endpoint: string,
    data?: unknown,
    params?: Record<string, string>,
  ) =>
    request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
      params,
    }),

  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
};
