import { getAllowedOrigins, type Env } from "./env";

export function getCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;

  if (getAllowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    headers.set("Vary", "Origin");
  }

  return headers;
}

export function assertAllowedOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;

  if (!getAllowedOrigins(env).has(origin)) {
    throw new Response("Forbidden origin", { status: 403 });
  }
}

export function corsResponse(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}
