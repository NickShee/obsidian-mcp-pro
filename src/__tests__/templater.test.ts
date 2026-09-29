import { describe, it, expect } from "vitest";
import { resolveTemplaterTags } from "../lib/templater.js";

// 2026-09-29 in local time (month is 0-indexed).
const REF = new Date(2026, 8, 29);

describe("resolveTemplaterTags", () => {
  it("resolves tp.date.now with and without a format", () => {
    expect(resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD") %>', REF).value).toBe(
      "2026-09-29"
    );
    expect(resolveTemplaterTags("<% tp.date.now() %>", REF).value).toBe("2026-09-29");
    expect(resolveTemplaterTags('<% tp.date.now("YYYY/MM") %>', REF).value).toBe(
      "2026/09"
    );
  });

  it("applies day offsets and reference dates", () => {
    expect(resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", 7) %>', REF).value).toBe(
      "2026-10-06"
    );
    expect(resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", -1) %>', REF).value).toBe(
      "2026-09-28"
    );
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", 1, "2026-01-01") %>', REF).value
    ).toBe("2026-01-02");
  });

  it("supports tomorrow and yesterday", () => {
    expect(
      resolveTemplaterTags('<% tp.date.tomorrow("YYYY-MM-DD") %>', REF).value
    ).toBe("2026-09-30");
    expect(resolveTemplaterTags("<% tp.date.yesterday() %>", REF).value).toBe(
      "2026-09-28"
    );
  });

  it("rolls over month and year boundaries", () => {
    const newYearsEve = new Date(2026, 11, 31);
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", 1) %>', newYearsEve).value
    ).toBe("2027-01-01");
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", -1) %>', new Date(2026, 2, 1))
        .value
    ).toBe("2026-02-28");
  });

  it("accepts single quotes", () => {
    expect(resolveTemplaterTags("<% tp.date.now('YYYY-MM') %>", REF).value).toBe(
      "2026-09"
    );
  });

  it("reports unsupported expressions and leaves them verbatim", () => {
    const result = resolveTemplaterTags(
      'owner: <% tp.system.prompt("who") %>',
      REF
    );
    expect(result.unsupported).toEqual(['tp.system.prompt("who")']);
    expect(result.value).toBe('owner: <% tp.system.prompt("who") %>');
  });

  it("rejects execution and trim tags", () => {
    expect(resolveTemplaterTags("<%* 1 + 1 %>", REF).unsupported).toHaveLength(1);
    expect(resolveTemplaterTags("<%~ tp.date.now() %>", REF).unsupported).toHaveLength(1);
  });

  it("rejects malformed arguments", () => {
    // unquoted format
    expect(resolveTemplaterTags("<% tp.date.now(YYYY) %>", REF).unsupported).toHaveLength(1);
    // non-integer offset
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", "x") %>', REF).unsupported
    ).toHaveLength(1);
    // tomorrow takes a format only
    expect(
      resolveTemplaterTags('<% tp.date.tomorrow("YYYY", 3) %>', REF).unsupported
    ).toHaveLength(1);
    // unparseable reference date
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD", 0, "not-a-date") %>', REF)
        .unsupported
    ).toHaveLength(1);
    // unterminated string
    expect(
      resolveTemplaterTags('<% tp.date.now("YYYY-MM-DD) %>', REF).unsupported
    ).toHaveLength(1);
  });

  it("resolves supported tags while reporting unsupported ones in the same string", () => {
    const result = resolveTemplaterTags(
      '<% tp.date.now("YYYY") %>-<% tp.file.title %>',
      REF
    );
    expect(result.value).toBe("2026-<% tp.file.title %>");
    expect(result.unsupported).toEqual(["tp.file.title"]);
  });

  it("handles multiple supported tags", () => {
    expect(
      resolveTemplaterTags(
        '<% tp.date.now("YYYY-MM-DD") %>..<% tp.date.now("YYYY-MM-DD", 1) %>',
        REF
      ).value
    ).toBe("2026-09-29..2026-09-30");
  });

  it("leaves plain text untouched", () => {
    expect(resolveTemplaterTags("no tags here", REF).value).toBe("no tags here");
    expect(resolveTemplaterTags("no tags here", REF).unsupported).toEqual([]);
  });
});
