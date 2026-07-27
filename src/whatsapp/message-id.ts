import { createHash } from "node:crypto";
import type { Message } from "whatsapp-web.js";

function serializedRemote(remote: unknown): string {
  if (typeof remote === "string") {
    return remote;
  }
  if (
    remote &&
    typeof remote === "object" &&
    "_serialized" in remote &&
    typeof remote._serialized === "string"
  ) {
    return remote._serialized;
  }
  return "";
}

export function serializeMessageId(message: Message, chatId: string): string {
  const runtimeId = message.id as unknown as {
    _serialized?: unknown;
    fromMe?: unknown;
    remote?: unknown;
    id?: unknown;
  };

  if (
    typeof runtimeId._serialized === "string" &&
    runtimeId._serialized.trim()
  ) {
    return runtimeId._serialized;
  }

  const remote = serializedRemote(runtimeId.remote) || chatId;
  if (typeof runtimeId.id === "string" && runtimeId.id.trim() && remote) {
    return `${String(Boolean(runtimeId.fromMe))}_${remote}_${runtimeId.id}`;
  }

  const fingerprint = JSON.stringify({
    chatId,
    from: message.from,
    to: message.to,
    author: message.author ?? "",
    fromMe: message.fromMe,
    timestamp: Number(message.timestamp),
    type: message.type,
    body: message.body ?? "",
  });
  return `fallback_${createHash("sha256").update(fingerprint).digest("hex")}`;
}
