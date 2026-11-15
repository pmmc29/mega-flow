import fsp from "node:fs/promises";
import path from "node:path";

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
      audio_format: "mp3",
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

  const buffer = Buffer.from(await audioRes.arrayBuffer());
  await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fsp.writeFile(options.outputPath, buffer);

  console.log(`[ACE-Step] Música guardada en ${options.outputPath} (${buffer.length} bytes)`);
  return { size: buffer.length, taskId };
}
