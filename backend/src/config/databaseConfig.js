const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const VERIFIED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

// Production connections that leave the host must use verified TLS. With the
// pg driver, require/verify-ca/verify-full all verify the certificate unless
// libpq compatibility is requested, where only verify-full does.
function assertVerifiedTransport(parsed, urlName) {
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return;
  const mode = parsed.searchParams.get("sslmode");
  const libpq = parsed.searchParams.get("uselibpqcompat") === "true";
  if (!VERIFIED_SSL_MODES.has(mode) || (libpq && mode !== "verify-full")) {
    throw new Error(`${urlName} must use verified TLS in production (sslmode=verify-full).`);
  }
}

function databasePoolOptions(env, urlName, prefix) {
  const production = env.NODE_ENV === "production";
  const connectionString = String(env[urlName] || "").trim();
  if (connectionString) {
    let parsed;
    try { parsed = new URL(connectionString); } catch { throw new Error(`${urlName} must be a valid PostgreSQL URL.`); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) {
      throw new Error(`${urlName} must contain a PostgreSQL host, user and database.`);
    }
    if (production) assertVerifiedTransport(parsed, urlName);
    return { connectionString };
  }

  const required = [`${prefix}_HOST`, `${prefix}_PORT`, `${prefix}_NAME`, `${prefix}_USER`, `${prefix}_PASSWORD`];
  const missing = required.filter(name => !String(env[name] || "").trim());
  if (missing.length) throw new Error(`Database configuration is incomplete: ${missing.join(", ")}`);
  const host = env[`${prefix}_HOST`].trim();
  return {
    host,
    port: Number(env[`${prefix}_PORT`]),
    database: env[`${prefix}_NAME`].trim(),
    user: env[`${prefix}_USER`].trim(),
    password: String(env[`${prefix}_PASSWORD`]),
    ...(production && !LOOPBACK_HOSTS.has(host.toLowerCase()) ? { ssl: { rejectUnauthorized: true } } : {})
  };
}

module.exports = { databasePoolOptions };
