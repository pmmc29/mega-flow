import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { PATHS } from "./config/styleConfig.js";
import { transcribeVoiceover } from "./services/transcriber.js";
import { generateStoryboard } from "./services/sceneDirector.js";
import { generateSceneImages } from "./services/imageGenerator.js";
import type { Storyboard, TranscriptionResult } from "./types/pipeline.js";

const app = express();
const PORT = Number(process.env.PANEL_PORT ?? 3000);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(PATHS.root, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

type AssetKey = "voiceover" | "characterRef" | "bgMusic" | "watermark";

const ASSET_PATH_MAP: Record<AssetKey, string> = {
  voiceover: PATHS.voiceover,
  characterRef: PATHS.characterRef,
  bgMusic: PATHS.bgMusic,
  watermark: PATHS.watermark,
};

interface JobState {
  running: boolean;
  step: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  error: string | null;
}

const jobState: JobState = {
  running: false,
  step: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: null,
};

function appendLog(message: string): void {
  const time = new Date().toLocaleTimeString("es-ES", { hour12: false });
  jobState.logs.push(`[${time}] ${message}`);
  if (jobState.logs.length > 200) {
    jobState.logs.shift();
  }
}

async function getFileMeta(filePath: string) {
  try {
    const stat = await fsp.stat(filePath);
    return { exists: true, size: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch {
    return { exists: false, size: 0, updatedAt: null };
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

app.get("/api/status", async (_req, res) => {
  const [scriptMeta, voiceover, characterRef, bgMusic, watermark] = await Promise.all([
    getFileMeta(PATHS.script),
    getFileMeta(PATHS.voiceover),
    getFileMeta(PATHS.characterRef),
    getFileMeta(PATHS.bgMusic),
    getFileMeta(PATHS.watermark),
  ]);

  let scriptContent = "";
  if (scriptMeta.exists) {
    scriptContent = await fsp.readFile(PATHS.script, "utf-8");
  }

  const [timestamps, storyboard] = await Promise.all([
    readJsonSafe<TranscriptionResult>(PATHS.timestamps),
    readJsonSafe<Storyboard>(PATHS.storyboard),
  ]);

  let scenes: string[] = [];
  if (fs.existsSync(PATHS.scenesDir)) {
    const entries = await fsp.readdir(PATHS.scenesDir);
    scenes = entries.filter((f) => f.endsWith(".png")).sort();
  }

  res.json({
    env: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
    },
    files: {
      script: { ...scriptMeta, content: scriptContent },
      voiceover,
      characterRef,
      bgMusic,
      watermark,
    },
    outputs: {
      timestamps,
      storyboard,
      scenes,
    },
    job: jobState,
  });
});

app.post("/api/upload/script", upload.single("file"), async (req, res) => {
  try {
    let content = "";
    if (req.file) {
      content = req.file.buffer.toString("utf-8");
    } else if (typeof req.body?.content === "string") {
      content = req.body.content;
    } else {
      res.status(400).json({ error: "Envía un archivo .txt o el texto del guion." });
      return;
    }

    await fsp.mkdir(path.dirname(PATHS.script), { recursive: true });
    await fsp.writeFile(PATHS.script, content, "utf-8");
    res.json({ ok: true, bytes: Buffer.byteLength(content, "utf-8") });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al guardar el guion" });
  }
});

app.post("/api/upload/:assetType", upload.single("file"), async (req, res) => {
  const assetType = req.params.assetType as AssetKey;
  const targetPath = ASSET_PATH_MAP[assetType];

  if (!targetPath) {
    res.status(400).json({ error: `Tipo de archivo no válido: ${assetType}` });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No se recibió ningún archivo." });
    return;
  }

  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, req.file.buffer);
    res.json({ ok: true, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al guardar el archivo" });
  }
});

app.delete("/api/upload/:assetType", async (req, res) => {
  const assetType = req.params.assetType as AssetKey | "script";
  const targetPath = assetType === "script" ? PATHS.script : ASSET_PATH_MAP[assetType as AssetKey];

  if (!targetPath) {
    res.status(400).json({ error: "Tipo de archivo no válido." });
    return;
  }

  try {
    if (fs.existsSync(targetPath)) {
      await fsp.unlink(targetPath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al eliminar" });
  }
});

app.post("/api/run/:step", (req, res) => {
  const step = req.params.step;
  if (!["transcribe", "direct", "images", "all"].includes(step)) {
    res.status(400).json({ error: "Paso inválido." });
    return;
  }

  if (jobState.running) {
    res.status(409).json({ error: "Ya hay una ejecución en curso." });
    return;
  }

  jobState.running = true;
  jobState.step = step;
  jobState.startedAt = new Date().toISOString();
  jobState.finishedAt = null;
  jobState.logs = [];
  jobState.error = null;

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    appendLog(args.map(String).join(" "));
    originalLog(...args);
  };
  console.error = (...args: unknown[]) => {
    appendLog(`ERROR: ${args.map(String).join(" ")}`);
    originalError(...args);
  };

  void (async () => {
    try {
      appendLog(`Iniciando ejecución: ${step}`);
      if (step === "transcribe" || step === "all") {
        await transcribeVoiceover();
      }
      if (step === "direct" || step === "all") {
        await generateStoryboard();
      }
      if (step === "images" || step === "all") {
        await generateSceneImages();
      }
      appendLog("Ejecución completada con éxito.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jobState.error = msg;
      appendLog(`Fallo en la ejecución: ${msg}`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      jobState.running = false;
      jobState.finishedAt = new Date().toISOString();
    }
  })();

  res.json({ ok: true, started: step });
});

// Media preview endpoints
app.get("/media/voiceover", (_req, res) => {
  if (!fs.existsSync(PATHS.voiceover)) return res.status(404).end();
  res.sendFile(PATHS.voiceover);
});
app.get("/media/character_ref", (_req, res) => {
  if (!fs.existsSync(PATHS.characterRef)) return res.status(404).end();
  res.sendFile(PATHS.characterRef);
});
app.get("/media/bg_music", (_req, res) => {
  if (!fs.existsSync(PATHS.bgMusic)) return res.status(404).end();
  res.sendFile(PATHS.bgMusic);
});
app.get("/media/watermark", (_req, res) => {
  if (!fs.existsSync(PATHS.watermark)) return res.status(404).end();
  res.sendFile(PATHS.watermark);
});
app.use("/media/scenes", express.static(PATHS.scenesDir));

app.listen(PORT, () => {
  console.log(`Mega Explains Studio disponible en http://localhost:${PORT}`);
});
