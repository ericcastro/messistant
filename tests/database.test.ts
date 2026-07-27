import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessistantDatabase } from "../src/persistence/database.js";
import { temporaryDatabase } from "./helpers.js";

describe("message ledger", () => {
  let database: MessistantDatabase;
  let cleanup: () => void;

  beforeEach(() => {
    ({ database, cleanup } = temporaryDatabase());
  });

  afterEach(() => cleanup());

  it("deduplicates events and calculates activity statistics", () => {
    const start = Date.now();
    const event = {
      messageId: "message-1",
      occurredAt: start + 100,
      chatId: "friend@c.us",
      chatName: "Friend",
      actorId: "friend@c.us",
      direction: "incoming" as const,
      chatType: "direct" as const,
      messageType: "ptt",
      voiceSeconds: 42,
    };

    expect(database.recordMessageEvent(event)).toBe(true);
    expect(database.recordMessageEvent(event)).toBe(false);
    expect(
      database.recordMessageEvent({
        ...event,
        messageId: "message-2",
        direction: "outgoing",
        messageType: "chat",
        voiceSeconds: 0,
      }),
    ).toBe(true);

    const stats = database.getStatistics(start, start + 1000);
    expect(stats).toMatchObject({
      total: 2,
      incoming: 1,
      outgoing: 1,
      voiceNotes: 1,
      voiceSeconds: 42,
    });
    expect(stats.topChats[0]).toMatchObject({
      chatName: "Friend",
      count: 2,
    });
    expect(database.listObservedChatIds()).toEqual(["friend@c.us"]);
  });

  it("migrates the legacy nullable message ID ledger without retaining corrupt rows", () => {
    cleanup();
    const directory = mkdtempSync(path.join(tmpdir(), "messistant-legacy-"));
    const legacy = new Database(path.join(directory, "messistant.sqlite"));
    legacy.exec(`
      CREATE TABLE message_events (
        message_id TEXT PRIMARY KEY,
        occurred_at INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        message_type TEXT NOT NULL,
        voice_seconds INTEGER NOT NULL DEFAULT 0,
        observed_at INTEGER NOT NULL
      );
    `);
    const insert = legacy.prepare(`
      INSERT INTO message_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const values = [
      Date.now(),
      "friend@c.us",
      "Friend",
      "friend@c.us",
      "incoming",
      "direct",
      "chat",
      0,
      Date.now(),
    ] as const;
    insert.run(null, ...values);
    insert.run(null, ...values);
    insert.run("valid-message", ...values);
    legacy.close();

    database = new MessistantDatabase(directory);
    cleanup = () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    };

    expect(database.getTotalMessageCount()).toBe(1);
    expect(
      database.recordMessageEvent({
        messageId: "valid-message",
        occurredAt: values[0],
        chatId: values[1],
        chatName: values[2],
        actorId: values[3],
        direction: values[4],
        chatType: values[5],
        messageType: values[6],
        voiceSeconds: values[7],
      }),
    ).toBe(false);
  });
});
