// Checks a perchlight.json screen configuration. The same rules are
// published as JSON Schema in schema/perchlight.schema.json so people and AI
// agents can write the file themselves; this checker gives plain-language
// errors with the exact path of each problem.

export const CONFIG_VERSION = 1;
export const COLUMN_TYPES = ["text", "number", "boolean", "date", "enum", "count", "json"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KV_FROM_RE = /^(key|value|expiration|key\.[A-Za-z0-9_]+|value(\.[A-Za-z0-9_$-]+)+)$/;
const D1_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Field names that would reach JavaScript's built-in objects. */
export const RESERVED_SEGMENT = /(^|\.)(__proto__|constructor|prototype)(\.|$)/;

/**
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validateConfig(config) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const str = (v, path, { min = 1, max = 200, re, what = "text" } = {}) => {
    if (typeof v !== "string") return err(path, `should be ${what}`), false;
    if (v.length < min) return err(path, min === 1 ? "can't be empty" : `should be at least ${min} characters`), false;
    if (v.length > max) return err(path, `should be at most ${max} characters`), false;
    if (re && !re.test(v)) return err(path, `isn't valid (${what})`), false;
    return true;
  };
  const known = (obj, path, keys) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) err(`${path}.${k}`, `isn't a known setting (expected one of: ${keys.join(", ")})`);
  };

  if (!isObj(config)) {
    err("(file)", "should be a JSON object like { \"version\": 1, \"views\": [...] }");
    return { ok: false, errors };
  }
  known(config, "(file)", ["$schema", "version", "views"]);
  if (config.$schema !== undefined && typeof config.$schema !== "string") err("$schema", "should be text (the schema's address)");
  if (config.version !== CONFIG_VERSION) {
    if (typeof config.version === "number" && config.version > CONFIG_VERSION) {
      err("version", `is ${config.version}, but this app understands version ${CONFIG_VERSION}. Update Perchlight to use this file.`);
    } else {
      err("version", `should be ${CONFIG_VERSION}`);
    }
  }
  if (!Array.isArray(config.views)) {
    err("views", "should be a list of screens");
    return { ok: errors.length === 0, errors };
  }

  const ids = new Set();
  config.views.forEach((view, i) => {
    const p = `views[${i}]`;
    if (!isObj(view)) return err(p, "should be an object describing one screen");
    if (str(view.id, `${p}.id`, { max: 40, re: ID_RE, what: "lower-case letters, digits and dashes" })) {
      if (ids.has(view.id)) err(`${p}.id`, `"${view.id}" is used by another screen; ids must be unique`);
      ids.add(view.id);
    }
    str(view.title, `${p}.title`, { max: 60 });

    if (view.preset !== undefined) {
      known(view, p, ["id", "title", "preset", "database", "siteUrl"]);
      if (view.preset !== "perchlight-list") err(`${p}.preset`, 'should be "perchlight-list" (the only preset so far)');
      str(view.database, `${p}.database`, { max: 100, what: "a D1 database id" });
      if (view.siteUrl !== undefined && !(typeof view.siteUrl === "string" && view.siteUrl.length <= 300 && /^https:\/\/[^\s/]+/.test(view.siteUrl))) {
        err(`${p}.siteUrl`, "should be the https:// address of your perchlight-list site");
      }
      return;
    }

    known(view, p, ["id", "title", "source", "keyPattern", "columns", "actions"]);
    const src = view.source;
    let kind = null;
    if (!isObj(src)) err(`${p}.source`, 'should say where the data is, e.g. { "type": "d1", "database": "…", "table": "…" }');
    else if (src.type === "kv") {
      kind = "kv";
      known(src, `${p}.source`, ["type", "namespace", "prefix"]);
      str(src.namespace, `${p}.source.namespace`, { max: 100, what: "a KV namespace id" });
      if (src.prefix !== undefined) str(src.prefix, `${p}.source.prefix`, { min: 0, max: 200 });
    } else if (src.type === "d1") {
      kind = "d1";
      known(src, `${p}.source`, ["type", "database", "table"]);
      str(src.database, `${p}.source.database`, { max: 100, what: "a D1 database id" });
      str(src.table, `${p}.source.table`, { max: 100, re: D1_NAME_RE, what: "a table name (letters, digits, underscores)" });
    } else {
      err(`${p}.source.type`, 'should be "kv" or "d1"');
    }

    if (view.keyPattern !== undefined) {
      if (kind !== "kv") err(`${p}.keyPattern`, "only applies to KV screens");
      else if (str(view.keyPattern, `${p}.keyPattern`, { max: 200 }) && !/\{[A-Za-z0-9_]+\}/.test(view.keyPattern)) {
        err(`${p}.keyPattern`, 'should name at least one part, like "devices:{hash}"');
      }
    }

    if (!Array.isArray(view.columns) || !view.columns.length) err(`${p}.columns`, "should list at least one column");
    else if (view.columns.length > 30) err(`${p}.columns`, "has more than 30 columns");
    else {
      view.columns.forEach((c, j) => {
        const cp = `${p}.columns[${j}]`;
        if (!isObj(c)) return err(cp, "should be an object like { \"label\": \"Email\", \"from\": \"email\" }");
        known(c, cp, ["label", "from", "type", "options", "editable", "hidden"]);
        str(c.label, `${cp}.label`, { max: 60 });
        if (str(c.from, `${cp}.from`, { max: 200 })) {
          if (kind === "kv" && !KV_FROM_RE.test(c.from)) err(`${cp}.from`, 'for KV should be "key", "key.<part>", "value", "value.<field>…" or "expiration"');
          if (kind === "kv" && RESERVED_SEGMENT.test(c.from)) err(`${cp}.from`, "can't use the field names __proto__, constructor or prototype");
          if (kind === "d1" && !D1_NAME_RE.test(c.from)) err(`${cp}.from`, "for D1 should be a column name");
        }
        if (c.type !== undefined && !COLUMN_TYPES.includes(c.type)) err(`${cp}.type`, `should be one of: ${COLUMN_TYPES.join(", ")}`);
        if (c.type === "enum") {
          if (!Array.isArray(c.options) || !c.options.length || !c.options.every((o) => typeof o === "string")) {
            err(`${cp}.options`, "should list the allowed values for an enum column");
          }
        } else if (c.options !== undefined) err(`${cp}.options`, 'only applies to "enum" columns');
        for (const flag of ["editable", "hidden"]) if (c[flag] !== undefined && typeof c[flag] !== "boolean") err(`${cp}.${flag}`, "should be true or false");
        if (c.editable === true && kind === "kv" && typeof c.from === "string" && !c.from.startsWith("value")) {
          err(`${cp}.editable`, "keys and expirations can't be edited from a column");
        }
      });
    }

    if (view.actions !== undefined) {
      if (!Array.isArray(view.actions)) err(`${p}.actions`, "should be a list");
      else {
        view.actions.forEach((a, j) => {
          const ap = `${p}.actions[${j}]`;
          if (!isObj(a)) return err(ap, "should be an object");
          known(a, ap, ["label", "set", "delete", "confirm"]);
          str(a.label, `${ap}.label`, { max: 40 });
          const hasSet = a.set !== undefined;
          const hasDelete = a.delete === true;
          if (hasSet === hasDelete) err(ap, 'should have exactly one of "set" or "delete": true');
          if (a.delete !== undefined && a.delete !== true) err(`${ap}.delete`, "should be true");
          if (hasSet) {
            if (!isObj(a.set) || !Object.keys(a.set).length) err(`${ap}.set`, 'should map fields to new values, like { "value.revoked": true }');
            else {
              for (const [k, v] of Object.entries(a.set)) {
                if (kind === "kv" && !/^value(\.[A-Za-z0-9_$-]+)+$/.test(k)) err(`${ap}.set.${k}`, 'for KV should be a "value.<field>" path');
                if (kind === "kv" && RESERVED_SEGMENT.test(k)) err(`${ap}.set.${k}`, "can't use the field names __proto__, constructor or prototype");
                if (kind === "d1" && !D1_NAME_RE.test(k)) err(`${ap}.set.${k}`, "for D1 should be a column name");
                if (v !== null && !["string", "number", "boolean"].includes(typeof v)) err(`${ap}.set.${k}`, "should be text, a number, true/false or null");
              }
            }
          }
          if (a.confirm !== undefined && typeof a.confirm !== "boolean") err(`${ap}.confirm`, "should be true or false");
        });
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/** A new, empty configuration. */
export function emptyConfig() {
  return { $schema: "https://perchlight.ravenburst.com/schema/v1.json", version: CONFIG_VERSION, views: [] };
}

/** "Users list" -> "users-list", unique among existing ids. */
export function makeId(title, existing) {
  const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "screen";
  let id = /^[a-z0-9]/.test(base) ? base : `s-${base}`;
  for (let n = 2; existing.includes(id); n++) id = `${base.slice(0, 30)}-${n}`;
  return id;
}
