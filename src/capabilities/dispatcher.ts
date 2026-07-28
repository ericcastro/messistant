import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { SettingsService } from "../config/settings.js";
import type { OpenAiService } from "../openai/service.js";
import type { MessistantDatabase } from "../persistence/database.js";
import type { NormalizedMessageEvent } from "../whatsapp/types.js";
import { isCapabilityAuthorized } from "./access.js";
import type { Capability } from "./types.js";

export class CapabilityDispatcher {
  static readonly maximumExecutionAgeMs = 2 * 60 * 1000;
  static readonly maximumFutureSkewMs = 5 * 60 * 1000;

  readonly #queues = new Map<string, Promise<void>>();
  #lastPrunedAt = 0;

  constructor(
    readonly capabilities: Capability[],
    readonly database: MessistantDatabase,
    readonly settings: SettingsService,
    readonly openAi: OpenAiService,
    readonly logger: Logger,
  ) {
    for (const capability of capabilities) {
      database.ensureCapability(capability.defaults);
      const current = database.getCapability(capability.defaults.id);
      const migrated =
        current && capability.migrateConfiguration?.(current);
      if (current && migrated && JSON.stringify(current) !== JSON.stringify(migrated)) {
        database.updateCapability(migrated);
      }
    }
  }

  async handle(event: NormalizedMessageEvent): Promise<void> {
    const inserted = this.database.recordMessageEvent({
      messageId: event.id,
      occurredAt: event.occurredAt,
      chatId: event.chatId,
      chatName: event.chatName,
      actorId: event.actorId,
      direction: event.direction,
      chatType: event.chatType,
      messageType: event.messageType,
      voiceSeconds: event.voiceSeconds,
    });

    if (!inserted) {
      return;
    }

    const age = Date.now() - event.occurredAt;
    if (
      age > CapabilityDispatcher.maximumExecutionAgeMs ||
      age < -CapabilityDispatcher.maximumFutureSkewMs
    ) {
      this.logger.debug(
        { messageId: event.id, age },
        "Recorded a replayed message without executing capabilities",
      );
      return;
    }

    this.#pruneIfNeeded();
    const previous = this.#queues.get(event.chatId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#dispatch(event))
      .finally(() => {
        if (this.#queues.get(event.chatId) === current) {
          this.#queues.delete(event.chatId);
        }
      });
    this.#queues.set(event.chatId, current);
    await current;
  }

  async #dispatch(event: NormalizedMessageEvent): Promise<void> {
    for (const capability of this.capabilities) {
      if (!capability.matches(event)) {
        continue;
      }

      const configuration = this.database.getCapability(
        capability.defaults.id,
      );
      const authorized = configuration
        ? capability.authorize
          ? capability.authorize(event, configuration, this.database)
          : isCapabilityAuthorized(configuration, event, this.database)
        : false;
      if (
        !configuration ||
        !authorized
      ) {
        continue;
      }

      try {
        const requestKey = createHash("sha256")
          .update(`${capability.defaults.id}:${event.id}`)
          .digest("hex");
        await capability.execute(event, {
          database: this.database,
          settings: this.settings,
          openAi: this.openAi,
          logger: this.logger,
          configuration,
          requestKey,
        });
      } catch (error) {
        this.logger.error(
          {
            err: error,
            capabilityId: capability.defaults.id,
            messageId: event.id,
          },
          "Capability execution failed",
        );
        try {
          await event.raw.reply(
            "Messistant hit a problem while handling that. Check the admin console.",
          );
        } catch (replyError) {
          this.logger.warn(
            { err: replyError, capabilityId: capability.defaults.id },
            "Could not send capability error reply",
          );
        }
      }
    }
  }

  #pruneIfNeeded(): void {
    const now = Date.now();
    if (now - this.#lastPrunedAt < 24 * 60 * 60 * 1000) {
      return;
    }
    this.#lastPrunedAt = now;
    const retentionDays = this.settings.getGlobal().retentionDays;
    const deleted = this.database.pruneMessageEvents(
      now - retentionDays * 24 * 60 * 60 * 1000,
    );
    const deletedVoiceMarkers = this.database.pruneProcessedVoiceNotes(
      now - retentionDays * 24 * 60 * 60 * 1000,
    );
    if (deleted > 0 || deletedVoiceMarkers > 0) {
      this.logger.info(
        { deleted, deletedVoiceMarkers, retentionDays },
        "Pruned message metadata",
      );
    }
  }
}
