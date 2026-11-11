// DELETE_PENDING and DELETED are reserved vocabulary; no deletion transition is implemented.
const DOCUMENT_STATES = Object.freeze(['PENDING', 'UPLOADING', 'UPLOADED', 'SCANNING', 'AVAILABLE', 'CANCELLED', 'EXPIRED', 'QUARANTINED', 'REJECTED', 'MISSING', 'SUPERSEDED', 'ARCHIVED', 'DELETE_PENDING', 'DELETED']);
const SCAN_STATES = Object.freeze(['NOT_REQUESTED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR']);
const TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['UPLOADING', 'CANCELLED', 'EXPIRED']),
  UPLOADING: Object.freeze(['UPLOADED', 'CANCELLED', 'EXPIRED', 'REJECTED']),
  UPLOADED: Object.freeze(['SCANNING', 'QUARANTINED', 'REJECTED']),
  SCANNING: Object.freeze(['AVAILABLE', 'QUARANTINED', 'REJECTED']),
  AVAILABLE: Object.freeze(['SUPERSEDED', 'ARCHIVED', 'QUARANTINED']),
  QUARANTINED: Object.freeze(['SCANNING', 'REJECTED']),
  MISSING: Object.freeze(['QUARANTINED']),
  CANCELLED: Object.freeze([]), EXPIRED: Object.freeze([]), REJECTED: Object.freeze([]),
  SUPERSEDED: Object.freeze([]), ARCHIVED: Object.freeze([]), DELETE_PENDING: Object.freeze([]), DELETED: Object.freeze([])
});
const FILE_CLASSES = Object.freeze({
  PDF: Object.freeze({ maxBytes: 20 * 1024 * 1024, mime: Object.freeze(['application/pdf']), extensions: Object.freeze(['pdf']) }),
  IMAGE: Object.freeze({ maxBytes: 10 * 1024 * 1024, mime: Object.freeze(['image/png', 'image/jpeg']), extensions: Object.freeze(['png', 'jpg', 'jpeg']) }),
  OOXML: Object.freeze({ maxBytes: 25 * 1024 * 1024, mime: Object.freeze(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']), extensions: Object.freeze(['docx', 'xlsx', 'pptx']) }),
  CSV: Object.freeze({ maxBytes: 10 * 1024 * 1024, mime: Object.freeze(['text/csv']), extensions: Object.freeze(['csv']) })
});
const UPLOAD_FILE_CLASSES = Object.freeze(['PDF', 'IMAGE', 'OOXML']);
const LIMITS = Object.freeze({ uploadCapabilityMs: 10 * 60 * 1000, downloadCapabilityMs: 5 * 60 * 1000,
  organizationQuotaBytes: 2.5 * 1024 * 1024 * 1024, multipartThreshold: 16 * 1024 * 1024, partBytes: 8 * 1024 * 1024, maxParts: 16,
  globalConcurrency: 4, organizationConcurrency: 2, maxRangeBytes: 8 * 1024 * 1024, maxMemoryBytes: 128 * 1024 * 1024 });
module.exports = { DOCUMENT_STATES, FILE_CLASSES, LIMITS, SCAN_STATES, TRANSITIONS, UPLOAD_FILE_CLASSES };
