const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;
const AMR_MODES = new Set(["any", "all"]);
const RECOGNIZED_ASSURANCE_POLICIES = Object.freeze({
  "c4g-user-mfa-v1": Object.freeze({
    privilegedCategory: "recent-auth",
    acrLoaMap: Object.freeze({ "c4g-loa1": 1, "c4g-loa2": 2 }),
    policy: Object.freeze({
      "recent-auth": Object.freeze({
        mfa: false, maxAgeSeconds: 300,
        acceptedAcr: Object.freeze(["c4g-loa1"]),
        acceptedAmr: Object.freeze(["pwd"]), amrMode: "any"
      })
    })
  }),
  "c4g-assurance-v1": Object.freeze({
    privilegedCategory: "recent-mfa",
    acrLoaMap: Object.freeze({ "c4g-loa1": 1, "c4g-loa2": 2 }),
    policy: Object.freeze({
      "recent-mfa": Object.freeze({
        mfa: true, maxAgeSeconds: 300,
        acceptedAcr: Object.freeze(["c4g-loa2"]),
        acceptedAmr: Object.freeze(["otp"]), amrMode: "all"
      })
    })
  }),
  "f2-integration-stepup-v1": Object.freeze({
    privilegedCategory: "recent-mfa",
    acrLoaMap: Object.freeze({ "c4g-loa1": 1, "c4g-loa2": 2 }),
    policy: Object.freeze({
      "recent-auth": Object.freeze({
        mfa: false, maxAgeSeconds: 300,
        acceptedAcr: Object.freeze(["c4g-loa1", "c4g-loa2"]),
        acceptedAmr: Object.freeze(["pwd"]), amrMode: "any"
      }),
      "recent-mfa": Object.freeze({
        mfa: true, maxAgeSeconds: 2,
        acceptedAcr: Object.freeze(["c4g-loa2"]),
        acceptedAmr: Object.freeze(["otp"]), amrMode: "all"
      })
    })
  })
});

function parseList(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

function parseRequiredPositiveInteger(value, name, required) {
  if ((value === undefined || value === null || value === "") && !required) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function validateStringArray(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be ${allowEmpty ? "an" : "a non-empty"} array of non-empty strings.`);
  }
  return Object.freeze([...new Set(value.map(item => item.trim()))]);
}

function validateAssurancePolicy(rawPolicy) {
  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw new Error("AUTH_ASSURANCE_POLICY_JSON must be an object.");
  }
  const entries = Object.entries(rawPolicy);
  if (entries.length === 0) throw new Error("AUTH_ASSURANCE_POLICY_JSON must define at least one category.");
  const validated = {};
  for (const [category, requirement] of entries) {
    if (!SAFE_CATEGORY.test(category) || !requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      throw new Error(`Invalid assurance category: ${category}.`);
    }
    const allowedKeys = new Set(["mfa", "maxAgeSeconds", "acceptedAcr", "acceptedAmr", "amrMode"]);
    if (Object.keys(requirement).some(key => !allowedKeys.has(key))) {
      throw new Error(`Unknown property in assurance category: ${category}.`);
    }
    if (typeof requirement.mfa !== "boolean"
      || !Number.isInteger(requirement.maxAgeSeconds)
      || requirement.maxAgeSeconds < 1
      || requirement.maxAgeSeconds > 86400) {
      throw new Error(`Category ${category} requires boolean mfa and maxAgeSeconds between 1 and 86400.`);
    }
    const acceptedAcr = validateStringArray(requirement.acceptedAcr || [], `${category}.acceptedAcr`, { allowEmpty: true });
    const acceptedAmr = validateStringArray(requirement.acceptedAmr || [], `${category}.acceptedAmr`, { allowEmpty: true });
    const amrMode = requirement.amrMode || "any";
    if (!AMR_MODES.has(amrMode)) throw new Error(`${category}.amrMode must be any or all.`);
    if (requirement.mfa && (acceptedAcr.length === 0 || acceptedAmr.length === 0)) {
      throw new Error(`MFA category ${category} requires exact ACR and AMR allowlists.`);
    }
    validated[category] = Object.freeze({
      mfa: requirement.mfa,
      maxAgeSeconds: requirement.maxAgeSeconds,
      acceptedAcr,
      acceptedAmr,
      amrMode
    });
  }
  return Object.freeze(validated);
}

function canonicalPolicy(policy) {
  return Object.keys(policy).sort().map(category => {
    const requirement = policy[category];
    return [category, {
      mfa: requirement.mfa,
      maxAgeSeconds: requirement.maxAgeSeconds,
      acceptedAcr: [...requirement.acceptedAcr].sort(),
      acceptedAmr: [...requirement.acceptedAmr].sort(),
      amrMode: requirement.amrMode
    }];
  });
}

function recognizedAssurancePolicy(version, policy, privilegedCategory) {
  const manifest = RECOGNIZED_ASSURANCE_POLICIES[version];
  if (!manifest) throw new Error("AUTH_POLICY_VERSION is not recognized.");
  if (privilegedCategory !== manifest.privilegedCategory
    || JSON.stringify(canonicalPolicy(policy)) !== JSON.stringify(canonicalPolicy(manifest.policy))) {
    throw new Error("AUTH_ASSURANCE_POLICY_JSON diverges from the recognized policy version.");
  }
  return manifest;
}

function requireUrl(value, name, required) {
  if (!value && !required) return null;
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

function loadAuthConfig(env) {
  if (env.OIDC_EMAIL_VERIFICATION && env.OIDC_EMAIL_VERIFICATION !== 'keycloak-account-v1') {
    throw new Error('OIDC_EMAIL_VERIFICATION must be keycloak-account-v1 or unset.');
  }
  const mode = env.AUTH_MODE || "oidc";
  if (mode !== "oidc") throw new Error("AUTH_MODE must be oidc.");

  const oidcEnabled = true;
  const publicOrigin = requireUrl(env.PUBLIC_APP_URL, "PUBLIC_APP_URL", true);
  const issuer = requireUrl(env.OIDC_ISSUER, "OIDC_ISSUER", true);
  const redirectUri = requireUrl(env.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI", true);
  const postLogoutRedirectUri = requireUrl(
    env.OIDC_POST_LOGOUT_REDIRECT_URI || env.PUBLIC_APP_URL,
    "OIDC_POST_LOGOUT_REDIRECT_URI",
    true
  );

  if (!env.OIDC_CLIENT_ID || !env.SESSION_SECRET) {
    throw new Error("OIDC_CLIENT_ID and SESSION_SECRET are required when OIDC is enabled.");
  }
  if (env.NODE_ENV === 'production') {
    if (!require('./secretFormat').isSecretHex(env.SESSION_SECRET)) {
      throw new Error('SESSION_SECRET must be a hexadecimal encoding of at least 32 random bytes in production.');
    }
  } else if (env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  if (redirectUri.origin !== publicOrigin.origin) {
    throw new Error("OIDC_REDIRECT_URI must use the public application origin.");
  }
  if (postLogoutRedirectUri.origin !== publicOrigin.origin) {
    throw new Error("OIDC_POST_LOGOUT_REDIRECT_URI must use the public application origin.");
  }
  if (env.NODE_ENV === "production" && publicOrigin.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use HTTPS in production.");
  }
  const secureCookie = env.NODE_ENV === "production" || env.SESSION_COOKIE_SECURE === "true";
  const sessionCookieName = env.SESSION_COOKIE_NAME || (secureCookie ? "__Host-c4g_session" : "c4g_session_dev");
  if (env.NODE_ENV === "production" && !sessionCookieName.startsWith("__Host-")) {
    throw new Error("Production session cookie name must use the __Host- prefix.");
  }

  let assurancePolicy;
  try {
    assurancePolicy = env.AUTH_ASSURANCE_POLICY_JSON ? validateAssurancePolicy(JSON.parse(env.AUTH_ASSURANCE_POLICY_JSON)) : null;
  } catch {
    throw new Error("AUTH_ASSURANCE_POLICY_JSON is invalid.");
  }
  if (!env.AUTH_POLICY_VERSION || !assurancePolicy) {
    throw new Error("AUTH_POLICY_VERSION and AUTH_ASSURANCE_POLICY_JSON are required when OIDC is enabled.");
  }
  const privilegedLoginCategory = env.PRIVILEGED_LOGIN_ASSURANCE_CATEGORY || "recent-mfa";
  if (!assurancePolicy[privilegedLoginCategory]) {
    throw new Error("PRIVILEGED_LOGIN_ASSURANCE_CATEGORY must reference a configured category.");
  }
  const assuranceManifest = recognizedAssurancePolicy(env.AUTH_POLICY_VERSION, assurancePolicy, privilegedLoginCategory);

  return Object.freeze({
    mode,
    oidcEnabled,
    emailVerification: env.OIDC_EMAIL_VERIFICATION === 'keycloak-account-v1',
    issuer,
    clientId: env.OIDC_CLIENT_ID || null,
    clientSecret: env.OIDC_CLIENT_SECRET || undefined,
    redirectUri,
    postLogoutRedirectUri,
    publicOrigin,
    allowedDevelopmentOrigins: parseList(env.DEV_ALLOWED_ORIGINS),
    sessionSecret: env.SESSION_SECRET || null,
    sessionCookieName,
    sessionIdleMs: parseRequiredPositiveInteger(env.SESSION_IDLE_MS, "SESSION_IDLE_MS", oidcEnabled),
    sessionAbsoluteMs: parseRequiredPositiveInteger(env.SESSION_ABSOLUTE_MS, "SESSION_ABSOLUTE_MS", oidcEnabled),
    oidcTransactionMs: parseRequiredPositiveInteger(env.OIDC_TRANSACTION_MS, "OIDC_TRANSACTION_MS", oidcEnabled),
    policyVersion: env.AUTH_POLICY_VERSION || null,
    assuranceMapVersion: env.AUTH_POLICY_VERSION || null,
    acrLoaMap: assuranceManifest && assuranceManifest.acrLoaMap,
    privilegedLoginCategory,
    privilegedRoleNames: parseList(env.OIDC_PRIVILEGED_ROLE_NAMES || "C4G_ADMIN,SUPPORT,ORG_ADMIN"),
    assurancePolicy,
    nodeEnv: env.NODE_ENV || "development",
    secureCookie
  });
}

function safeReturnPath(value, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || /[\\\u0000-\u001f\u007f]/.test(value)
    || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://local.invalid");
    const canonical = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.origin === "https://local.invalid" && canonical === value ? value : fallback;
  } catch {
    return fallback;
  }
}

module.exports = {
  RECOGNIZED_ASSURANCE_POLICIES,
  loadAuthConfig,
  recognizedAssurancePolicy,
  safeReturnPath,
  validateAssurancePolicy
};
