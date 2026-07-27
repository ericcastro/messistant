import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AccessGroup,
  AuthenticatedSession,
  CapabilityConfiguration,
  CapabilityDefaults,
} from "../config/types.js";

interface UserRow {
  username: string;
  password_hash: string;
  must_change_password: number;
}

interface CapabilityRow {
  id: string;
  enabled: number;
  access_mode: CapabilityConfiguration["accessMode"];
  group_ids_json: string;
  direct_chat_ids_json: string;
  settings_json: string;
}

interface AccessGroupRow {
  id: string;
  name: string;
  chat_ids_json: string;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  token_hash: string;
  username: string;
  csrf_token: string;
  must_change_password: number;
  expires_at: number;
}

export interface MessageEventRecord {
  messageId: string;
  occurredAt: number;
  chatId: string;
  chatName: string;
  actorId: string;
  direction: "incoming" | "outgoing";
  chatType: "self" | "direct" | "group" | "broadcast" | "status";
  messageType: string;
  voiceSeconds: number;
}

export interface MessageStatistics {
  total: number;
  incoming: number;
  outgoing: number;
  voiceNotes: number;
  voiceSeconds: number;
  topChats: Array<{
    chatId: string;
    chatName: string;
    count: number;
    incoming: number;
    outgoing: number;
  }>;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseSettings(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class MessistantDatabase {
  readonly #database: Database.Database;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    this.#database = new Database(
      path.join(dataDirectory, "messistant.sqlite"),
    );
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("foreign_keys = ON");
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        chat_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_configs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        access_mode TEXT NOT NULL,
        group_ids_json TEXT NOT NULL,
        direct_chat_ids_json TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_events (
        message_id TEXT NOT NULL PRIMARY KEY,
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

    this.#migrateMessageEventIds();

    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS message_events_time_idx
        ON message_events(occurred_at);
      CREATE INDEX IF NOT EXISTS message_events_chat_time_idx
        ON message_events(chat_id, occurred_at);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx
        ON sessions(expires_at);
    `);
  }

  #migrateMessageEventIds(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(message_events)")
      .all() as Array<{ name: string; notnull: number }>;
    const messageId = columns.find((column) => column.name === "message_id");
    if (!messageId || messageId.notnull === 1) {
      return;
    }

    this.#database.transaction(() => {
      this.#database.exec(`
        ALTER TABLE message_events RENAME TO message_events_legacy;

        CREATE TABLE message_events (
          message_id TEXT NOT NULL PRIMARY KEY,
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

        INSERT OR IGNORE INTO message_events (
          message_id,
          occurred_at,
          chat_id,
          chat_name,
          actor_id,
          direction,
          chat_type,
          message_type,
          voice_seconds,
          observed_at
        )
        SELECT
          message_id,
          occurred_at,
          chat_id,
          chat_name,
          actor_id,
          direction,
          chat_type,
          message_type,
          voice_seconds,
          observed_at
        FROM message_events_legacy
        WHERE message_id IS NOT NULL AND trim(message_id) <> '';

        DROP TABLE message_events_legacy;
      `);
    })();
  }

  close(): void {
    this.#database.close();
  }

  ensureAdmin(passwordHash: string): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO users
          (username, password_hash, must_change_password)
         VALUES ('admin', ?, 1)`,
      )
      .run(passwordHash);
  }

  getUser(username: string): UserRow | undefined {
    return this.#database
      .prepare(
        `SELECT username, password_hash, must_change_password
         FROM users
         WHERE username = ?`,
      )
      .get(username) as UserRow | undefined;
  }

  updatePassword(username: string, passwordHash: string): void {
    this.#database
      .prepare(
        `UPDATE users
         SET password_hash = ?, must_change_password = 0
         WHERE username = ?`,
      )
      .run(passwordHash, username);
    this.#database
      .prepare("DELETE FROM sessions WHERE username = ?")
      .run(username);
  }

  createSession(input: {
    tokenHash: string;
    username: string;
    csrfToken: string;
    createdAt: number;
    expiresAt: number;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO sessions
          (token_hash, username, csrf_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.tokenHash,
        input.username,
        input.csrfToken,
        input.createdAt,
        input.expiresAt,
      );
  }

  getSession(tokenHash: string, now = Date.now()): AuthenticatedSession | null {
    const row = this.#database
      .prepare(
        `SELECT
          sessions.token_hash,
          sessions.username,
          sessions.csrf_token,
          sessions.expires_at,
          users.must_change_password
         FROM sessions
         JOIN users ON users.username = sessions.username
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(tokenHash, now) as SessionRow | undefined;

    return row
      ? {
          tokenHash: row.token_hash,
          username: row.username,
          csrfToken: row.csrf_token,
          mustChangePassword: row.must_change_password === 1,
          expiresAt: row.expires_at,
        }
      : null;
  }

  deleteSession(tokenHash: string): void {
    this.#database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  deleteExpiredSessions(now = Date.now()): void {
    this.#database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(now);
  }

  getSetting(key: string): string | null {
    const row = this.#database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.#database
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  deleteSetting(key: string): void {
    this.#database.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  ensureCapability(defaults: CapabilityDefaults): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO capability_configs
          (
            id,
            enabled,
            access_mode,
            group_ids_json,
            direct_chat_ids_json,
            settings_json,
            updated_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        defaults.id,
        defaults.enabled ? 1 : 0,
        defaults.accessMode,
        JSON.stringify(defaults.groupIds),
        JSON.stringify(defaults.directChatIds),
        JSON.stringify(defaults.settings),
        Date.now(),
      );
  }

  getCapability(id: string): CapabilityConfiguration | null {
    const row = this.#database
      .prepare(
        `SELECT
          id,
          enabled,
          access_mode,
          group_ids_json,
          direct_chat_ids_json,
          settings_json
         FROM capability_configs
         WHERE id = ?`,
      )
      .get(id) as CapabilityRow | undefined;

    return row ? this.#mapCapability(row) : null;
  }

  listCapabilities(): CapabilityConfiguration[] {
    const rows = this.#database
      .prepare(
        `SELECT
          id,
          enabled,
          access_mode,
          group_ids_json,
          direct_chat_ids_json,
          settings_json
         FROM capability_configs
         ORDER BY id`,
      )
      .all() as unknown as CapabilityRow[];
    return rows.map((row) => this.#mapCapability(row));
  }

  #mapCapability(row: CapabilityRow): CapabilityConfiguration {
    return {
      id: row.id,
      enabled: row.enabled === 1,
      accessMode: row.access_mode,
      groupIds: parseStringArray(row.group_ids_json),
      directChatIds: parseStringArray(row.direct_chat_ids_json),
      settings: parseSettings(row.settings_json),
    };
  }

  updateCapability(configuration: CapabilityConfiguration): void {
    this.#database
      .prepare(
        `UPDATE capability_configs SET
          enabled = ?,
          access_mode = ?,
          group_ids_json = ?,
          direct_chat_ids_json = ?,
          settings_json = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        configuration.enabled ? 1 : 0,
        configuration.accessMode,
        JSON.stringify(configuration.groupIds),
        JSON.stringify(configuration.directChatIds),
        JSON.stringify(configuration.settings),
        Date.now(),
        configuration.id,
      );
  }

  listAccessGroups(): AccessGroup[] {
    const rows = this.#database
      .prepare(
        `SELECT id, name, chat_ids_json, created_at, updated_at
         FROM access_groups
         ORDER BY name COLLATE NOCASE`,
      )
      .all() as unknown as AccessGroupRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      chatIds: parseStringArray(row.chat_ids_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveAccessGroup(group: Pick<AccessGroup, "id" | "name" | "chatIds">): void {
    const now = Date.now();
    this.#database
      .prepare(
        `INSERT INTO access_groups
          (id, name, chat_ids_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           chat_ids_json = excluded.chat_ids_json,
           updated_at = excluded.updated_at`,
      )
      .run(group.id, group.name, JSON.stringify(group.chatIds), now, now);
  }

  deleteAccessGroup(id: string): void {
    this.#database.prepare("DELETE FROM access_groups WHERE id = ?").run(id);

    for (const capability of this.listCapabilities()) {
      if (capability.groupIds.includes(id)) {
        this.updateCapability({
          ...capability,
          groupIds: capability.groupIds.filter((groupId) => groupId !== id),
        });
      }
    }
  }

  resolveAllowedChatIds(configuration: CapabilityConfiguration): Set<string> {
    const allowed = new Set(configuration.directChatIds);
    const groupsById = new Map(
      this.listAccessGroups().map((group) => [group.id, group]),
    );

    for (const groupId of configuration.groupIds) {
      for (const chatId of groupsById.get(groupId)?.chatIds ?? []) {
        allowed.add(chatId);
      }
    }

    return allowed;
  }

  recordMessageEvent(event: MessageEventRecord): boolean {
    if (!event.messageId.trim()) {
      throw new Error("Cannot record a message event without an ID.");
    }

    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO message_events
          (
            message_id,
            occurred_at,
            chat_id,
            chat_name,
            actor_id,
            direction,
            chat_type,
            message_type,
            voice_seconds,
            observed_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.messageId,
        event.occurredAt,
        event.chatId,
        event.chatName,
        event.actorId,
        event.direction,
        event.chatType,
        event.messageType,
        event.voiceSeconds,
        Date.now(),
      );

    return Number(result.changes) > 0;
  }

  getStatistics(startAt: number, endAt: number): MessageStatistics {
    const summary = this.#database
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS incoming,
          SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing,
          SUM(CASE WHEN message_type = 'ptt' THEN 1 ELSE 0 END) AS voice_notes,
          SUM(voice_seconds) AS voice_seconds
         FROM message_events
         WHERE occurred_at >= ?
           AND occurred_at < ?
           AND chat_type IN ('direct', 'group')`,
      )
      .get(startAt, endAt) as {
      total: number;
      incoming: number | null;
      outgoing: number | null;
      voice_notes: number | null;
      voice_seconds: number | null;
    };

    const topChats = this.#database
      .prepare(
        `SELECT
          chat_id,
          MAX(chat_name) AS chat_name,
          COUNT(*) AS count,
          SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS incoming,
          SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing
         FROM message_events
         WHERE occurred_at >= ?
           AND occurred_at < ?
           AND chat_type IN ('direct', 'group')
         GROUP BY chat_id
         ORDER BY count DESC, chat_name COLLATE NOCASE
         LIMIT 10`,
      )
      .all(startAt, endAt) as unknown as Array<{
      chat_id: string;
      chat_name: string;
      count: number;
      incoming: number;
      outgoing: number;
    }>;

    return {
      total: Number(summary.total ?? 0),
      incoming: Number(summary.incoming ?? 0),
      outgoing: Number(summary.outgoing ?? 0),
      voiceNotes: Number(summary.voice_notes ?? 0),
      voiceSeconds: Number(summary.voice_seconds ?? 0),
      topChats: topChats.map((chat) => ({
        chatId: chat.chat_id,
        chatName: chat.chat_name || chat.chat_id,
        count: Number(chat.count),
        incoming: Number(chat.incoming),
        outgoing: Number(chat.outgoing),
      })),
    };
  }

  getTotalMessageCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM message_events")
      .get() as { count: number };
    return Number(row.count);
  }

  listObservedChatIds(): string[] {
    const rows = this.#database
      .prepare(
        `SELECT chat_id
         FROM message_events
         WHERE chat_type IN ('self', 'direct', 'group')
         GROUP BY chat_id
         ORDER BY MAX(observed_at) DESC`,
      )
      .all() as unknown as Array<{ chat_id: string }>;
    return rows.map((row) => row.chat_id);
  }

  pruneMessageEvents(before: number): number {
    const result = this.#database
      .prepare("DELETE FROM message_events WHERE occurred_at < ?")
      .run(before);
    return Number(result.changes);
  }
}
