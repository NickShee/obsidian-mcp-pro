import { log } from "./logger.js";

/**
 * Read `OBSIDIAN_DEFAULT_FRONTMATTER` — a JSON object string of frontmatter
 * keys that the write tools apply as a *bottom layer*: a key is only ever
 * added when the note does not already have it. Existing keys keep their
 * original value, position and formatting.
 *
 * Returns `null` when the variable is unset, empty, malformed or not a JSON
 * object. A `null` result means "feature disabled", which leaves every write
 * path byte-identical to the behaviour before this feature existed.
 *
 * Read lazily on each call (mirroring `permissions.ts`) rather than caching at
 * module load, so a changed value takes effect without a module reload and
 * test suites can toggle it per case.
 */
export function getDefaultFrontmatter(): Record<string, unknown> | null {
  const raw = process.env.OBSIDIAN_DEFAULT_FRONTMATTER;
  if (!raw || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("OBSIDIAN_DEFAULT_FRONTMATTER is not valid JSON; ignoring", {});
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    log.warn("OBSIDIAN_DEFAULT_FRONTMATTER must be a JSON object; ignoring", {});
    return null;
  }

  return parsed as Record<string, unknown>;
}
