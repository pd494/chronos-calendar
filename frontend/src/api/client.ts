const API_BASE_URL = requireEnv("VITE_API_URL").replace(/\/+$/, "");
const CSRF_COOKIE_NAME = requireEnv("VITE_CSRF_COOKIE_NAME");
let authRequestController = new AbortController();

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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
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

  const execute = async (hasRetriedCsrf: boolean): Promise<T> => {
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

      const detail =
        typeof details === "object" && details && "detail" in details
          ? String((details as { detail: unknown }).detail)
          : null;

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
          return execute(true);
        }
      }

      if (response.status === 401) {
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

  return execute(false);
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

  patch: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
};
