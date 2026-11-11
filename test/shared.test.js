import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig, makeId, emptyConfig } from "../src/shared/config-schema.js";
import { compileKeyPattern, getPath, setPath, readColumn, suggestColumns, formatValue, parseInput, typeOf, parseJsonExact } from "../src/shared/columns.js";
import { markdownToHtml } from "../src/shared/markdown.js";
import { toCsv, ident } from "../src/shared/csv.js";

const good = {
  version: 1,
  views: [
    {
      id: "licenses",
      title: "Licenses",
      source: { type: "kv", namespace: "abc123", prefix: "devices:" },
      keyPattern: "devices:{hash}",
      columns: [
        { label: "Hash", from: "key.hash" },
        { label: "Devices", from: "value.devices", type: "count" },
        { label: "Revoked", from: "value.revoked", type: "boolean", editable: true },
      ],
      actions: [{ label: "Revoke", set: { "value.revoked": true }, confirm: true }],
    },
    {
      id: "users",
      title: "Users",
      source: { type: "d1", database: "db-1", table: "users" },
      columns: [{ label: "Plan", from: "plan", type: "enum", options: ["free", "pro"], editable: true }],
      actions: [{ label: "Delete", delete: true }],
    },
    { id: "list", title: "Mailing list", preset: "perchlight-list", database: "db-2", siteUrl: "https://list.example.com" },
  ],
};

describe("config checking", () => {
  it("accepts a valid file and the empty template", () => {
    expect(validateConfig(good)).toEqual({ ok: true, errors: [] });
    expect(validateConfig(emptyConfig()).ok).toBe(true);
  });

  it("reports each problem with its path, in plain language", () => {
    const bad = structuredClone(good);
    bad.views[0].columns[1].type = "money";
    bad.views[1].id = "licenses";
    bad.views[1].columns[0].from = "plan; DROP TABLE users";
    bad.views[0].actions[0] = { label: "Both", set: { "value.x": 1 }, delete: true };
    bad.views[0].extra = 1;
    const { ok, errors } = validateConfig(bad);
    expect(ok).toBe(false);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("views[0].columns[1].type");
    expect(paths).toContain("views[1].id");
    expect(paths).toContain("views[1].columns[0].from");
    expect(paths).toContain("views[0].actions[0]");
    expect(paths).toContain("views[0].extra");
    expect(errors.find((e) => e.path === "views[1].id").message).toContain("unique");
  });

  it("explains a file from a newer version of the app", () => {
    const { errors } = validateConfig({ version: 2, views: [] });
    expect(errors[0].message).toContain("Update Perchlight");
  });

  it("rejects non-objects and missing views", () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig({ version: 1 }).errors[0].path).toBe("views");
  });

  it("enum columns need options; KV keys can't be editable", () => {
    const c = { version: 1, views: [{ id: "a", title: "A", source: { type: "kv", namespace: "n" }, columns: [{ label: "K", from: "key", editable: true }, { label: "S", from: "value.s", type: "enum" }] }] };
    const paths = validateConfig(c).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["views[0].columns[0].editable", "views[0].columns[1].options"]));
  });

  it("makes unique ids from titles", () => {
    expect(makeId("Users List!", [])).toBe("users-list");
    expect(makeId("Users List", ["users-list"])).toBe("users-list-2");
    expect(makeId("***", [])).toBe("screen");
  });

  it("the published JSON Schema file parses and covers the same top-level shape", () => {
    const schema = JSON.parse(readFileSync(new URL("../schema/perchlight.schema.json", import.meta.url), "utf8"));
    expect(schema.properties.version.const).toBe(1);
    expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining(["kvView", "d1View", "listPreset"]));
    const published = readFileSync(new URL("../site/schema/v1.json", import.meta.url), "utf8");
    expect(JSON.parse(published)).toEqual(schema); // the website serves the same schema
  });
});

describe("columns", () => {
  it("key patterns name the parts of a key", () => {
    const parse = compileKeyPattern("devices:{hash}");
    expect(parse("devices:abc")).toEqual({ hash: "abc" });
    expect(parse("trial:abc")).toBeNull();
    expect(compileKeyPattern("{kind}:{id}")("user:42:x")).toEqual({ kind: "user", id: "42:x" });
    expect(compileKeyPattern("a.b+{x}")("a.b+1")).toEqual({ x: "1" }); // regex characters are literal
  });

  it("setPath never overwrites existing non-object data, and refuses dangerous names", () => {
    expect(() => setPath([1, 2], "revoked", true)).toThrow(/isn't a JSON object/);
    expect(() => setPath("text", "a", 1)).toThrow();
    expect(() => setPath(null, "a", 1)).toThrow();
    expect(() => setPath({ a: 5 }, "a.b", 1)).toThrow(/isn't an object/);
    expect(() => setPath({ a: [1] }, "a.b", 1)).toThrow(/isn't an object/);
    expect(() => setPath({}, "__proto__.polluted", true)).toThrow(/allowed/);
    expect(() => setPath({}, "a.constructor", 1)).toThrow();
    expect({}.polluted).toBeUndefined();
    expect(getPath({ a: 1 }, "constructor")).toBeUndefined();
    expect(getPath({ a: 1 }, "toString")).toBeUndefined(); // own fields only
  });

  it("parseJsonExact spots numbers that would be rounded", () => {
    expect(parseJsonExact('{"n": 12345, "f": 1.5, "s": "99999999999999999999"}')).toMatchObject({ ok: true, lossless: true });
    expect(parseJsonExact('{"id": 12345678901234567890}').lossless).toBe(false);
    expect(parseJsonExact('{"pi": 3.14159265358979323846}').lossless).toBe(false);
    expect(parseJsonExact("[9007199254740993]").lossless).toBe(false);
    expect(parseJsonExact("{not json").ok).toBe(false);
  });

  it("gets and sets nested paths without changing the original", () => {
    const o = { a: { b: 1 } };
    expect(getPath(o, "a.b")).toBe(1);
    expect(getPath(o, "a.c.d")).toBeUndefined();
    const n = setPath(o, "a.c.d", true);
    expect(n).toEqual({ a: { b: 1, c: { d: true } } });
    expect(o).toEqual({ a: { b: 1 } });
  });

  it("reads KV and D1 columns", () => {
    const rec = { key: "devices:abc", keyParts: { hash: "abc" }, value: { devices: [1, 2], meta: { plan: "pro" } }, expiration: 1700000000 };
    expect(readColumn(rec, "key.hash", "kv")).toBe("abc");
    expect(readColumn(rec, "value.meta.plan", "kv")).toBe("pro");
    expect(readColumn(rec, "expiration", "kv")).toBe(1700000000);
    expect(readColumn({ email: "a@b.co" }, "email", "d1")).toBe("a@b.co");
  });

  it("suggests KV columns from samples, with types", () => {
    const samples = [
      { key: "devices:a", keyParts: { hash: "a" }, value: { revoked: false, devices: ["x"], plan: "pro", issued: "2026-01-02T00:00:00Z" } },
      { key: "devices:b", keyParts: { hash: "b" }, value: { revoked: true, devices: [], plan: "free", issued: "2026-02-03T00:00:00Z" } },
      { key: "devices:c", keyParts: { hash: "c" }, value: { revoked: false, devices: ["y", "z"], plan: "pro", issued: "2026-03-04T00:00:00Z" } },
    ];
    const cols = suggestColumns("kv", samples);
    const by = Object.fromEntries(cols.map((c) => [c.from, c]));
    expect(cols[0]).toEqual({ label: "Hash", from: "key.hash", type: "text" });
    expect(by["value.revoked"].type).toBe("boolean");
    expect(by["value.devices"].type).toBe("count");
    expect(by["value.plan"]).toMatchObject({ type: "enum", options: ["free", "pro"] });
    expect(by["value.issued"].type).toBe("date");
  });

  it("suggests D1 columns from rows", () => {
    const rows = [
      { __rowid: 1, email: "a@x.co", status: "confirmed", created_at: "2026-01-01 10:00:00" },
      { __rowid: 2, email: "b@x.co", status: "pending", created_at: "2026-01-02 10:00:00" },
      { __rowid: 3, email: "c@x.co", status: "confirmed", created_at: "2026-01-03 10:00:00" },
    ];
    const cols = suggestColumns("d1", rows);
    expect(cols.map((c) => c.from)).toEqual(["email", "status", "created_at"]);
    expect(cols[1].type).toBe("enum");
    expect(cols[2]).toMatchObject({ label: "Created at", type: "date" });
  });

  it("formats and parses values by type", () => {
    expect(formatValue(true, "boolean")).toBe("Yes");
    expect(formatValue([1, 2, 3], "count")).toBe("3");
    expect(formatValue(null, "text")).toBe("—");
    expect(parseInput("42", "number")).toBe(42);
    expect(() => parseInput("x", "number")).toThrow();
    expect(parseInput("yes", "boolean", 0)).toBe(1);
    expect(parseInput("NULL", "text", "a")).toBeNull();
    expect(typeOf(1767225600000)).toBe("date");
  });
});

describe("markdown", () => {
  it("renders the subset and escapes everything else", () => {
    const html = markdownToHtml("# Hi <there>\n\nSome **bold** and *it* and `code`.\n\n- one\n- two\n\n[Site](https://x.co) [bad](javascript:alert(1))");
    expect(html).toContain("<h1");
    expect(html).toContain("Hi &lt;there&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(html).toContain('<a href="https://x.co"');
    expect(html).not.toContain('href="javascript'); // left as plain text, never a link
    expect(html).not.toContain("<there>");
  });
});

describe("csv", () => {
  it("quotes properly and neutralises formulas", () => {
    expect(toCsv([{ a: 'x,"y"', b: "=SUM(1)" }], ["a", "b"])).toBe('a,b\r\n"x,""y""",\'=SUM(1)');
    expect(toCsv([{ "Name, full": "-12.5", x: "-cmd" }], ["Name, full", "x"])).toBe('"Name, full",x\r\n-12.5,\'-cmd');
    expect(ident('we"ird')).toBe('"we""ird"');
  });
});
