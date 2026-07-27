import OpenAI, { toFile } from "openai";
import type { SettingsService } from "../config/settings.js";

export class OpenAiService {
  #client: OpenAI | null = null;
  #clientKey: string | null = null;

  constructor(readonly settings: SettingsService) {}

  isConfigured(): boolean {
    return Boolean(this.settings.getOpenAiApiKey());
  }

  #getClient(): OpenAI {
    const apiKey = this.settings.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error(
        "OpenAI is not configured. Add an API key in the admin console.",
      );
    }

    if (!this.#client || this.#clientKey !== apiKey) {
      this.#client = new OpenAI({ apiKey });
      this.#clientKey = apiKey;
    }

    return this.#client;
  }

  async generateText(input: {
    instructions: string;
    prompt: string;
    model?: string;
    maxOutputTokens?: number;
    idempotencyKey?: string;
  }): Promise<string> {
    const client = this.#getClient();
    const response = await client.responses.create(
      {
        model: input.model ?? this.settings.getGlobal().textModel,
        instructions: input.instructions,
        input: input.prompt,
        max_output_tokens: input.maxOutputTokens ?? 600,
      },
      input.idempotencyKey
        ? { headers: { "Idempotency-Key": input.idempotencyKey } }
        : undefined,
    );

    const output = response.output_text.trim();
    if (!output) {
      throw new Error("OpenAI returned an empty response.");
    }
    return output;
  }

  async transcribe(input: {
    audio: Buffer;
    filename: string;
    mimeType: string;
    model?: string;
    language?: string;
    prompt?: string;
    idempotencyKey?: string;
  }): Promise<string> {
    const client = this.#getClient();
    const file = await toFile(input.audio, input.filename, {
      type: input.mimeType,
    });
    const response = await client.audio.transcriptions.create(
      {
        file,
        model: input.model ?? this.settings.getGlobal().transcriptionModel,
        ...(input.language ? { language: input.language } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
      },
      input.idempotencyKey
        ? { headers: { "Idempotency-Key": input.idempotencyKey } }
        : undefined,
    );

    const transcription = response.text.trim();
    if (!transcription) {
      throw new Error("OpenAI returned an empty transcription.");
    }
    return transcription;
  }
}
