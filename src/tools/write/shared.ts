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

// Frontmatter must be a YAML mapping at the root. `JSON.parse` happily returns
// strings, numbers, booleans, null, and arrays as well — feeding any of those
// to `matter.stringify` produces malformed (or surprising) YAML. Reject early
// with a clear message instead of writing a broken file to disk.
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
