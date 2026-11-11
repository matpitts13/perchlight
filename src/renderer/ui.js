// Small DOM helpers shared by every screen. Text is always inserted as text
// (never as HTML), so data from Cloudflare can't inject markup.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = Boolean(v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function toast(msg, kind = "ok") {
  const el = h("div", { class: `toast ${kind}` }, msg);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 3500);
}

/** Runs fn, shows a toast for success or failure, returns its result (undefined on error). */
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (err) {
    toast(err.message || String(err), "error");
    return undefined;
  }
}

const OTHER = "\u0000other";

/** A dropdown of common values plus "Other…", which reveals a free-text box. */
export function choiceControl(options, value, { other = true, type = "text", placeholder = "Enter a value…", onChange } = {}) {
  const opts = options.map((o) => (typeof o === "object" ? o : { value: String(o), label: String(o) }));
  const sel = h("select", {}, opts.map((o) => h("option", { value: o.value }, o.label)), other && h("option", { value: OTHER }, "Other…"));
  const input = other ? h("input", { type, placeholder, class: "other-input", "aria-label": placeholder }) : null;
  const str = value == null ? "" : String(value);
  if (opts.some((o) => o.value === str)) sel.value = str;
  else if (other && str) {
    sel.value = OTHER;
    input.value = str;
  }
  const sync = () => input && (input.hidden = sel.value !== OTHER);
  sync();
  sel.addEventListener("change", () => {
    sync();
    if (sel.value === OTHER) input.focus();
    else onChange?.(sel.value);
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && onChange) {
      e.preventDefault();
      onChange(input.value);
    }
  });
  return {
    el: h("div", { class: "choice" }, sel, input),
    get value() {
      return sel.value === OTHER ? input.value : sel.value;
    },
  };
}

/**
 * Resolves to { fieldName: value } on submit, or null if cancelled.
 * `content` may be a function (choose) => Node: calling choose(value) closes
 * the dialog and resolves to { choice: value }.
 */
export function modal({ title, body, content, fields = [], confirm = "OK", cancel = "Cancel", danger = false, wide = false }) {
  return new Promise((resolve) => {
    if (typeof content === "function") content = content((value) => close({ choice: value }));
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const inputs = {};
    const fieldEls = fields.map((f) => {
      let el;
      if (f.options) {
        const c = choiceControl(f.options, f.value, { other: f.other, type: f.type, placeholder: f.placeholder });
        inputs[f.name] = c;
        el = c.el;
      } else if (f.type === "checkbox") {
        el = h("input", { type: "checkbox", checked: f.value });
        inputs[f.name] = { get value() { return el.checked; } };
        return h("label", { class: "field check" }, el, h("span", {}, f.label));
      } else {
        el = f.multiline
          ? h("textarea", { rows: f.rows || 14, spellcheck: f.spellcheck ? "true" : "false", class: f.prose ? "prose" : null })
          : h("input", { type: f.type || "text", placeholder: f.placeholder || "", autocomplete: "off" });
        el.value = f.value ?? "";
        inputs[f.name] = el;
      }
      return h("label", { class: "field" }, h("span", {}, f.label), el, f.hint && h("small", { class: "muted" }, f.hint));
    });
    const form = h(
      "form",
      {
        class: `modal${wide ? " wide" : ""}`,
        onsubmit: (e) => {
          e.preventDefault();
          const missing = fields.find((f) => f.required && !String(inputs[f.name].value).trim());
          if (missing) return toast(`${missing.label} is required.`, "error");
          close(Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
        },
      },
      h("h2", { id: titleId }, title),
      body && h("p", { class: "muted" }, body),
      content,
      fieldEls,
      h("div", { class: "actions" }, cancel && h("button", { type: "button", class: "ghost", "data-cancel": "", onclick: () => close(null) }, cancel), confirm && h("button", { type: "submit", class: danger ? "danger" : "primary" }, confirm)),
    );
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", titleId);
    const overlay = h("div", { class: "overlay", onmousedown: (e) => e.target === overlay && close(null) }, form);
    const returnFocus = document.activeElement;
    const focusable = () => [...form.querySelectorAll("button:not([disabled]), input:not([hidden]), select, textarea, [tabindex='0']")];
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && e.ctrlKey) form.requestSubmit();
      if (e.key === "Tab") {
        // Keep keyboard focus inside the dialog.
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    function close(v) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      resolve(v);
    }
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    // Start in the first field; for a dangerous confirm with no fields, start on Cancel so Enter can't confirm by accident.
    (form.querySelector("input:not([hidden]), select, textarea") || (danger && form.querySelector("[data-cancel]")) || form.querySelector("button[type=submit]") || form).focus();
  });
}

export const confirmBox = (title, body, confirm = "Confirm", danger = true) => modal({ title, body, confirm, danger }).then((v) => v !== null);

/** The last step before every write: shows what changes, before → after. */
export function confirmChange({ title, body, before, after, confirm = "Save", danger = false }) {
  const side = (label, text, cls) => h("div", {}, h("span", { class: "diff-label" }, label), h("pre", { class: cls }, text));
  const content = h("div", { class: "diff" }, before !== undefined && side("Before", before ?? "(nothing)", "before"), after !== undefined && side("After", after ?? "(deleted)", "after"));
  return modal({ title, body: body || "This changes live data.", content, confirm, danger, wide: true }).then((v) => v !== null);
}

export function table(columns, rows, empty = "Nothing here.") {
  if (!rows.length) return h("div", { class: "empty" }, empty);
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.class, scope: "col" }, c.label)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, columns.map((c) => h("td", { class: c.class }, c.render(r)))))),
    ),
  );
}

export function stats(items) {
  return h("div", { class: "stats" }, items.map(([label, n, kind]) => h("div", { class: `stat ${kind || ""}` }, h("b", {}, n), h("span", {}, label))));
}

export function chips(options, current, onPick) {
  return h("div", { class: "chips" }, options.map((o) => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return h("button", { class: `chip${value === current ? " on" : ""}`, "aria-pressed": value === current ? "true" : "false", onclick: () => onPick(value) }, label);
  }));
}

export const badge = (text, kind = "neutral") => h("span", { class: `badge ${kind}` }, text);
export const short = (s) => (s && s.length > 14 ? `${s.slice(0, 12)}…` : s || "");
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function copyable(text, shown = short(text)) {
  return h("button", { class: "mono copy", title: `${text}\n(click to copy)`, onclick: () => navigator.clipboard.writeText(text).then(() => toast("Copied")) }, shown);
}

export function parseJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null; // not JSON
  }
}

export const pretty = (v) => (typeof v === "string" ? (parseJson(v) !== null ? JSON.stringify(JSON.parse(v), null, 2) : v) : JSON.stringify(v, null, 2));
export const sqlDate = (s) => (s ? new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`) : null);

export function fmt(d) {
  if (d == null || d === "") return "—";
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date) ? String(d) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function searchBox(placeholder, value, onInput) {
  return h("input", { class: "search", type: "search", placeholder, value, "aria-label": placeholder, oninput: (e) => onInput(e.target.value) });
}

/** Edit JSON text until it parses or the user cancels. */
export async function editJson(title, text) {
  let value = text;
  for (;;) {
    const r = await modal({ title, fields: [{ name: "v", label: "JSON", multiline: true, value }], confirm: "Save", wide: true });
    if (!r) return null;
    value = r.v;
    try {
      JSON.parse(value);
      return value;
    } catch (err) {
      toast(`Not valid JSON: ${err.message}`, "error");
    }
  }
}

/** A list of config-check errors, each with its path. */
export function errorList(errors) {
  return h("ul", { class: "errors" }, errors.map((e) => h("li", {}, h("code", {}, e.path), " ", e.message)));
}
