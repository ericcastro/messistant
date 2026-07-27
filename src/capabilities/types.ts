import type { Logger } from "pino";
import type {
  CapabilityConfiguration,
  CapabilityDefaults,
} from "../config/types.js";
import type { SettingsService } from "../config/settings.js";
import type { OpenAiService } from "../openai/service.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { NormalizedMessageEvent } from "../whatsapp/types.js";

export interface CapabilityContext {
  database: MessistantDatabase;
  settings: SettingsService;
  openAi: OpenAiService;
  logger: Logger;
  configuration: CapabilityConfiguration;
  requestKey: string;
}

export interface Capability {
  defaults: CapabilityDefaults;
  migrateConfiguration?(
    configuration: CapabilityConfiguration,
  ): CapabilityConfiguration;
  authorize?(
    event: NormalizedMessageEvent,
    configuration: CapabilityConfiguration,
    database: MessistantDatabase,
  ): boolean;
  matches(event: NormalizedMessageEvent): boolean;
  execute(
    event: NormalizedMessageEvent,
    context: CapabilityContext,
  ): Promise<void>;
}
