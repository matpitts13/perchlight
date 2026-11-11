// Screens: create, edit, reorder and delete the project's screens without
// writing JSON; import/export perchlight.json for people (or AI agents) who
// prefer to write it.
import { h, act, modal, confirmBox, toast, table, errorList, badge, plural } from "../ui.js";
import { state, viewHeader, show, saveConfig, nameOfNamespace, nameOfDatabase } from "../state.js";
import { suggestColumns, readColumn, formatValue } from "../../shared/columns.js";
import { COLUMN_TYPES, makeId, validateConfig } from "../../shared/config-schema.js";
import { loadRecords } from "./custom.js";
import { listTables } from "./d1.js";

const SCHEMA_URL = "https://github.com/matpitts13/perchlight/blob/main/schema/perchlight.schema.json";
const SAMPLE = 20;

export async function viewBuilder(root) {
  const views = state.config.views;
  const describe = (v) =>
    v.preset ? `Mailing list · D1 ${nameOfDatabase(v.database)}` : v.source.type === "kv" ? `KV ${nameOfNamespace(v.source.namespace)}${v.source.prefix ? ` · “${v.source.prefix}”` : ""}` : `D1 ${nameOfDatabase(v.source.database)} · ${v.source.table}`;

  const move = async (i, d) => {
    const next = structuredClone(state.config);
    const [v] = next.views.splice(i, 1);
    next.views.splice(i + d, 0, v);
    if (await saveConfig(next)) show("builder");
  };

  root.append(
    viewHeader(
      "Screens",
      "Your own screens over this project's data. They appear at the top of the sidebar.",
      h("button", { class: "primary", onclick: () => newScreen() }, "+ New screen"),
      h("button", { onclick: () => newListScreen() }, "+ Mailing list screen"),
      h("button", { class: "ghost", onclick: importFile }, "Import…"),
      h("button", { class: "ghost", onclick: () => act(() => window.api.exportViews(state.projectId)).then((p) => p && p !== true && toast(`Saved ${p}`)) }, "Export…"),
    ),
    h(
      "div",
      { class: "note" },
      "Prefer to write it yourself, or have an AI agent do it? Screens are saved as a ",
      h("code", {}, "perchlight.json"),
      " file. The format is published as a ",
      h("button", { class: "link", onclick: () => window.api.openExternal(SCHEMA_URL) }, "JSON Schema"),
      ". Use Import to load a file; it's checked first and every problem is listed.",
    ),
    table(
      [
        { label: "Screen", render: (v) => h("b", {}, v.title) },
        { label: "Data", render: describe },
        { label: "Columns", class: "num", render: (v) => (v.preset ? "—" : v.columns.length) },
        {
          label: "",
          class: "row-actions",
          render: (v) => {
            const i = views.indexOf(v);
            return [
              h("button", { class: "small", disabled: i === 0, onclick: () => move(i, -1), "aria-label": `Move ${v.title} up` }, "↑"),
              h("button", { class: "small", disabled: i === views.length - 1, onclick: () => move(i, 1), "aria-label": `Move ${v.title} down` }, "↓"),
              h("button", { class: "small", onclick: () => (v.preset ? newListScreen(v) : editScreen(v)) }, "Edit"),
              h("button", {
                class: "small danger-text",
                onclick: async () => {
                  if (!(await confirmBox(`Delete the “${v.title}” screen?`, "Only the screen is removed. No data on Cloudflare changes."))) return;
                  const next = structuredClone(state.config);
                  next.views = next.views.filter((x) => x.id !== v.id);
                  if (await saveConfig(next)) show("builder");
                },
              }, "Delete"),
            ];
          },
        },
      ],
      views,
      "No screens yet. Make one with “+ New screen”.",
    ),
  );
}

async function importFile() {
  const result = await act(() => window.api.importViews(state.projectId));
  if (!result || result === true) return;
  if (!result.ok) {
    await modal({ title: "That file has problems", body: "Nothing was imported. Fix these and try again:", content: errorList(result.errors), confirm: "OK", cancel: null, wide: true });
    return;
  }
  state.config = result.config;
  toast(`Imported ${plural(result.config.views.length, "screen")}`);
  show("builder");
}

/** Step 1: where the data is. */
async function newScreen() {
  const kinds = [
    ...(state.databases.length ? [{ value: "d1", label: "A D1 table" }] : []),
    ...(state.namespaces.length ? [{ value: "kv", label: "KV keys (optionally with a prefix)" }] : []),
  ];
  if (!kinds.length) return toast("This account has no KV namespaces or D1 databases yet.", "error");
  const pick = await modal({ title: "New screen: where's the data?", fields: [{ name: "kind", label: "Show", options: kinds, other: false }], confirm: "Next" });
  if (!pick) return;

  let source;
  let keyPattern;
  if (pick.kind === "d1") {
    const db = await modal({ title: "Which database?", fields: [{ name: "db", label: "Database", options: state.databases.map((d) => ({ value: d.id, label: d.name })), other: false }], confirm: "Next" });
    if (!db) return;
    const tables = await act(() => listTables(db.db));
    if (!tables || tables === true) return;
    if (!tables.length) return toast("That database has no tables yet.", "error");
    const t = await modal({ title: "Which table?", fields: [{ name: "table", label: "Table", options: tables, other: false }], confirm: "Next" });
    if (!t) return;
    source = { type: "d1", database: db.db, table: t.table };
  } else {
    const r = await modal({
      title: "Which keys?",
      fields: [
        { name: "ns", label: "Namespace", options: state.namespaces.map((n) => ({ value: n.id, label: n.title })), other: false },
        { name: "prefix", label: "Only keys starting with (optional)", placeholder: "e.g. user:" },
        { name: "pattern", label: "Name the parts of the key (optional)", placeholder: "e.g. user:{id}", hint: "Parts in {braces} become columns you can show, like key.id." },
      ],
      confirm: "Next",
    });
    if (!r) return;
    source = { type: "kv", namespace: r.ns, ...(r.prefix ? { prefix: r.prefix } : {}) };
    keyPattern = r.pattern.trim() || undefined;
  }

  const sample = await act(() => loadRecords(source, keyPattern, { limit: SAMPLE }));
  if (!sample || sample === true) return;
  if (!sample.records.length) toast("No records found to learn from, so you'll pick columns by hand.", "error");
  const columns = suggestColumns(source.type, sample.records);
  const title = source.type === "d1" ? source.table.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : (source.prefix || "Keys").replace(/[:_-]+$/, "");
  await editScreen({ id: makeId(title, state.config.views.map((v) => v.id)), title, source, ...(keyPattern ? { keyPattern } : {}), columns, actions: [] }, { isNew: true, sample: sample.records });
}

/** Step 2: columns and actions, with a live preview of the sample. */
async function editScreen(original, { isNew = false, sample = null } = {}) {
  const draft = structuredClone(original);
  const kind = draft.source.type;
  if (!sample) {
    const loaded = await act(() => loadRecords(draft.source, draft.keyPattern, { limit: SAMPLE }));
    sample = loaded && loaded !== true ? loaded.records : [];
  }
  // Fields seen in the sample that aren't columns yet can be added.
  const extra = suggestColumns(kind, sample, { max: 40 }).filter((s) => !draft.columns.some((c) => c.from === s.from));

  const main = document.getElementById("main");
  const root = h("div", { class: "view" });
  const titleInput = h("input", { type: "text", value: draft.title, "aria-label": "Screen title", oninput: (e) => (draft.title = e.target.value) });
  const colsBox = h("div", { class: "builder-cols" });
  const actionsBox = h("div");
  const previewBox = h("div");
  const errorsBox = h("div");

  const drawPreview = () => {
    const shown = draft.columns.filter((c) => !c.hidden);
    previewBox.replaceChildren(
      h("h3", {}, `Preview (${plural(sample.length, "sample record")})`),
      h("div", { class: "sample" }, table(shown.map((c) => ({ label: c.label, render: (r) => formatValue(readColumn(r, c.from, kind), c.type) })), sample.slice(0, 8), "No sample records.")),
    );
  };

  const drawCols = () => {
    colsBox.replaceChildren(
      ...draft.columns.map((c, i) => {
        const typeSel = h(
          "select",
          { "aria-label": `Type of ${c.label}`, onchange: (e) => ((c.type = e.target.value), c.type === "enum" && !c.options?.length && (c.options = ["a", "b"]), c.type !== "enum" && delete c.options, drawCols()) },
          COLUMN_TYPES.map((t) => {
            const o = h("option", { value: t }, t);
            o.selected = (c.type ?? "text") === t;
            return o;
          }),
        );
        const keyish = kind === "kv" && (c.from === "key" || c.from.startsWith("key.") || c.from === "expiration");
        return h(
          "div",
          { class: `builder-col${c.hidden ? " off" : ""}` },
          h("span", { class: "muted" }, i + 1),
          h("input", { type: "text", value: c.label, "aria-label": "Column label", oninput: (e) => ((c.label = e.target.value), drawPreview()) }),
          h("code", { title: c.from }, c.from),
          typeSel,
          h("label", {}, h("input", { type: "checkbox", checked: c.editable, disabled: keyish, onchange: (e) => (e.target.checked ? (c.editable = true) : delete c.editable) }), "editable"),
          h("label", {}, h("input", { type: "checkbox", checked: c.hidden, onchange: (e) => ((e.target.checked ? (c.hidden = true) : delete c.hidden), drawCols()) }), "hidden"),
          h(
            "span",
            {},
            h("button", { class: "small", disabled: i === 0, "aria-label": "Move up", onclick: () => (draft.columns.splice(i - 1, 0, draft.columns.splice(i, 1)[0]), drawCols()) }, "↑"),
            h("button", { class: "small", disabled: i === draft.columns.length - 1, "aria-label": "Move down", onclick: () => (draft.columns.splice(i + 1, 0, draft.columns.splice(i, 1)[0]), drawCols()) }, "↓"),
            c.type === "enum" && h("button", { class: "small", onclick: () => editOptions(c).then(drawCols) }, "Options"),
            h("button", { class: "small danger-text", "aria-label": `Remove ${c.label}`, onclick: () => (draft.columns.splice(i, 1), drawCols()) }, "✕"),
          ),
        );
      }),
      h(
        "div",
        { class: "actions", style: "justify-content:flex-start" },
        extra.length > 0 &&
          h(
            "select",
            {
              "aria-label": "Add a field",
              onchange: (e) => {
                const s = extra.find((x) => x.from === e.target.value);
                if (s) {
                  draft.columns.push(s);
                  extra.splice(extra.indexOf(s), 1);
                }
                drawCols();
              },
            },
            h("option", { value: "" }, "+ Add a field from the data…"),
            extra.map((s) => h("option", { value: s.from }, `${s.label} (${s.from})`)),
          ),
        h("button", { class: "small", onclick: addCustomColumn }, "+ Add a field by name"),
      ),
    );
    drawPreview();
  };

  async function addCustomColumn() {
    const r = await modal({
      title: "Add a field",
      fields: [
        { name: "from", label: kind === "kv" ? 'Field path (e.g. value.profile.name, key, key.id, expiration)' : "Column name", required: true },
        { name: "label", label: "Label", required: true },
      ],
      confirm: "Add",
    });
    if (!r) return;
    draft.columns.push({ label: r.label.trim(), from: r.from.trim(), type: "text" });
    drawCols();
  }

  const drawActions = () => {
    actionsBox.replaceChildren(
      h("h3", {}, "Row buttons"),
      h("p", { class: "muted" }, "Buttons on every row, like “Revoke” (sets a field) or “Delete”. Every one asks before changing anything."),
      table(
        [
          { label: "Button", render: (a) => a.label },
          { label: "Does", render: (a) => (a.delete ? badge("deletes the record", "bad") : Object.entries(a.set).map(([k, v]) => `${k} → ${JSON.stringify(v)}`).join(", ")) },
          { label: "", class: "row-actions", render: (a) => h("button", { class: "small danger-text", onclick: () => ((draft.actions = draft.actions.filter((x) => x !== a)), drawActions()) }, "Remove") },
        ],
        draft.actions ?? [],
        "No row buttons.",
      ),
      h("div", { class: "actions", style: "justify-content:flex-start" }, h("button", { class: "small", onclick: addAction }, "+ Add a row button")),
    );
  };

  async function addAction() {
    const fields = kind === "kv" ? draft.columns.filter((c) => c.from.startsWith("value.")) : draft.columns;
    const r = await modal({
      title: "Add a row button",
      fields: [
        { name: "label", label: "Button label", required: true, placeholder: "e.g. Revoke" },
        { name: "what", label: "What it does", options: [{ value: "set", label: "Sets a field to a value" }, { value: "delete", label: "Deletes the record" }], other: false },
        { name: "field", label: "Field (for “sets a field”)", options: fields.map((c) => ({ value: c.from, label: `${c.label} (${c.from})` })), other: true, placeholder: kind === "kv" ? "value.fieldName" : "column_name" },
        { name: "value", label: "New value (for “sets a field”): text, a number, true/false or null", placeholder: "true" },
      ],
      confirm: "Add",
    });
    if (!r) return;
    let action;
    if (r.what === "delete") action = { label: r.label.trim(), delete: true };
    else {
      const raw = r.value.trim();
      let value = raw;
      if (raw === "true" || raw === "false" || raw === "null" || (raw !== "" && !isNaN(Number(raw)))) value = JSON.parse(raw);
      action = { label: r.label.trim(), set: { [r.field.trim()]: value } };
    }
    draft.actions = [...(draft.actions ?? []), action];
    drawActions();
  }

  async function save() {
    draft.title = draft.title.trim();
    if (!draft.actions?.length) delete draft.actions;
    const next = structuredClone(state.config);
    const idx = next.views.findIndex((v) => v.id === original.id);
    if (idx >= 0 && !isNew) next.views[idx] = draft;
    else next.views.push(draft);
    const check = validateConfig(next);
    if (!check.ok) {
      errorsBox.replaceChildren(h("div", { class: "error-box" }, h("h3", {}, "Fix these first:"), errorList(check.errors)));
      return;
    }
    if (await saveConfig(next)) {
      toast(isNew ? "Screen created" : "Screen saved");
      show(`v:${draft.id}`);
    }
  }

  const where = kind === "kv" ? `KV ${nameOfNamespace(draft.source.namespace)}${draft.source.prefix ? `, keys starting “${draft.source.prefix}”` : ""}${draft.keyPattern ? `, pattern ${draft.keyPattern}` : ""}` : `D1 ${nameOfDatabase(draft.source.database)} → ${draft.source.table}`;
  root.append(
    h("header", { class: "view-head" }, h("div", {}, h("h1", {}, isNew ? "New screen" : `Edit “${original.title}”`), h("p", { class: "muted" }, where)), h("div", { class: "head-actions" }, h("button", { class: "ghost", onclick: () => show("builder") }, "Cancel"), h("button", { class: "primary", onclick: save }, "Save screen"))),
    errorsBox,
    h("label", { class: "field" }, h("span", {}, "Title"), titleInput),
    h("h3", { style: "margin-top:16px" }, "Columns"),
    h("p", { class: "muted" }, isNew ? `Suggested from ${plural(sample.length, "sample record")}. Rename, reorder, hide, or mark columns editable.` : "Rename, reorder, hide, or mark columns editable."),
    colsBox,
    h("div", { style: "margin-top:16px" }, previewBox),
    h("div", { style: "margin-top:16px" }, actionsBox),
  );
  drawCols();
  drawActions();
  main.replaceChildren(root);
}

async function editOptions(col) {
  const r = await modal({ title: `Options for ${col.label}`, fields: [{ name: "o", label: "One value per line", multiline: true, rows: 8, value: (col.options ?? []).join("\n") }], confirm: "Save" });
  if (!r) return;
  const opts = [...new Set(r.o.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  if (opts.length) col.options = opts;
}

/** Adds or edits the built-in mailing-list screen for a perchlight-list database. */
async function newListScreen(existing = null) {
  if (!state.databases.length) return toast("This account has no D1 databases. Deploy perchlight-list first.", "error");
  const r = await modal({
    title: existing ? "Edit mailing list screen" : "Mailing list screen",
    body: "For a perchlight-list mailing list: subscribers, blocking, CSV export and announcements.",
    fields: [
      { name: "title", label: "Title", value: existing?.title ?? "Mailing list", required: true },
      { name: "db", label: "The D1 database your perchlight-list Worker uses", options: state.databases.map((d) => ({ value: d.id, label: d.name })), other: false, value: existing?.database ?? state.databases.find((d) => /list/i.test(d.name))?.id },
      { name: "siteUrl", label: "Your list's site address (optional, for adding subscribers)", placeholder: "https://list.example.com", value: existing?.siteUrl ?? "" },
    ],
    confirm: "Save",
  });
  if (!r) return;
  const tables = await act(() => listTables(r.db));
  if (!tables || tables === true) return;
  const missing = ["subscribers", "announcements", "deliveries"].filter((t) => !tables.includes(t));
  if (missing.length && !(await confirmBox("That doesn't look like a perchlight-list database", `It has no ${missing.join(", ")} table${missing.length > 1 ? "s" : ""}. Use it anyway?`, "Use it anyway", false))) return;
  const view = { id: existing?.id ?? makeId(r.title, state.config.views.map((v) => v.id)), title: r.title.trim(), preset: "perchlight-list", database: r.db, ...(r.siteUrl.trim() ? { siteUrl: r.siteUrl.trim().replace(/\/+$/, "") } : {}) };
  const next = structuredClone(state.config);
  const idx = next.views.findIndex((v) => v.id === view.id);
  if (idx >= 0) next.views[idx] = view;
  else next.views.push(view);
  if (await saveConfig(next)) show(`v:${view.id}`);
}
