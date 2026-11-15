import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  createProject,
  getActiveProject,
  listProjects,
  setActiveProject,
  touchProject,
} from "./config/projectManager.js";
import { PATHS } from "./config/styleConfig.js";
import { transcribeVoiceover } from "./services/transcriber.js";
import { generateStoryboard } from "./services/sceneDirector.js";
import { generateSceneImages } from "./services/imageGenerator.js";
import {
  buildElevenLabsTagPrompt,
  buildRetentionScriptPrompt,
} from "./services/scriptGenerator.js";
import type { GeneratedScript, Storyboard, TranscriptionResult } from "./types/pipeline.js";

const app = express();
const PORT = Number(process.env.PANEL_PORT ?? 3000);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(PATHS.root, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

type AssetKey = "voiceover" | "characterRef" | "bgMusic" | "watermark";

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
  const [{ meta: activeProject, paths: projectPaths }, projects] = await Promise.all([
    getActiveProject(),
    listProjects(),
  ]);

  const [scriptMeta, scriptElevenLabsMeta, voiceover, characterRef, bgMusic, watermark] =
    await Promise.all([
      getFileMeta(projectPaths.script),
      getFileMeta(projectPaths.scriptElevenLabs),
      getFileMeta(projectPaths.voiceover),
      getFileMeta(PATHS.characterRef),
      getFileMeta(PATHS.bgMusic),
      getFileMeta(PATHS.watermark),
    ]);

  let scriptContent = "";
  if (scriptMeta.exists) {
    scriptContent = await fsp.readFile(projectPaths.script, "utf-8");
  }

  let scriptElevenLabsContent = "";
  if (scriptElevenLabsMeta.exists) {
    scriptElevenLabsContent = await fsp.readFile(projectPaths.scriptElevenLabs, "utf-8");
  }

  const [timestamps, storyboard, scriptStructure] = await Promise.all([
    readJsonSafe<TranscriptionResult>(projectPaths.timestamps),
    readJsonSafe<Storyboard>(projectPaths.storyboard),
    readJsonSafe<GeneratedScript>(projectPaths.scriptStructure),
  ]);

  let scenes: string[] = [];
  if (fs.existsSync(projectPaths.scenesDir)) {
    const entries = await fsp.readdir(projectPaths.scenesDir);
    scenes = entries.filter((f) => f.endsWith(".png")).sort();
  }

  res.json({
    env: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      transcriberProvider: process.env.TRANSCRIBER_PROVIDER === "openai" ? "openai" : "local",
    },
    activeProject,
    projects,
    files: {
      script: { ...scriptMeta, content: scriptContent },
      scriptElevenLabs: { ...scriptElevenLabsMeta, content: scriptElevenLabsContent },
      voiceover,
      characterRef,
      bgMusic,
      watermark,
    },
    outputs: {
      timestamps,
      storyboard,
      scriptStructure,
      scenes,
    },
    job: jobState,
  });
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Escribe un tema o etiqueta para el nuevo video." });
    return;
  }

  if (jobState.running) {
    res.status(409).json({ error: "Espera a que termine la ejecución actual antes de cambiar de proyecto." });
    return;
  }

  try {
    const created = await createProject(name);
    res.json({ ok: true, project: created.meta });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al crear proyecto" });
  }
});

app.post("/api/projects/select", async (req, res) => {
  const { slug } = req.body ?? {};
  if (!slug || typeof slug !== "string") {
    res.status(400).json({ error: "Falta el identificador del proyecto." });
    return;
  }

  if (jobState.running) {
    res.status(409).json({ error: "Espera a que termine la ejecución actual antes de cambiar de proyecto." });
    return;
  }

  try {
    const selected = await setActiveProject(slug);
    res.json({ ok: true, project: selected });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Proyecto no encontrado" });
  }
});

app.post("/api/script/generate", (req, res) => {
  const { topic, durationSeconds, tone, customInstructions } = req.body ?? {};
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    res.status(400).json({ error: "Escribe un tema o idea para armar el prompt." });
    return;
  }

  const prompt = buildRetentionScriptPrompt({
    topic: topic.trim(),
    durationSeconds: Number(durationSeconds) || 45,
    tone: typeof tone === "string" && tone.trim() ? tone.trim() : "curioso y dinámico",
    customInstructions: typeof customInstructions === "string" ? customInstructions : undefined,
  });

  res.json({ ok: true, prompt });
});

app.post("/api/script/elevenlabs", async (req, res) => {
  const { content, regenerate, tone } = req.body ?? {};

  try {
    const { meta, paths } = await getActiveProject();

    if (regenerate) {
      if (!fs.existsSync(paths.script)) {
        res.status(400).json({ error: "Primero escribe o pega un guion limpio." });
        return;
      }
      const cleanScript = await fsp.readFile(paths.script, "utf-8");
      const prompt = buildElevenLabsTagPrompt(
        cleanScript,
        typeof tone === "string" ? tone : undefined,
      );
      res.json({ ok: true, prompt });
      return;
    }

    if (typeof content !== "string") {
      res.status(400).json({ error: "Envía el contenido para ElevenLabs." });
      return;
    }

    await fsp.mkdir(path.dirname(paths.scriptElevenLabs), { recursive: true });
    await fsp.writeFile(paths.scriptElevenLabs, content, "utf-8");
    await touchProject(meta.slug);
    res.json({ ok: true, content });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al procesar el formato ElevenLabs.",
    });
  }
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

    const { meta, paths } = await getActiveProject();
    await fsp.mkdir(path.dirname(paths.script), { recursive: true });
    await fsp.writeFile(paths.script, content, "utf-8");
    await touchProject(meta.slug);
    res.json({ ok: true, bytes: Buffer.byteLength(content, "utf-8") });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al guardar el guion" });
  }
});

async function resolveAssetPath(assetType: AssetKey): Promise<string> {
  if (assetType === "voiceover") {
    const { paths } = await getActiveProject();
    return paths.voiceover;
  }
  const brandMap: Record<Exclude<AssetKey, "voiceover">, string> = {
    characterRef: PATHS.characterRef,
    bgMusic: PATHS.bgMusic,
    watermark: PATHS.watermark,
  };
  return brandMap[assetType];
}

app.post("/api/upload/:assetType", upload.single("file"), async (req, res) => {
  const assetType = req.params.assetType as AssetKey;
  if (!["voiceover", "characterRef", "bgMusic", "watermark"].includes(assetType)) {
    res.status(400).json({ error: `Tipo de archivo no válido: ${assetType}` });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No se recibió ningún archivo." });
    return;
  }

  try {
    const targetPath = await resolveAssetPath(assetType);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, req.file.buffer);
    if (assetType === "voiceover") {
      const { meta } = await getActiveProject();
      await touchProject(meta.slug);
    }
    res.json({ ok: true, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al guardar el archivo" });
  }
});

app.delete("/api/upload/:assetType", async (req, res) => {
  const assetType = req.params.assetType as AssetKey | "script";
  if (!["script", "voiceover", "characterRef", "bgMusic", "watermark"].includes(assetType)) {
    res.status(400).json({ error: "Tipo de archivo no válido." });
    return;
  }

  try {
    const { paths } = await getActiveProject();
    const targetPath =
      assetType === "script" ? paths.script : await resolveAssetPath(assetType as AssetKey);

    if (fs.existsSync(targetPath)) {
      await fsp.unlink(targetPath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al eliminar" });
  }
});

app.post("/api/run/:step", async (req, res) => {
  const step = req.params.step;
  if (!["transcribe", "direct", "images", "all"].includes(step)) {
    res.status(400).json({ error: "Paso inválido." });
    return;
  }

  if (jobState.running) {
    res.status(409).json({ error: "Ya hay una ejecución en curso." });
    return;
  }

  const { meta, paths } = await getActiveProject();

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
      appendLog(`[${meta.name}] Iniciando ejecución: ${step}`);
      if (step === "transcribe") {
        await transcribeVoiceover(paths.voiceover, paths.timestamps);
      } else if (step === "all") {
        if (fs.existsSync(paths.voiceover)) {
          await transcribeVoiceover(paths.voiceover, paths.timestamps);
        } else {
          appendLog(
            "[Pipeline] Sin audio de locución en este proyecto; omitiendo transcripción y usando duración estimada del guion.",
          );
        }
      }
      if (step === "direct" || step === "all") {
        await generateStoryboard(paths.script, paths.timestamps, paths.storyboard);
      }
      if (step === "images" || step === "all") {
        await generateSceneImages(paths.storyboard, PATHS.characterRef, paths.scenesDir);
      }
      await touchProject(meta.slug);
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

// Media preview endpoints (per active project for voiceover & scenes; shared for brand assets)
app.get("/media/voiceover", async (_req, res) => {
  const { paths } = await getActiveProject();
  if (!fs.existsSync(paths.voiceover)) return res.status(404).end();
  res.sendFile(paths.voiceover);
});
app.get("/media/scenes/:filename", async (req, res) => {
  const { paths } = await getActiveProject();
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(paths.scenesDir, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
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

app.listen(PORT, () => {
  console.log(`Mega Studio disponible en http://localhost:${PORT}`);
});
