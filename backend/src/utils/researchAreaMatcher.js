const STOP_WORDS = new Set([
  "de", "da", "do", "e", "em", "a", "o", "os", "as", "para", "com", "of", "and", "the", "for", "in", "to"
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function termsFrom(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(term => term.length >= 3 && !STOP_WORDS.has(term));
}

function rawText(raw, keys) {
  return keys
    .flatMap(key => {
      const value = raw[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") return JSON.stringify(value);
      return value ? [value] : [];
    })
    .filter(Boolean)
    .join(" ");
}

function buildOpportunityText(opportunity) {
  const raw = opportunity.raw_payload || {};
  return normalize([
    opportunity.title,
    opportunity.programme,
    opportunity.funding_entity,
    opportunity.description,
    opportunity.eligibility,
    opportunity.aviso_type,
    opportunity.fundo,
    opportunity.objetivo_especifico,
    rawText(raw, ["title", "callTitle", "description", "objective", "topicDescription"])
  ].filter(Boolean).join(" "));
}

function keywordsForArea(area) {
  const configuredKeywords = String(area.keywords || "")
    .split(",")
    .map(keyword => keyword.trim())
    .filter(Boolean);

  const keywords = [
    ...configuredKeywords,
    ...termsFrom(area.name),
    ...termsFrom(area.description)
  ];

  return [...new Set(keywords.map(normalize).filter(Boolean))];
}

function scoreArea(opportunityText, area) {
  const keywords = keywordsForArea(area);
  let score = 0;
  const matches = [];

  for (const keyword of keywords) {
    if (keyword.length < 3) continue;
    if (opportunityText.includes(keyword)) {
      const weight = keyword.includes(" ") ? 3 : 1;
      score += weight;
      matches.push(keyword);
    }
  }

  return { score, matches };
}

function suggestResearchAreas(opportunity, areas, options = {}) {
  const minScore = options.minScore || 2;
  const maxSuggestions = options.maxSuggestions || 5;
  const opportunityText = buildOpportunityText(opportunity);

  return areas
    .map(area => {
      const result = scoreArea(opportunityText, area);
      return {
        id: area.id,
        name: area.name,
        score: result.score,
        matches: result.matches.slice(0, 10)
      };
    })
    .filter(area => area.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, maxSuggestions);
}

module.exports = {
  suggestResearchAreas
};
