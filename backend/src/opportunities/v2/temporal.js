'use strict';

const { validateSnapshotV2 } = require('./validation');
const { deepFreeze } = require('./data');
const { OpportunityV2Error } = require('./errors');

const DAY = 86400000;
const valueOf = fact => fact.state === 'PRESENT' ? fact.value : null;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function referenceInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new OpportunityV2Error('OPPORTUNITY_V2_INVALID_REFERENCE_TIME', '/asOf');
  }
  return Date.parse(value);
}

// Civil interval bounds exist only while computing this projection. They are never
// returned as factual instants or written into the opportunity snapshot.
function interval(at) {
  if (at.precision === 'INSTANT') {
    const ms = Date.parse(at.value);
    return { start: ms, end: ms };
  }
  const start = at.precision === 'DATE' ? at.value : at.start;
  const end = at.precision === 'DATE' ? at.value : at.end;
  return { start: Date.parse(`${start}T00:00:00.000Z`), end: Date.parse(`${end}T00:00:00.000Z`) + DAY - 1 };
}

function relation(at, now) {
  const bounds = interval(at);
  if (at.precision === 'INSTANT') return bounds.start > now ? 'FUTURE' : 'PAST';
  if (now < bounds.start) return 'FUTURE';
  if (now > bounds.end) return 'PAST';
  return 'UNCERTAIN';
}

function temporalKey(at) {
  return at.precision === 'PERIOD'
    ? `${at.precision}:${at.start}:${at.end}:${at.periodKind}:${at.label}`
    : `${at.precision}:${at.value}`;
}

function deadlineKey(deadline) { return `${temporalKey(deadline.at)}\u0000${deadline.phase ?? ''}`; }

function orderedDeadlines(deadlines) {
  const unique = new Map();
  for (const deadline of deadlines) {
    const key = deadlineKey(deadline);
    // The normalized instant is the fact; an equivalent original offset is provenance.
    if (!unique.has(key)) unique.set(key, deadline);
  }
  return [...unique.values()].sort((a, b) => {
    const left = interval(a.at), right = interval(b.at);
    return left.start - right.start || left.end - right.end || compareText(deadlineKey(a), deadlineKey(b));
  });
}

function extrema(deadlines, last) {
  return deadlines.filter(candidate => {
    const bounds = interval(candidate.at);
    return !deadlines.some(other => {
      if (candidate === other) return false;
      const otherBounds = interval(other.at);
      return last ? otherBounds.start > bounds.end : otherBounds.end < bounds.start;
    });
  });
}

function precisionOf(opening, deadlines) {
  const precisions = new Set([...(opening ? [opening.precision] : []), ...deadlines.map(d => d.at.precision)]);
  if (!precisions.size) return 'UNKNOWN';
  if (precisions.size > 1) return 'MIXED';
  return { INSTANT: 'EXACT', DATE: 'DATE_ONLY', PERIOD: 'PERIOD_ONLY' }[[...precisions][0]];
}

function projectTemporalV2(input, { asOf } = {}) {
  return projectTemporalFacts(validateSnapshotV2(input), {asOf});
}

// Internal read index uses only these validated calendar facts; no provenance cloning.
function projectTemporalFacts(snapshot, {asOf}={}) {
  const now = referenceInstant(asOf);
  const publication = valueOf(snapshot.publication);
  const publishedState = valueOf(snapshot.status.published);
  const opening = valueOf(snapshot.schedule.opening);
  const deadlines = orderedDeadlines(valueOf(snapshot.schedule.deadlines) || []);
  const pending = deadlines.filter(d => relation(d.at, now) !== 'PAST');
  const nextCandidates = extrema(pending, false);
  const finalCandidates = extrema(deadlines, true);
  const reasons = new Set();
  const mixedAmbiguity = [nextCandidates, finalCandidates].some(candidates => candidates.length > 1
    && new Set(candidates.map(d => d.at.precision)).size > 1);
  if (mixedAmbiguity) reasons.add('AMBIGUOUS_DEADLINE_PRECISION');
  if ([nextCandidates, finalCandidates].some(candidates => candidates.length > 1 && !mixedAmbiguity)) {
    reasons.add('MULTIPLE_DEADLINE_CANDIDATES');
  }
  const uncertain = pending.filter(d => relation(d.at, now) === 'UNCERTAIN');
  if (uncertain.some(d => d.at.precision === 'DATE')) reasons.add('DEADLINE_TIME_NOT_PUBLISHED');
  if (uncertain.some(d => d.at.precision === 'PERIOD')) reasons.add('DEADLINE_PERIOD_IN_PROGRESS');
  let effectiveState = 'UNKNOWN';
  const conflict = [snapshot.publication, ...Object.values(snapshot.status), ...Object.values(snapshot.schedule)]
    .some(fact => fact.state === 'CONFLICT');
  if (conflict) reasons.add('TEMPORAL_CONFLICT');
  else if (publishedState === 'CANCELLED' || publishedState === 'CLOSED') {
    effectiveState = publishedState;
    reasons.add('SOURCE_STATUS_FINAL');
  } else if (publication === 'PLANNED') {
    effectiveState = 'PLANNED';
    reasons.add('PUBLICATION_PLANNED');
  } else if (publication !== 'PUBLISHED') reasons.add('PUBLICATION_NOT_CONFIRMED');
  else if (opening && relation(opening, now) === 'FUTURE') {
    effectiveState = 'UPCOMING';
    reasons.add('OPENING_IN_FUTURE');
  } else if (uncertain.length) {
    // An exact deadline later today cannot supply the missing time of another cutoff.
    effectiveState = 'UNKNOWN';
  } else if (deadlines.length && !pending.length && valueOf(snapshot.schedule.deadlineModel) !== 'CONTINUOUS') {
    effectiveState = 'CLOSED';
    reasons.add('ALL_CONFIRMED_DEADLINES_PASSED');
  } else if (opening && relation(opening, now) === 'PAST' && pending.length) {
    effectiveState = 'OPEN';
    reasons.add('OPENING_REACHED_WITH_FUTURE_DEADLINE');
  } else if (publishedState === 'OPEN') {
    effectiveState = 'OPEN';
    reasons.add('SOURCE_STATUS_ONLY');
  } else {
    if (opening && relation(opening, now) === 'UNCERTAIN') reasons.add('OPENING_TIME_NOT_PUBLISHED');
    reasons.add('INSUFFICIENT_TEMPORAL_EVIDENCE');
  }
  return deepFreeze({
    asOf,
    effectiveState,
    publishedState,
    publishedCode: valueOf(snapshot.status.publishedCode),
    nextDeadline: nextCandidates.length === 1 && relation(nextCandidates[0].at, now) === 'FUTURE' ? nextCandidates[0] : null,
    nextDeadlineCandidates: nextCandidates,
    finalDeadline: finalCandidates.length === 1 ? finalCandidates[0] : null,
    finalDeadlineCandidates: finalCandidates,
    precision: precisionOf(opening, deadlines),
    reasonCodes: [...reasons].sort(compareText),
  });
}

module.exports = { projectTemporalV2, projectTemporalFacts };
