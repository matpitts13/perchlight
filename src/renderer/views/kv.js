// KV browser: any namespace, keys by prefix, view/edit/create/delete values.
import { h, act, modal, confirmBox, confirmChange, toast, fmt, plural } from "../ui.js";
import { state, cf, viewHeader, show } from "../state.js";
import { parseJsonExact } from "../../shared/columns.js";

export async function viewKv(root) {
  if (!state.namespaces.length) {
    root.append(viewHeader("KV browser"), h("div", { class: "empty" }, "This account has no KV namespaces."));
    return;
  }
  const ns = state.namespaces.some((n) => n.id === state.ui.kvNs) ? state.ui.kvNs : state.namespaces[0].id;
  const prefix = state.ui.kvPrefix ?? "";
  const { keys, truncated } = await cf("kvKeys", ns, prefix, { limit: 5000 });
  let selected = null;

  const nsSelect = h(
    "select",
    { "aria-label": "Namespace", onchange: (e) => ((state.ui.kvNs = e.target.value), (state.ui.kvPrefix = ""), show("kv")) },
    state.namespaces.map((n) => {
      const o = h("option", { value: n.id }, n.title);
      o.selected = n.id === ns;
      return o;
    }),
  );
  const prefixInput = h("input", {
    type: "search",
    placeholder: "Key prefix, then Enter",
    value: prefix,
    "aria-label": "Key prefix",
    onkeydown: (e) => e.key === "Enter" && ((state.ui.kvPrefix = e.target.value), show("kv")),
  });

  const list = h("div", { class: "key-list" });
  const editor = h("div", { class: "editor" }, h("div", { class: "empty" }, "Pick a key."));
  const drawList = () =>
    list.replaceChildren(...keys.map((k) => h("button", { class: `key${k.name === selected ? " on" : ""}`, title: k.name, onclick: () => openKey(k) }, k.name)));

  async function openKey(k) {
    selected = k.name;
    drawList();
    editor.replaceChildren(h("div", { class: "empty" }, "Loading…"));
    const raw = await act(() => cf("kvGet", ns, k.name));
    if (raw === undefined) return;
    if (raw === true || raw === null) {
      editor.replaceChildren(h("div", { class: "empty" }, `${k.name} no longer exists. Refresh the list.`));
      return;
    }
    const text = raw;
    const exact = parseJsonExact(text);
    // Pretty-print JSON for editing, unless that would round a number; then show it exactly as stored.
    const isJson = exact.ok;
    const shown = isJson && exact.lossless ? JSON.stringify(exact.value, null, 2) : text;
    const area = h("textarea", { spellcheck: "false", "aria-label": `Value of ${k.name}`, value: shown });
    editor.replaceChildren(
      h("div", { class: "editor-head" }, h("code", {}, k.name), k.expiration && h("span", { class: "muted" }, `expires ${fmt(k.expiration * 1000)}`)),
      area,
      h(
        "div",
        { class: "actions" },
        h("button", {
          class: "danger-text ghost",
          onclick: async () => {
            if (!(await confirmBox(`Delete ${k.name}?`, "This can't be undone."))) return;
            if (await act(() => cf("kvDelete", ns, k.name), "Deleted")) show("kv");
          },
        }, "Delete"),
        h("button", {
          class: "primary",
          onclick: async () => {
            if (area.value === shown) return toast("No changes to save.");
            // JSON stays JSON. It's saved compact only when that can't round a
            // number; otherwise exactly as typed.
            let next = area.value;
            if (isJson) {
              const edited = parseJsonExact(area.value);
              if (!edited.ok) return toast("Not valid JSON (this key held JSON).", "error");
              if (edited.lossless) next = JSON.stringify(edited.value);
            }
            if (!(await confirmChange({ title: `Save ${k.name}?`, before: text, after: next }))) return;
            const saved = await act(async () => {
              // Re-read the key's current expiration and metadata so a change made elsewhere isn't reverted.
              const { keys: now } = await cf("kvKeys", ns, k.name, { limit: 1 });
              const current = now.find((x) => x.name === k.name);
              if (!current) throw new Error(`${k.name} was deleted meanwhile. Use "+ New key" to create it again.`);
              if (current.expiration && current.expiration * 1000 - Date.now() < 90_000) throw new Error(`${k.name} expires in under 90 seconds, so it can't be saved.`);
              return cf("kvPut", ns, k.name, next, current.expiration, current.metadata ?? null);
            }, "Saved");
            if (saved) openKey(k);
          },
        }, "Save"),
      ),
    );
  }

  const newBtn = h("button", {
    class: "primary",
    onclick: async () => {
      const res = await modal({
        title: "New key",
        fields: [
          { name: "name", label: "Key", required: true, value: prefix },
          { name: "value", label: "Value", multiline: true, rows: 10 },
        ],
        confirm: "Next",
        wide: true,
      });
      if (!res) return;
      const key = res.name.trim();
      if (keys.some((k) => k.name === key)) return toast(`${key} already exists. Open it to edit.`, "error");
      if (!(await confirmChange({ title: `Create ${key}?`, after: res.value || "(empty)", confirm: "Create" }))) return;
      if (await act(() => cf("kvPut", ns, key, res.value), "Created")) show("kv");
    },
  }, "+ New key");

  root.append(
    viewHeader("KV browser", `${plural(keys.length, "key")}${prefix ? ` starting with “${prefix}”` : ""}${truncated ? " (first 5,000 shown; narrow with a prefix)" : ""}. Changes can take up to 60 seconds to reach every Cloudflare location.`, newBtn),
    h("div", { class: "toolbar" }, nsSelect, prefixInput),
    h("div", { class: "split" }, list, editor),
  );
  drawList();
}
