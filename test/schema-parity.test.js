// The published JSON Schema and the app's own checker must agree, so a file an
// AI agent writes from the schema imports cleanly, and vice versa.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { validateConfig } from "../src/shared/config-schema.js";

const schema = JSON.parse(readFileSync(new URL("../schema/perchlight.schema.json", import.meta.url), "utf8"));
// Strict mode catches invalid or sloppy schemas. strictRequired is an Ajv style
// rule that rejects `required` inside if/then (standard JSON Schema), so it's off.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const schemaValid = ajv.compile(schema);

const kv = (extra = {}, col = {}) => ({
  version: 1,
  views: [{ id: "k", title: "K", source: { type: "kv", namespace: "ns" }, columns: [{ label: "V", from: "value.a", ...col }], ...extra }],
});
const d1 = (extra = {}, col = {}) => ({
  version: 1,
  views: [{ id: "d", title: "D", source: { type: "d1", database: "db", table: "t" }, columns: [{ label: "C", from: "c", ...col }], ...extra }],
});

// [description, config, expected validity]
const CASES = [
  ["empty", { version: 1, views: [] }, true],
  ["with $schema", { $schema: "https://perchlight.ravenburst.com/schema/v1.json", version: 1, views: [] }, true],
  ["$schema not text", { $schema: 1, version: 1, views: [] }, false],
  ["wrong version", { version: 2, views: [] }, false],
  ["unknown top-level key", { version: 1, views: [], extra: 1 }, false],
  ["plain kv", kv(), true],
  ["kv with prefix and pattern", kv({ source: { type: "kv", namespace: "ns", prefix: "u:" }, keyPattern: "u:{id}" }, { from: "key.id" }), true],
  ["kv pattern without a part", kv({ keyPattern: "plain" }), false],
  ["kv editable value field", kv({}, { editable: true }), true],
  ["kv editable key", kv({}, { from: "key", editable: true }), false],
  ["kv editable expiration", kv({}, { from: "expiration", editable: true }), false],
  ["kv bad from", kv({}, { from: "valuex" }), false],
  ["kv __proto__ field", kv({}, { from: "value.__proto__.x" }), false],
  ["kv constructor field", kv({}, { from: "value.a.constructor" }), false],
  ["enum with options", d1({}, { type: "enum", options: ["a", "b"] }), true],
  ["enum without options", d1({}, { type: "enum" }), false],
  ["options on a text column", d1({}, { options: ["a"] }), false],
  ["empty options", d1({}, { type: "enum", options: [] }), false],
  ["unknown column type", d1({}, { type: "money" }), false],
  ["d1 bad column name", d1({}, { from: "a b" }), false],
  ["d1 bad table name", d1({ source: { type: "d1", database: "db", table: "t;drop" } }), false],
  ["from too long", d1({}, { from: `c${"x".repeat(220)}` }), false],
  ["kv set action", kv({ actions: [{ label: "Revoke", set: { "value.revoked": true } }] }), true],
  ["kv set action on __proto__", kv({ actions: [{ label: "Bad", set: { "value.__proto__.x": 1 } }] }), false],
  ["d1 delete action", d1({ actions: [{ label: "Delete", delete: true, confirm: true }] }), true],
  ["action with set and delete", d1({ actions: [{ label: "X", set: { c: 1 }, delete: true }] }), false],
  ["action with neither", d1({ actions: [{ label: "X" }] }), false],
  ["action value not scalar", d1({ actions: [{ label: "X", set: { c: [1] } }] }), false],
  ["list preset", { version: 1, views: [{ id: "l", title: "List", preset: "perchlight-list", database: "db", siteUrl: "https://x.co" }] }, true],
  ["list preset http site", { version: 1, views: [{ id: "l", title: "List", preset: "perchlight-list", database: "db", siteUrl: "http://x.co" }] }, false],
  ["bad id", { version: 1, views: [{ id: "Bad Id", title: "x", preset: "perchlight-list", database: "db" }] }, false],
];

describe("published JSON Schema vs the app's checker", () => {
  it("the schema itself is valid (compiles in strict mode)", () => {
    expect(typeof schemaValid).toBe("function");
  });

  it.each(CASES)("%s", (_name, config, expected) => {
    const bySchema = schemaValid(config);
    const byApp = validateConfig(config).ok;
    expect({ bySchema, byApp }).toEqual({ bySchema: expected, byApp: expected });
  });

  it("duplicate ids: only the app catches them (JSON Schema can't express it), and says why", () => {
    const dup = { version: 1, views: [kv().views[0], kv().views[0]] };
    expect(validateConfig(dup).errors.some((e) => /unique/.test(e.message))).toBe(true);
  });

  it("never crashes on odd input", () => {
    for (const odd of [null, 1, "x", [], { version: 1, views: [null, 1, { columns: "x" }, { source: {}, columns: [{ editable: true }] }] }]) {
      expect(() => validateConfig(odd)).not.toThrow();
    }
  });
});
