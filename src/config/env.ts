import path from "node:path";
import { z } from "zod";

const booleanFromEnvironment = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const environmentSchema = z.object({
  MESSISTANT_HOST: z.string().min(1).default("127.0.0.1"),
  MESSISTANT_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  MESSISTANT_DATA_DIR: z.string().min(1).default("./data"),
  MESSISTANT_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  OPENAI_API_KEY: z.string().optional(),
  PUPPETEER_NO_SANDBOX: booleanFromEnvironment,
});

export interface Environment {
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
  openAiApiKey?: string;
  puppeteerNoSandbox: boolean;
}

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const parsed = environmentSchema.parse(source);
  const openAiApiKey = parsed.OPENAI_API_KEY?.trim();

  return {
    host: parsed.MESSISTANT_HOST,
    port: parsed.MESSISTANT_PORT,
    dataDir: path.resolve(parsed.MESSISTANT_DATA_DIR),
    logLevel: parsed.MESSISTANT_LOG_LEVEL,
    ...(openAiApiKey ? { openAiApiKey } : {}),
    puppeteerNoSandbox: parsed.PUPPETEER_NO_SANDBOX,
  };
}

