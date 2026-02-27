const API_BASE_URL = resolveApiBaseUrl();
const CSRF_COOKIE_NAME =
  import.meta.env.VITE_CSRF_COOKIE_NAME?.trim() || "chronos_csrf";

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return "/api";
}

export function getApiUrl(): string {
  return API_BASE_URL;
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

function isMutatingMethod(method?: string): boolean {
  if (!method) return false;
  const normalized = method.toUpperCase();
  return (
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  );
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

  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isMutatingMethod(init.method)) {
    const csrfToken = getCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...headers,
      ...(init.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text().catch(() => null);
    }

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      throw new ApiError("Unauthorized", 401, details);
    }

    const message =
      typeof details === "object" && details && "detail" in details
        ? String((details as { detail: unknown }).detail)
        : `API Error: ${response.status} ${response.statusText}`;

    throw new ApiError(message, response.status, details);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
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
