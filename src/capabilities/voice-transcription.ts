import type { Message } from "whatsapp-web.js";
import type { Capability } from "./types.js";
import type { CapabilityConfiguration } from "../config/types.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { NormalizedMessageEvent } from "../whatsapp/types.js";
import {
  downloadMessageMedia,
  mediaMetadataAvailability,
} from "../whatsapp/media.js";
import { isCapabilityAuthorized } from "./access.js";

const defaultMaximumBytes = 20 * 1024 * 1024;
const defaultMaximumSeconds = 10 * 60;
const defaultTranscriptionPrompt =
  "The speaker may switch between languages, including within the same sentence. Transcribe each phrase exactly in the language spoken. Preserve code-switching and original wording. Do not translate.";

function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "ogg";
}

export function isSttCommand(body: string): boolean {
  return body.trim().toLowerCase() === "!stt";
}

function runtimeMessageId(message: Message): string {
  const id = message.id as unknown as { id?: unknown };
  return typeof id.id === "string" ? id.id : "";
}

function quotedMessageReference(event: NormalizedMessageEvent): {
  id: string;
  raw: Record<string, unknown> | null;
} | null {
  const eventData = event.raw.rawData as unknown as
    | Record<string, unknown>
    | undefined;
  if (!eventData) {
    return null;
  }
  const quoted =
    [eventData.quotedMsg, eventData.quotedMsgObj].find(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    ) ?? null;
  const context = [eventData.contextInfo, eventData.msgContextInfo].find(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  const quotedId =
    quoted?.id && typeof quoted.id === "object" && "id" in quoted.id
      ? quoted.id.id
      : [
          eventData.quotedStanzaID,
          eventData.quotedStanzaId,
          eventData.stanzaId,
          context?.quotedStanzaID,
          context?.quotedStanzaId,
          context?.stanzaId,
        ].find((value): value is string => typeof value === "string");
  return typeof quotedId === "string"
    ? { id: quotedId, raw: quoted }
    : null;
}

async function loadQuotedMessageById(
  event: NormalizedMessageEvent,
  stanzaId: string,
): Promise<Message | null> {
  const internal = event.raw as unknown as {
    client?: { getMessageById?(messageId: string): Promise<Message | null> };
  };
  const getMessageById = internal.client?.getMessageById;
  if (!getMessageById) {
    return null;
  }

  for (const fromMe of [true, false]) {
    try {
      const message = await getMessageById.call(
        internal.client,
        `${String(fromMe)}_${event.chatId}_${stanzaId}`,
      );
      if (message) {
        return message;
      }
    } catch {
      // Try the other direction, then the live quoted-message lookup.
    }
  }
  return null;
}

function messageFromEmbeddedQuote(
  event: NormalizedMessageEvent,
  raw: Record<string, unknown>,
): Message {
  const command = event.raw as unknown as {
    client?: unknown;
  };
  return {
    id: raw.id,
    type: raw.type,
    duration: raw.duration,
    hasMedia: Boolean(raw.directPath),
    rawData: raw,
    client: command.client,
    downloadMedia: async () => undefined,
  } as unknown as Message;
}

export async function selectQuotedVoiceNote(
  event: NormalizedMessageEvent,
): Promise<Message | null> {
  const quotedReference = quotedMessageReference(event);
  if (quotedReference) {
    const recent = event.recentMessages
      .toReversed()
      .find((message) => runtimeMessageId(message) === quotedReference.id);
    if (recent) {
      return recent;
    }
    const loaded = await loadQuotedMessageById(event, quotedReference.id);
    if (loaded) {
      return loaded;
    }
  }

  const mutableMessage = event.raw as unknown as { hasQuotedMsg: boolean };
  const originalHasQuotedMessage = mutableMessage.hasQuotedMsg;
  try {
    // Current WhatsApp builds can render a quote while omitting quotedMsg from
    // the serialized event. Force the library to query the live message model.
    mutableMessage.hasQuotedMsg = true;
    const quoted = await event.raw.getQuotedMessage();
    if (quoted) {
      return quoted;
    }
  } catch {
    // The observed-message buffer remains available below.
  } finally {
    mutableMessage.hasQuotedMsg = originalHasQuotedMessage;
  }

  const recentVoiceNote = event.recentMessages
    .toReversed()
    .find((message) => message.type === "ptt" && message.hasMedia);
  if (recentVoiceNote) {
    return recentVoiceNote;
  }

  return quotedReference?.raw
    ? messageFromEmbeddedQuote(event, quotedReference.raw)
    : null;
}

export function isVoiceTranscriptionAuthorized(
  event: NormalizedMessageEvent,
  configuration: CapabilityConfiguration,
  database: MessistantDatabase,
): boolean {
  if (!configuration.enabled || configuration.accessMode === "disabled") {
    return false;
  }
  if (isSttCommand(event.body)) {
    return event.fromMe;
  }
  if (event.chatType === "self" && event.fromMe) {
    return true;
  }
  return isCapabilityAuthorized(configuration, event, database);
}

export const voiceTranscriptionCapability: Capability = {
  defaults: {
    id: "voice-transcription",
    name: "Voice-note transcription",
    description:
      "Transcribes allowlisted voice notes automatically, or any quoted voice note when you reply with !stt.",
    triggerLabel: "Voice note / !stt",
    enabled: true,
    accessMode: "allowlist",
    groupIds: [],
    directChatIds: [],
    settings: {
      maxBytes: defaultMaximumBytes,
      maxSeconds: defaultMaximumSeconds,
      language: "",
      prompt: defaultTranscriptionPrompt,
      replyPrefix: "📝 Transcript:",
      configurationVersion: 4,
    },
  },

  migrateConfiguration(configuration) {
    if (configuration.settings.configurationVersion === 4) {
      return configuration;
    }

    return {
      ...configuration,
      accessMode:
        configuration.accessMode === "owner_or_allowlist"
          ? "allowlist"
          : configuration.accessMode === "owner_any_chat"
            ? "self_chat_only"
        : configuration.accessMode,
      settings: {
        ...configuration.settings,
        prompt:
          typeof configuration.settings.prompt === "string" &&
          configuration.settings.prompt.trim()
            ? configuration.settings.prompt
            : defaultTranscriptionPrompt,
        configurationVersion: 4,
      },
    };
  },

  authorize(event, configuration, database) {
    return isVoiceTranscriptionAuthorized(event, configuration, database);
  },

  matches(event) {
    return (
      isSttCommand(event.body) ||
      (event.messageType === "ptt" &&
        event.hasMedia &&
        (!event.fromMe || event.chatType === "self"))
    );
  },

  async execute(event, context) {
    const manual = isSttCommand(event.body);
    const target = manual ? await selectQuotedVoiceNote(event) : event.raw;
    if (!target) {
      await event.raw.reply("Reply to a voice note with !stt to transcribe it.");
      return;
    }
    if (target.type !== "ptt") {
      await event.raw.reply("The quoted message is not a voice note.");
      return;
    }

    const maxBytes = numberSetting(
      context.configuration.settings,
      "maxBytes",
      defaultMaximumBytes,
    );
    const maxSeconds = numberSetting(
      context.configuration.settings,
      "maxSeconds",
      defaultMaximumSeconds,
    );

    const targetSeconds = Number(target.duration ?? 0);
    if (targetSeconds > maxSeconds) {
      await event.raw.reply(
        `That voice note is longer than the configured ${Math.round(maxSeconds / 60)} minute limit.`,
      );
      return;
    }

    const media = await downloadMessageMedia(target);
    if (!media?.data) {
      const availability = mediaMetadataAvailability(target);
      context.logger.warn(
        { messageId: event.id, availability },
        "WhatsApp exposed a voice note without downloadable media",
      );
      throw new Error(
        `WhatsApp could not download the voice note. Media metadata: ${JSON.stringify(availability)}`,
      );
    }

    const audio = Buffer.from(media.data, "base64");
    if (audio.byteLength > maxBytes) {
      await event.raw.reply(
        `That voice note is larger than the configured ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`,
      );
      return;
    }

    const mimeType = media.mimetype.split(";")[0]?.trim() || "audio/ogg";
    const languageValue = context.configuration.settings.language;
    const language =
      typeof languageValue === "string" && languageValue.trim()
        ? languageValue.trim()
        : undefined;
    const promptValue = context.configuration.settings.prompt;
    const prompt =
      typeof promptValue === "string" && promptValue.trim()
        ? promptValue.trim()
        : defaultTranscriptionPrompt;
    const transcript = await context.openAi.transcribe({
      audio,
      filename: `voice-note.${extensionForMimeType(mimeType)}`,
      mimeType,
      ...(language ? { language } : {}),
      prompt,
      idempotencyKey: context.requestKey,
    });
    const prefixValue = context.configuration.settings.replyPrefix;
    const prefix =
      typeof prefixValue === "string" && prefixValue.trim()
        ? prefixValue.trim()
        : "📝 Transcript:";

    await event.raw.reply(`${prefix}\n${transcript}`);
  },
};
