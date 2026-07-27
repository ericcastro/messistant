import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "whatsapp-web.js";
import { CapabilityDispatcher } from "../src/capabilities/dispatcher.js";
import { selectReferenceBody } from "../src/capabilities/explain.js";
import type { Capability } from "../src/capabilities/types.js";
import {
  isSttCommand,
  isVoiceTranscriptionAuthorized,
  selectQuotedVoiceNote,
  voiceTranscriptionCapability,
} from "../src/capabilities/voice-transcription.js";
import type { SettingsService } from "../src/config/settings.js";
import type { OpenAiService } from "../src/openai/service.js";
import type { NormalizedMessageEvent } from "../src/whatsapp/types.js";
import { serializeMessageId } from "../src/whatsapp/message-id.js";
import { downloadMessageMedia } from "../src/whatsapp/media.js";
import { temporaryDatabase } from "./helpers.js";

function fakeMessage(input: Record<string, unknown>): Message {
  return input as unknown as Message;
}

function event(
  overrides: Partial<NormalizedMessageEvent> = {},
): NormalizedMessageEvent {
  const raw = fakeMessage({
    id: {
      fromMe: true,
      remote: "me@lid",
      id: "ABC",
      _serialized: "true_me@lid_ABC",
    },
    from: "me@c.us",
    to: "me@lid",
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1000),
    type: "chat",
    body: "!test",
    hasMedia: false,
    reply: vi.fn(),
  });
  return {
    id: "true_me@lid_ABC",
    occurredAt: Date.now(),
    body: "!test",
    chatId: "me@lid",
    chatName: "You",
    actorId: "me@c.us",
    accountId: "me@c.us",
    direction: "outgoing",
    chatType: "self",
    fromMe: true,
    messageType: "chat",
    voiceSeconds: 0,
    hasMedia: false,
    recentMessages: [],
    raw,
    ...overrides,
  };
}

describe("message processing regressions", () => {
  it("reconstructs whatsapp-web.js IDs when _serialized is absent", () => {
    const message = fakeMessage({
      id: {
        fromMe: true,
        remote: { _serialized: "92410533118177@lid" },
        id: "3EB0123456789",
      },
      from: "33640400988@c.us",
      to: "92410533118177@lid",
      fromMe: true,
      timestamp: 1_784_859_098,
      type: "chat",
      body: "!conj cagar",
    });

    expect(serializeMessageId(message, "92410533118177@lid")).toBe(
      "true_92410533118177@lid_3EB0123456789",
    );
  });

  it("executes a fresh event once and only records historical replays", async () => {
    const { database, cleanup } = temporaryDatabase();
    const execute = vi.fn(async () => undefined);
    const capability: Capability = {
      defaults: {
        id: "test",
        name: "Test",
        description: "Test",
        triggerLabel: "!test",
        enabled: true,
        accessMode: "everyone",
        groupIds: [],
        directChatIds: [],
        settings: {},
      },
      matches: () => true,
      execute,
    };
    const dispatcher = new CapabilityDispatcher(
      [capability],
      database,
      {
        getGlobal: () => ({ retentionDays: 30 }),
      } as unknown as SettingsService,
      {} as OpenAiService,
      pino({ level: "silent" }),
    );

    const fresh = event();
    await dispatcher.handle(fresh);
    await dispatcher.handle(fresh);
    await dispatcher.handle(
      event({
        id: "historical",
        occurredAt:
          Date.now() - CapabilityDispatcher.maximumExecutionAgeMs - 1,
      }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(database.getTotalMessageCount()).toBe(2);
    cleanup();
  });

  it("resolves !!! from the observed chat buffer without a page-side chat lookup", async () => {
    const getChat = vi.fn();
    const previous = fakeMessage({
      id: { _serialized: "previous" },
      body: "Qué quilombo, che.",
    });
    const command = event({
      recentMessages: [previous],
      raw: fakeMessage({
        id: { _serialized: "command" },
        body: "!!!",
        hasQuotedMsg: false,
        getChat,
      }),
    });

    await expect(selectReferenceBody(command, -1)).resolves.toBe(
      "Qué quilombo, che.",
    );
    expect(getChat).not.toHaveBeenCalled();
  });

  it("upgrades voice settings to automatic allowlist and multilingual transcription", () => {
    const { database, cleanup } = temporaryDatabase();
    database.ensureCapability({
      ...voiceTranscriptionCapability.defaults,
      accessMode: "owner_or_allowlist",
      settings: {
        maxBytes: 20 * 1024 * 1024,
        maxSeconds: 10 * 60,
        language: "",
        replyPrefix: "📝 Transcript:",
        configurationVersion: 2,
      },
    });

    new CapabilityDispatcher(
      [voiceTranscriptionCapability],
      database,
      {} as SettingsService,
      {} as OpenAiService,
      pino({ level: "silent" }),
    );

    expect(database.getCapability("voice-transcription")).toMatchObject({
      accessMode: "allowlist",
      settings: {
        configurationVersion: 4,
        prompt: expect.stringContaining("Do not translate"),
      },
    });
    cleanup();
  });

  it("downloads voice media directly from event metadata when ID lookup fails", async () => {
    const downloadMedia = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({
      data: "dm9pY2U=",
      mimetype: "audio/ogg",
      filename: null,
      filesize: 5,
    });
    const message = fakeMessage({
      downloadMedia,
      client: { pupPage: { evaluate } },
      rawData: {
        directPath: "/v/t62.7117/example",
        encFilehash: "encrypted",
        filehash: "plain",
        mediaKey: "key",
        mediaKeyTimestamp: 1_784_861_355,
        type: "ptt",
        mimetype: "audio/ogg; codecs=opus",
        size: 5,
      },
    });
    await expect(
      downloadMessageMedia(message),
    ).resolves.toMatchObject({ data: "dm9pY2U=" });
    expect(downloadMedia).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("matches self-chat voice notes without matching owner's notes to other chats", () => {
    expect(
      voiceTranscriptionCapability.matches(
        event({
          messageType: "ptt",
          hasMedia: true,
          chatType: "self",
        }),
      ),
    ).toBe(true);
    expect(
      voiceTranscriptionCapability.matches(
        event({
          messageType: "ptt",
          hasMedia: true,
          chatId: "friend@c.us",
          chatType: "direct",
        }),
      ),
    ).toBe(false);
    expect(
      voiceTranscriptionCapability.matches(
        event({
          messageType: "ptt",
          hasMedia: true,
          chatId: "friend@c.us",
          chatType: "direct",
          fromMe: false,
          direction: "incoming",
        }),
      ),
    ).toBe(true);
  });

  it("recognizes !stt and resolves its quoted voice note from recent messages", async () => {
    const quotedVoice = fakeMessage({
      id: { id: "VOICE", _serialized: "false_friend@c.us_VOICE" },
      type: "ptt",
      duration: 8,
      hasMedia: true,
    });
    const getQuotedMessage = vi.fn();
    const command = event({
      body: " !STT ",
      chatId: "friend@c.us",
      chatType: "direct",
      recentMessages: [quotedVoice],
      raw: fakeMessage({
        id: { id: "COMMAND", _serialized: "true_friend@c.us_COMMAND" },
        type: "chat",
        body: "!stt",
        hasQuotedMsg: true,
        rawData: { quotedMsg: { id: { id: "VOICE" }, type: "ptt" } },
        getQuotedMessage,
      }),
    });

    expect(isSttCommand(command.body)).toBe(true);
    expect(voiceTranscriptionCapability.matches(command)).toBe(true);
    await expect(selectQuotedVoiceNote(command)).resolves.toBe(quotedVoice);
    expect(getQuotedMessage).not.toHaveBeenCalled();
  });

  it("resolves a visibly quoted voice note when whatsapp-web.js omits hasQuotedMsg", async () => {
    const quotedVoice = fakeMessage({
      id: { id: "VOICE", _serialized: "false_friend@c.us_VOICE" },
      type: "ptt",
      duration: 14,
      hasMedia: true,
    });
    const otherVoice = fakeMessage({
      id: { id: "OTHER", _serialized: "false_friend@c.us_OTHER" },
      type: "ptt",
      duration: 3,
      hasMedia: true,
    });
    const command = event({
      body: "!stt",
      chatId: "friend@c.us",
      chatType: "direct",
      recentMessages: [quotedVoice, otherVoice],
      raw: fakeMessage({
        id: { id: "COMMAND", _serialized: "true_friend@c.us_COMMAND" },
        type: "chat",
        body: "!stt",
        hasQuotedMsg: false,
        rawData: { quotedStanzaID: "VOICE" },
        getQuotedMessage: vi.fn(),
      }),
    });

    await expect(selectQuotedVoiceNote(command)).resolves.toBe(quotedVoice);
  });

  it("falls back to the most recent observed voice note when quote metadata is missing", async () => {
    const quotedVoice = fakeMessage({
      id: { id: "VOICE", _serialized: "false_friend@c.us_VOICE" },
      type: "ptt",
      duration: 14,
      hasMedia: true,
    });
    const command = event({
      body: "!stt",
      chatId: "friend@c.us",
      chatType: "direct",
      recentMessages: [quotedVoice],
      raw: fakeMessage({
        id: { id: "COMMAND", _serialized: "true_friend@c.us_COMMAND" },
        type: "chat",
        body: "!stt",
        hasQuotedMsg: false,
        rawData: {},
        getQuotedMessage: vi.fn(),
      }),
    });

    await expect(selectQuotedVoiceNote(command)).resolves.toBe(quotedVoice);
  });

  it("loads an older quoted voice note by stanza ID after the recent buffer resets", async () => {
    const quotedVoice = fakeMessage({
      id: { id: "VOICE", _serialized: "true_friend@c.us_VOICE" },
      type: "ptt",
      duration: 14,
      hasMedia: true,
    });
    const getMessageById = vi.fn(async (messageId: string) =>
      messageId === "true_friend@c.us_VOICE" ? quotedVoice : null,
    );
    const command = event({
      body: "!stt",
      chatId: "friend@c.us",
      chatType: "direct",
      recentMessages: [],
      raw: fakeMessage({
        id: { id: "COMMAND", _serialized: "true_friend@c.us_COMMAND" },
        type: "chat",
        body: "!stt",
        hasQuotedMsg: false,
        rawData: { contextInfo: { stanzaId: "VOICE" } },
        client: { getMessageById },
        getQuotedMessage: vi.fn(),
      }),
    });

    await expect(selectQuotedVoiceNote(command)).resolves.toBe(quotedVoice);
    expect(getMessageById).toHaveBeenCalledWith(
      "true_friend@c.us_VOICE",
    );
  });

  it("keeps automatic transcription allowlisted while !stt works owner-only anywhere", () => {
    const { database, cleanup } = temporaryDatabase();
    const configuration = {
      ...voiceTranscriptionCapability.defaults,
      directChatIds: ["friend@c.us"],
    };

    expect(
      isVoiceTranscriptionAuthorized(
        event({
          body: "!stt",
          chatId: "stranger@c.us",
          chatType: "direct",
        }),
        configuration,
        database,
      ),
    ).toBe(true);
    expect(
      isVoiceTranscriptionAuthorized(
        event({
          body: "!stt",
          chatId: "friend@c.us",
          chatType: "direct",
          fromMe: false,
          direction: "incoming",
        }),
        { ...configuration, accessMode: "everyone" },
        database,
      ),
    ).toBe(false);
    expect(
      isVoiceTranscriptionAuthorized(
        event({
          body: "",
          messageType: "ptt",
          hasMedia: true,
          chatId: "friend@c.us",
          chatType: "direct",
          fromMe: false,
          direction: "incoming",
        }),
        configuration,
        database,
      ),
    ).toBe(true);
    expect(
      isVoiceTranscriptionAuthorized(
        event({
          body: "",
          messageType: "ptt",
          hasMedia: true,
          chatId: "stranger@c.us",
          chatType: "direct",
          fromMe: false,
          direction: "incoming",
        }),
        configuration,
        database,
      ),
    ).toBe(false);
    cleanup();
  });
});
