import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeNote } from "../../lib/vault.js";
import { defineTool, text, error } from "../../lib/tool-seam.js";
import { formatLocalDateOnly } from "../../lib/dates.js";
import { getDefaultFrontmatter } from "../../lib/frontmatter-defaults.js";
import {
  escapeControlChars,
  ensureMdExtension,
  composeCreateContent,
  isPlainObject,
} from "./shared.js";

/**
 * Defaults for a brand-new note: the configured defaults plus a server-side
 * `created` stamp.
 *
 * `created` is placed first so it leads the block, and is computed here
 * because a calling agent has no reliable notion of "today". An explicit
 * `created` in `OBSIDIAN_DEFAULT_FRONTMATTER` wins (spread order), which also
 * serves as the escape hatch for users who don't want an automatic date.
 *
 * It is only ever added for NEW notes. Backfilling an existing note
 * (append_to_note / prepend_to_note) must not stamp today's date as that
 * note's creation date.
 */
function newNoteDefaults(
  defaults: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (defaults === null) return null;
  return { created: formatLocalDateOnly(), ...defaults };
}

export function registerCreateNote(server: McpServer, vaultPath: string): void {
  defineTool(
    server,
    vaultPath,
    {
      name: "create_note",
      title: "Create Note",
      description:
        "Create a new markdown note at the given path with body content and optional YAML frontmatter. Fails (does not overwrite) if a note already exists at that path — use append_to_note, prepend_to_note, or update_frontmatter for existing notes. Missing directories are created automatically, and a .md extension is appended if omitted.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "Relative path from vault root, e.g., 'folder/note.md' or 'note' (.md added automatically)"
          ),
        content: z
          .string()
          .max(1_000_000)
          .describe(
            "Markdown body content for the note (rendered below the frontmatter block if any)"
          ),
        frontmatter: z
          .string()
          .max(100_000)
          .optional()
          .describe(
            'JSON object string of frontmatter key-value pairs (e.g., \'{"status":"draft","tags":["idea"]}\'). Rendered as YAML at the top of the note.'
          ),
      },
    },
    async ({ path: notePath, content, frontmatter }) => {
      const resolvedPath = ensureMdExtension(notePath);
      const displayedPath = escapeControlChars(resolvedPath);

      let callerFm: Record<string, unknown> | undefined;

      if (frontmatter) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(frontmatter);
        } catch {
          return error("Error: Invalid JSON in frontmatter parameter.");
        }
        if (!isPlainObject(parsed)) {
          return error(
            'Error: frontmatter must be a JSON object (e.g. \'{"status":"draft"}\'), not an array, string, number, boolean, or null.'
          );
        }
        callerFm = parsed;
      }

      // Caller values win, then configured defaults fill whatever is still
      // missing. With OBSIDIAN_DEFAULT_FRONTMATTER unset this reduces to the
      // original behaviour: caller frontmatter only, or the bare body.
      const finalContent = composeCreateContent(
        content,
        newNoteDefaults(getDefaultFrontmatter()),
        callerFm
      );

      try {
        await writeNote(vaultPath, resolvedPath, finalContent, {
          exclusive: true,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          return error(
            `Error: Note already exists at '${displayedPath}'. Use append or update tools instead.`
          );
        }
        throw err;
      }
      return text(`Created note at '${displayedPath}'.`);
    }
  );
}
