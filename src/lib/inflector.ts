/**
 * English inflection for relation-name suggestions, ported from Liquid's PHP
 * Inflector (rule tables, irregulars and uncountables kept as-is). The
 * suggestions are always user-overridable, so a miss is never fatal.
 */

type Rule = [RegExp, string];

const PLURAL_RULES: Rule[] = [
  [/(quiz)$/i, "$1zes"],
  [/^(ox)$/i, "$1en"],
  [/([ml])ouse$/i, "$1ice"],
  [/(matr|vert|ind)(?:ix|ex)$/i, "$1ices"],
  [/(x|ch|ss|sh)$/i, "$1es"],
  [/([^aeiouy]|qu)y$/i, "$1ies"],
  [/(hive)$/i, "$1s"],
  [/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
  [/sis$/i, "ses"],
  [/([ti])um$/i, "$1a"],
  [/(buffal|tomat)o$/i, "$1oes"],
  [/(bu)s$/i, "$1ses"],
  [/(alias|status)$/i, "$1es"],
  [/(octop|vir)us$/i, "$1i"],
  [/(ax|test)is$/i, "$1es"],
  [/s$/i, "s"],
  [/$/, "s"],
];

const SINGULAR_RULES: Rule[] = [
  [/(quiz)zes$/i, "$1"],
  [/(matr)ices$/i, "$1ix"],
  [/(vert|ind)ices$/i, "$1ex"],
  [/^(ox)en/i, "$1"],
  [/(alias|status)es$/i, "$1"],
  [/(octop|vir)i$/i, "$1us"],
  [/(cris|ax|test)es$/i, "$1is"],
  [/(shoe)s$/i, "$1"],
  [/(o)es$/i, "$1"],
  [/(bus)es$/i, "$1"],
  [/([ml])ice$/i, "$1ouse"],
  [/(x|ch|ss|sh)es$/i, "$1"],
  [/(m)ovies$/i, "$1ovie"],
  [/(s)eries$/i, "$1eries"],
  [/([^aeiouy]|qu)ies$/i, "$1y"],
  [/([lr])ves$/i, "$1f"],
  [/(tive)s$/i, "$1"],
  [/(hive)s$/i, "$1"],
  [/([^f])ves$/i, "$1fe"],
  [/(^analy)ses$/i, "$1sis"],
  [/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$/i, "$1sis"],
  [/([ti])a$/i, "$1um"],
  [/(n)ews$/i, "$1ews"],
  [/s$/i, ""],
];

const PLURAL_UNCOUNTABLE = ["species", "series"];
const SINGULAR_UNCOUNTABLE = [
  "equipment", "information", "rice", "money", "species", "series", "fish", "sheep",
  /* already singular; the man→men irregular would mangle it to "abdoman" */
  "abdomen",
];

/** singular → plural */
const PLURAL_IRREGULAR: [string, string][] = [
  ["person", "people"],
  ["man", "men"],
  ["child", "children"],
  ["sex", "sexes"],
  ["move", "moves"],
  ["money", "monies"],
  ["fish", "fishes"],
];
const SINGULAR_IRREGULAR: [string, string][] = [
  ["person", "people"],
  ["man", "men"],
  ["child", "children"],
  ["sex", "sexes"],
  ["move", "moves"],
  ["cookie", "cookies"],
];

const endsWith = (word: string, suffix: string) =>
  word.toLowerCase().endsWith(suffix);

/** Replace a trailing irregular form, keeping the first letter's case. */
function irregular(word: string, from: string, to: string): string | null {
  const m = word.match(new RegExp(`(${from})$`, "i"));
  if (!m) return null;
  return word.replace(new RegExp(`(${from})$`, "i"), m[1][0] + to.slice(1));
}

export function pluralize(word: string): string {
  if (PLURAL_UNCOUNTABLE.some((u) => endsWith(word, u))) return word;
  for (const [single, plural] of PLURAL_IRREGULAR) {
    const r = irregular(word, single, plural);
    if (r != null) return r;
  }
  for (const [rule, replacement] of PLURAL_RULES) {
    if (rule.test(word)) return word.replace(rule, replacement);
  }
  return word;
}

export function singularize(word: string): string {
  if (SINGULAR_UNCOUNTABLE.some((u) => endsWith(word, u))) return word;
  for (const [single, plural] of SINGULAR_IRREGULAR) {
    const r = irregular(word, plural, single);
    if (r != null) return r;
  }
  for (const [rule, replacement] of SINGULAR_RULES) {
    if (rule.test(word)) return word.replace(rule, replacement);
  }
  return word;
}

/** "address_types" → "AddressTypes" (non-alphanumerics split words). */
export function camelize(word: string): string {
  return word
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** Class-style relation name for a table: "address_types" → "AddressType"
 * (has one) or "AddressTypes" (has many). */
export function classify(table: string, plural: boolean): string {
  const single = singularize(table);
  return camelize(plural ? pluralize(single) : single);
}
