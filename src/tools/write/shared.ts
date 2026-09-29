import { formatLocalDateOnly } from "../../lib/dates.js";
import { escapeControlChars } from "../../lib/errors.js";
import {
  appendDefaultFrontmatterKeys,
  updateFrontmatter,
} from "../../lib/markdown.js";

export { escapeControlChars };

export function ensureMdExtension(filePath: string): string {
  return /\.md$/i.test(filePath) ? filePath : `${filePath}.md`;
}

export function buildFrontmatterContent(
  frontmatterObj: Record<string, unknown>,
  body: string
): string {
  return updateFrontmatter(body, frontmatterObj);
}

/**
 * Build the final content for `create_note`.
 *
 * Precedence: explicit `callerFm` > frontmatter already present in `body` >
 * `defaults`. The caller's values overwrite (existing behaviour, untouched);
 * the configured defaults are then applied as a bottom layer that only fills
 * keys still missing — they never overwrite anything.
 */
export function composeCreateContent(
  body: string,
  defaults: Record<string, unknown> | null,
  callerFm?: Record<string, unknown>
): string {
  const withCaller = callerFm
    ? buildFrontmatterContent(callerFm, body)
    : body;
  return appendDefaultFrontmatterKeys(withCaller, defaults);
}

/**
 * Defaults for a brand-new note: the configured defaults, plus the auto-managed
 * date fields, with `created` generated server-side.
 *
 * `created` is placed first so it leads the block, and is derived from
 * `noteDate` because a calling agent has no reliable notion of "today" — and a
 * daily note created for a past day should carry that day, not the day it was
 * written. An explicit `created` in OBSIDIAN_DEFAULT_FRONTMATTER wins (spread
 * order), which doubles as the escape hatch for anyone who does not want an
 * automatic creation date.
 *
 * `patch` (the auto-managed fields, default `modified`) is applied last so it
 * beats a same-named key in the configured defaults. `created` itself stays
 * tied to OBSIDIAN_DEFAULT_FRONTMATTER: enabling only OBSIDIAN_MODIFIED_FIELDS
 * must not add keys nobody asked for.
 *
 * Used for note creation ONLY. Backfilling an existing note (append/prepend)
 * must never stamp a creation date — that would misreport when the note was
 * actually written.
 */
export function newNoteDefaults(
  defaults: Record<string, unknown> | null,
  patch: Record<string, string>,
  noteDate = new Date()
): Record<string, unknown> | null {
  const base =
    defaults === null
      ? null
      : { created: formatLocalDateOnly(noteDate), ...defaults };
  if (base === null && Object.keys(patch).length === 0) return null;
  return { ...(base ?? {}), ...patch };
}

// Frontmatter must be a YAML mapping at the root. `JSON.parse` happily returns
// strings, numbers, booleans, null, and arrays as well — feeding any of those
// to `matter.stringify` produces malformed (or surprising) YAML. Reject early
// with a clear message instead of writing a broken file to disk.
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
