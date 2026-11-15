import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { MODELS, PATHS } from "../config/styleConfig.js";
import type { TranscriptionResult, WordTimestamp } from "../types/pipeline.js";

export async function transcribeVoiceover(
  audioPath: string = PATHS.voiceover,
  outputPath: string = PATHS.timestamps,
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno OPENAI_API_KEY.");
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`No se encontró el archivo de audio en: ${audioPath}`);
  }

  const openai = new OpenAI({ apiKey });

  console.log(`[Transcriber] Enviando audio a Whisper (${MODELS.transcriber})...`);

  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: MODELS.transcriber,
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const rawWords = response.words ?? [];
  const words: WordTimestamp[] = rawWords.map((item) => ({
    word: item.word,
    start: Number(item.start.toFixed(3)),
    end: Number(item.end.toFixed(3)),
  }));

  const duration =
    typeof response.duration === "number"
      ? Number(response.duration.toFixed(3))
      : words.length > 0
        ? words[words.length - 1].end
        : 0;

  const result: TranscriptionResult = {
    duration,
    words,
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(
    `[Transcriber] Transcripción completada (${words.length} palabras, ${duration}s) -> ${outputPath}`,
  );

  return result;
}
