import { z } from "zod";

export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3";
export const GROQ_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

const groqSegmentSchema = z.object({
  id: z.number().optional(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
}).passthrough();

const groqWordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
}).passthrough();

const groqTranscriptionSchema = z.object({
  text: z.string().trim().min(1),
  language: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  segments: z.array(groqSegmentSchema).optional(),
  words: z.array(groqWordSchema).optional(),
  x_groq: z.object({ id: z.string().optional() }).passthrough().optional(),
}).passthrough();

export type GroqTranscription = {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  segments: z.infer<typeof groqSegmentSchema>[];
  words: z.infer<typeof groqWordSchema>[];
  requestId: string | null;
};

export function normalizeGroqTranscription(payload: unknown): GroqTranscription {
  const parsed = groqTranscriptionSchema.parse(payload);
  return {
    text: parsed.text,
    language: parsed.language ?? null,
    durationSeconds: parsed.duration ?? null,
    segments: parsed.segments ?? [],
    words: parsed.words ?? [],
    requestId: parsed.x_groq?.id ?? null,
  };
}

function providerErrorMessage(payload: unknown, status: number) {
  const parsed = z
    .object({ error: z.object({ message: z.string() }).optional() })
    .safeParse(payload);
  const detail = parsed.success ? parsed.data.error?.message : null;
  return detail ? `Groq respondió ${status}: ${detail}` : `Groq respondió con estado ${status}.`;
}

export async function transcribeWithGroq(input: {
  apiKey: string;
  audio: Blob;
  fileName: string;
  signal?: AbortSignal;
}): Promise<GroqTranscription> {
  const form = new FormData();
  form.append("file", input.audio, input.fileName);
  form.append("model", GROQ_TRANSCRIPTION_MODEL);
  form.append("language", "es");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
    signal: input.signal,
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(providerErrorMessage(payload, response.status));
  return normalizeGroqTranscription(payload);
}
