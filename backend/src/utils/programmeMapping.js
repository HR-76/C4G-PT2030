/**
 * Maps EU Funding & Tenders Portal internal numeric programme IDs to
 * human-readable acronyms. The API sometimes returns the numeric ID instead
 * of the text code depending on the record vintage.
 */
const PROGRAMME_ID_MAP = {
  // ── 2021-2027 Framework Programmes ───────────────────────────────────────
  "43108390": "HORIZON",    // Horizon Europe
  "43298916": "EURATOM",    // Euratom Research Programme

  // Connecting Europe Facility
  "43251567": "CEF",       // Official FACET, 2026-10-29

  // Digital Europe Programme (official FACET, 2026-10-29)
  "43152860": "DIGITAL",

  // Creative Europe (two internal codes observed)
  "43252482": "CREA",
  "43251814": "CREA",       // MEDIA sub-programme

  // Citizens, Equality, Rights and Values
  "43252445": "CERV",
  "43251589": "CERV",      // Official FACET reference data

  // European Solidarity Corps
  "43254037": "ESC",

  // European Maritime, Fisheries and Aquaculture Fund
  "43252439": "EMFAF",

  // Just Transition Fund
  "43252471": "JTF",

  // LIFE Programme (legacy)
  "31107710": "LIFE",       // legacy LIFE
  "43252405": "LIFE",       // Official FACET, 2026-10-29

  // Single Market Programme (incl. COSME sub-programme)
  "43252475": "SMP",
  "43252476": "SMP",        // COSME sub-programme variant

  // Neighbourhood, Development and International Cooperation
  "43252491": "NDICI",

  // EU Renewable Energy Financing Mechanism
  "43253967": "RENEWFM",

  // Erasmus+
  "43353764": "ERASMUS",

  // European Social Fund+ (two internal codes observed)
  "43252434": "ESF+",
  "43254019": "ESF+",       // ESF+ (variant)

  // Social Dialogue & Social Rights
  "43252517": "SOCPL",

  // European Defence Fund
  "44181033": "EDF",

  // Research Fund for Coal and Steel
  "43252449": "RFCS",

  // Union Civil Protection Mechanism
  "43298203": "UCPM",

  // Pilot Projects & Preparatory Actions (Media Freedom)
  "43637601": "PPPA",

  // European Parliament Grants
  "43697167": "EP",

  // EU Agency Framework Grants
  "43251842": "EUAF",

  // Official FACET identifies the general EU Bodies and Agencies programme
  "45532249": "EUBA",

  // Internal Security Fund
  "43252368": "ISF",

  // InvestEU
  "43252451": "InvestEU",

  // Recovery and Resilience Facility
  "43252458": "RCF",

  // European Regional Development Fund
  "43252428": "ERDF",

  // Official FACET, 2026-11-11: codes in open/forthcoming calls that were still
  // shown to users as raw numeric ids.
  "44416173": "I3",          // Interregional Innovation Investments Instrument
  "44773066": "JTM",         // Just Transition Mechanism
  "43252386": "JUST",        // Justice Programme
  "45876777": "NDICI",       // NDICI – Global Europe (current code)
  "43089234": "INNOVFUND",   // Innovation Fund
  "43251882": "IMCAP",       // Information measures, common agricultural policy
  "43252433": "PERICLES IV", // Protection of the Euro against Counterfeiting
  "43253952": "HUMA",        // Humanitarian Aid
  "43332642": "EU4H",        // EU4Health Programme
  "43392145": "EMFAF",       // EMFAF (current code)
  "44773133": "IMREG",       // Information Measures for the EU Cohesion policy
  "42810547": "ED",          // EUROPE DIRECT
  "111111": "RELEX-PROSPECT", // EU External Action - Prospect (type 2 calls)

  // ── Legacy programmes (FP7, H2020, COSME) ────────────────────────────────
  "31045243": "H2020",      // Horizon 2020
  "31059643": "COSME",      // COSME (legacy)
};

/**
 * Normalise a raw frameworkProgramme value: if it looks like a pure numeric
 * ID, translate it; otherwise pass it through unchanged.
 */
function normaliseProgramme(value) {
  if (!value) return null;
  const str = String(value).trim();
  return PROGRAMME_ID_MAP[str] || str;
}

module.exports = { PROGRAMME_ID_MAP, normaliseProgramme };
