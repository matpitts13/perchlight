// D1 browser: tables, rows (double-click to edit), and a SQL console.
import { h, act, modal, confirmBox, confirmChange, table, chips } from "../ui.js";
import { state, cf, viewHeader, show } from "../state.js";
import { ident } from "../../shared/csv.js";

// "_" is a LIKE wildcard, so it's escaped to match only a real underscore.
const SYSTEM_TABLES = "name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'";

export async function listTables(db) {
  const [res] = await cf("d1Query", db, `SELECT name FROM sqlite_master WHERE type = 'table' AND ${SYSTEM_TABLES} ORDER BY name`);
  return res.results.map((r) => r.name);
}

export async function viewD1(root) {
  if (!state.databases.length) {
    root.append(viewHeader("D1 browser"), h("div", { class: "empty" }, "This account has no D1 databases."));
    return;
  }
  const db = state.databases.some((d) => d.id === state.ui.d1Db) ? state.ui.d1Db : state.databases[0].id;
  const tables = await listTables(db);
  const current = tables.includes(state.ui.d1Table) ? state.ui.d1Table : tables[0];

  const dbSelect = h(
    "select",
    { "aria-label": "Database", onchange: (e) => ((state.ui.d1Db = e.target.value), (state.ui.d1Table = null), show("d1")) },
    state.databases.map((d) => {
      const o = h("option", { value: d.id }, d.name);
      o.selected = d.id === db;
      return o;
    }),
  );

  const grid = h("div");
  if (current) {
    const [[countRes], [rowsRes]] = await Promise.all([
      cf("d1Query", db, `SELECT COUNT(*) AS n FROM ${ident(current)}`),
      cf("d1Query", db, `SELECT rowid AS __rowid, * FROM ${ident(current)} ORDER BY rowid DESC LIMIT 500`).catch(() =>
        cf("d1Query", db, `SELECT * FROM ${ident(current)} LIMIT 500`), // WITHOUT ROWID tables: read-only here
      ),
    ]);
    const rows = rowsRes.results;
    const hasRowid = rows.length === 0 || "__rowid" in rows[0];
    const cols = rows.length ? Object.keys(rows[0]).filter((c) => c !== "__rowid") : [];
    const n = countRes.results[0].n;
    grid.append(
      h("p", { class: "muted" }, `${n} rows${n > 500 ? " (newest 500 shown)" : ""}${hasRowid ? " · double-click a cell to edit" : " · this table has no rowid, so edit it with SQL"}`),
      table(
        [
          ...cols.map((c) => ({ label: c, render: (r) => (hasRowid ? editableCell(db, current, rows, r, c) : cellText(r[c])) })),
          hasRowid && {
            label: "",
            class: "row-actions",
            render: (r) =>
              h("button", {
                class: "small danger-text",
                onclick: async () => {
                  if (!(await confirmBox("Delete row?", `${current}, rowid ${r.__rowid}. This can't be undone.`))) return;
                  if (await act(() => cf("d1Query", db, `DELETE FROM ${ident(current)} WHERE rowid = ?1`, [r.__rowid]), "Deleted")) show("d1");
                },
              }, "Delete"),
          },
        ].filter(Boolean),
        rows,
        "Empty table.",
      ),
    );
  }

  root.append(
    viewHeader("D1 browser", "Tables, rows and a SQL console."),
    h("div", { class: "toolbar" }, dbSelect, chips(tables, current, (t) => ((state.ui.d1Table = t), show("d1")))),
    tables.length ? grid : h("div", { class: "empty" }, "No tables yet. Create one with the SQL console."),
    sqlConsole(db),
  );
}

const cellText = (v) => h("span", { class: `cell${v === null ? " null" : ""}` }, v === null ? "NULL" : String(v));

function editableCell(db, tableName, rows, row, col) {
  const cell = h("span", { class: `cell editable${row[col] === null ? " null" : ""}`, title: "Double-click to edit", tabindex: "0" }, row[col] === null ? "NULL" : String(row[col]));
  const edit = async () => {
    const original = row[col];
    const shown = original === null ? "NULL" : String(original);
    const distinct = [...new Set(rows.map((r) => r[col]).filter((v) => v !== null).map(String))];
    const field =
      distinct.length && distinct.length <= 8 && distinct.length < rows.length
        ? { name: "v", label: "New value", options: distinct, other: true, value: shown, placeholder: "Type a value, or NULL" }
        : { name: "v", label: "New value (type NULL for null)", value: shown, multiline: shown.length > 60, rows: 6 };
    const res = await modal({ title: `Edit ${tableName}.${col}`, body: `Row ${row.__rowid}`, fields: [field], confirm: "Next" });
    if (!res || res.v === shown) return;
    let v = res.v === "NULL" ? null : res.v;
    if (typeof original === "number" && v !== null && v.trim() !== "" && !isNaN(Number(v))) v = Number(v);
    const after = v === null ? "NULL" : String(v);
    if (!(await confirmChange({ title: `Save ${tableName}.${col}?`, body: `Row ${row.__rowid} on the live database.`, before: shown, after }))) return;
    if (await act(() => cf("d1Query", db, `UPDATE ${ident(tableName)} SET ${ident(col)} = ?1 WHERE rowid = ?2`, [v, row.__rowid]), "Saved")) {
      row[col] = v;
      cell.textContent = after;
      cell.classList.toggle("null", v === null);
    }
  };
  cell.addEventListener("dblclick", edit);
  cell.addEventListener("keydown", (e) => e.key === "Enter" && edit());
  return cell;
}

export function sqlConsole(db, presets = []) {
  const area = h("textarea", { class: "sql", spellcheck: "false", rows: 5, "aria-label": "SQL", placeholder: "SELECT * FROM my_table LIMIT 50;   (Ctrl+Enter to run)", value: state.ui.lastSql || "" });
  const out = h("div");
  const run = async () => {
    const sql = area.value.trim();
    if (!sql) return;
    state.ui.lastSql = sql;
    const single = !/;\s*\S/.test(sql.replace(/;\s*$/, ""));
    const writes = /\b(insert|update|delete|replace|drop|alter|create|vacuum|reindex|attach|pragma)\b/i.test(sql);
    const readOnly = single && /^(select|explain|with)\b/i.test(sql) && !writes;
    if (!readOnly && !(await confirmBox("Run this SQL?", "It may change or delete data on the live database.", "Run"))) return;
    out.replaceChildren(h("div", { class: "empty" }, "Running…"));
    const results = await act(() => cf("d1Query", db, sql));
    if (!results || results === true) return out.replaceChildren();
    out.replaceChildren(
      ...results.map((r) =>
        r.results.length
          ? table(Object.keys(r.results[0]).map((c) => ({ label: c, render: (row) => cellText(row[c]) })), r.results)
          : h("p", { class: "muted" }, `OK · ${r.meta.changes ?? 0} row(s) changed · ${Math.round(r.meta.duration ?? 0)} ms`),
      ),
    );
  };
  area.addEventListener("keydown", (e) => e.key === "Enter" && e.ctrlKey && (e.preventDefault(), run()));
  const presetSelect = presets.length
    ? h(
        "select",
        { "aria-label": "Common queries", onchange: (e) => e.target.value && ((area.value = e.target.value), run(), (e.target.value = "")) },
        h("option", { value: "" }, "Common queries…"),
        presets.map((p) => h("option", { value: p.sql }, p.label)),
      )
    : null;
  return h(
    "section",
    { class: "console" },
    h("div", { class: "console-head" }, h("h2", {}, "SQL console"), presetSelect),
    area,
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: run }, "Run")),
    out,
  );
}
