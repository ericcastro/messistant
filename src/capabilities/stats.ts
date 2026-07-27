import { DateTime } from "luxon";
import type { Capability } from "./types.js";

export type StatisticsPeriod = "today" | "week";

export function parseStatsCommand(body: string): StatisticsPeriod | null {
  const normalized = body.trim().toLowerCase();
  if (normalized === "!stats" || normalized === "!stats today") {
    return "today";
  }
  if (normalized === "!stats week") {
    return "week";
  }
  return null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export const statsCapability: Capability = {
  defaults: {
    id: "messaging-stats",
    name: "Messaging statistics",
    description:
      "Reports private daily or weekly activity collected by the live message ledger.",
    triggerLabel: "!stats [today|week]",
    enabled: true,
    accessMode: "self_chat_only",
    groupIds: [],
    directChatIds: [],
    settings: {},
  },

  matches(event) {
    return parseStatsCommand(event.body) !== null;
  },

  async execute(event, context) {
    const period = parseStatsCommand(event.body);
    if (!period) {
      return;
    }

    const timezone = context.settings.getGlobal().timezone;
    const now = DateTime.now().setZone(timezone);
    if (!now.isValid) {
      throw new Error(`Invalid statistics timezone: ${timezone}`);
    }
    const start =
      period === "today" ? now.startOf("day") : now.startOf("week");
    const stats = context.database.getStatistics(
      start.toMillis(),
      now.plus({ seconds: 1 }).toMillis(),
    );

    const heading = period === "today" ? "Today" : "This week";
    const lines = [
      `*${heading} in messages*`,
      `${stats.total} messages · ${stats.incoming} in · ${stats.outgoing} out`,
      `${stats.voiceNotes} voice notes · ${formatDuration(stats.voiceSeconds)}`,
    ];

    if (stats.topChats.length > 0) {
      lines.push("", "*Most active conversations*");
      stats.topChats.slice(0, 5).forEach((chat, index) => {
        lines.push(
          `${index + 1}. ${chat.chatName} — ${chat.count} (${chat.incoming} in / ${chat.outgoing} out)`,
        );
      });
    } else {
      lines.push("", "No conversation activity has been observed yet.");
    }

    await event.raw.reply(lines.join("\n"));
  },
};

