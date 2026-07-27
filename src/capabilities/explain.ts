import type { Capability } from "./types.js";
import type { NormalizedMessageEvent } from "../whatsapp/types.js";

export interface ExplainCommand {
  offset: number;
  keywords: string | null;
}

export function parseExplainCommand(body: string): ExplainCommand | null {
  if (body !== "!!!" && !body.startsWith("!!! ")) {
    return null;
  }

  const argument = body.slice(3).trim();
  if (!argument) {
    return { offset: -1, keywords: null };
  }
  if (/^-\d+$/.test(argument)) {
    return { offset: Number(argument), keywords: null };
  }
  return { offset: -1, keywords: argument };
}

export async function selectReferenceBody(
  event: NormalizedMessageEvent,
  offset: number,
): Promise<string | null> {
  if (event.raw.hasQuotedMsg) {
    const rawData = event.raw.rawData as unknown as
      | { quotedMsg?: { body?: unknown } }
      | undefined;
    const embeddedBody = rawData?.quotedMsg?.body;
    if (typeof embeddedBody === "string" && embeddedBody.trim()) {
      return embeddedBody;
    }

    try {
      const quoted = await event.raw.getQuotedMessage();
      if (quoted?.body?.trim()) {
        return quoted.body;
      }
    } catch {
      // Recent-message fallback below avoids a brittle page-side chat lookup.
    }
  }

  const candidates = event.recentMessages.filter(
    (message) =>
      message.id._serialized !== event.id && Boolean(message.body?.trim()),
  );
  const reference = candidates.at(offset);
  return reference?.body?.trim() || null;
}

export const explainCapability: Capability = {
  defaults: {
    id: "explain",
    name: "Argentine Spanish explainer",
    description:
      "Explains a quoted or recent message, including Argentine usage and slang.",
    triggerLabel: "!!!",
    enabled: true,
    accessMode: "owner_or_allowlist",
    groupIds: [],
    directChatIds: [],
    settings: {},
  },

  matches(event) {
    return parseExplainCommand(event.body) !== null;
  },

  async execute(event, context) {
    const command = parseExplainCommand(event.body);
    if (!command) {
      return;
    }

    const reference = await selectReferenceBody(event, command.offset);
    if (!reference) {
      await event.raw.reply(
        "I could not find a text message to explain. Reply to one with !!!",
      );
      return;
    }

    const focus = command.keywords
      ? `Focus especially on these words or expressions: ${command.keywords}`
      : "Explain the meaning of the whole message.";
    const explanation = await context.openAi.generateText({
      instructions: [
        "You explain Argentine Spanish clearly to a language learner.",
        "Use voseo where relevant and omit tú and vosotros conjugations.",
        "Mention slang only when it is genuinely present or contextually likely.",
        "Keep the answer concise and immediately useful.",
        "Return only the explanation, formatted for a WhatsApp message.",
      ].join(" "),
      prompt: `${focus}\n\nMessage:\n${reference}`,
      maxOutputTokens: 500,
      idempotencyKey: context.requestKey,
    });

    await event.raw.reply(explanation);
  },
};
