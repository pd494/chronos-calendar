export interface Env {
  ALLOWED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  INSTANT_ADMIN_TOKEN?: string;
  INSTANT_APP_ID?: string;
  OAUTH_STATE_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  REDIRECT_URL?: string;
}

export function getAllowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function requireEnv(env: Env, key: keyof Env): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
