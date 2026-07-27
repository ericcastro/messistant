import { conjugateCapability } from "./conjugate.js";
import { explainCapability } from "./explain.js";
import { statsCapability } from "./stats.js";
import type { Capability } from "./types.js";
import { voiceTranscriptionCapability } from "./voice-transcription.js";

export const capabilities: Capability[] = [
  explainCapability,
  conjugateCapability,
  voiceTranscriptionCapability,
  statsCapability,
];

