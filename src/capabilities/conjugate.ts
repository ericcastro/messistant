import type { Capability } from "./types.js";

const supportedTenses = new Set([
  "present",
  "past",
  "imperfect",
  "future",
  "imperative",
]);
const supportedPeople = new Set([
  "yo",
  "vos",
  "él",
  "ella",
  "nosotros",
  "ustedes",
  "ellos",
  "ellas",
]);

export interface ConjugateCommand {
  verb: string;
  qualifier: string | null;
}

export function parseConjugateCommand(body: string): ConjugateCommand | null {
  if (body !== "!conj" && !body.startsWith("!conj ")) {
    return null;
  }
  const parts = body.trim().split(/\s+/);
  return {
    verb: parts[1] ?? "",
    qualifier: parts[2]?.toLocaleLowerCase("es") ?? null,
  };
}

export const conjugateCapability: Capability = {
  defaults: {
    id: "conjugate",
    name: "Argentine conjugation",
    description:
      "Conjugates Spanish verbs with vos and ustedes forms for language practice.",
    triggerLabel: "!conj <verb> [tense/person]",
    enabled: true,
    accessMode: "owner_or_allowlist",
    groupIds: [],
    directChatIds: [],
    settings: {},
  },

  matches(event) {
    return parseConjugateCommand(event.body) !== null;
  },

  async execute(event, context) {
    const command = parseConjugateCommand(event.body);
    if (!command?.verb) {
      await event.raw.reply(
        "Usage: !conj <verb> [present|past|imperfect|future|imperative|person]",
      );
      return;
    }

    if (
      command.qualifier &&
      !supportedTenses.has(command.qualifier) &&
      !supportedPeople.has(command.qualifier)
    ) {
      await event.raw.reply(
        `I do not recognize “${command.qualifier}”. Use a supported tense or person.`,
      );
      return;
    }

    const qualifier = command.qualifier
      ? supportedTenses.has(command.qualifier)
        ? `Show the ${command.qualifier} tense.`
        : `Show all common tenses for ${command.qualifier}.`
      : "Show present, preterite, imperfect, future, and imperative.";
    const answer = await context.openAi.generateText({
      instructions: [
        "You are an Argentine Spanish conjugation reference.",
        "Use vos instead of tú and ustedes instead of vosotros.",
        "Be accurate, compact, and format the result for WhatsApp.",
        "Return only the conjugation.",
      ].join(" "),
      prompt: `Conjugate the Spanish verb “${command.verb}”. ${qualifier}`,
      maxOutputTokens: 700,
      idempotencyKey: context.requestKey,
    });

    await event.raw.reply(answer);
  },
};
