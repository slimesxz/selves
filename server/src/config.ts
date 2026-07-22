// Runtime configuration for the Selves authentication server. Values come from
// the environment; nothing here is a secret. The cookie variant is chosen by an
// explicit flag, never by sniffing the request.

export interface AppConfig {
  /** Cookie name: `__Host-` prefix requires Secure, so only in secure environments. */
  cookieName: string;
  /** Set the Secure attribute (and use the `__Host-` name). */
  cookieSecure: boolean;
  /** Absolute session lifetime in seconds — matches the DB trigger (604800). */
  sessionTtlSeconds: number;
  /** Exact CORS origin allowlist (no wildcards). */
  corsOrigins: string[];
}

export const SESSION_TTL_SECONDS = 604800;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secure = env.SELVES_COOKIE_SECURE === 'true';
  const origins = (env.SELVES_CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    cookieName: secure ? '__Host-selves_session' : 'selves_session',
    cookieSecure: secure,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    corsOrigins: origins,
  };
}
