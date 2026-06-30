import type { Env } from "./env";
import { errorJson, json } from "./http";
import { assertAllowedOrigin, corsResponse, getCorsHeaders } from "./security";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return corsResponse(request, env);
      }

      assertAllowedOrigin(request, env);

      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return withCors(json({ ok: true }), request, env);
      }

      return withCors(errorJson("Not found", 404), request, env);
    } catch (error) {
      if (error instanceof Response) {
        return withCors(error, request, env);
      }

      return withCors(errorJson("Internal server error", 500), request, env);
    }
  },
};

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of getCorsHeaders(request, env)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
