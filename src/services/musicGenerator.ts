import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const DEFAULT_ACESTEP_URL = "http://127.0.0.1:8001";

export function getAceStepUrl(): string {
  return (process.env.ACESTEP_API_URL || DEFAULT_ACESTEP_URL).replace(/\/+$/, "");
}

function getAuthHeaders(): Record<string, string> {
  const apiKey = process.env.ACESTEP_API_KEY?.trim();
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

export interface AceStepHealth {
  available: boolean;
  url: string;
  error?: string;
}

export async function checkAceStepHealth(): Promise<AceStepHealth> {
  const url = getAceStepUrl();
  try {
    const res = await fetch(`${url}/health`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(1800),
    });
    if (!res.ok) {
      return { available: false, url, error: `HTTP ${res.status}` };
    }
    return { available: true, url };
  } catch (err) {
    return {
      available: false,
      url,
      error: err instanceof Error ? err.message : "Sin conexión",
    };
  }
}

export interface GenerateAceStepMusicOptions {
  prompt: string;
  durationSeconds: number;
  outputPath: string;
}

interface AceStepEnvelope<T> {
  data: T;
  code: number;
  error: string | null;
}

interface ReleaseTaskData {
  task_id: string;
  status: string;
}

interface QueryResultItem {
  task_id: string;
  status: number; // 0 = queued/running, 1 = succeeded, 2 = failed
  result?: string | Array<{ file?: string; status?: number }>;
}

function convertWavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin) {
    throw new Error("No se encontró el binario de ffmpeg-static.");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, [
      "-y",
      "-i",
      wavPath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      mp3Path,
    ]);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg falló al convertir WAV a MP3 (${code}): ${stderr}`));
      }
    });
  });
}

export async function getAudioDurationSeconds(audioPath: string): Promise<number | null> {
  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin) return null;

  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, ["-i", audioPath]);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const total = hours * 3600 + minutes * 60 + seconds;
      resolve(Number.isFinite(total) && total > 0 ? total : null);
    });
  });
}

export async function generateAceStepMusic(
  options: GenerateAceStepMusicOptions,
): Promise<{ size: number; taskId: string }> {
  const baseUrl = getAceStepUrl();
  const duration = Math.max(10, Math.min(600, Math.round(options.durationSeconds || 45)));

  console.log(`[ACE-Step] Enviando tarea (${duration}s) a ${baseUrl}...`);
  const releaseRes = await fetch(`${baseUrl}/release_task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      prompt: options.prompt,
      lyrics: "[inst]",
      audio_duration: duration,
      audio_format: "wav",
      batch_size: 1,
      inference_steps: 8,
      thinking: true,
    }),
  });

  if (!releaseRes.ok) {
    const text = await releaseRes.text().catch(() => "");
    throw new Error(`ACE-Step /release_task falló (${releaseRes.status}): ${text}`);
  }

  const releaseJson = (await releaseRes.json()) as AceStepEnvelope<ReleaseTaskData>;
  const taskId = releaseJson?.data?.task_id;
  if (!taskId) {
    throw new Error(releaseJson?.error || "ACE-Step no devolvió un task_id.");
  }

  console.log(`[ACE-Step] Tarea en cola: ${taskId}`);
  const deadline = Date.now() + 3 * 60 * 1000;
  let filePathUrl = "";

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const queryRes = await fetch(`${baseUrl}/query_result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ task_id_list: [taskId] }),
    });

    if (!queryRes.ok) {
      throw new Error(`ACE-Step /query_result falló (${queryRes.status})`);
    }

    const queryJson = (await queryRes.json()) as AceStepEnvelope<QueryResultItem[]>;
    const item = queryJson?.data?.[0];
    if (!item) continue;

    if (item.status === 2) {
      throw new Error("ACE-Step reportó un fallo al generar la música.");
    }

    if (item.status === 1) {
      const parsedResult =
        typeof item.result === "string"
          ? (JSON.parse(item.result) as Array<{ file?: string }>)
          : item.result;

      filePathUrl = parsedResult?.[0]?.file || "";
      if (!filePathUrl) {
        throw new Error("ACE-Step completó la tarea pero no devolvió la ruta del audio.");
      }
      break;
    }
  }

  if (!filePathUrl) {
    throw new Error("Tiempo de espera agotado esperando la generación en ACE-Step.");
  }

  const downloadUrl = filePathUrl.startsWith("http")
    ? filePathUrl
    : `${baseUrl}${filePathUrl.startsWith("/") ? "" : "/"}${filePathUrl}`;

  const audioRes = await fetch(downloadUrl, { headers: getAuthHeaders() });
  if (!audioRes.ok) {
    throw new Error(`No se pudo descargar el audio desde ACE-Step (${audioRes.status}).`);
  }

  const wavBuffer = Buffer.from(await audioRes.arrayBuffer());
  await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mega-acestep-"));
  const tmpWav = path.join(tmpDir, "track.wav");
  try {
    await fsp.writeFile(tmpWav, wavBuffer);
    await convertWavToMp3(tmpWav, options.outputPath);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  const stat = await fsp.stat(options.outputPath);
  console.log(`[ACE-Step] Música guardada en ${options.outputPath} (${stat.size} bytes)`);
  return { size: stat.size, taskId };
}
