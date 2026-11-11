// A screen described in the project's perchlight.json: a table over KV or D1
// data, with editable columns and row actions.
import { h, act, modal, confirmBox, confirmChange, table, toast, searchBox, plural, parseJson, pretty } from "../ui.js";
import { cf, viewHeader, show, state, nameOfNamespace, nameOfDatabase } from "../state.js";
import { compileKeyPattern, readColumn, formatValue, parseInput, setPath, getPath, parseJsonExact } from "../../shared/columns.js";
import { toCsv, ident } from "../../shared/csv.js";

const KV_LIMIT = 2000;
const D1_LIMIT = 500;

/** Loads a screen's records. Also used by the screen builder for samples. */
export async function loadRecords(source, keyPattern, { limit } = {}) {
  if (source.type === "kv") {
    const parse = compileKeyPattern(keyPattern);
    const { keys, truncated } = await cf("kvKeys", source.namespace, source.prefix ?? "", { limit: limit ?? KV_LIMIT });
    const values = keys.length ? await cf("kvGetMany", source.namespace, keys.map((k) => k.name)) : {};
    const records = [];
    for (const k of keys) {
      const keyParts = parse(k.name);
      if (keyPattern && !keyParts) continue; // keys that don't fit the pattern aren't part of this screen
      const raw = values[k.name];
      const parsed = raw == null ? null : parseJson(raw);
      records.push({ key: k.name, keyParts: keyParts ?? {}, value: parsed ?? raw ?? null, raw: raw ?? null, isJson: parsed !== null, expiration: k.expiration });
    }
    return { records, total: records.length, truncated };
  }
  const t = ident(source.table);
  const n = limit ?? D1_LIMIT;
  const [[count], [rows]] = await Promise.all([
    cf("d1Query", source.database, `SELECT COUNT(*) AS n FROM ${t}`),
    // WITHOUT ROWID tables have no rowid: shown read-only.
    cf("d1Query", source.database, `SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid DESC LIMIT ?1`, [n]).catch(() => cf("d1Query", source.database, `SELECT * FROM ${t} LIMIT ?1`, [n])),
  ]);
  return { records: rows.results, total: count.results[0].n, truncated: count.results[0].n > rows.results.length };
}

export async function viewCustom(root, view) {
  const kind = view.source.type;
  const { records, total, truncated } = await loadRecords(view.source, view.keyPattern);
  // A D1 table without rowid can be shown but not edited from here.
  const readOnly = kind === "d1" && records.length > 0 && !("__rowid" in records[0]);
  if (readOnly) view = { ...view, actions: [], columns: view.columns.map((c) => ({ ...c, editable: false })) };
  const columns = view.columns.filter((c) => !c.hidden);
  let query = state.ui[`q:${view.id}`] ?? "";

  const cellFor = (record, col) => {
    const v = readColumn(record, col.from, kind);
    const text = formatValue(v, col.type);
    if (!col.editable) return h("span", { class: `cell${v == null ? " null" : ""}`, title: typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "") }, text);
    const cell = h("span", { class: `cell editable${v == null ? " null" : ""}`, tabindex: "0", title: "Double-click to edit" }, text);
    const edit = () => editCell(view, record, col, v);
    cell.addEventListener("dblclick", edit);
    cell.addEventListener("keydown", (e) => e.key === "Enter" && edit());
    return cell;
  };

  const rowActions = (record) =>
    (view.actions ?? []).map((a) =>
      h("button", { class: `small${a.delete ? " danger-text" : ""}`, onclick: () => runAction(view, record, a) }, a.label),
    );

  const body = h("div");
  const filtered = () => {
    const q = query.toLowerCase();
    if (!q) return records;
    return records.filter((r) => columns.some((c) => String(readColumn(r, c.from, kind) ?? "").toLowerCase().includes(q)));
  };
  const draw = () =>
    body.replaceChildren(
      table(
        [
          ...columns.map((c) => ({ label: c.label, class: c.type === "number" || c.type === "count" ? "num" : null, render: (r) => cellFor(r, c) })),
          ...(view.actions?.length ? [{ label: "", class: "row-actions", render: rowActions }] : []),
        ],
        filtered(),
        records.length ? "Nothing matches." : "No records yet.",
      ),
    );

  const exportBtn = h("button", {
    class: "ghost",
    onclick: async () => {
      const rows = filtered().map((r) => Object.fromEntries(view.columns.map((c) => [c.label, readColumn(r, c.from, kind)])));
      const saved = await act(() => window.api.saveText(`${view.id}.csv`, toCsv(rows, view.columns.map((c) => c.label))));
      if (saved && saved !== true) toast(`Saved ${plural(rows.length, "row")}`);
    },
  }, "Export CSV");

  const where = kind === "kv" ? `KV ${nameOfNamespace(view.source.namespace)}${view.source.prefix ? ` → keys starting “${view.source.prefix}”` : ""}` : `D1 ${nameOfDatabase(view.source.database)} → ${view.source.table}`;
  root.append(
    viewHeader(view.title, `${where} · ${plural(total, "record")}${truncated ? ` (first ${records.length} shown)` : ""}`, exportBtn),
    readOnly && h("div", { class: "note" }, "This table has no rowid, so it's shown read-only. Edit it with the SQL console in the D1 browser."),
    h("div", { class: "toolbar" }, searchBox("Search…", query, (v) => ((query = v), (state.ui[`q:${view.id}`] = v), draw()))),
    body,
  );
  draw();
}

async function editCell(view, record, col, current) {
  const shown = current == null ? "" : typeof current === "object" ? JSON.stringify(current) : String(current);
  const field =
    col.type === "enum"
      ? { name: "v", label: col.label, options: col.options, other: true, value: shown }
      : col.type === "boolean"
        ? { name: "v", label: col.label, options: ["yes", "no"], other: false, value: current ? "yes" : "no" }
        : { name: "v", label: `${col.label}${col.type === "text" ? " (type NULL for empty)" : ""}`, value: shown, multiline: shown.length > 60 || col.type === "json", rows: 6 };
  const res = await modal({ title: `Edit ${col.label}`, fields: [field], confirm: "Next" });
  if (!res) return;
  let next;
  try {
    next = parseInput(res.v, col.type ?? "text", current);
  } catch (err) {
    return toast(`${col.label} ${err.message}`, "error");
  }
  if (JSON.stringify(next) === JSON.stringify(current ?? null)) return;
  if (!(await confirmChange({ title: `Save ${col.label}?`, before: formatValue(current, "json"), after: formatValue(next, "json") }))) return;
  if (await act(() => write(view, record, { [col.from]: next }), "Saved")) show(state.view);
}

async function runAction(view, record, action) {
  const label = view.source.type === "kv" ? record.key : `row ${record.__rowid}`;
  if (action.delete) {
    if (!(await confirmBox(`${action.label}: ${label}?`, "This deletes it from Cloudflare and can't be undone.", action.label))) return;
    if (await act(() => remove(view, record), "Done")) show(state.view);
    return;
  }
  const changes = Object.entries(action.set).map(([k, v]) => `${k} → ${JSON.stringify(v)}`).join("\n");
  if (action.confirm !== false && !(await confirmChange({ title: `${action.label}: ${label}?`, after: changes, confirm: action.label }))) return;
  if (await act(() => write(view, record, action.set), "Done")) show(state.view);
}

/**
 * Applies { from: value } changes to one record.
 * KV: re-reads the key (its value, expiration and metadata) just before
 * writing, so other fields, a TTL changed elsewhere and metadata are kept.
 * Refuses rather than risk damage: a key deleted meanwhile, a value that
 * isn't a JSON object, or numbers too large to round-trip exactly.
 */
async function write(view, record, changes) {
  const src = view.source;
  if (src.type === "kv") {
    const [fresh, listing] = await Promise.all([cf("kvGet", src.namespace, record.key), cf("kvKeys", src.namespace, record.key, { limit: 1 })]);
    const meta = listing.keys.find((k) => k.name === record.key);
    if (fresh == null || !meta) throw new Error(`${record.key} no longer exists (deleted since this screen loaded). Refresh to see the current data.`);
    let value;
    if (Object.keys(changes).length === 1 && "value" in changes) value = changes.value;
    else {
      const parsed = parseJsonExact(fresh);
      if (!parsed.ok) throw new Error("This key's value isn't JSON, so fields can't be set. Edit it in the KV browser.");
      if (!parsed.lossless) throw new Error("This key's value contains numbers too large or precise to edit safely here (they'd be rounded). Edit it in the KV browser.");
      value = parsed.value;
      for (const [from, v] of Object.entries(changes)) value = from === "value" ? v : setPath(value, from.slice(6), v);
    }
    if (meta.expiration && meta.expiration * 1000 - Date.now() < 90_000) throw new Error(`${record.key} expires in under 90 seconds, so it can't be saved. Cloudflare needs at least 60 seconds left.`);
    await cf("kvPut", src.namespace, record.key, JSON.stringify(value), meta.expiration ?? null, meta.metadata ?? null);
    return true;
  }
  if (record.__rowid === undefined) throw new Error("This table has no rowid, so rows can't be edited here. Use the SQL console in the D1 browser.");
  const cols = Object.keys(changes);
  const sets = cols.map((c, i) => `${ident(c)} = ?${i + 1}`).join(", ");
  await cf("d1Query", src.database, `UPDATE ${ident(src.table)} SET ${sets} WHERE rowid = ?${cols.length + 1}`, [...cols.map((c) => changes[c]), record.__rowid]);
  return true;
}

async function remove(view, record) {
  const src = view.source;
  if (src.type === "kv") return cf("kvDelete", src.namespace, record.key);
  if (record.__rowid === undefined) throw new Error("This table has no rowid, so rows can't be deleted here. Use the SQL console in the D1 browser.");
  return cf("d1Query", src.database, `DELETE FROM ${ident(src.table)} WHERE rowid = ?1`, [record.__rowid]);
}

export { pretty, getPath };
