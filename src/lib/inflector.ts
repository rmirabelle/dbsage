/**
 * Pragmatic English inflection for relationship-name suggestions. Covers the
 * common table-naming cases (customers, addresses, companies, address_types…);
 * it is intentionally simple — the suggestions are always user-overridable.
 */

export function singularize(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.replace(/es$/i, "");
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.replace(/s$/i, "");
  return word;
}

export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, "ies");
  return `${word}s`;
}
