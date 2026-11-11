// Reading records into columns, and suggesting columns from sample records.
//
// A KV record is { key, keyParts, value, expiration } where value is the
// parsed JSON (or the raw text if it isn't JSON). A D1 record is a row object.

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Gets "a.b.c" from an object (own fields only); undefined if any step is missing. */
export function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of path.split(".")) {
    if (RESERVED.has(part) || cur === null || typeof cur !== "object" || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * A copy of obj with "a.b.c" set to value. Missing objects along the way are
 * created, but nothing existing is ever replaced: if obj, or a field along the
 * path, is a list, text or number, this throws instead of overwriting it.
 */
export function setPath(obj, path, value) {
  const parts = path.split(".");
  if (parts.some((p) => RESERVED.has(p) || p === "")) throw new Error(`"${path}" isn't an allowed field path`);
  if (!isPlainObject(obj)) throw new Error("This record's value isn't a JSON object, so a field can't be set in it. Edit it in the KV browser.");
  const root = structuredClone(obj);
  let cur = root;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      cur[part] = value;
      return;
    }
    if (!Object.hasOwn(cur, part) || cur[part] === null || cur[part] === undefined) cur[part] = {};
    else if (!isPlainObject(cur[part])) throw new Error(`"${parts.slice(0, i + 1).join(".")}" isn't an object, so "${path}" can't be set without overwriting it.`);
    cur = cur[part];
  });
  return root;
}

/**
 * Parses JSON and reports whether doing so changed any number (integers past
 * 2^53, or decimals with more precision than JavaScript keeps). Writing such
 * a value back would silently corrupt it, so callers refuse or keep the text.
 * @returns {{ ok: true, value: unknown, lossless: boolean } | { ok: false }}
 */
export function parseJsonExact(text) {
  let lossless = true;
  let sawSource = false;
  const exact = (src, v) => {
    if (!Number.isFinite(v)) return false;
    if (/^-?\d+$/.test(src)) return Number.isSafeInteger(v);
    // Decimals: JavaScript keeps about 15-17 significant digits.
    const digits = src.replace(/^-/, "").replace(/[eE].*$/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
    return digits.length <= 15;
  };
  try {
    const value = JSON.parse(text, function (_key, v, context) {
      if (typeof v === "number" && typeof context?.source === "string") {
        sawSource = true;
        if (!exact(context.source, v)) lossless = false;
      }
      return v;
    });
    // Engines without JSON.parse source access: look for long number literals outside strings.
    if (!sawSource && lossless) {
      const outsideStrings = String(text).replace(/"(?:[^"\\]|\\.)*"/g, '""');
      for (const m of outsideStrings.matchAll(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) if (!exact(m[0], Number(m[0]))) lossless = false;
    }
    return { ok: true, value, lossless };
  } catch {
    return { ok: false };
  }
}

/** Compiles "devices:{hash}" into a function returning { hash } or null. */
export function compileKeyPattern(pattern) {
  if (!pattern) return () => ({});
  const names = [];
  const parts = pattern.split(/(\{[A-Za-z0-9_]+\})/).filter((s) => s !== "");
  const source = parts
    .map((p, i) => {
      const m = /^\{([A-Za-z0-9_]+)\}$/.exec(p);
      if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(m[1]);
      return i === parts.length - 1 ? "(.*)" : "(.*?)";
    })
    .join("");
  const re = new RegExp(`^${source}$`);
  return (key) => {
    const m = re.exec(key);
    return m ? Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) : null;
  };
}

/** The value a column shows for a record. */
export function readColumn(record, from, kind) {
  if (kind === "d1") return record[from];
  if (from === "key") return record.key;
  if (from === "expiration") return record.expiration ?? null;
  if (from.startsWith("key.")) return record.keyParts?.[from.slice(4)];
  if (from === "value") return record.value;
  return getPath(record.value, from.slice(6)); // "value.x.y"
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** The kind of value, for suggesting a column type. */
export function typeOf(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return v > 1e11 && v < 1e14 ? "date" : "number"; // epoch milliseconds
  if (Array.isArray(v)) return "count";
  if (typeof v === "object") return "json";
  if (typeof v === "string" && ISO_DATE.test(v)) return "date";
  return "text";
}

/** Pairs of [path, value] for the leaves of a value, two levels deep. */
function leaves(value, prefix = "", depth = 0) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || depth >= 2) return [[prefix, value]];
  const out = [];
  for (const [k, v] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_$-]+$/.test(k)) continue;
    out.push(...leaves(v, prefix ? `${prefix}.${k}` : k, depth + 1));
  }
  return out.length ? out : [[prefix, value]];
}

function pretty(path) {
  const last = path.split(".").pop() || path;
  const words = last.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : path;
}

/** One column suggestion from the values seen for a field. */
function suggest(label, from, values) {
  const types = new Set(values.map(typeOf).filter(Boolean));
  let type = types.size === 1 ? [...types][0] : types.size ? "text" : "text";
  const col = { label, from, type };
  if (type === "text") {
    const distinct = [...new Set(values.filter((v) => typeof v === "string"))];
    if (distinct.length >= 2 && distinct.length <= 6 && distinct.length < values.length && distinct.every((d) => d.length <= 30)) {
      col.type = "enum";
      col.options = distinct.sort();
    }
  }
  return col;
}

/**
 * Suggests columns from up to ~20 sample records.
 * @param {"kv" | "d1"} kind
 * @param {object[]} samples  KV records ({ key, keyParts, value, expiration }) or D1 rows
 */
export function suggestColumns(kind, samples, { max = 12 } = {}) {
  if (kind === "d1") {
    const names = [];
    for (const row of samples) for (const k of Object.keys(row)) if (!names.includes(k) && k !== "__rowid") names.push(k);
    return names.slice(0, max).map((n) => suggest(pretty(n), n, samples.map((r) => r[n])));
  }

  const cols = [];
  const partNames = [...new Set(samples.flatMap((s) => Object.keys(s.keyParts ?? {})))];
  if (partNames.length) for (const n of partNames) cols.push({ label: pretty(n), from: `key.${n}`, type: "text" });
  else cols.push({ label: "Key", from: "key", type: "text" });

  const seen = new Map(); // path -> values
  for (const s of samples) {
    for (const [path, v] of leaves(s.value)) {
      if (!seen.has(path)) seen.set(path, []);
      seen.get(path).push(v);
    }
  }
  for (const [path, values] of seen) {
    if (cols.length >= max) break;
    cols.push(suggest(path ? pretty(path) : "Value", path ? `value.${path}` : "value", values));
  }
  if (samples.some((s) => s.expiration) && cols.length < max + 1) cols.push({ label: "Expires", from: "expiration", type: "date" });
  return cols;
}

/** A value as display text for a column type. */
export function formatValue(v, type) {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "boolean":
      return v === true || v === 1 || v === "true" ? "Yes" : v === false || v === 0 || v === "false" ? "No" : String(v);
    case "count":
      return Array.isArray(v) ? String(v.length) : String(v);
    case "json":
      return typeof v === "string" ? v : JSON.stringify(v);
    case "date": {
      const d = typeof v === "number" ? new Date(v < 1e11 ? v * 1000 : v) : new Date(String(v).includes("T") || /Z$/.test(v) ? v : `${String(v).replace(" ", "T")}Z`);
      return isNaN(d) ? String(v) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

/** Turns typed text from an edit box into a value of the column's type. */
export function parseInput(text, type, previous) {
  const t = String(text);
  if (t === "NULL" || t === "") return previous === undefined ? null : t === "NULL" ? null : "";
  if (type === "boolean") {
    if (/^(yes|true|1)$/i.test(t)) return typeof previous === "number" ? 1 : true;
    if (/^(no|false|0)$/i.test(t)) return typeof previous === "number" ? 0 : false;
    throw new Error(`"${t}" isn't yes or no`);
  }
  if (type === "number" || (type !== "text" && type !== "json" && typeof previous === "number")) {
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`"${t}" isn't a number`);
    return n;
  }
  if (type === "json") {
    try {
      return JSON.parse(t);
    } catch {
      throw new Error("isn't valid JSON");
    }
  }
  return t;
}
