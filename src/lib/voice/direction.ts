import type { VoiceSettings } from "./elevenlabs";

// Turns a script line into an acted read for the voice model: delivery tags from the character, the line's
// expression, whether it's an inner thought, and the writer's `delivery` note. Eleven v3 reads [bracketed] tags as
// performance directions and doesn't speak them.

type Line = { speaker: "uco" | "ocu"; text: string; expression: string; thought_bubble?: boolean; delivery?: string | null; beat?: string };

const TAGS: Record<"uco" | "ocu", Record<string, string[]>> = {
  uco: {
    angry: ["angry", "fast"],
    furious: ["furious", "shouting"],
    excited: ["excited", "energetic"],
    smug: ["smug", "loud"],
    thinking: ["annoyed", "muttering"],
    worried: ["nervous", "fast"],
    calm: ["exasperated"],
    deadpan: ["sarcastic"],
  },
  ocu: {
    deadpan: ["deadpan", "flat"],
    calm: ["calm", "unbothered"],
    worried: ["deadpan", "ominous"],
    smug: ["smug", "dry"],
    thinking: ["dry", "quiet"],
    angry: ["flat", "annoyed"],
    furious: ["flat", "annoyed"],
    excited: ["dry", "mildly amused"],
  },
};

// Uco: expressive and unstable. Ocu: steady and low-energy. (v3 stability: 0 creative, 0.5 natural, 1 robust)
export const DEFAULT_SETTINGS: Record<"uco" | "ocu", VoiceSettings> = {
  uco: { stability: 0.0, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true },
  ocu: { stability: 0.5, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true },
};

export function directLine(line: Line, extra?: string) {
  const tags = [...(TAGS[line.speaker][line.expression] ?? TAGS[line.speaker].calm)];
  if (line.thought_bubble) tags.splice(0, tags.length, "whispers", line.speaker === "uco" ? "annoyed" : "dry");
  const notes = [line.delivery, extra].filter(Boolean).join(", ");
  const head = tags.map((t) => `[${t}]`).join(" ");
  // the writer's note goes in as one more direction tag
  return `${head}${notes ? ` [${notes.replace(/[[\]]/g, "").slice(0, 120)}]` : ""} ${line.text.trim()}`;
}
