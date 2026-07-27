import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityConfiguration } from "../src/config/types.js";
import { isCapabilityAuthorized } from "../src/capabilities/access.js";
import type { MessistantDatabase } from "../src/persistence/database.js";
import { temporaryDatabase } from "./helpers.js";

describe("capability access", () => {
  let database: MessistantDatabase;
  let cleanup: () => void;

  beforeEach(() => {
    ({ database, cleanup } = temporaryDatabase());
  });

  afterEach(() => cleanup());

  const configuration: CapabilityConfiguration = {
    id: "test",
    enabled: true,
    accessMode: "allowlist",
    groupIds: [],
    directChatIds: ["friend@c.us"],
    settings: {},
  };

  it("keeps self-chat capabilities inside the actual self chat", () => {
    expect(
      isCapabilityAuthorized(
        { ...configuration, accessMode: "self_chat_only" },
        { chatId: "me@c.us", chatType: "self", fromMe: true },
        database,
      ),
    ).toBe(true);
    expect(
      isCapabilityAuthorized(
        { ...configuration, accessMode: "self_chat_only" },
        { chatId: "friend@c.us", chatType: "direct", fromMe: true },
        database,
      ),
    ).toBe(false);
  });

  it("combines reusable groups and per-capability chat IDs", () => {
    database.saveAccessGroup({
      id: "friends",
      name: "Friends",
      chatIds: ["group-friend@c.us"],
    });
    const withGroup = {
      ...configuration,
      groupIds: ["friends"],
    };

    expect(
      isCapabilityAuthorized(
        withGroup,
        { chatId: "friend@c.us", chatType: "direct", fromMe: false },
        database,
      ),
    ).toBe(true);
    expect(
      isCapabilityAuthorized(
        withGroup,
        { chatId: "group-friend@c.us", chatType: "direct", fromMe: false },
        database,
      ),
    ).toBe(true);
    expect(
      isCapabilityAuthorized(
        withGroup,
        { chatId: "stranger@c.us", chatType: "direct", fromMe: false },
        database,
      ),
    ).toBe(false);
  });

  it("allows the owner without opening owner-or-allowlist to strangers", () => {
    const ownerOrAllowlist = {
      ...configuration,
      accessMode: "owner_or_allowlist" as const,
    };
    expect(
      isCapabilityAuthorized(
        ownerOrAllowlist,
        { chatId: "anyone@c.us", chatType: "direct", fromMe: true },
        database,
      ),
    ).toBe(true);
    expect(
      isCapabilityAuthorized(
        ownerOrAllowlist,
        { chatId: "stranger@c.us", chatType: "direct", fromMe: false },
        database,
      ),
    ).toBe(false);
  });
});

