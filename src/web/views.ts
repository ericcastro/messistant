import type {
  AccessGroup,
  AuthenticatedSession,
  CapabilityConfiguration,
  CapabilityDefaults,
  GlobalSettings,
} from "../config/types.js";
import type { KnownChat, WhatsAppStatus } from "../whatsapp/types.js";

export interface CapabilityView {
  definition: CapabilityDefaults;
  configuration: CapabilityConfiguration;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checked(value: boolean): string {
  return value ? " checked" : "";
}

function selected(value: boolean): string {
  return value ? " selected" : "";
}

function csrfInput(session: AuthenticatedSession): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">`;
}

function statusTone(phase: WhatsAppStatus["phase"]): string {
  switch (phase) {
    case "ready":
      return "success";
    case "qr_required":
    case "authenticated":
    case "starting":
      return "pending";
    case "error":
    case "disconnected":
      return "danger";
    case "stopped":
      return "muted";
  }
}

function layout(input: {
  title: string;
  content: string;
  session?: AuthenticatedSession;
}): string {
  const navigation = input.session
    ? `
      <header class="topbar">
        <a class="brand" href="/dashboard">
          <span class="brand-mark">M</span>
          <span>messistant</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/dashboard">Overview</a>
          <a href="/capabilities">Assists</a>
          <a href="/access">Access</a>
          <a href="/settings">Settings</a>
        </nav>
        <form method="post" action="/logout" class="compact-form">
          ${csrfInput(input.session)}
          <button class="button ghost small" type="submit">Sign out</button>
        </form>
      </header>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>${escapeHtml(input.title)} · messistant</title>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/app.js" defer></script>
  </head>
  <body>
    ${navigation}
    ${input.content}
  </body>
</html>`;
}

export function renderLogin(error: string | null): string {
  return layout({
    title: "Admin sign in",
    content: `
      <main class="login-shell">
        <section class="login-panel">
          <div class="login-copy">
            <h1
              class="typewriter-title"
              aria-label="messistant. messages get messy?. messi assists. messaging, assisted."
            >
              <span data-typewriter-text aria-hidden="true">messistant</span><span class="typewriter-cursor" aria-hidden="true">_</span>
            </h1>
            <p class="eyebrow">Your WhatsApp, with an assist</p>
            <p class="lede">
              Messistant gives your messaging mess 💬 the Messi assist 👟⚽️ it deserves ✅.
            </p>
            <p class="lede">
              Voice transcription, canned responses, translations, message
              explanations, conversation analytics, and countless other
              assists—all in one self-hosted, plugin-based messaging
              companion.
            </p>
            <div class="privacy-note">
              <span class="pulse-dot"></span>
              Self-hosted and local by default
            </div>
          </div>
          <div class="login-card">
            <img src="/assets/messistant.jpg" alt="Messi holding a WhatsApp logo" class="login-logo">
            <div>
              <p class="eyebrow">Admin console</p>
              <h2>Admin sign in</h2>
            </div>
            ${
              error
                ? `<div class="notice danger" role="alert">${escapeHtml(error)}</div>`
                : ""
            }
            <form method="post" action="/login" class="stack">
              <label>
                Username
                <input name="username" autocomplete="username" value="admin" required>
              </label>
              <label>
                Password
                <input type="password" name="password" autocomplete="current-password" required autofocus>
              </label>
              <button class="button primary wide" type="submit">Sign in</button>
            </form>
            <p class="fine-print">
              First run? Use <code>admin</code> / <code>admin</code>, then change it.
            </p>
          </div>
        </section>
      </main>`,
  });
}

export function renderDashboard(input: {
  session: AuthenticatedSession;
  whatsapp: WhatsAppStatus;
  openAiConfigured: boolean;
  messageCount: number;
  settings: GlobalSettings;
  flash?: string | undefined;
  error?: string | undefined;
  hostWarning: boolean;
}): string {
  const { session, whatsapp } = input;
  return layout({
    title: "Overview",
    session,
    content: `
      <main class="page-shell">
        <section class="page-heading">
          <div>
            <p class="eyebrow">Control room</p>
            <h1>The assist is live.</h1>
            <p>Watch the connection, authorize WhatsApp, and keep the essentials healthy.</p>
          </div>
          <span class="status-badge ${statusTone(whatsapp.phase)}" id="whatsapp-badge">
            ${escapeHtml(whatsapp.phase.replaceAll("_", " "))}
          </span>
        </section>

        ${input.flash ? `<div class="notice success">${escapeHtml(input.flash)}</div>` : ""}
        ${input.error ? `<div class="notice danger">${escapeHtml(input.error)}</div>` : ""}
        ${
          session.mustChangePassword
            ? `<div class="notice warning">
                <strong>Default password still active.</strong>
                Change it below before exposing this server beyond localhost.
              </div>`
            : ""
        }
        ${
          input.hostWarning
            ? `<div class="notice danger">
                The admin server is listening beyond localhost. Use HTTPS and a strong password.
              </div>`
            : ""
        }

        <section class="metric-grid" aria-label="Service metrics">
          <article class="metric-card">
            <span class="metric-label">WhatsApp</span>
            <strong id="whatsapp-phase">${escapeHtml(whatsapp.phase.replaceAll("_", " "))}</strong>
            <small id="whatsapp-detail">${escapeHtml(whatsapp.detail)}</small>
          </article>
          <article class="metric-card">
            <span class="metric-label">OpenAI</span>
            <strong>${input.openAiConfigured ? "Configured" : "Needs a key"}</strong>
            <small>${escapeHtml(input.settings.textModel)} · ${escapeHtml(input.settings.transcriptionModel)}</small>
          </article>
          <article class="metric-card">
            <span class="metric-label">Observed</span>
            <strong id="message-count">${input.messageCount.toLocaleString()}</strong>
            <small>deduplicated message events</small>
          </article>
          <article class="metric-card">
            <span class="metric-label">Timezone</span>
            <strong>${escapeHtml(input.settings.timezone)}</strong>
            <small>${input.settings.retentionDays} day metadata retention</small>
          </article>
        </section>

        <section class="content-grid">
          <article class="panel qr-panel">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Linked device</p>
                <h2>WhatsApp session</h2>
              </div>
              <div class="action-row">
                <form method="post" action="/whatsapp/reconnect">
                  ${csrfInput(session)}
                  <button class="button secondary small" type="submit">Reconnect</button>
                </form>
                <form method="post" action="/whatsapp/unlink" data-confirm="Unlink WhatsApp and generate a fresh QR code?">
                  ${csrfInput(session)}
                  <button class="button danger small" type="submit">Unlink</button>
                </form>
              </div>
            </div>
            <div class="qr-stage" id="qr-stage">
              <img id="qr-image" alt="WhatsApp authorization QR code"${
                whatsapp.qrDataUrl
                  ? ` src="${escapeHtml(whatsapp.qrDataUrl)}"`
                  : " hidden"
              }>
              <div id="qr-placeholder"${whatsapp.qrDataUrl ? " hidden" : ""}>
                <span class="connection-orbit"></span>
                <strong>${whatsapp.phase === "ready" ? "Connected" : "Waiting for WhatsApp"}</strong>
                <small>${escapeHtml(whatsapp.detail)}</small>
              </div>
            </div>
            <p class="fine-print">
              QR values stay in memory and are visible only after admin authentication.
            </p>
          </article>

          <aside class="stack">
            <article class="panel">
              <p class="eyebrow">Quick start</p>
              <h2>Finish setup</h2>
              <ol class="setup-list">
                <li class="${session.mustChangePassword ? "" : "done"}">Change the default password</li>
                <li class="${whatsapp.phase === "ready" ? "done" : ""}">Link WhatsApp with the QR code</li>
                <li class="${input.openAiConfigured ? "done" : ""}">Configure an OpenAI API key</li>
                <li>Build reusable access groups</li>
                <li>Choose access for each assist</li>
              </ol>
            </article>

            <article class="panel">
              <p class="eyebrow">Security</p>
              <h2>Change password</h2>
              <form method="post" action="/security/password" class="stack compact">
                ${csrfInput(session)}
                <label>
                  Current password
                  <input type="password" name="currentPassword" autocomplete="current-password" required>
                </label>
                <label>
                  New password
                  <input type="password" name="newPassword" autocomplete="new-password" minlength="12" required>
                </label>
                <label>
                  Confirm new password
                  <input type="password" name="confirmPassword" autocomplete="new-password" minlength="12" required>
                </label>
                <button class="button primary" type="submit">Update password</button>
              </form>
            </article>
          </aside>
        </section>
      </main>`,
  });
}

function capabilitySettings(
  capability: CapabilityView,
): string {
  if (capability.definition.id !== "voice-transcription") {
    return "";
  }
  const settings = capability.configuration.settings;
  const maxSeconds =
    typeof settings.maxSeconds === "number" ? settings.maxSeconds : 600;
  const maxBytes =
    typeof settings.maxBytes === "number"
      ? Math.round(settings.maxBytes / 1024 / 1024)
      : 20;
  const language =
    typeof settings.language === "string" ? settings.language : "";
  const prompt =
    typeof settings.prompt === "string"
      ? settings.prompt
      : "The speaker may switch between languages, including within the same sentence. Transcribe each phrase exactly in the language spoken. Preserve code-switching and original wording. Do not translate.";
  const replyPrefix =
    typeof settings.replyPrefix === "string"
      ? settings.replyPrefix
      : "📝 Transcript:";

  return `
    <div class="field-grid capability-settings">
      <label>
        Language hint
        <input name="language" value="${escapeHtml(language)}" placeholder="auto">
      </label>
      <label>
        Maximum minutes
        <input name="maxMinutes" type="number" min="1" max="120" value="${Math.ceil(maxSeconds / 60)}">
      </label>
      <label>
        Maximum MB
        <input name="maxMegabytes" type="number" min="1" max="100" value="${maxBytes}">
      </label>
      <label>
        Reply prefix
        <input name="replyPrefix" value="${escapeHtml(replyPrefix)}">
      </label>
      <label class="full-width">
        Transcription instructions
        <textarea name="prompt" rows="4">${escapeHtml(prompt)}</textarea>
        <small>Keep this language-neutral when voice notes may contain more than one language.</small>
      </label>
    </div>`;
}

function knownChatLabel(chat: KnownChat): string {
  return [chat.name, chat.phoneNumber, chat.type]
    .filter(
      (value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
    )
    .join(" · ");
}

function assistGuide(definition: CapabilityDefaults): string {
  if (definition.id !== "voice-transcription") {
    return "";
  }
  return `
    <div class="assist-guide">
      <div>
        <span class="assist-guide-label">Automatic</span>
        <strong>Allowlisted voice notes</strong>
        <p>Incoming voice notes from the chats and groups below transcribe automatically. Your self-chat does too.</p>
      </div>
      <div>
        <span class="assist-guide-label">On demand · owner only</span>
        <strong>Reply with <code>!stt</code></strong>
        <p>Use it on any voice note in any conversation. It transcribes that one note without adding the chat to automatic access.</p>
      </div>
    </div>`;
}

export function renderCapabilities(input: {
  session: AuthenticatedSession;
  capabilities: CapabilityView[];
  groups: AccessGroup[];
  chats: KnownChat[];
  flash?: string | undefined;
  error?: string | undefined;
  selectedCapabilityId?: string | undefined;
}): string {
  const knownIds = new Set(input.chats.map((chat) => chat.id));
  const selectedCapabilityId = input.capabilities.some(
    ({ definition }) => definition.id === input.selectedCapabilityId,
  )
    ? input.selectedCapabilityId
    : input.capabilities[0]?.definition.id;
  const navigation = input.capabilities
    .map(({ definition, configuration }) => {
      const active = definition.id === selectedCapabilityId;
      return `
        <a
          class="capability-nav-item${active ? " active" : ""}"
          href="/capabilities?selected=${encodeURIComponent(definition.id)}"
          role="tab"
          aria-selected="${String(active)}"
          aria-controls="capability-panel-${escapeHtml(definition.id)}"
          data-capability-target="${escapeHtml(definition.id)}"
        >
          <span class="capability-nav-icon">${escapeHtml(definition.triggerLabel.slice(0, 3))}</span>
          <span>
            <strong>${escapeHtml(definition.name)}</strong>
            <small>${configuration.enabled ? "Enabled" : "Disabled"} · ${escapeHtml(definition.triggerLabel)}</small>
          </span>
        </a>`;
    })
    .join("");
  const cards = input.capabilities
    .map(({ definition, configuration }) => {
      const active = definition.id === selectedCapabilityId;
      const voiceTranscription = definition.id === "voice-transcription";
      const unknownChatIds = configuration.directChatIds.filter(
        (id) => !knownIds.has(id),
      );
      return `
        <article
          class="panel capability-card"
          id="capability-panel-${escapeHtml(definition.id)}"
          role="tabpanel"
          data-capability-panel="${escapeHtml(definition.id)}"
          ${active ? "" : "hidden"}
        >
          <form method="post" action="/capabilities/${escapeHtml(definition.id)}">
            ${csrfInput(input.session)}
            <div class="panel-heading">
              <div>
                <div class="capability-title">
                  <span class="capability-icon">${escapeHtml(definition.triggerLabel.slice(0, 3))}</span>
                  <div>
                    <h2>${escapeHtml(definition.name)}</h2>
                    <code>${escapeHtml(definition.triggerLabel)}</code>
                  </div>
                </div>
                <p>${escapeHtml(definition.description)}</p>
              </div>
              <label class="switch">
                <input type="checkbox" name="enabled" value="true"${checked(configuration.enabled)}>
                <span>Enabled</span>
              </label>
            </div>

            ${assistGuide(definition)}

            <div class="field-grid">
              <label>
                ${voiceTranscription ? "Automatic transcription policy" : "Access policy"}
                <select name="accessMode">
                  ${
                    voiceTranscription
                      ? `
                        <option value="disabled"${selected(configuration.accessMode === "disabled")}>Disabled</option>
                        <option value="self_chat_only"${selected(configuration.accessMode === "self_chat_only")}>Self-chat only</option>
                        <option value="allowlist"${selected(configuration.accessMode === "allowlist")}>Allowlist + self-chat</option>
                        <option value="everyone"${selected(configuration.accessMode === "everyone")}>All eligible chats + self-chat</option>`
                      : `
                        <option value="disabled"${selected(configuration.accessMode === "disabled")}>Disabled</option>
                        <option value="self_chat_only"${selected(configuration.accessMode === "self_chat_only")}>Self-chat only</option>
                        <option value="owner_any_chat"${selected(configuration.accessMode === "owner_any_chat")}>Owner, from any chat</option>
                        <option value="allowlist"${selected(configuration.accessMode === "allowlist")}>Allowlist only</option>
                        <option value="owner_or_allowlist"${selected(configuration.accessMode === "owner_or_allowlist")}>Owner or allowlist</option>
                        <option value="everyone"${selected(configuration.accessMode === "everyone")}>Everyone</option>`
                  }
                </select>
              </label>
              <fieldset>
                <legend>${voiceTranscription ? "Automatic access groups" : "Reusable access groups"}</legend>
                <div class="check-list">
                  ${
                    input.groups.length
                      ? input.groups
                          .map(
                            (group) => `
                            <label>
                              <input type="checkbox" name="groupIds" value="${escapeHtml(group.id)}"${checked(configuration.groupIds.includes(group.id))}>
                              ${escapeHtml(group.name)}
                            </label>`,
                          )
                          .join("")
                      : `<small>No groups yet. <a href="/access">Create one</a>.</small>`
                  }
                </div>
              </fieldset>
            </div>

            <div class="field-grid">
              <label>
                ${voiceTranscription ? "Automatic WhatsApp chats" : "Known WhatsApp chats"}
                <select name="chatIds" multiple size="6">
                  ${input.chats
                    .map(
                      (chat) => `
                        <option value="${escapeHtml(chat.id)}"${selected(configuration.directChatIds.includes(chat.id))}>
                          ${escapeHtml(knownChatLabel(chat))}
                        </option>`,
                    )
                    .join("")}
                </select>
                <small>Hold Command/Ctrl to select multiple.</small>
              </label>
              <label>
                Additional WhatsApp IDs
                <textarea name="manualChatIds" rows="6" placeholder="123456789@c.us">${escapeHtml(unknownChatIds.join("\n"))}</textarea>
                <small>One stable chat ID per line.</small>
              </label>
            </div>

            ${capabilitySettings({ definition, configuration })}

            <div class="form-footer">
              <span class="fine-print">${
                voiceTranscription
                  ? "The allowlist controls automatic transcription. !stt remains owner-only and works anywhere while this assist is enabled."
                  : "Policy and allowlists apply only to this assist."
              }</span>
              <button class="button primary" type="submit">Save assist</button>
            </div>
          </form>
        </article>`;
    })
    .join("");

  return layout({
    title: "Assists",
    session: input.session,
    content: `
      <main class="page-shell">
        <section class="page-heading">
          <div>
            <p class="eyebrow">Assist registry</p>
            <h1>Every assist has boundaries.</h1>
            <p>Configure each assist and its audience independently. No phone number lives in source code.</p>
          </div>
        </section>
        ${input.flash ? `<div class="notice success">${escapeHtml(input.flash)}</div>` : ""}
        ${input.error ? `<div class="notice danger">${escapeHtml(input.error)}</div>` : ""}
        <section class="capability-layout" data-capability-tabs>
          <aside class="capability-sidebar">
            <p class="eyebrow">Choose an assist</p>
            <nav class="capability-nav" role="tablist" aria-orientation="vertical">
              ${navigation}
            </nav>
            <a class="button secondary wide" href="/access">Manage access groups</a>
          </aside>
          <div class="capability-panels">${cards}</div>
        </section>
      </main>`,
  });
}

function groupForm(input: {
  session: AuthenticatedSession;
  chats: KnownChat[];
  group?: AccessGroup;
}): string {
  const group = input.group;
  const knownIds = new Set(input.chats.map((chat) => chat.id));
  const unknownIds =
    group?.chatIds.filter((id) => !knownIds.has(id)) ?? [];
  return `
    <form method="post" action="/access/groups" class="stack">
      ${csrfInput(input.session)}
      <input type="hidden" name="id" value="${escapeHtml(group?.id ?? "")}">
      <label>
        Group name
        <input name="name" value="${escapeHtml(group?.name ?? "")}" placeholder="Spanish practice" maxlength="80" required>
      </label>
      <label>
        Known WhatsApp chats
        <select name="chatIds" multiple size="7">
          ${input.chats
            .map(
              (chat) => `
                <option value="${escapeHtml(chat.id)}"${selected(group?.chatIds.includes(chat.id) ?? false)}>
                  ${escapeHtml(knownChatLabel(chat))}
                </option>`,
            )
            .join("")}
        </select>
      </label>
      <label>
        Additional WhatsApp IDs
        <textarea name="manualChatIds" rows="4" placeholder="123456789@c.us">${escapeHtml(unknownIds.join("\n"))}</textarea>
      </label>
      <button class="button primary" type="submit">${group ? "Update group" : "Create group"}</button>
    </form>`;
}

export function renderAccessGroups(input: {
  session: AuthenticatedSession;
  groups: AccessGroup[];
  chats: KnownChat[];
  flash?: string | undefined;
  error?: string | undefined;
}): string {
  return layout({
    title: "Access groups",
    session: input.session,
    content: `
      <main class="page-shell narrow">
        <section class="page-heading">
          <div>
            <p class="eyebrow">Reusable policy building blocks</p>
            <h1>People change. Policies follow.</h1>
            <p>Create a group once, then attach it to any number of assists.</p>
          </div>
        </section>
        ${input.flash ? `<div class="notice success">${escapeHtml(input.flash)}</div>` : ""}
        ${input.error ? `<div class="notice danger">${escapeHtml(input.error)}</div>` : ""}
        <section class="access-layout">
          <article class="panel sticky-panel">
            <p class="eyebrow">New group</p>
            <h2>Create an audience</h2>
            ${groupForm({ session: input.session, chats: input.chats })}
          </article>
          <div class="stack">
            ${
              input.groups.length
                ? input.groups
                    .map(
                      (group) => `
                        <article class="panel">
                          <div class="panel-heading">
                            <div>
                              <p class="eyebrow">${group.chatIds.length} chats</p>
                              <h2>${escapeHtml(group.name)}</h2>
                            </div>
                            <form method="post" action="/access/groups/${escapeHtml(group.id)}/delete" data-confirm="Delete this reusable access group?">
                              ${csrfInput(input.session)}
                              <button class="button danger small" type="submit">Delete</button>
                            </form>
                          </div>
                          ${groupForm({ session: input.session, chats: input.chats, group })}
                        </article>`,
                    )
                    .join("")
                : `<div class="empty-state"><strong>No access groups yet.</strong><span>Create the first reusable audience.</span></div>`
            }
          </div>
        </section>
      </main>`,
  });
}

export function renderSettings(input: {
  session: AuthenticatedSession;
  settings: GlobalSettings;
  keyStatus: {
    configured: boolean;
    source: "environment" | "encrypted-local" | "missing";
    suffix: string | null;
  };
  flash?: string | undefined;
  error?: string | undefined;
}): string {
  return layout({
    title: "Settings",
    session: input.session,
    content: `
      <main class="page-shell narrow">
        <section class="page-heading">
          <div>
            <p class="eyebrow">Service configuration</p>
            <h1>Secrets out of source.</h1>
            <p>Models and local data policy are configurable without editing code.</p>
          </div>
        </section>
        ${input.flash ? `<div class="notice success">${escapeHtml(input.flash)}</div>` : ""}
        ${input.error ? `<div class="notice danger">${escapeHtml(input.error)}</div>` : ""}
        <section class="settings-grid">
          <article class="panel">
            <p class="eyebrow">OpenAI credentials</p>
            <h2>${input.keyStatus.configured ? "API key configured" : "API key required"}</h2>
            <p>
              ${
                input.keyStatus.configured
                  ? `Source: ${escapeHtml(input.keyStatus.source)} · ending in <code>${escapeHtml(input.keyStatus.suffix)}</code>`
                  : "Add an API key to enable explanations, conjugation, and transcription."
              }
            </p>
            ${
              input.keyStatus.source === "environment"
                ? `<div class="notice neutral">OPENAI_API_KEY is set in the environment and takes precedence over the local vault.</div>`
                : `
                  <form method="post" action="/settings/openai-key" class="stack">
                    ${csrfInput(input.session)}
                    <label>
                      New OpenAI API key
                      <input type="password" name="apiKey" autocomplete="off" placeholder="Stored encrypted on this machine" required>
                    </label>
                    <button class="button primary" type="submit">Save encrypted key</button>
                  </form>
                  ${
                    input.keyStatus.configured
                      ? `<form method="post" action="/settings/openai-key/clear" data-confirm="Remove the locally stored OpenAI API key?">
                          ${csrfInput(input.session)}
                          <button class="button danger small" type="submit">Remove local key</button>
                        </form>`
                      : ""
                  }`
            }
          </article>

          <article class="panel">
            <p class="eyebrow">Models and data</p>
            <h2>Runtime defaults</h2>
            <form method="post" action="/settings/global" class="stack">
              ${csrfInput(input.session)}
              <label>
                Text model
                <input name="textModel" value="${escapeHtml(input.settings.textModel)}" required>
              </label>
              <label>
                Transcription model
                <input name="transcriptionModel" value="${escapeHtml(input.settings.transcriptionModel)}" required>
              </label>
              <label>
                Statistics timezone
                <input name="timezone" value="${escapeHtml(input.settings.timezone)}" required>
              </label>
              <label>
                Metadata retention in days
                <input name="retentionDays" type="number" min="1" max="3650" value="${input.settings.retentionDays}" required>
              </label>
              <button class="button primary" type="submit">Save settings</button>
            </form>
          </article>
        </section>
      </main>`,
  });
}
