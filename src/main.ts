import { mkdirSync } from "node:fs";
import pino from "pino";
import { capabilities } from "./capabilities/registry.js";
import { CapabilityDispatcher } from "./capabilities/dispatcher.js";
import { loadEnvironment } from "./config/env.js";
import { SettingsService } from "./config/settings.js";
import { OpenAiService } from "./openai/service.js";
import { MessistantDatabase } from "./persistence/database.js";
import { AuthService } from "./security/auth.js";
import { SecretVault } from "./security/secrets.js";
import { WhatsAppService } from "./whatsapp/service.js";
import { createWebServer } from "./web/server.js";

const environment = loadEnvironment();
mkdirSync(environment.dataDir, { recursive: true, mode: 0o700 });

const logger = pino({
  level: environment.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.body",
      "*.transcript",
      "*.qrDataUrl",
    ],
    censor: "[redacted]",
  },
});

const database = new MessistantDatabase(environment.dataDir);
const vault = new SecretVault(environment.dataDir);
const settings = new SettingsService(database, vault, environment);
const auth = new AuthService(database);
const openAi = new OpenAiService(settings);
const whatsapp = new WhatsAppService(environment, logger);
const dispatcher = new CapabilityDispatcher(
  capabilities,
  database,
  settings,
  openAi,
  logger,
);
whatsapp.setMessageHandler((event) => dispatcher.handle(event));

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

await server.listen({
  host: environment.host,
  port: environment.port,
});

logger.info(
  {
    url: `http://${environment.host}:${environment.port}`,
    dataDir: environment.dataDir,
  },
  "Messistant admin server ready",
);

void whatsapp.start();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down Messistant");
  await server.close();
  await whatsapp.stop();
  database.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ err: error }, "Messistant shutdown failed");
        process.exit(1);
      });
  });
}

