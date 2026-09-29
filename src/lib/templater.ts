import { formatMomentDate, parseLocalDateOnly } from "./dates.js";

/**
 * A deliberately tiny, eval-free subset of Templater's date API.
 *
 * Obsidian's Templater plugin resolves `<% … %>` by executing JavaScript.
 * Reimplementing that is neither possible (no user to answer a prompt) nor
 * desirable (running template code server-side). What we do instead is
 * recognise a fixed whitelist of *date* expressions and format them with the
 * same moment-style engine the rest of the server uses. Everything else is
 * reported as unsupported so the caller can drop that field rather than write
 * a literal `<% … %>` into a note.
 *
 * Supported:
 *   <% tp.date.now() %>                        → today, YYYY-MM-DD
 *   <% tp.date.now("FORMAT") %>                → today, FORMAT
 *   <% tp.date.now("FORMAT", N) %>             → today + N days
 *   <% tp.date.now("FORMAT", N, "YYYY-MM-DD") %> → reference + N days
 *   <% tp.date.tomorrow(["FORMAT"]) %>         → today + 1
 *   <% tp.date.yesterday(["FORMAT"]) %>        → today - 1
 *
 * `FORMAT` may be single- or double-quoted. Anything else — other `tp.*`
 * helpers, `<%* … %>` execution tags, `<%~ … %>` trim tags, unparseable
 * arguments — is unsupported.
 */

export interface TemplaterResolution {
  /** The input with every supported tag replaced. Unsupported tags are left verbatim. */
  value: string;
  /** Raw bodies of the tags that could not be resolved (trimmed, for logging). */
  unsupported: string[];
}

const TAG_RE = /<%([\s\S]*?)%>/g;
const CALL_RE = /^\s*tp\.date\.(now|tomorrow|yesterday)\s*\(([\s\S]*)\)\s*$/;

/** Split on commas that are not inside a quoted string. `null` when unbalanced. */
function splitArguments(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote !== null) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        current += ch + trimmed[i + 1]!;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (quote !== null) return null;
  parts.push(current.trim());
  return parts;
}

/** Accepts `"…"` or `'…'` only — a bare word is not a Templater string. */
function unquote(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function resolveDateTag(body: string, reference: Date): string | null {
  const match = CALL_RE.exec(body);
  if (match === null) return null;

  const fn = match[1]!;
  const args = splitArguments(match[2]!);
  if (args === null) return null;

  const isSingleFormatCall = fn === "tomorrow" || fn === "yesterday";
  if (isSingleFormatCall && args.length > 1) return null;
  if (!isSingleFormatCall && args.length > 3) return null;

  let format = "YYYY-MM-DD";
  let offset = fn === "tomorrow" ? 1 : fn === "yesterday" ? -1 : 0;
  let base = reference;

  if (args.length >= 1) {
    const parsedFormat = unquote(args[0]!);
    if (parsedFormat === null) return null;
    format = parsedFormat;
  }
  if (!isSingleFormatCall && args.length >= 2) {
    const parsedOffset = Number(args[1]);
    if (!Number.isInteger(parsedOffset)) return null;
    offset += parsedOffset;
  }
  if (!isSingleFormatCall && args.length >= 3) {
    const parsedReference = unquote(args[2]!);
    if (parsedReference === null) return null;
    const date = parseLocalDateOnly(parsedReference);
    if (date === null) return null;
    base = date;
  }

  const shifted = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + offset
  );
  return formatMomentDate(shifted, format);
}

export function resolveTemplaterTags(
  input: string,
  reference: Date
): TemplaterResolution {
  const unsupported: string[] = [];

  const value = input.replace(TAG_RE, (whole: string, body: string) => {
    const resolved = resolveDateTag(body, reference);
    if (resolved === null) {
      unsupported.push(body.trim());
      return whole;
    }
    return resolved;
  });

  return { value, unsupported };
}
