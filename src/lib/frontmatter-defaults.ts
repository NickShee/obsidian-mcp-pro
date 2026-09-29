import {
  formatLocalDateOnly,
  substituteDatePlaceholders,
} from "./dates.js";
import { loadTemplateFrontmatter } from "./frontmatter-template.js";
import { log } from "./logger.js";
import { resolveTemplaterTags } from "./templater.js";

/**
 * Where the default frontmatter for a new note comes from.
 *
 *   OBSIDIAN_FM_SOURCE=env       → OBSIDIAN_DEFAULT_FRONTMATTER (JSON in the env)
 *   OBSIDIAN_FM_SOURCE=template  → the frontmatter of OBSIDIAN_FRONTMATTER_TEMPLATE,
 *                                  with OBSIDIAN_DEFAULT_FRONTMATTER layered on top
 *
 * Unset means "env only", which is the behaviour that existed before templates
 * were supported — so an upgrade that does not touch the environment keeps
 * working, and the template is strictly opt-in.
 */
export type FrontmatterSource = "env" | "template";

const warnOnceKeys = new Set<string>();

function warnOnce(
  key: string,
  message: string,
  context: Record<string, unknown>
): void {
  if (warnOnceKeys.has(key)) return;
  warnOnceKeys.add(key);
  log.warn(message, context);
}

/** Test hook: clear "already warned" state. */
export function resetFrontmatterWarnings(): void {
  warnOnceKeys.clear();
}

export function getFrontmatterSource(): FrontmatterSource | null {
  const raw = process.env.OBSIDIAN_FM_SOURCE;
  if (raw === undefined || raw.trim() === "") {
    if (getTemplatePath() !== null) {
      warnOnce(
        "source:unset",
        "OBSIDIAN_FRONTMATTER_TEMPLATE is set but OBSIDIAN_FM_SOURCE is not; ignoring the template (set OBSIDIAN_FM_SOURCE=template to enable it)",
        {}
      );
    }
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "env" || normalized === "template") return normalized;

  warnOnce(
    "source:invalid",
    "OBSIDIAN_FM_SOURCE must be 'env' or 'template'; ignoring",
    { value: raw }
  );
  return null;
}

export function getTemplatePath(): string | null {
  const raw = process.env.OBSIDIAN_FRONTMATTER_TEMPLATE;
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim();
}

/**
 * Read `OBSIDIAN_DEFAULT_FRONTMATTER` — a JSON object string of frontmatter
 * keys, applied as a *bottom layer*: a key is only ever added when the note
 * does not already have it. Existing keys keep their original value, position
 * and formatting.
 *
 * Returned unresolved; `resolveDefaultFrontmatter` applies placeholders and
 * unifies the env and template paths.
 *
 * Returns `null` when the variable is unset, empty, malformed or not a JSON
 * object — "feature disabled", which leaves every write path byte-identical to
 * the behaviour before this feature existed.
 */
export function getDefaultFrontmatter(): Record<string, unknown> | null {
  const raw = process.env.OBSIDIAN_DEFAULT_FRONTMATTER;
  if (raw === undefined || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnOnce("env:json", "OBSIDIAN_DEFAULT_FRONTMATTER is not valid JSON; ignoring", {});
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnOnce(
      "env:shape",
      "OBSIDIAN_DEFAULT_FRONTMATTER must be a JSON object; ignoring",
      {}
    );
    return null;
  }

  return parsed as Record<string, unknown>;
}

/** True when any string inside `value` carries a Templater tag we cannot resolve. */
function hasUnsupportedTag(value: unknown): boolean {
  if (typeof value === "string") {
    // A throwaway reference date is fine: whether a tag is *resolvable* does
    // not depend on the date, only on the expression itself.
    return resolveTemplaterTags(value, new Date()).unsupported.length > 0;
  }
  if (Array.isArray(value)) return value.some((entry) => hasUnsupportedTag(entry));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasUnsupportedTag(entry)
    );
  }
  return false;
}

function resolvePlaceholders(value: unknown, date: Date): unknown {
  if (typeof value === "string") {
    // Templater first, then Obsidian core syntax — a template may use either.
    const templater = resolveTemplaterTags(value, date).value;
    return substituteDatePlaceholders(templater, date);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolvePlaceholders(entry, date));
  }
  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolvePlaceholders(entry, date);
    }
    return resolved;
  }
  return value;
}

/**
 * Drop fields whose value carries an unresolvable Templater expression, then
 * resolve the placeholders of what is left.
 *
 * Dropping beats writing a literal `<% tp.system.prompt(...) %>` into every new
 * note: the field would be silent garbage, and the note would look fine. One
 * field is dropped at a time — a single unsupported expression must not take
 * the rest of the block down with it.
 */
function prepareDefaults(
  source: Record<string, unknown>,
  date: Date,
  origin: string
): Record<string, unknown> {
  const prepared: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(source)) {
    if (hasUnsupportedTag(value)) {
      warnOnce(
        `unsupported:${origin}:${field}`,
        "Dropping a default frontmatter field with an unsupported Templater expression",
        { field, origin }
      );
      continue;
    }
    prepared[field] = resolvePlaceholders(value, date);
  }

  return prepared;
}

/**
 * The defaults for a note, honouring `OBSIDIAN_FM_SOURCE`.
 *
 * With `template`, the template's frontmatter is the base and
 * `OBSIDIAN_DEFAULT_FRONTMATTER` (if set) is layered on top, so the env stays
 * useful as a per-field override or as an escape hatch when the template is
 * temporarily unavailable.
 *
 * `date` is what placeholders resolve against: today for an ordinary note, and
 * the note's own date when creating a daily note for a past day.
 */
export async function resolveDefaultFrontmatter(
  vaultPath: string,
  date = new Date()
): Promise<Record<string, unknown> | null> {
  const source = getFrontmatterSource();

  let templateDefaults: Record<string, unknown> | null = null;
  if (source === "template") {
    const templatePath = getTemplatePath();
    if (templatePath === null) {
      warnOnce(
        "template:missing-path",
        "OBSIDIAN_FM_SOURCE=template but OBSIDIAN_FRONTMATTER_TEMPLATE is not set; using env defaults only",
        {}
      );
    } else {
      templateDefaults = await loadTemplateFrontmatter(vaultPath, templatePath);
    }
  }

  const envDefaults = getDefaultFrontmatter();

  let merged: Record<string, unknown> | null;
  if (templateDefaults === null) merged = envDefaults;
  else if (envDefaults === null) merged = templateDefaults;
  else merged = { ...templateDefaults, ...envDefaults };

  if (merged === null) return null;
  return prepareDefaults(merged, date, source ?? "env");
}

/**
 * Remove the server-managed fields from a defaults object before backfilling an
 * EXISTING note (append/prepend).
 *
 * `created` must never be backfilled — stamping today's date onto a note
 * written in 2024 would misreport when it was written. The auto-managed
 * `modified`-style fields are removed too: the write path refreshes them from
 * the current date regardless, so carrying a template's copy would just be a
 * second, staler source of truth.
 */
export function stripAutoManagedFields(
  defaults: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (defaults === null) return null;

  const managed = new Set(["created", ...getModifiedFields()]);
  const kept: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(defaults)) {
    if (managed.has(field)) continue;
    kept[field] = value;
  }

  return Object.keys(kept).length === 0 ? null : kept;
}

// Field names are spliced into a generated `key: value` line, so anything that
// could break out of that shape (whitespace, colon, quote, newline) is rejected
// rather than escaped — an unusable name is a config mistake, not a value.
const FIELD_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Read `OBSIDIAN_MODIFIED_FIELDS` — a comma-separated list of frontmatter keys
 * that every content write refreshes to the current local date.
 *
 * This is the single deliberate exception to the "fill missing keys, never
 * overwrite" rule that `OBSIDIAN_DEFAULT_FRONTMATTER` follows: a listed key is
 * *always* overwritten, which is what makes it usable for `modified`-style
 * bookkeeping. Unset or empty disables it, leaving writes unchanged.
 *
 * Invalid names are skipped with a warning so one typo cannot disable the rest.
 */
export function getModifiedFields(): string[] {
  const raw = process.env.OBSIDIAN_MODIFIED_FIELDS;
  if (raw === undefined || raw.trim() === "") return [];

  const fields: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (!FIELD_NAME_RE.test(name)) {
      warnOnce(
        `modified:invalid:${name}`,
        "OBSIDIAN_MODIFIED_FIELDS contains an invalid field name; skipping",
        { field: name }
      );
      continue;
    }
    if (!fields.includes(name)) fields.push(name);
  }
  return fields;
}

/**
 * `{ field: "YYYY-MM-DD" }` for every configured auto-managed field, ready to
 * hand to `setFrontmatterFields`. Empty when the feature is off.
 */
export function buildModifiedPatch(
  date = formatLocalDateOnly()
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of getModifiedFields()) patch[field] = date;
  return patch;
}
