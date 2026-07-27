import { z } from "zod";
import type { Environment } from "./env.js";
import type { GlobalSettings } from "./types.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { SecretVault } from "../security/secrets.js";

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Enter a valid IANA timezone such as Europe/Paris." },
  );

const globalSettingsSchema = z.object({
  textModel: z.string().trim().min(1).max(100),
  transcriptionModel: z.string().trim().min(1).max(100),
  timezone: timezoneSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650),
});

const defaults: GlobalSettings = {
  textModel: "gpt-5.6-luna",
  transcriptionModel: "gpt-4o-transcribe",
  timezone: "Europe/Paris",
  retentionDays: 365,
};

export class SettingsService {
  constructor(
    readonly database: MessistantDatabase,
    readonly vault: SecretVault,
    readonly environment: Environment,
  ) {}

  getGlobal(): GlobalSettings {
    return globalSettingsSchema.parse({
      textModel:
        this.database.getSetting("global.textModel") ?? defaults.textModel,
      transcriptionModel:
        this.database.getSetting("global.transcriptionModel") ??
        defaults.transcriptionModel,
      timezone:
        this.database.getSetting("global.timezone") ?? defaults.timezone,
      retentionDays:
        this.database.getSetting("global.retentionDays") ??
        defaults.retentionDays,
    });
  }

  updateGlobal(input: unknown): GlobalSettings {
    const settings = globalSettingsSchema.parse(input);
    this.database.setSetting("global.textModel", settings.textModel);
    this.database.setSetting(
      "global.transcriptionModel",
      settings.transcriptionModel,
    );
    this.database.setSetting("global.timezone", settings.timezone);
    this.database.setSetting(
      "global.retentionDays",
      String(settings.retentionDays),
    );
    return settings;
  }

  setOpenAiApiKey(apiKey: string): void {
    const normalized = apiKey.trim();
    if (!normalized) {
      throw new Error("The OpenAI API key cannot be empty.");
    }
    this.database.setSetting(
      "secret.openAiApiKey",
      this.vault.encrypt(normalized),
    );
  }

  clearOpenAiApiKey(): void {
    this.database.deleteSetting("secret.openAiApiKey");
  }

  getOpenAiApiKey(): string | null {
    if (this.environment.openAiApiKey) {
      return this.environment.openAiApiKey;
    }

    const encrypted = this.database.getSetting("secret.openAiApiKey");
    return encrypted ? this.vault.decrypt(encrypted) : null;
  }

  getOpenAiKeyStatus(): {
    configured: boolean;
    source: "environment" | "encrypted-local" | "missing";
    suffix: string | null;
  } {
    const key = this.getOpenAiApiKey();
    return {
      configured: Boolean(key),
      source: this.environment.openAiApiKey
        ? "environment"
        : key
          ? "encrypted-local"
          : "missing",
      suffix: key ? key.slice(-4) : null,
    };
  }
}
