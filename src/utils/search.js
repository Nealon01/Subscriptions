/**
 * Flexible search matching: multi-keyword (AND, any order) with quoted exact phrases.
 *
 * Rules:
 *  - Unquoted words are individual tokens; ALL must match somewhere across the fields.
 *  - "Quoted phrases" must appear as a contiguous substring in at least one field.
 *  - Case-insensitive.
 *
 * Examples:
 *  - `react hooks`          → both "react" AND "hooks" must appear (any order, any field)
 *  - `"react hooks"`        → exact phrase "react hooks" must appear in some field
 *  - `tutorial "react hooks"` → "tutorial" must match AND "react hooks" as exact phrase
 *
 * @param {string} query  The raw search string
 * @param {...string} fields  One or more text values to search against
 * @returns {boolean}
 */
export function matchesSearch(query, ...fields) {
  if (!query) return true;

  const tokens = parseSearchTokens(query);
  if (tokens.length === 0) return true;

  const lowerFields = fields.map((f) => (f || '').toLowerCase());

  return tokens.every((token) =>
    lowerFields.some((field) => field.includes(token))
  );
}

/**
 * Parse a search query into lowercase tokens.
 * Quoted strings become a single token (with quotes stripped).
 * Unquoted text is split on whitespace into individual word tokens.
 */
function parseSearchTokens(query) {
  const tokens = [];
  const regex = /"([^"]*)"|\S+/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    // match[1] is the content inside quotes, match[0] is the full match
    const token = (match[1] !== undefined ? match[1] : match[0]).toLowerCase().trim();
    if (token) tokens.push(token);
  }

  return tokens;
}
