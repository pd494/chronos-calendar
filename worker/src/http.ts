export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function errorJson(message: string, status = 400): Response {
  return json({ error: message }, { status });
}
