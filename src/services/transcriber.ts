import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import ffmpegStatic from "ffmpeg-static";
import OpenAI from "openai";
import { MODELS, PATHS } from "../config/styleConfig.js";
import type { TranscriptionResult, WordTimestamp } from "../types/pipeline.js";

const SAMPLE_RATE = 16000;

let cachedPipeline: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getLocalWhisperPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!cachedPipeline) {
    console.log(
      `[Transcriber] Cargando modelo local Whisper (${MODELS.localWhisper})... (la primera vez descarga el modelo en caché)`,
    );
    cachedPipeline = pipeline("automatic-speech-recognition", MODELS.localWhisper, {
      dtype: "q8",
    });
  }
  return cachedPipeline;
}

function decodeAudioToFloat32(audioPath: string): Promise<Float32Array> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin) {
    throw new Error("No se encontró el binario de ffmpeg-static.");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, [
      "-i",
      audioPath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg falló (código ${code}): ${stderr.slice(-400)}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const floatArray = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        Math.floor(buffer.byteLength / 4),
      );
      resolve(floatArray);
    });
  });
}

async function transcribeWithLocalWhisper(audioPath: string): Promise<TranscriptionResult> {
  console.log(`[Transcriber] Decodificando audio local con ffmpeg...`);
  const audioData = await decodeAudioToFloat32(audioPath);
  const duration = Number((audioData.length / SAMPLE_RATE).toFixed(3));

  const asr = await getLocalWhisperPipeline();
  const language = process.env.WHISPER_LANGUAGE || "spanish";

  console.log(`[Transcriber] Transcribiendo localmente (${duration}s, idioma: ${language})...`);

  const output = await asr(audioData, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    language,
    task: "transcribe",
  });

  const singleOutput = Array.isArray(output) ? output[0] : output;
  const rawChunks = (singleOutput as { chunks?: Array<{ text: string; timestamp: [number, number | null] }> }).chunks ?? [];

  const words: WordTimestamp[] = rawChunks
    .map((chunk) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? start + 0.2;
      return {
        word: chunk.text.trim(),
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
      };
    })
    .filter((w) => w.word.length > 0);

  return { duration, words };
}

async function transcribeWithOpenAI(audioPath: string): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno OPENAI_API_KEY.");
  }

  const openai = new OpenAI({ apiKey });
  console.log(`[Transcriber] Enviando audio a OpenAI Whisper (${MODELS.transcriber})...`);

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

  return { duration, words };
}

function normalizeToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function tokenSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeToken(aRaw);
  const b = normalizeToken(bRaw);
  if (!a || !b) return -1.0;
  if (a === b) return 2.2;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    return 1.3;
  }

  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  const dist = dp[n];
  const ratio = 1 - dist / Math.max(m, n, 1);
  return ratio >= 0.55 ? ratio * 1.4 : -1.1;
}

export function alignWhisperWithScript(
  whisperWords: WordTimestamp[],
  scriptText: string,
  totalDuration: number,
): WordTimestamp[] {
  const scriptTokens = scriptText.trim().split(/\s+/).filter(Boolean);
  if (scriptTokens.length === 0 || whisperWords.length === 0) {
    return whisperWords;
  }

  const ratio = scriptTokens.length / whisperWords.length;
  if (ratio < 0.55 || ratio > 1.85) {
    return whisperWords;
  }

  const N = scriptTokens.length;
  const M = whisperWords.length;
  const GAP = -0.75;

  const dp: Float64Array[] = Array.from({ length: N + 1 }, () => new Float64Array(M + 1));
  const move: Uint8Array[] = Array.from({ length: N + 1 }, () => new Uint8Array(M + 1));
  // move: 1 = diag, 2 = up (skip script), 3 = left (skip whisper)

  for (let i = 1; i <= N; i++) {
    dp[i][0] = i * GAP;
    move[i][0] = 2;
  }
  for (let j = 1; j <= M; j++) {
    dp[0][j] = j * GAP;
    move[0][j] = 3;
  }

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const diag = dp[i - 1][j - 1] + tokenSimilarity(scriptTokens[i - 1], whisperWords[j - 1].word);
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;

      if (diag >= up && diag >= left) {
        dp[i][j] = diag;
        move[i][j] = 1;
      } else if (up >= left) {
        dp[i][j] = up;
        move[i][j] = 2;
      } else {
        dp[i][j] = left;
        move[i][j] = 3;
      }
    }
  }

  const matchedWhisperIdx = new Array<number | null>(N).fill(null);
  let i = N;
  let j = M;
  while (i > 0 || j > 0) {
    const dir = move[i][j];
    if (i > 0 && j > 0 && dir === 1) {
      matchedWhisperIdx[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || dir === 2)) {
      i--;
    } else {
      j--;
    }
  }

  const result: WordTimestamp[] = new Array(N);
  let idx = 0;
  while (idx < N) {
    const wIdx = matchedWhisperIdx[idx];
    if (wIdx !== null) {
      const w = whisperWords[wIdx];
      result[idx] = {
        word: scriptTokens[idx],
        start: w.start,
        end: w.end,
      };
      idx++;
      continue;
    }

    const runStart = idx;
    while (idx < N && matchedWhisperIdx[idx] === null) {
      idx++;
    }
    const runEnd = idx - 1;

    const prevTime =
      runStart > 0
        ? result[runStart - 1].end
        : whisperWords[0].start;
    const nextWIdx = idx < N ? matchedWhisperIdx[idx] : null;
    const nextTime =
      nextWIdx !== null
        ? whisperWords[nextWIdx].start
        : Math.max(prevTime + 0.3, totalDuration || whisperWords[M - 1].end);

    const span = Math.max(0.15 * (runEnd - runStart + 1), nextTime - prevTime);
    const weights = [];
    let sumW = 0;
    for (let k = runStart; k <= runEnd; k++) {
      const w = Math.max(2, normalizeToken(scriptTokens[k]).length || 2);
      weights.push(w);
      sumW += w;
    }
    let cursor = prevTime;
    for (let k = runStart; k <= runEnd; k++) {
      const dur = (weights[k - runStart] / sumW) * span;
      const start = Number(cursor.toFixed(3));
      cursor += dur;
      const end = Number(Math.max(start + 0.06, cursor).toFixed(3));
      result[k] = { word: scriptTokens[k], start, end };
    }
  }

  return result;
}

export async function transcribeVoiceover(
  audioPath: string = PATHS.voiceover,
  outputPath: string = PATHS.timestamps,
  scriptPath?: string,
): Promise<TranscriptionResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`No se encontró el archivo de audio en: ${audioPath}`);
  }

  const provider = process.env.TRANSCRIBER_PROVIDER === "openai" ? "openai" : "local";
  const rawResult =
    provider === "openai"
      ? await transcribeWithOpenAI(audioPath)
      : await transcribeWithLocalWhisper(audioPath);

  let finalWords = rawResult.words;
  if (scriptPath && fs.existsSync(scriptPath)) {
    const scriptText = await fsp.readFile(scriptPath, "utf-8");
    const aligned = alignWhisperWithScript(rawResult.words, scriptText, rawResult.duration);
    if (aligned !== rawResult.words) {
      finalWords = aligned;
      console.log(
        `[Transcriber] Ortografía alineada con el guion limpio (${finalWords.length} palabras).`,
      );
    }
  }

  const result: TranscriptionResult = {
    duration: rawResult.duration,
    words: finalWords,
    source: "whisper",
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(
    `[Transcriber] Transcripción completada (${result.words.length} palabras, ${result.duration}s) -> ${outputPath}`,
  );

  return result;
}

export async function generateEstimatedTimestampsFromScript(
  scriptPath: string = PATHS.script,
  storyboardPath: string = PATHS.storyboard,
  outputPath: string = PATHS.timestamps,
  fallbackDurationSeconds?: number,
): Promise<TranscriptionResult> {
  const scriptText = fs.existsSync(scriptPath)
    ? await fsp.readFile(scriptPath, "utf-8")
    : "";
  const tokens = scriptText.trim().split(/\s+/).filter(Boolean);

  let totalDuration = 0;
  if (fs.existsSync(storyboardPath)) {
    try {
      const sb = JSON.parse(await fsp.readFile(storyboardPath, "utf-8")) as {
        scenes?: Array<{ end?: number }>;
      };
      const lastEnd = sb.scenes?.length ? sb.scenes[sb.scenes.length - 1]?.end : 0;
      if (typeof lastEnd === "number" && Number.isFinite(lastEnd) && lastEnd > 0) {
        totalDuration = lastEnd;
      }
    } catch {
      // ignore invalid storyboard
    }
  }

  if (totalDuration <= 0 && fallbackDurationSeconds && fallbackDurationSeconds > 0) {
    totalDuration = fallbackDurationSeconds;
  }

  if (totalDuration <= 0) {
    totalDuration = Math.max(5, Number((tokens.length / 2.5).toFixed(3)));
  }

  if (tokens.length === 0) {
    const emptyResult: TranscriptionResult = {
      duration: Number(totalDuration.toFixed(3)),
      words: [],
      source: "estimated",
    };
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, JSON.stringify(emptyResult, null, 2), "utf-8");
    return emptyResult;
  }

  const weights = tokens.map((token) => {
    const cleanLen = token.replace(/[^\p{L}\p{N}]/gu, "").length || 1;
    const pause = /[.!?…]+$/.test(token) ? 3.2 : /[,;:]+$/.test(token) ? 1.6 : 0;
    return Math.max(2, cleanLen) + pause;
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || tokens.length;

  const leadIn = totalDuration > 3 ? 0.15 : 0;
  const tailOut = totalDuration > 3 ? 0.15 : 0;
  const usableDuration = Math.max(0.5, totalDuration - leadIn - tailOut);

  let cursor = leadIn;
  const words: WordTimestamp[] = tokens.map((token, idx) => {
    const slot = (weights[idx] / totalWeight) * usableDuration;
    const start = Number(cursor.toFixed(3));
    cursor += slot;
    const end = Number(Math.max(start + 0.08, cursor).toFixed(3));
    return { word: token, start, end };
  });

  const result: TranscriptionResult = {
    duration: Number(totalDuration.toFixed(3)),
    words,
    source: "estimated",
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(
    `[Transcriber] Timestamps estándar del guion (${result.words.length} palabras, ${result.duration}s) -> ${outputPath}`,
  );

  return result;
}
