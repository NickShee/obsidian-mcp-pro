import fs from "node:fs/promises";
import { sanitizeError } from "./errors.js";
import { log } from "./logger.js";
import { parseStrictYamlFrontmatter } from "./markdown.js";
import { readNote } from "./note-reads.js";
import { resolveVaultPathSafe } from "./vault-fs.js";

/**
 * Read the frontmatter of a vault note used as the frontmatter source
 * (`OBSIDIAN_FM_SOURCE=template`).
 *
 * Two things matter here:
 *
 * 1. **Safety.** The path comes from configuration, but it is still resolved
 *    through the normal vault pipeline — `resolveVaultPathSafe` enforces the
 *    vault boundary and `OBSIDIAN_READ_PATHS`, and `readNote` enforces the
 *    `*.md` extension and the size caps. A config value must not become a way
 *    to read an arbitrary host file.
 *
 * 2. **Cost.** The template is read on every write. A raw re-read of a typical
 *    template costs ~0.24 ms on this NAS, so the parse result is memoised on
 *    `(mtimeMs, size)`; a hit still re-resolves placeholders (cheap, and they
 *    must track the current date) but skips the read and the YAML parse.
 *    Keying on mtime also means editing the template in Obsidian takes effect
 *    on the next write, with no container restart.
 */

interface TemplateSnapshot {
  mtimeMs: number;
  size: number;
  defaults: Record<string, unknown> | null;
}

const cache = new Map<string, TemplateSnapshot>();
const warned = new Set<string>();

/** Test hook: drop memoised templates and "warn once" state. */
export function resetTemplateCache(): void {
  cache.clear();
  warned.clear();
}

function warnOnce(
  key: string,
  message: string,
  context: Record<string, unknown>
): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(message, context);
}

export async function loadTemplateFrontmatter(
  vaultPath: string,
  templatePath: string
): Promise<Record<string, unknown> | null> {
  let fullPath: string;
  try {
    fullPath = await resolveVaultPathSafe(vaultPath, templatePath, "read");
  } catch (err) {
    warnOnce(
      `template:resolve:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE is not a readable vault file; ignoring",
      { templatePath, err: sanitizeError(err) }
    );
    return null;
  }

  let mtimeMs: number;
  let size: number;
  try {
    const stats = await fs.stat(fullPath);
    mtimeMs = stats.mtimeMs;
    size = stats.size;
  } catch (err) {
    warnOnce(
      `template:stat:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE could not be stat-ed; ignoring",
      { templatePath, err: sanitizeError(err) }
    );
    return null;
  }

  const cached = cache.get(fullPath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.defaults;
  }

  let raw: string;
  try {
    raw = await readNote(vaultPath, templatePath);
  } catch (err) {
    warnOnce(
      `template:read:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE could not be read; ignoring",
      { templatePath, err: sanitizeError(err) }
    );
    return null;
  }

  const parsed = parseStrictYamlFrontmatter(raw);
  let defaults: Record<string, unknown> | null = null;

  if (parsed.error !== undefined) {
    warnOnce(
      `template:yaml:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE has malformed frontmatter; ignoring",
      { templatePath, err: sanitizeError(parsed.error) }
    );
  } else if (parsed.oversized === true) {
    warnOnce(
      `template:oversized:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE frontmatter exceeds the size cap; ignoring",
      { templatePath }
    );
  } else if (!parsed.hasFrontmatter) {
    warnOnce(
      `template:empty:${templatePath}`,
      "OBSIDIAN_FRONTMATTER_TEMPLATE has no frontmatter; ignoring",
      { templatePath }
    );
  } else {
    defaults = parsed.data;
  }

  cache.set(fullPath, { mtimeMs, size, defaults });
  return defaults;
}
