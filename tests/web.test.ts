import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityDispatcher } from "../src/capabilities/dispatcher.js";
import { capabilities } from "../src/capabilities/registry.js";
import type { Environment } from "../src/config/env.js";
import { SettingsService } from "../src/config/settings.js";
import { OpenAiService } from "../src/openai/service.js";
import type { MessistantDatabase } from "../src/persistence/database.js";
import { AuthService } from "../src/security/auth.js";
import { SecretVault } from "../src/security/secrets.js";
import { createWebServer } from "../src/web/server.js";
import { WhatsAppService } from "../src/whatsapp/service.js";
import { temporaryDatabase } from "./helpers.js";

describe("admin server", () => {
  let database: MessistantDatabase;
  let cleanup: () => void;
  let directory: string;

  beforeEach(() => {
    ({ database, cleanup, directory } = temporaryDatabase());
  });

  afterEach(() => cleanup());

  it("protects the dashboard and accepts the bootstrap credentials", async () => {
    const logger = pino({ level: "silent" });
    const environment: Environment = {
      host: "127.0.0.1",
      port: 3000,
      dataDir: directory,
      logLevel: "silent",
      puppeteerNoSandbox: false,
    };
    const settings = new SettingsService(
      database,
      new SecretVault(directory),
      environment,
    );
    const auth = new AuthService(database);
    const openAi = new OpenAiService(settings);
    const whatsapp = new WhatsAppService(environment, logger);
    new CapabilityDispatcher(
      capabilities,
      database,
      settings,
      openAi,
      logger,
    );
    const server = await createWebServer({
      environment,
      logger,
      database,
      settings,
      auth,
      openAi,
      whatsapp,
      capabilities,
    });

    const protectedResponse = await server.inject({
      method: "GET",
      url: "/dashboard",
    });
    expect(protectedResponse.statusCode).toBe(302);
    expect(protectedResponse.headers.location).toBe("/login");

    const loginResponse = await server.inject({
      method: "POST",
      url: "/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "username=admin&password=admin",
    });
    expect(loginResponse.statusCode).toBe(302);
    const cookie = loginResponse.headers["set-cookie"];
    expect(cookie).toContain("messistant_session=");

    const dashboardResponse = await server.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] ?? "" : (cookie ?? ""),
      },
    });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.body).toContain("The assist is live.");

    const loginPage = await server.inject({
      method: "GET",
      url: "/login",
    });
    expect(loginPage.body).toContain("data-typewriter-text");
    expect(loginPage.body).not.toContain("Messi assists.<br>Messages are messy.");

    const capabilitiesResponse = await server.inject({
      method: "GET",
      url: "/capabilities?selected=conjugate",
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] ?? "" : (cookie ?? ""),
      },
    });
    expect(capabilitiesResponse.statusCode).toBe(200);
    expect(capabilitiesResponse.body).toContain("data-capability-tabs");
    expect(capabilitiesResponse.body).toContain("Assist registry");
    expect(capabilitiesResponse.body).toContain("Reply with <code>!stt</code>");
    expect(capabilitiesResponse.body).toContain(
      'data-capability-target="conjugate"',
    );
    expect(capabilitiesResponse.body).toContain(
      'id="capability-panel-conjugate"',
    );

    await server.close();
  });
});
