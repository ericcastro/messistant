import type { CapabilityConfiguration } from "../config/types.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { NormalizedMessageEvent } from "../whatsapp/types.js";

export function isCapabilityAuthorized(
  configuration: CapabilityConfiguration,
  event: Pick<
    NormalizedMessageEvent,
    "chatId" | "chatType" | "fromMe"
  >,
  database: MessistantDatabase,
): boolean {
  if (!configuration.enabled || configuration.accessMode === "disabled") {
    return false;
  }

  const allowlisted = database
    .resolveAllowedChatIds(configuration)
    .has(event.chatId);

  switch (configuration.accessMode) {
    case "self_chat_only":
      return event.chatType === "self" && event.fromMe;
    case "owner_any_chat":
      return event.fromMe;
    case "allowlist":
      return allowlisted;
    case "owner_or_allowlist":
      return event.fromMe || allowlisted;
    case "everyone":
      return true;
  }
}
