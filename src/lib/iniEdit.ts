/**
 * Minimal, comment-preserving INI line surgery for the structured my.ini editor.
 * Both the Form and Raw views operate on the same raw text, so editing a setting
 * in the form just rewrites (or inserts) the one matching line — every other
 * line, including comments and unknown keys, is left untouched.
 */

const SECTION_RE = /^\[(.+?)\]$/;
const KEY_RE = /^([\w-]+)\s*=\s*(.*)$/;

function eolOf(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function isComment(s: string): boolean {
  return s.startsWith("#") || s.startsWith(";");
}

/** Current value of `section.key`, or undefined if not present. */
export function getIniValue(
  content: string,
  section: string,
  key: string
): string | undefined {
  const target = section.toLowerCase();
  const wantKey = key.toLowerCase();
  let cur = "";
  for (const line of content.split(/\r?\n/)) {
    const s = line.trim();
    const sec = s.match(SECTION_RE);
    if (sec) {
      cur = sec[1].toLowerCase();
      continue;
    }
    if (cur !== target || isComment(s)) continue;
    const m = s.match(KEY_RE);
    if (m && m[1].toLowerCase() === wantKey) return m[2].trim();
  }
  return undefined;
}

/**
 * Return `content` with `section.key` set to `value` — replacing the existing
 * line in place (preserving indent), inserting into an existing section, or
 * appending a new section as needed.
 */
export function setIniValue(
  content: string,
  section: string,
  key: string,
  value: string
): string {
  const eol = eolOf(content);
  const lines = content.split(/\r?\n/);
  const target = section.toLowerCase();
  const wantKey = key.toLowerCase();

  let cur = "";
  let sectionHeaderIdx = -1;
  let lastTargetLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    const sec = s.match(SECTION_RE);
    if (sec) {
      cur = sec[1].toLowerCase();
      if (cur === target) {
        sectionHeaderIdx = i;
        lastTargetLineIdx = i;
      }
      continue;
    }
    if (cur !== target) continue;
    lastTargetLineIdx = i;
    if (isComment(s)) continue;
    const m = s.match(KEY_RE);
    if (m && m[1].toLowerCase() === wantKey) {
      const indent = lines[i].match(/^\s*/)?.[0] ?? "";
      lines[i] = `${indent}${m[1]}=${value}`;
      return lines.join(eol);
    }
  }

  if (sectionHeaderIdx >= 0) {
    lines.splice(lastTargetLineIdx + 1, 0, `${key}=${value}`);
    return lines.join(eol);
  }

  const sep = content.length === 0 || content.endsWith("\n") ? "" : eol;
  return `${content}${sep}${eol}[${section}]${eol}${key}=${value}${eol}`;
}

/** Interpret an INI value as a boolean (ON/1/TRUE/YES → true). */
export function iniValueIsOn(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "yes";
}
