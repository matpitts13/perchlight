// Projects: one per site. Each has a Cloudflare account and a sign-in.
import { h, act, modal, confirmBox, toast, badge } from "../ui.js";
import { state, viewHeader, show } from "../state.js";
import { openProject, reloadProjects, disconnect } from "../app.js";

export async function viewProjects(root) {
  await reloadProjects();
  const add = h("button", { class: "primary", onclick: () => addProject() }, "+ Add project");

  if (!state.projects.length) {
    root.append(
      viewHeader("Welcome to Perchlight", "Browse and edit your Cloudflare data, build your own screens, and run a mailing list."),
      h(
        "div",
        { class: "card" },
        h("h2", {}, "Add your first project"),
        h("p", {}, "A project is one site or app: a name, the Cloudflare account it lives in, and how you sign in. You can add as many as you like and switch between them in the sidebar."),
        h("div", { class: "actions" }, add),
      ),
    );
    return;
  }

  root.append(
    viewHeader("Projects", "One per site or app. Switch between them in the sidebar.", add),
    h(
      "div",
      { class: "cards" },
      state.projects.map((p) =>
        h(
          "div",
          { class: `card${p.id === state.projectId ? " on" : ""}` },
          h("h2", {}, p.name),
          h("p", { class: "muted" }, p.accountName || p.accountId),
          h("div", {}, p.signedIn ? badge(p.auth === "oauth" ? "Signed in with Cloudflare" : "API token saved", "good") : badge("Signed out", "bad")),
          h(
            "div",
            { class: "actions" },
            p.signedIn && h("button", { class: "small primary", onclick: () => openProject(p.id) }, "Open"),
            h("button", { class: "small", onclick: () => addProject(p) }, p.signedIn ? "Change sign-in" : "Sign in"),
            h("button", { class: "small", onclick: () => rename(p) }, "Rename"),
            p.signedIn && h("button", {
              class: "small",
              onclick: async () => {
                if (!(await confirmBox(`Sign out of ${p.name}?`, "The saved token is deleted from this computer. Your screens are kept.", "Sign out"))) return;
                if (await act(() => window.api.signOut(p.id), "Signed out")) {
                  if (state.projectId === p.id) disconnect();
                  show("projects");
                }
              },
            }, "Sign out"),
            h("button", {
              class: "small danger-text",
              onclick: async () => {
                if (!(await confirmBox(`Remove ${p.name}?`, "Removes the project, its saved sign-in and its screens from this computer. Nothing on Cloudflare changes."))) return;
                if (await act(() => window.api.deleteProject(p.id), "Removed")) show("projects"); // reloadProjects() disconnects if it was open
              },
            }, "Remove"),
          ),
        ),
      ),
    ),
  );
}

async function rename(p) {
  const r = await modal({ title: "Rename project", fields: [{ name: "name", label: "Name", value: p.name, required: true }], confirm: "Save" });
  if (!r) return;
  if (await act(() => window.api.saveProject({ id: p.id, name: r.name.trim() }), "Renamed")) {
    await reloadProjects();
    show("projects");
  }
}

/** Sign in (new project, or a new sign-in for an existing one), pick the account, save. */
async function addProject(existing = null) {
  const signIn = await chooseSignIn();
  if (!signIn) return;

  let account = signIn.accounts[0];
  if (signIn.accounts.length > 1) {
    const r = await modal({
      title: "Which Cloudflare account?",
      body: "This sign-in can see more than one account. The project uses one; add another project for the others.",
      fields: [{ name: "account", label: "Account", options: signIn.accounts.map((a) => ({ value: a.id, label: a.name })), other: false, value: existing?.accountId }],
      confirm: "Next",
    });
    if (!r) return;
    account = signIn.accounts.find((a) => a.id === r.account);
  }
  if (existing && account.id !== existing.accountId) {
    const ok = await confirmBox(
      `Switch ${existing.name} to the account “${account.name}”?`,
      `This project was using “${existing.accountName || existing.accountId}”. Its screens point at that account's namespaces and databases, so they may stop working. To keep both, add a new project instead.`,
      "Switch account",
    );
    if (!ok) return;
  }

  let name = existing?.name;
  if (!existing) {
    const r = await modal({ title: "Name this project", body: "Usually the site or app it's for.", fields: [{ name: "name", label: "Name", value: account.name, required: true }], confirm: "Save" });
    if (!r) return;
    name = r.name.trim();
  }

  const saved = await act(
    () => window.api.saveProject({ id: existing?.id, name, pendingId: signIn.pendingId, accountId: account.id, accountName: account.name, auth: signIn.auth }),
    existing ? "Signed in" : "Project added",
  );
  if (saved) {
    await reloadProjects();
    await openProject(saved.id);
  }
}

/** Returns { pendingId, accounts, auth } or null. */
async function chooseSignIn() {
  const oauthReady = state.info?.oauthAvailable;
  const picked = await modal({
    title: "Connect to Cloudflare",
    body: "Your sign-in is stored encrypted on this computer and only ever sent to Cloudflare.",
    confirm: null,
    wide: true,
    content: (choose) => {
      const card = (title, text, button, value, disabled) =>
        h("div", { class: "card" }, h("h3", {}, title), h("p", { class: "muted" }, text), h("div", { class: "actions" }, h("button", { type: "button", class: value === (oauthReady ? "oauth" : "token") ? "primary" : "", disabled, onclick: () => choose(value) }, button)));
      return h(
        "div",
        { class: "cards" },
        card(
          "Sign in with Cloudflare",
          oauthReady ? "Opens Cloudflare in your browser. Nothing to copy or paste." : "Not set up in this version yet. Use an API token for now.",
          "Sign in with Cloudflare",
          "oauth",
          !oauthReady,
        ),
        card("Use an API token", "Create a token on Cloudflare (we fill in the permissions for you) and paste it here.", "Use an API token", "token", false),
      );
    },
  });
  const choice = picked?.choice;
  if (!choice) return null;

  if (choice === "oauth") {
    toast("Finish signing in in your browser…");
    return (await act(() => window.api.browserSignIn())) || null;
  }

  for (;;) {
    const content = h(
      "div",
      {},
      h(
        "ol",
        { class: "steps" },
        h("li", {}, h("button", { type: "button", class: "link", onclick: () => window.api.openExternal(state.info.tokenTemplateUrl) }, "Open Cloudflare's token page"), " (a new token with Perchlight's permissions filled in)."),
        h("li", {}, "If the permissions aren't filled in, add: ", h("b", {}, "Account Settings: Read"), ", ", h("b", {}, "Workers KV Storage: Edit"), " and ", h("b", {}, "D1: Edit"), "."),
        h("li", {}, "Create the token, copy it, and paste it below."),
      ),
    );
    const r = await modal({ title: "Use an API token", content, fields: [{ name: "token", label: "API token", type: "password", required: true }], confirm: "Check token", wide: true });
    if (!r) return null;
    const result = await act(() => window.api.checkToken(r.token.trim()));
    if (result) return result;
  }
}
