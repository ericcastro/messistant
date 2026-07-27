import path from "node:path";
import QRCode from "qrcode";
import whatsappWeb from "whatsapp-web.js";
import type { Logger } from "pino";
import type { Environment } from "../config/env.js";
import type {
  KnownChat,
  NormalizedMessageEvent,
  WhatsAppStatus,
} from "./types.js";
import { serializeMessageId } from "./message-id.js";

const { Client, LocalAuth } = whatsappWeb;

type MessageHandler = (event: NormalizedMessageEvent) => Promise<void>;

export class WhatsAppService {
  #client: InstanceType<typeof Client> | null = null;
  #handler: MessageHandler | null = null;
  #starting = false;
  #intentionalStop = false;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #chatNames = new Map<string, string>();
  #chatPhoneNumbers = new Map<string, string>();
  #chatTypes = new Map<string, KnownChat["type"]>();
  #recentMessages = new Map<string, whatsappWeb.Message[]>();
  #accountIds = new Set<string>();
  #checkedIdentityIds = new Set<string>();
  #status: WhatsAppStatus = {
    phase: "stopped",
    detail: "WhatsApp has not started.",
    qrDataUrl: null,
    accountId: null,
    updatedAt: Date.now(),
  };

  constructor(
    readonly environment: Environment,
    readonly logger: Logger,
  ) {}

  setMessageHandler(handler: MessageHandler): void {
    this.#handler = handler;
  }

  getStatus(): WhatsAppStatus {
    return { ...this.#status };
  }

  #updateStatus(update: Partial<WhatsAppStatus>): void {
    this.#status = {
      ...this.#status,
      ...update,
      updatedAt: Date.now(),
    };
  }

  async start(): Promise<void> {
    if (this.#starting || this.#status.phase === "ready") {
      return;
    }

    this.#starting = true;
    this.#intentionalStop = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#updateStatus({
      phase: "starting",
      detail: "Starting the WhatsApp Web session…",
      qrDataUrl: null,
    });

    const puppeteerArgs = this.environment.puppeteerNoSandbox
      ? ["--no-sandbox", "--disable-setuid-sandbox"]
      : [];

    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(this.environment.dataDir, "whatsapp-session"),
        clientId: "messistant",
      }),
      puppeteer: {
        headless: true,
        args: puppeteerArgs,
      },
    });
    this.#client = client;

    client.on("qr", (qr: string) => {
      void QRCode.toDataURL(qr, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
      })
        .then((qrDataUrl) => {
          this.#updateStatus({
            phase: "qr_required",
            detail: "Scan this QR code from WhatsApp → Linked devices.",
            qrDataUrl,
          });
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, "Could not render WhatsApp QR");
          this.#updateStatus({
            phase: "error",
            detail: "The WhatsApp QR code could not be rendered.",
          });
        });
    });

    client.on("authenticated", () => {
      this.#updateStatus({
        phase: "authenticated",
        detail: "WhatsApp accepted the linked-device session.",
        qrDataUrl: null,
      });
    });

    client.on("ready", () => {
      void this.#onReady(client);
    });

    client.on("auth_failure", (message: string) => {
      this.#starting = false;
      this.#updateStatus({
        phase: "error",
        detail: `WhatsApp authentication failed: ${message}`,
        qrDataUrl: null,
      });
      this.logger.error({ message }, "WhatsApp authentication failed");
    });

    client.on("disconnected", (reason: string) => {
      this.#starting = false;
      this.#updateStatus({
        phase: "disconnected",
        detail: `WhatsApp disconnected: ${reason}`,
        qrDataUrl: null,
      });
      this.logger.warn({ reason }, "WhatsApp disconnected");
      this.#scheduleReconnect();
    });

    client.on("message_create", (message) => {
      void this.#onMessage(message).catch((error: unknown) => {
        this.logger.error({ err: error }, "Message normalization failed");
      });
    });

    try {
      await client.initialize();
    } catch (error) {
      this.#starting = false;
      this.#updateStatus({
        phase: "error",
        detail:
          error instanceof Error
            ? error.message
            : "WhatsApp failed to initialize.",
        qrDataUrl: null,
      });
      this.logger.error({ err: error }, "WhatsApp initialization failed");
    }
  }

  async reconnect(): Promise<void> {
    this.#intentionalStop = false;
    await this.#destroyClient();
    await this.start();
  }

  async unlink(): Promise<void> {
    this.#intentionalStop = false;
    if (this.#client) {
      try {
        await this.#client.logout();
      } catch (error) {
        this.logger.warn(
          { err: error },
          "WhatsApp logout failed; restarting session",
        );
      }
    }
    await this.#destroyClient();
    await this.start();
  }

  async stop(): Promise<void> {
    this.#intentionalStop = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    await this.#destroyClient();
    this.#updateStatus({
      phase: "stopped",
      detail: "WhatsApp is stopped.",
      qrDataUrl: null,
    });
  }

  #scheduleReconnect(): void {
    if (this.#intentionalStop || this.#reconnectTimer) {
      return;
    }
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#intentionalStop && this.#status.phase === "disconnected") {
        this.logger.info("Attempting automatic WhatsApp reconnect");
        void this.reconnect();
      }
    }, 10_000);
    this.#reconnectTimer.unref();
  }

  async #destroyClient(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#starting = false;
    if (client) {
      try {
        await client.destroy();
      } catch (error) {
        this.logger.warn({ err: error }, "WhatsApp client teardown failed");
      }
    }
  }

  async #onReady(client: InstanceType<typeof Client>): Promise<void> {
    const accountId = client.info?.wid?._serialized ?? null;
    this.#accountIds.clear();
    this.#checkedIdentityIds.clear();
    if (accountId) {
      this.#accountIds.add(accountId);
      try {
        const identities = await client.getContactLidAndPhone([accountId]);
        for (const identity of identities) {
          if (identity.lid) this.#accountIds.add(identity.lid);
          if (identity.pn) this.#accountIds.add(identity.pn);
        }
      } catch (error) {
        this.logger.warn(
          { err: error, accountId },
          "Could not resolve the account's WhatsApp LID",
        );
      }
    }

    this.#updateStatus({
      phase: "ready",
      detail: "WhatsApp is connected and observing messages.",
      qrDataUrl: null,
      accountId,
    });
    this.#starting = false;
    this.logger.info(
      { accountId, accountAliases: [...this.#accountIds] },
      "WhatsApp client ready",
    );
  }

  async #identifySelfLid(chatId: string, accountId: string): Promise<void> {
    if (
      !this.#client ||
      !accountId ||
      !chatId.endsWith("@lid") ||
      this.#accountIds.has(chatId) ||
      this.#checkedIdentityIds.has(chatId)
    ) {
      return;
    }
    this.#checkedIdentityIds.add(chatId);

    try {
      const identities = await this.#client.getContactLidAndPhone([chatId]);
      const belongsToAccount = identities.some(
        (identity) =>
          this.#accountIds.has(identity.lid) ||
          this.#accountIds.has(identity.pn),
      );
      if (belongsToAccount) {
        this.#accountIds.add(chatId);
        for (const identity of identities) {
          if (identity.lid) this.#accountIds.add(identity.lid);
          if (identity.pn) this.#accountIds.add(identity.pn);
        }
      }
    } catch (error) {
      this.logger.debug(
        { err: error, chatId },
        "Could not resolve a WhatsApp LID while classifying a chat",
      );
    }
  }

  async #onMessage(message: whatsappWeb.Message): Promise<void> {
    if (!this.#handler) {
      return;
    }

    const accountId =
      this.#client?.info?.wid?._serialized ?? this.#status.accountId ?? "";
    const chatId = message.fromMe ? message.to : message.from;
    const timestamp = Number(message.timestamp);
    const occurredAt =
      Number.isFinite(timestamp) && timestamp > 0
        ? timestamp * 1000
        : Date.now();
    if (message.fromMe && Math.abs(Date.now() - occurredAt) < 5 * 60 * 1000) {
      await this.#identifySelfLid(chatId, accountId);
    }
    const messageId = serializeMessageId(message, chatId);
    if (!message.id._serialized) {
      message.id._serialized = messageId;
    }
    const chatType =
      this.#accountIds.has(chatId)
        ? "self"
        : chatId === "status@broadcast"
          ? "status"
          : chatId.endsWith("@g.us")
            ? "group"
            : chatId.endsWith("@broadcast")
              ? "broadcast"
              : "direct";
    const actorId = message.fromMe
      ? accountId
      : (message.author ?? message.from);

    let chatName =
      chatType === "self" ? "You" : this.#chatNames.get(chatId);
    if (!chatName) {
      try {
        const chat = await message.getChat();
        chatName = chat.name || chatId.replace(/@.+$/, "");
      } catch {
        chatName = chatId.replace(/@.+$/, "");
      }
      this.#chatNames.set(chatId, chatName);
    }
    if (chatType === "self") {
      chatName = "You";
      this.#chatNames.set(chatId, chatName);
    }
    if (
      chatType === "self" ||
      chatType === "direct" ||
      chatType === "group"
    ) {
      this.#chatTypes.set(chatId, chatType);
    }

    const recentMessages = [...(this.#recentMessages.get(chatId) ?? [])];
    this.#recentMessages.delete(chatId);
    this.#recentMessages.set(
      chatId,
      [...recentMessages, message].slice(-60),
    );
    if (this.#recentMessages.size > 200) {
      const oldestChatId = this.#recentMessages.keys().next().value;
      if (oldestChatId) this.#recentMessages.delete(oldestChatId);
    }

    await this.#handler({
      id: messageId,
      occurredAt,
      body: message.body ?? "",
      chatId,
      chatName,
      actorId,
      accountId,
      direction: message.fromMe ? "outgoing" : "incoming",
      chatType,
      fromMe: message.fromMe,
      messageType: message.type,
      voiceSeconds: Number(message.duration ?? 0),
      hasMedia: message.hasMedia,
      recentMessages,
      raw: message,
    });
  }

  #cachedChats(additionalIds: string[] = []): KnownChat[] {
    const chatTypes = new Map(this.#chatTypes);
    for (const id of additionalIds) {
      if (
        id &&
        !chatTypes.has(id) &&
        !id.endsWith("@broadcast") &&
        id !== "status@broadcast"
      ) {
        chatTypes.set(
          id,
          this.#accountIds.has(id)
            ? "self"
            : id.endsWith("@g.us")
              ? "group"
              : "direct",
        );
      }
    }
    return [...chatTypes]
      .map(([id, type]) => {
        const phoneNumber = this.#chatPhoneNumbers.get(id);
        return {
          id,
          name:
            type === "self"
              ? "You (self chat)"
              : (this.#chatNames.get(id) ?? id.replace(/@.+$/, "")),
          ...(phoneNumber ? { phoneNumber } : {}),
          type,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listChats(additionalIds: string[] = []): Promise<KnownChat[]> {
    if (!this.#client || this.#status.phase !== "ready") {
      return this.#cachedChats(additionalIds);
    }

    let chats: whatsappWeb.Chat[] = [];
    try {
      chats = await this.#client.getChats();
    } catch (error) {
      this.logger.warn({ err: error }, "Could not load WhatsApp chats");
    }
    const chatSources = chats
      .filter((chat) => !chat.id._serialized.endsWith("@broadcast"))
      .map((chat) => ({
        id: chat.id._serialized,
        isGroup: chat.isGroup,
        name: chat.name,
      }));
    const liveIds = new Set(chatSources.map((chat) => chat.id));
    for (const id of additionalIds) {
      if (
        id &&
        !liveIds.has(id) &&
        !id.endsWith("@broadcast") &&
        id !== "status@broadcast"
      ) {
        chatSources.push({
          id,
          isGroup: id.endsWith("@g.us"),
          name: "",
        });
        liveIds.add(id);
      }
    }

    const directIds = chatSources
      .filter(
        (chat) =>
          !chat.isGroup &&
          !this.#accountIds.has(chat.id),
      )
      .map((chat) => chat.id);
    const phoneIdsByLid = new Map<string, string>();
    try {
      const identities =
        await this.#client.getContactLidAndPhone(directIds);
      for (const identity of identities) {
        if (identity.lid && identity.pn) {
          phoneIdsByLid.set(identity.lid, identity.pn);
        }
      }
    } catch (error) {
      this.logger.debug(
        { err: error },
        "Could not resolve WhatsApp LIDs to phone identities",
      );
    }

    const contactsById = new Map<string, whatsappWeb.Contact>();
    try {
      const contacts = await this.#client.getContacts();
      for (const contact of contacts) {
        contactsById.set(contact.id._serialized, contact);
      }
    } catch (error) {
      this.logger.debug(
        { err: error },
        "Could not load WhatsApp contact names",
      );
    }

    return chatSources
      .map((chat) => {
          const id = chat.id;
          const isSelf = this.#accountIds.has(id);
          const type = isSelf ? "self" : chat.isGroup ? "group" : "direct";
          const phoneId =
            type === "direct"
              ? phoneIdsByLid.get(id) ??
                (id.endsWith("@c.us") ? id : undefined)
              : undefined;
          const contact = phoneId
            ? contactsById.get(phoneId)
            : contactsById.get(id);
          const phoneDigits = phoneId?.replace(/@.+$/, "");
          const phoneNumber = phoneDigits ? `+${phoneDigits}` : undefined;
          const internalLabels = new Set(
            [id, id.replace(/@.+$/, ""), phoneId, phoneDigits].filter(
              (value): value is string => Boolean(value),
            ),
          );
          const contactName = [
            contact?.name,
            contact?.shortName,
            contact?.verifiedName,
            contact?.pushname,
            chat.name,
          ]
            .map((value) => value?.trim())
            .find(
              (value): value is string =>
                Boolean(value) &&
                !internalLabels.has(value as string) &&
                !/^\d{8,}$/.test(value as string),
            );
          const name = isSelf
            ? "You (self chat)"
            : contactName ||
              phoneNumber ||
              chat.name ||
              id.replace(/@.+$/, "");
          this.#chatNames.set(id, name);
          this.#chatTypes.set(id, type);
          if (phoneNumber) {
            this.#chatPhoneNumbers.set(id, phoneNumber);
          }
          return {
            id,
            name,
            ...(phoneNumber && phoneNumber !== name ? { phoneNumber } : {}),
            type,
          } satisfies KnownChat;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}
