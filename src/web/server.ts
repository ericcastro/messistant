import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { Logger } from "pino";
import { accessModes, type AuthenticatedSession } from "../config/types.js";
import type { Environment } from "../config/env.js";
import type { SettingsService } from "../config/settings.js";
import type { AuthService } from "../security/auth.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { OpenAiService } from "../openai/service.js";
import type { WhatsAppService } from "../whatsapp/service.js";
import type { Capability } from "../capabilities/types.js";
import {
  renderAccessGroups,
  renderCapabilities,
  renderDashboard,
  renderLogin,
  renderSettings,
  type CapabilityView,
} from "./views.js";

const sessionCookieName = "messistant_session";

interface WebDependencies {
  environment: Environment;
  logger: Logger;
  database: MessistantDatabase;
  settings: SettingsService;
  auth: AuthService;
  openAi: OpenAiService;
  whatsapp: WhatsAppService;
  capabilities: Capability[];
}

type FormBody = Record<string, unknown>;

function formBody(request: FastifyRequest): FormBody {
  return request.body && typeof request.body === "object"
    ? (request.body as FormBody)
    : {};
}

function formString(body: FormBody, key: string): string {
  const value = body[key];
  if (Array.isArray(value)) {
    return String(value.at(-1) ?? "");
  }
  return value === undefined || value === null ? "" : String(value);
}

function formStrings(body: FormBody, key: string): string[] {
  const value = body[key];
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  return value === undefined || value === null || value === ""
    ? []
    : [String(value)];
}

function chatIdsFromBody(body: FormBody): string[] {
  const selected = formStrings(body, "chatIds");
  const manual = formString(body, "manualChatIds")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...selected, ...manual])];
}

function queryValue(request: FastifyRequest, key: string): string | undefined {
  const query =
    request.query && typeof request.query === "object"
      ? (request.query as Record<string, unknown>)
      : {};
  const value = query[key];
  return typeof value === "string" ? value : undefined;
}

function redirectWithMessage(
  reply: FastifyReply,
  pathName: string,
  key: "saved" | "error",
  message: string,
  additionalQuery: Record<string, string> = {},
): FastifyReply {
  const query = new URLSearchParams(additionalQuery);
  query.set(key, message);
  return reply.redirect(`${pathName}?${query.toString()}`);
}

function getSession(
  request: FastifyRequest,
  auth: AuthService,
): AuthenticatedSession | null {
  return auth.getSession(request.cookies[sessionCookieName]);
}

function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
): AuthenticatedSession | null {
  const session = getSession(request, auth);
  if (!session) {
    void reply.redirect("/login");
    return null;
  }
  return session;
}

function requireApiSession(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
): AuthenticatedSession | null {
  const session = getSession(request, auth);
  if (!session) {
    void reply.code(401).send({ error: "Authentication required." });
    return null;
  }
  return session;
}

function requireCsrf(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
): AuthenticatedSession | null {
  const session = requireSession(request, reply, auth);
  if (!session) {
    return null;
  }
  const submitted = formString(formBody(request), "csrf");
  if (!submitted || submitted !== session.csrfToken) {
    void reply.code(403).type("text/plain").send("Invalid CSRF token.");
    return null;
  }
  return session;
}

function capabilityViews(
  definitions: Capability[],
  database: MessistantDatabase,
): CapabilityView[] {
  return definitions.flatMap((capability) => {
    const configuration = database.getCapability(capability.defaults.id);
    return configuration
      ? [{ definition: capability.defaults, configuration }]
      : [];
  });
}

function configuredChatIds(database: MessistantDatabase): string[] {
  return [
    ...new Set([
      ...database
        .listCapabilities()
        .flatMap((capability) => capability.directChatIds),
      ...database.listAccessGroups().flatMap((group) => group.chatIds),
      ...database.listObservedChatIds(),
    ]),
  ];
}

export async function createWebServer(
  dependencies: WebDependencies,
) {
  const {
    environment,
    logger,
    database,
    settings,
    auth,
    openAi,
    whatsapp,
    capabilities,
  } = dependencies;
  const app = Fastify({
    loggerInstance: logger,
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, {
    global: false,
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
  });
  await app.register(fastifyStatic, {
    root: (() => {
      const publicRoot = [
        path.resolve(process.cwd(), "public"),
        path.resolve(import.meta.dirname, "../../public"),
      ].find(existsSync);
      if (!publicRoot) {
        throw new Error("Could not locate the public assets directory.");
      }
      return publicRoot;
    })(),
    prefix: "/assets/",
    decorateReply: false,
    maxAge: "1h",
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!request.url.startsWith("/assets/")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  app.get("/health", async () => ({
    ok: true,
    whatsapp: whatsapp.getStatus().phase,
    openAi: openAi.isConfigured(),
  }));

  app.get("/", async (request, reply) => {
    return getSession(request, auth)
      ? reply.redirect("/dashboard")
      : reply.redirect("/login");
  });

  app.get("/login", async (request, reply) => {
    if (getSession(request, auth)) {
      return reply.redirect("/dashboard");
    }
    return reply.type("text/html").send(renderLogin(null));
  });

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const body = formBody(request);
      const result = auth.login(
        formString(body, "username"),
        formString(body, "password"),
      );
      if (!result) {
        return reply
          .code(401)
          .type("text/html")
          .send(renderLogin("The username or password is incorrect."));
      }
      reply.setCookie(sessionCookieName, result.token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: request.protocol === "https",
        maxAge: Math.floor((result.session.expiresAt - Date.now()) / 1000),
      });
      return reply.redirect("/dashboard");
    },
  );

  app.post("/logout", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) {
      return reply;
    }
    auth.logout(request.cookies[sessionCookieName]);
    reply.clearCookie(sessionCookieName, { path: "/" });
    return reply.redirect("/login");
  });

  app.get("/dashboard", async (request, reply) => {
    const session = requireSession(request, reply, auth);
    if (!session) return reply;

    return reply.type("text/html").send(
      renderDashboard({
        session,
        whatsapp: whatsapp.getStatus(),
        openAiConfigured: openAi.isConfigured(),
        messageCount: database.getTotalMessageCount(),
        settings: settings.getGlobal(),
        ...(queryValue(request, "saved")
          ? { flash: queryValue(request, "saved") }
          : {}),
        ...(queryValue(request, "error")
          ? { error: queryValue(request, "error") }
          : {}),
        hostWarning: !["127.0.0.1", "::1", "localhost"].includes(
          environment.host,
        ),
      }),
    );
  });

  app.get("/api/status", async (request, reply) => {
    if (!requireApiSession(request, reply, auth)) {
      return reply;
    }
    return {
      whatsapp: whatsapp.getStatus(),
      openAi: settings.getOpenAiKeyStatus(),
      messageCount: database.getTotalMessageCount(),
    };
  });

  app.post("/security/password", async (request, reply) => {
    const session = requireCsrf(request, reply, auth);
    if (!session) return reply;
    const body = formBody(request);
    const newPassword = formString(body, "newPassword");
    if (newPassword !== formString(body, "confirmPassword")) {
      return redirectWithMessage(
        reply,
        "/dashboard",
        "error",
        "The new passwords did not match.",
      );
    }

    try {
      auth.changePassword({
        username: session.username,
        currentPassword: formString(body, "currentPassword"),
        newPassword,
      });
      reply.clearCookie(sessionCookieName, { path: "/" });
      return reply.redirect("/login");
    } catch (error) {
      return redirectWithMessage(
        reply,
        "/dashboard",
        "error",
        error instanceof Error ? error.message : "Password change failed.",
      );
    }
  });

  app.post("/whatsapp/reconnect", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    void whatsapp.reconnect();
    return redirectWithMessage(
      reply,
      "/dashboard",
      "saved",
      "WhatsApp is reconnecting.",
    );
  });

  app.post("/whatsapp/unlink", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    void whatsapp.unlink();
    return redirectWithMessage(
      reply,
      "/dashboard",
      "saved",
      "WhatsApp is unlinking. A fresh QR code will appear shortly.",
    );
  });

  app.get("/settings", async (request, reply) => {
    const session = requireSession(request, reply, auth);
    if (!session) return reply;
    return reply.type("text/html").send(
      renderSettings({
        session,
        settings: settings.getGlobal(),
        keyStatus: settings.getOpenAiKeyStatus(),
        ...(queryValue(request, "saved")
          ? { flash: queryValue(request, "saved") }
          : {}),
        ...(queryValue(request, "error")
          ? { error: queryValue(request, "error") }
          : {}),
      }),
    );
  });

  app.post("/settings/global", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    const body = formBody(request);
    try {
      settings.updateGlobal({
        textModel: formString(body, "textModel"),
        transcriptionModel: formString(body, "transcriptionModel"),
        timezone: formString(body, "timezone"),
        retentionDays: formString(body, "retentionDays"),
      });
      return redirectWithMessage(
        reply,
        "/settings",
        "saved",
        "Runtime settings saved.",
      );
    } catch (error) {
      return redirectWithMessage(
        reply,
        "/settings",
        "error",
        error instanceof Error ? error.message : "Settings were not saved.",
      );
    }
  });

  app.post("/settings/openai-key", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    try {
      settings.setOpenAiApiKey(formString(formBody(request), "apiKey"));
      return redirectWithMessage(
        reply,
        "/settings",
        "saved",
        "OpenAI API key encrypted and saved.",
      );
    } catch (error) {
      return redirectWithMessage(
        reply,
        "/settings",
        "error",
        error instanceof Error ? error.message : "The API key was not saved.",
      );
    }
  });

  app.post("/settings/openai-key/clear", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    settings.clearOpenAiApiKey();
    return redirectWithMessage(
      reply,
      "/settings",
      "saved",
      "The locally stored OpenAI API key was removed.",
    );
  });

  app.get("/capabilities", async (request, reply) => {
    const session = requireSession(request, reply, auth);
    if (!session) return reply;
    return reply.type("text/html").send(
      renderCapabilities({
        session,
        capabilities: capabilityViews(capabilities, database),
        groups: database.listAccessGroups(),
        chats: await whatsapp.listChats(configuredChatIds(database)),
        ...(queryValue(request, "selected")
          ? { selectedCapabilityId: queryValue(request, "selected") }
          : {}),
        ...(queryValue(request, "saved")
          ? { flash: queryValue(request, "saved") }
          : {}),
        ...(queryValue(request, "error")
          ? { error: queryValue(request, "error") }
          : {}),
      }),
    );
  });

  app.post("/capabilities/:id", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    const parameters = request.params as { id: string };
    const existing = database.getCapability(parameters.id);
    const definition = capabilities.find(
      (capability) => capability.defaults.id === parameters.id,
    );
    if (!existing || !definition) {
      return reply.code(404).type("text/plain").send("Unknown assist.");
    }

    const body = formBody(request);
    const accessMode = formString(body, "accessMode");
    if (!accessModes.includes(accessMode as (typeof accessModes)[number])) {
      return redirectWithMessage(
        reply,
        "/capabilities",
        "error",
        "The selected access policy is invalid.",
        { selected: parameters.id },
      );
    }

    const capabilitySettings = { ...existing.settings };
    if (parameters.id === "voice-transcription") {
      capabilitySettings.language = formString(body, "language").trim();
      capabilitySettings.prompt = formString(body, "prompt").trim();
      capabilitySettings.replyPrefix =
        formString(body, "replyPrefix").trim() || "📝 Transcript:";
      capabilitySettings.maxSeconds =
        Math.max(1, Number(formString(body, "maxMinutes")) || 10) * 60;
      capabilitySettings.maxBytes =
        Math.max(1, Number(formString(body, "maxMegabytes")) || 20) *
        1024 *
        1024;
    }

    database.updateCapability({
      ...existing,
      enabled: formString(body, "enabled") === "true",
      accessMode: accessMode as (typeof accessModes)[number],
      groupIds: [...new Set(formStrings(body, "groupIds"))],
      directChatIds: chatIdsFromBody(body),
      settings: capabilitySettings,
    });

    return redirectWithMessage(
      reply,
      "/capabilities",
      "saved",
      `${definition.defaults.name} saved.`,
      { selected: parameters.id },
    );
  });

  app.get("/access", async (request, reply) => {
    const session = requireSession(request, reply, auth);
    if (!session) return reply;
    return reply.type("text/html").send(
      renderAccessGroups({
        session,
        groups: database.listAccessGroups(),
        chats: await whatsapp.listChats(configuredChatIds(database)),
        ...(queryValue(request, "saved")
          ? { flash: queryValue(request, "saved") }
          : {}),
        ...(queryValue(request, "error")
          ? { error: queryValue(request, "error") }
          : {}),
      }),
    );
  });

  app.post("/access/groups", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    const body = formBody(request);
    const name = formString(body, "name").trim();
    if (!name) {
      return redirectWithMessage(
        reply,
        "/access",
        "error",
        "An access-group name is required.",
      );
    }

    try {
      database.saveAccessGroup({
        id: formString(body, "id") || randomUUID(),
        name,
        chatIds: chatIdsFromBody(body),
      });
      return redirectWithMessage(
        reply,
        "/access",
        "saved",
        `${name} saved.`,
      );
    } catch (error) {
      logger.warn({ err: error }, "Could not save access group");
      return redirectWithMessage(
        reply,
        "/access",
        "error",
        "That access-group name is already in use.",
      );
    }
  });

  app.post("/access/groups/:id/delete", async (request, reply) => {
    if (!requireCsrf(request, reply, auth)) return reply;
    const parameters = request.params as { id: string };
    database.deleteAccessGroup(parameters.id);
    return redirectWithMessage(
      reply,
      "/access",
      "saved",
      "Access group deleted.",
    );
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found." });
    }
    return reply
      .code(404)
      .type("text/html")
      .send(
        renderLogin(
          "That page does not exist. Sign in to return to Messistant.",
        ),
      );
  });

  return app;
}
