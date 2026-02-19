const API_BASE_URL = import.meta.env.VITE_API_URL?.trim() || "/api";
const CSRF_COOKIE_CANDIDATES = ["__Host-csrf_token", "csrf_token"] as const;
const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function getApiUrl(): string {
  return API_BASE_URL;
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const token = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")[1];
  return token ? decodeURIComponent(token) : null;
}

function getCsrfToken(): string | null {
  for (const cookieName of CSRF_COOKIE_CANDIDATES) {
    const token = getCookieValue(cookieName);
    if (token) {
      return token;
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
  const method = (init.method || "GET").toUpperCase();
  if (CSRF_METHODS.has(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
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
