// Deadline alerts are generated on request and are day-granular, so one
// generation per user and organization every few minutes is enough. This only
// remembers, in memory, when this browser last asked for it; the alerts page
// always generates, and the header bell generates only when it is due.
const generated = new Map()
export const ALERT_GENERATION_INTERVAL_MS = 15 * 60 * 1000
export const alertGenerationDue = (scope, now = Date.now()) => !scope || !(now - (generated.get(scope) ?? -Infinity) < ALERT_GENERATION_INTERVAL_MS)
export const markAlertsGenerated = (scope, now = Date.now()) => { if (scope) generated.set(scope, now) }
export const clearAlertGeneration = () => generated.clear()
