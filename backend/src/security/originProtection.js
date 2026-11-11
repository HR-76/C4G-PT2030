const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function exactOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function exactOriginHeader(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return value === parsed.origin ? parsed.origin : null;
  } catch {
    return null;
  }
}

function createOriginProtection({ allowedOrigins, skip = () => false }) {
  const allowed = new Set(allowedOrigins.map(exactOrigin).filter(Boolean));
  return function originProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method) || skip(req)) return next();
    const originHeader = req.get("origin");
    const refererHeader = req.get("referer");
    const supplied = originHeader === undefined ? exactOrigin(refererHeader) : exactOriginHeader(originHeader);
    if (!supplied || !allowed.has(supplied)) {
      return res.status(403).json({ code: "ORIGIN_NOT_ALLOWED", message: "Origem do pedido não autorizada." });
    }
    return next();
  };
}

module.exports = { createOriginProtection };
