'use strict';

const CONTRACT_VERSION = 1;
const NORMALIZATION_VERSION = 'opportunity-normalization-v1';
const QUALITY_VERSION = 'opportunity-quality-v1';
const DEDUPLICATION_VERSION = 'opportunity-deduplication-v1';
const AUTHORITIES = Object.freeze(['CENTRAL', 'ORGANIZATION']);
const LIFECYCLE_STATES = Object.freeze(['DRAFT', 'ACTIVE', 'STALE', 'ARCHIVED']);
const VALIDATION_STATES = Object.freeze(['PENDING_REVIEW', 'VALIDATED_MANUAL', 'CONFLICT']);
const SOURCE_TYPES = Object.freeze(['C4G_MANUAL', 'ORGANIZATION_MANUAL', 'EU_FUNDING_API','OFFICIAL_PROGRAMME']);
const ACTOR_TYPES = Object.freeze(['HUMAN', 'SERVICE']);
const DUPLICATE_CLASSES = Object.freeze(['EXACT', 'POSSIBLE', 'DISTINCT']);
const QUALITY_BUCKETS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'COMPLETE']);
const LIMITS = Object.freeze({ payloadBytes: 32 * 1024, textCharacters: 16 * 1024, listItems: 32, pageDefault: 25, pageMax: 100, responseBytes: 1024 * 1024, dateWindowDays: 366, queryTimeoutMs: 5000 });

module.exports = { ACTOR_TYPES, AUTHORITIES, CONTRACT_VERSION, DEDUPLICATION_VERSION, DUPLICATE_CLASSES, LIFECYCLE_STATES, LIMITS, NORMALIZATION_VERSION, QUALITY_BUCKETS, QUALITY_VERSION, SOURCE_TYPES, VALIDATION_STATES };
