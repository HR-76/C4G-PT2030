class PublicHttpError extends Error {
  constructor({ statusCode, code, publicMessage, cause }) {
    super(publicMessage, { cause });
    this.name = 'PublicHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function organizationContextUnavailable(cause) {
  if (cause instanceof PublicHttpError && cause.code === 'ORGANIZATION_CONTEXT_UNAVAILABLE') return cause;
  return new PublicHttpError({
    statusCode: 503,
    code: 'ORGANIZATION_CONTEXT_UNAVAILABLE',
    publicMessage: 'Organization context is temporarily unavailable.',
    cause
  });
}

module.exports = { PublicHttpError, organizationContextUnavailable };
