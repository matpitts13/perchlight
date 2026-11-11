// Perchlight: the app shell. Project picker, navigation, connecting to
// Cloudflare, and rendering the current screen.
import { h, toast } from "./ui.js";
import { state, setShow, setRedrawNav, viewHeader, currentProject } from "./state.js";
import { viewProjects } from "./views/projects.js";
import { viewKv } from "./views/kv.js";
import { viewD1 } from "./views/d1.js";
import { viewCustom } from "./views/custom.js";
import { viewBuilder } from "./views/builder.js";
import { viewList } from "./views/list.js";

const BUILT_IN = [
  { id: "kv", label: "KV browser", icon: "🗂", render: viewKv, group: "Cloudflare data" },
  { id: "d1", label: "D1 browser", icon: "🗄", render: viewD1, group: "Cloudflare data" },
  { id: "builder", label: "Screens", icon: "🛠", render: viewBuilder, group: "Set up" },
  { id: "projects", label: "Projects", icon: "🌐", render: viewProjects, group: "Set up", alwaysAvailable: true },
];

function allViews() {
  const custom = (state.config?.views ?? []).map((v) => ({
    id: `v:${v.id}`,
    label: v.title,
    icon: v.preset === "perchlight-list" ? "✉" : "▤",
    render: (root) => (v.preset === "perchlight-list" ? viewList(root, v) : viewCustom(root, v)),
    group: "Your screens",
  }));
  return [...custom, ...BUILT_IN];
}

let renderToken = 0;
async function show(id) {
  const views = allViews();
  const view = views.find((v) => v.id === id) ?? views.find((v) => v.id === "projects");
  state.view = view.id;
  drawNav();
  const main = document.getElementById("main");
  if (!state.connected && !view.alwaysAvailable) {
    state.view = "projects";
    drawNav();
    return show("projects");
  }
  const token = ++renderToken;
  const root = h("div", { class: "view" });
  main.replaceChildren(h("div", { class: "loading" }, h("div", { class: "spinner" }), "Loading…"));
  try {
    await view.render(root);
    if (token === renderToken) main.replaceChildren(root);
  } catch (err) {
    if (token !== renderToken) return;
    main.replaceChildren(
      h(
        "div",
        { class: "view" },
        viewHeader(view.label),
        h("div", { class: "error-box" }, h("p", {}, err.message), err.signedOut && h("button", { class: "primary", onclick: () => show("projects") }, "Go to Projects to sign in")),
      ),
    );
  }
}

function drawNav() {
  let group = null;
  const items = [];
  for (const v of allViews()) {
    if (!state.connected && !v.alwaysAvailable) continue;
    if (v.group !== group) items.push(h("div", { class: "nav-group" }, (group = v.group)));
    items.push(h("button", { class: `nav-item${v.id === state.view ? " on" : ""}`, "aria-current": v.id === state.view ? "page" : null, onclick: () => show(v.id) }, h("span", { class: "icon", "aria-hidden": "true" }, v.icon), v.label));
  }
  document.getElementById("nav").replaceChildren(...items);
}

function drawPicker() {
  const picker = document.getElementById("picker");
  if (!state.projects.length) return picker.replaceChildren();
  const sel = h(
    "select",
    { "aria-label": "Project", onchange: (e) => openProject(e.target.value) },
    state.projects.map((p) => {
      const o = h("option", { value: p.id }, p.name);
      o.selected = p.id === state.projectId;
      return o;
    }),
  );
  picker.replaceChildren(sel);
}

function drawConn(kind, title, detail) {
  const conn = document.getElementById("conn");
  conn.className = `conn ${kind}`;
  conn.replaceChildren(h("span", { class: "dot" }), h("div", {}, h("b", {}, title), detail && h("small", {}, detail)));
}

/** Switches to a project and loads its account's data and screens. */
export async function openProject(id, { view } = {}) {
  state.projectId = id;
  state.connected = false;
  state.ui = {};
  try {
    localStorage.setItem("perchlight.project", id);
  } catch {
    // storage unavailable: just don't remember the choice
  }
  drawPicker();
  const project = currentProject();
  if (!project) return show("projects");
  drawConn("", "Connecting…");
  document.getElementById("main").replaceChildren(h("div", { class: "loading" }, h("div", { class: "spinner" }), `Connecting to ${project.accountName || "Cloudflare"}…`));
  try {
    const [namespaces, databases, config] = await Promise.all([
      window.api.cf(id, "kvNamespaces"),
      window.api.cf(id, "d1Databases"),
      window.api.getViews(id),
    ]);
    if (state.projectId !== id) return; // switched to another project meanwhile
    Object.assign(state, { namespaces, databases, config, connected: true });
    drawConn("good", project.accountName || "Connected", project.auth === "oauth" ? "signed in with Cloudflare" : "API token");
    await show(view ?? (state.config.views[0] ? `v:${state.config.views[0].id}` : "kv"));
  } catch (err) {
    if (state.projectId !== id) return;
    drawConn("bad", "Not connected", project.name);
    toast(err.message, "error");
    await show("projects");
  }
}

export async function reloadProjects() {
  state.projects = await window.api.listProjects();
  if (state.projectId && !state.projects.some((p) => p.id === state.projectId)) disconnect();
  drawPicker();
}

/** Back to "no project open" (e.g. after removing the current one). */
export function disconnect() {
  Object.assign(state, { projectId: null, connected: false, namespaces: [], databases: [], config: null, ui: {} });
  document.getElementById("conn").replaceChildren();
  drawNav();
}

setShow(show);
setRedrawNav(drawNav);

(async () => {
  state.info = await window.api.info();
  await reloadProjects();
  let remembered = null;
  try {
    remembered = localStorage.getItem("perchlight.project");
  } catch {
    // storage unavailable
  }
  const start = state.projects.find((p) => p.id === remembered && p.signedIn) ?? state.projects.find((p) => p.signedIn);
  if (start) await openProject(start.id);
  else await show("projects");
})();
