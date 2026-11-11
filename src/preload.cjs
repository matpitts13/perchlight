// The bridge between the window and the main process: a fixed set of named
// calls, nothing else. (CommonJS, because sandboxed preloads can't be ES modules.)
const { contextBridge, ipcRenderer } = require("electron");

// Errors are rejected as plain { message, signedOut } objects: an Error's
// extra properties don't survive crossing the context bridge, plain objects do.
async function call(channel, payload) {
  const r = await ipcRenderer.invoke(channel, payload);
  if (!r.ok) throw { message: r.error, signedOut: Boolean(r.signedOut) };
  return r.value;
}

contextBridge.exposeInMainWorld("api", {
  info: () => call("app:info"),
  checkToken: (token) => call("auth:checkToken", { token }),
  browserSignIn: () => call("auth:browserSignIn"),
  listProjects: () => call("projects:list"),
  saveProject: (p) => call("projects:save", p),
  deleteProject: (id) => call("projects:delete", { id }),
  signOut: (id) => call("projects:signOut", { id }),
  getViews: (projectId) => call("views:get", { projectId }),
  saveViews: (projectId, config) => call("views:save", { projectId, config }),
  importViews: (projectId) => call("views:import", { projectId }),
  exportViews: (projectId) => call("views:export", { projectId }),
  cf: (projectId, name, ...args) => call("cf:call", { projectId, name, args }),
  saveText: (name, text) => call("file:saveText", { name, text }),
  openExternal: (url) => call("external:open", { url }),
  subscribe: (siteUrl, email, source) => call("list:subscribe", { siteUrl, email, source }),
});
