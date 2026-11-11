// Shared app state and navigation, used by every screen.
import { h, toast } from "./ui.js";

export const state = {
  info: null, // { version, oauthAvailable, tokenTemplateUrl }
  projects: [],
  projectId: null,
  namespaces: [],
  databases: [],
  config: null, // the project's perchlight.json
  connected: false,
  view: "projects",
  ui: {}, // per-screen remembered choices (selected namespace, filters…)
};

let showFn = async () => {};
let redrawNavFn = () => {};
export const setShow = (fn) => (showFn = fn);
export const setRedrawNav = (fn) => (redrawNavFn = fn);
export const show = (id) => showFn(id);
export const redrawNav = () => redrawNavFn();

export const currentProject = () => state.projects.find((p) => p.id === state.projectId) ?? null;

/** A Cloudflare call for the current project. */
export const cf = (name, ...args) => window.api.cf(state.projectId, name, ...args);

export function viewHeader(title, sub, ...buttons) {
  return h(
    "header",
    { class: "view-head" },
    h("div", {}, h("h1", {}, title), sub && h("p", { class: "muted" }, sub)),
    h("div", { class: "head-actions" }, buttons, h("button", { class: "ghost", onclick: () => show(state.view), title: "Reload from Cloudflare" }, "↻ Refresh")),
  );
}

/** Saves the project's screens after checking them; returns true if saved. */
export async function saveConfig(config) {
  try {
    const result = await window.api.saveViews(state.projectId, config);
    if (!result.ok) {
      toast(`Not saved: ${result.errors.map((e) => `${e.path} ${e.message}`).join("\n")}`, "error");
      return false;
    }
    state.config = config;
    redrawNav();
    return true;
  } catch (err) {
    toast(err.message, "error");
    return false;
  }
}

export const nameOfNamespace = (id) => state.namespaces.find((n) => n.id === id)?.title ?? id;
export const nameOfDatabase = (id) => state.databases.find((d) => d.id === id)?.name ?? id;
