import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import ffmpegStatic from "ffmpeg-static";
import multer from "multer";
import {
  createProject,
  deleteProject,
  getActiveProject,
  listProjects,
  setActiveProject,
  touchProject,
  updateProjectDuration,
  updateProjectTone,
} from "./config/projectManager.js";
import {
  CHARACTER_CONSISTENCY_PREFIX,
  PATHS,
  STYLE_ANCHOR,
} from "./config/styleConfig.js";
import {
  generateEstimatedTimestampsFromScript,
  transcribeVoiceover,
} from "./services/transcriber.js";
import { generateStoryboard, syncStoryboardToDuration } from "./services/sceneDirector.js";
import { generateSceneImages } from "./services/imageGenerator.js";
import { renderFinalVideo } from "./services/videoRenderer.js";
import {
  checkAceStepHealth,
  generateAceStepMusic,
  getAudioDurationSeconds,
} from "./services/musicGenerator.js";
import {
  generateFlowBatchScenes,
  openFlowLoginSession,
} from "./services/flowBatchGenerator.js";
import {
  buildElevenLabsTagPrompt,
  buildMusicPrompt,
  buildRetentionScriptPrompt,
  parseUnifiedScriptBundle,
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

interface FlowProgress {
  completed: number;
  total: number;
  lastSceneId: number;
}

interface JobState {
  running: boolean;
  step: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs: string[];
  error: string | null;
  flowProgress: FlowProgress | null;
}

const jobState: JobState = {
  running: false,
  step: null,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: null,
  flowProgress: null,
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
  res.setHeader("Cache-Control", "no-store");
  const [{ meta: activeProject, paths: projectPaths }, projects] = await Promise.all([
    getActiveProject(),
    listProjects(),
  ]);

  const [
    scriptMeta,
    scriptElevenLabsMeta,
    remotionStyleMeta,
    voiceover,
    characterRef,
    projectBgMusic,
    brandBgMusic,
    watermark,
  ] = await Promise.all([
    getFileMeta(projectPaths.script),
    getFileMeta(projectPaths.scriptElevenLabs),
    getFileMeta(projectPaths.remotionStyle),
    getFileMeta(projectPaths.voiceover),
    getFileMeta(PATHS.characterRef),
    getFileMeta(projectPaths.bgMusic),
    getFileMeta(PATHS.bgMusic),
    getFileMeta(PATHS.watermark),
  ]);

  const bgMusic = projectBgMusic.exists
    ? { ...projectBgMusic, scope: "project" as const }
    : brandBgMusic.exists
      ? { ...brandBgMusic, scope: "brand" as const }
      : { ...projectBgMusic, scope: "none" as const };

  let scriptContent = "";
  if (scriptMeta.exists) {
    scriptContent = await fsp.readFile(projectPaths.script, "utf-8");
  }

  let scriptElevenLabsContent = "";
  if (scriptElevenLabsMeta.exists) {
    scriptElevenLabsContent = await fsp.readFile(projectPaths.scriptElevenLabs, "utf-8");
  }

  let remotionStyleContent = "";
  if (remotionStyleMeta.exists) {
    remotionStyleContent = await fsp.readFile(projectPaths.remotionStyle, "utf-8");
  }

  const [timestamps, storyboard, scriptStructure, finalVideo, aceStep] = await Promise.all([
    readJsonSafe<TranscriptionResult>(projectPaths.timestamps),
    readJsonSafe<Storyboard>(projectPaths.storyboard),
    readJsonSafe<GeneratedScript>(projectPaths.scriptStructure),
    getFileMeta(projectPaths.finalVideo),
    checkAceStepHealth(),
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
      aceStep,
    },
    config: {
      styleAnchor: STYLE_ANCHOR,
      characterPrefix: CHARACTER_CONSISTENCY_PREFIX,
    },
    activeProject,
    projects,
    files: {
      script: { ...scriptMeta, content: scriptContent },
      scriptElevenLabs: { ...scriptElevenLabsMeta, content: scriptElevenLabsContent },
      remotionStyle: { ...remotionStyleMeta, content: remotionStyleContent },
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
      finalVideo,
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

app.delete("/api/projects/:slug", async (req, res) => {
  const { slug } = req.params;
  if (!slug) {
    res.status(400).json({ error: "Falta el identificador del proyecto." });
    return;
  }

  if (jobState.running) {
    res.status(409).json({ error: "Espera a que termine la ejecución actual antes de eliminar." });
    return;
  }

  try {
    const activeProject = await deleteProject(slug);
    res.json({ ok: true, activeProject });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "No se pudo eliminar el proyecto.",
    });
  }
});

app.post("/api/projects/tone", async (req, res) => {
  const { tone } = req.body ?? {};
  if (!tone || typeof tone !== "string" || !tone.trim()) {
    res.status(400).json({ error: "Selecciona un tono válido." });
    return;
  }

  try {
    const { meta } = await getActiveProject();
    const updated = await updateProjectTone(meta.slug, tone.trim());
    res.json({ ok: true, project: updated });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "No se pudo guardar el tono del proyecto.",
    });
  }
});

app.post("/api/script/generate", async (req, res) => {
  const { topic, durationSeconds, tone, customInstructions } = req.body ?? {};
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    res.status(400).json({ error: "Escribe un tema o idea para armar el prompt." });
    return;
  }

  const resolvedTone =
    typeof tone === "string" && tone.trim() ? tone.trim() : "curioso y dinámico";
  const resolvedDuration = Number(durationSeconds) || 45;

  try {
    const { meta } = await getActiveProject();
    await updateProjectTone(meta.slug, resolvedTone);
    await updateProjectDuration(meta.slug, resolvedDuration);
  } catch {
    // Non-fatal if project metadata update fails
  }

  const prompt = buildRetentionScriptPrompt({
    topic: topic.trim(),
    durationSeconds: resolvedDuration,
    tone: resolvedTone,
    customInstructions: typeof customInstructions === "string" ? customInstructions : undefined,
  });

  res.json({ ok: true, prompt });
});

app.post("/api/script/remotion-style", async (req, res) => {
  const { content } = req.body ?? {};
  if (typeof content !== "string") {
    res.status(400).json({ error: "Envía el JSON de estilo Remotion." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const trimmed = content.trim();

    if (!trimmed) {
      if (fs.existsSync(paths.remotionStyle)) {
        await fsp.unlink(paths.remotionStyle);
      }
      await touchProject(meta.slug);
      res.json({ ok: true, content: "" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      res.status(400).json({
        error: "El estilo Remotion no es un JSON válido. Revisa llaves, comillas y comas.",
      });
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      res.status(400).json({ error: "El estilo Remotion debe ser un objeto JSON { ... }." });
      return;
    }

    const formatted = JSON.stringify(parsed, null, 2);
    await fsp.mkdir(path.dirname(paths.remotionStyle), { recursive: true });
    await fsp.writeFile(paths.remotionStyle, formatted, "utf-8");
    await touchProject(meta.slug);
    res.json({ ok: true, content: formatted });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al guardar el estilo Remotion.",
    });
  }
});

app.post("/api/script/import-bundle", async (req, res) => {
  const { content, durationSeconds } = req.body ?? {};
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "Pega el bloque completo generado por tu agente IA." });
    return;
  }

  try {
    const bundle = parseUnifiedScriptBundle(content);
    const { meta, paths } = await getActiveProject();

    await fsp.mkdir(path.dirname(paths.script), { recursive: true });
    await fsp.writeFile(paths.script, bundle.cleanScript, "utf-8");

    if (bundle.elevenlabsScript) {
      await fsp.mkdir(path.dirname(paths.scriptElevenLabs), { recursive: true });
      await fsp.writeFile(paths.scriptElevenLabs, bundle.elevenlabsScript, "utf-8");
    }

    if (bundle.remotionStyle) {
      await fsp.mkdir(path.dirname(paths.remotionStyle), { recursive: true });
      await fsp.writeFile(paths.remotionStyle, bundle.remotionStyle, "utf-8");
    }

    if (bundle.storyboard) {
      await fsp.mkdir(path.dirname(paths.storyboard), { recursive: true });
      await fsp.writeFile(paths.storyboard, bundle.storyboard, "utf-8");
      const ts = await readJsonSafe<TranscriptionResult>(paths.timestamps);
      if (ts?.duration && ts.duration > 0) {
        await syncStoryboardToDuration(paths.storyboard, ts.duration);
      }
    }

    if (!meta.durationSeconds) {
      const requested = Number(durationSeconds);
      if (Number.isFinite(requested) && requested > 0) {
        await updateProjectDuration(meta.slug, requested);
      } else {
        const words = bundle.cleanScript.split(/\s+/).filter(Boolean).length;
        await updateProjectDuration(meta.slug, Math.max(20, Math.round((words / 140) * 60)));
      }
    }

    await touchProject(meta.slug);
    res.json({ ok: true, ...bundle });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "No se pudo importar el bloque.",
    });
  }
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

async function resolveTargetMusicDuration(options: {
  meta: { durationSeconds?: number };
  paths: { voiceover: string; timestamps: string };
  scriptText: string;
  requestedDurationSeconds?: unknown;
}): Promise<{ durationSeconds: number; source: "voiceover" | "project" | "estimated" }> {
  if (fs.existsSync(options.paths.voiceover)) {
    const measured = await getAudioDurationSeconds(options.paths.voiceover);
    if (measured && measured > 0) {
      return {
        durationSeconds: Math.max(10, Math.min(600, Math.round(measured))),
        source: "voiceover",
      };
    }
    const ts = await readJsonSafe<{ duration?: number }>(options.paths.timestamps);
    if (ts?.duration && ts.duration > 0) {
      return {
        durationSeconds: Math.max(10, Math.min(600, Math.round(ts.duration))),
        source: "voiceover",
      };
    }
  }

  if (options.meta.durationSeconds && options.meta.durationSeconds > 0) {
    return {
      durationSeconds: Math.max(10, Math.min(600, Math.round(options.meta.durationSeconds))),
      source: "project",
    };
  }

  const words = options.scriptText.split(/\s+/).filter(Boolean).length;
  const estimatedFromScript = Math.max(20, Math.round((words / 140) * 60));
  const requested = Number(options.requestedDurationSeconds);
  return {
    durationSeconds:
      Number.isFinite(requested) && requested > 0 ? Math.round(requested) : estimatedFromScript,
    source: "estimated",
  };
}

app.post("/api/music/prompt", async (req, res) => {
  const { topic, durationSeconds, tone } = req.body ?? {};
  try {
    const { meta, paths } = await getActiveProject();
    if (!fs.existsSync(paths.script)) {
      res.status(400).json({
        error: "Primero aplica y guarda el guion y estilo 3 en 1.",
      });
      return;
    }

    const scriptText = (await fsp.readFile(paths.script, "utf-8")).trim();
    if (!scriptText) {
      res.status(400).json({
        error: "El guion está vacío. Primero aplica y guarda el guion y estilo 3 en 1.",
      });
      return;
    }

    const remotionStyle = await readJsonSafe<{
      hook_badge?: string;
      vignette?: number;
      default_transition?: string;
    }>(paths.remotionStyle);

    const resolvedDuration = await resolveTargetMusicDuration({
      meta,
      paths,
      scriptText,
      requestedDurationSeconds: durationSeconds,
    });

    const resolvedTopic =
      typeof topic === "string" && topic.trim() ? topic.trim() : meta.name;
    const resolvedTone =
      typeof tone === "string" && tone.trim() ? tone.trim() : meta.tone;
    const prompt = buildMusicPrompt({
      topic: resolvedTopic,
      scriptText,
      durationSeconds: resolvedDuration.durationSeconds,
      tone: resolvedTone,
      remotionStyle,
    });
    res.json({
      ok: true,
      prompt,
      durationSeconds: resolvedDuration.durationSeconds,
      durationSource: resolvedDuration.source,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al armar el prompt musical.",
    });
  }
});

app.post("/api/music/generate-acestep", async (req, res) => {
  const { topic, durationSeconds, tone, prompt: customPrompt } = req.body ?? {};
  try {
    const { meta, paths } = await getActiveProject();
    if (!fs.existsSync(paths.script)) {
      res.status(400).json({
        error: "Primero aplica y guarda el guion y estilo 3 en 1.",
      });
      return;
    }

    const scriptText = (await fsp.readFile(paths.script, "utf-8")).trim();
    if (!scriptText) {
      res.status(400).json({
        error: "El guion está vacío. Primero aplica y guarda el guion y estilo 3 en 1.",
      });
      return;
    }

    if (!fs.existsSync(paths.voiceover)) {
      res.status(400).json({
        error:
          "Primero sube el audio de ElevenLabs para generar la música con la duración exacta de la locución.",
      });
      return;
    }

    const remotionStyle = await readJsonSafe<{
      hook_badge?: string;
      vignette?: number;
      default_transition?: string;
    }>(paths.remotionStyle);

    const resolvedDuration = await resolveTargetMusicDuration({
      meta,
      paths,
      scriptText,
      requestedDurationSeconds: durationSeconds,
    });

    const resolvedPrompt =
      typeof customPrompt === "string" && customPrompt.trim()
        ? customPrompt.trim()
        : buildMusicPrompt({
            topic: typeof topic === "string" && topic.trim() ? topic.trim() : meta.name,
            scriptText,
            durationSeconds: resolvedDuration.durationSeconds,
            tone: typeof tone === "string" && tone.trim() ? tone.trim() : meta.tone,
            remotionStyle,
          });

    const result = await generateAceStepMusic({
      prompt: resolvedPrompt,
      durationSeconds: resolvedDuration.durationSeconds,
      outputPath: paths.bgMusic,
    });

    await touchProject(meta.slug);
    res.json({
      ok: true,
      prompt: resolvedPrompt,
      durationSeconds: resolvedDuration.durationSeconds,
      durationSource: resolvedDuration.source,
      size: result.size,
      taskId: result.taskId,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al generar música con ACE-Step 1.5.",
    });
  }
});

async function resolveAssetPath(assetType: AssetKey): Promise<string> {
  if (assetType === "voiceover" || assetType === "bgMusic") {
    const { paths } = await getActiveProject();
    return assetType === "voiceover" ? paths.voiceover : paths.bgMusic;
  }
  const brandMap: Record<"characterRef" | "watermark", string> = {
    characterRef: PATHS.characterRef,
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
    if (assetType === "voiceover" || assetType === "bgMusic") {
      const { meta, paths } = await getActiveProject();
      if (assetType === "voiceover" && fs.existsSync(paths.timestamps)) {
        await fsp.unlink(paths.timestamps);
      }
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
    if (assetType === "bgMusic") {
      if (fs.existsSync(paths.bgMusic)) {
        await fsp.unlink(paths.bgMusic);
      } else if (fs.existsSync(PATHS.bgMusic)) {
        await fsp.unlink(PATHS.bgMusic);
      }
      res.json({ ok: true });
      return;
    }

    const targetPath =
      assetType === "script" ? paths.script : await resolveAssetPath(assetType as AssetKey);

    if (fs.existsSync(targetPath)) {
      await fsp.unlink(targetPath);
    }
    if (assetType === "voiceover" && fs.existsSync(paths.timestamps)) {
      await fsp.unlink(paths.timestamps);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Error al eliminar" });
  }
});

app.post("/api/run/:step", async (req, res) => {
  const step = req.params.step;
  if (!["transcribe", "direct", "images", "render", "all"].includes(step)) {
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
  jobState.flowProgress = null;

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
        if (fs.existsSync(paths.voiceover)) {
          const ts = await transcribeVoiceover(paths.voiceover, paths.timestamps, paths.script);
          await syncStoryboardToDuration(paths.storyboard, ts.duration);
        } else {
          appendLog(
            "[Pipeline] Sin audio ElevenLabs: generando timestamps estándar del guion para vista previa.",
          );
          await generateEstimatedTimestampsFromScript(
            paths.script,
            paths.storyboard,
            paths.timestamps,
            meta.durationSeconds,
          );
        }
      } else if (step === "all") {
        if (fs.existsSync(paths.voiceover)) {
          const ts = await transcribeVoiceover(paths.voiceover, paths.timestamps, paths.script);
          await syncStoryboardToDuration(paths.storyboard, ts.duration);
        } else {
          appendLog(
            "[Pipeline] Sin audio ElevenLabs: generando timestamps estándar del guion para vista previa.",
          );
          await generateEstimatedTimestampsFromScript(
            paths.script,
            paths.storyboard,
            paths.timestamps,
            meta.durationSeconds,
          );
        }
      }
      if (step === "direct") {
        await generateStoryboard(paths.script, paths.timestamps, paths.storyboard);
      } else if (step === "all") {
        if (fs.existsSync(paths.storyboard) && !process.env.GEMINI_API_KEY) {
          appendLog(
            "[Pipeline] Usando storyboard.json importado del bloque 4 en 1 (sin Gemini API).",
          );
        } else {
          await generateStoryboard(paths.script, paths.timestamps, paths.storyboard);
        }
      }
      if (step === "images" || step === "all") {
        if (process.env.GEMINI_API_KEY) {
          await generateSceneImages(paths.storyboard, PATHS.characterRef, paths.scenesDir);
        } else {
          const sb = await readJsonSafe<Storyboard>(paths.storyboard);
          if (!sb || !Array.isArray(sb.scenes) || sb.scenes.length === 0) {
            throw new Error(
              "No hay storyboard.json. Pega el bloque 4 en 1 para generar las escenas.",
            );
          }
          const missing = sb.scenes
            .map((s) => `scene_${String(s.id).padStart(3, "0")}.png`)
            .filter((name) => !fs.existsSync(path.join(paths.scenesDir, name)));
          if (missing.length > 0) {
            throw new Error(
              `Faltan ${missing.length} escenas (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}). Súbelas en la pestaña Escenas desde Google Flow.`,
            );
          }
          appendLog(
            `[Google Flow] ${sb.scenes.length} escenas verificadas en workspace/scenes/.`,
          );
        }
      }
      if (step === "render") {
        if (fs.existsSync(paths.voiceover)) {
          const existingTs = await readJsonSafe<TranscriptionResult>(paths.timestamps);
          if (!existingTs || existingTs.source !== "whisper") {
            appendLog(
              "[Pipeline] Audio ElevenLabs detectado: ajustando timestamps con Whisper para renderizado final...",
            );
            const ts = await transcribeVoiceover(paths.voiceover, paths.timestamps, paths.script);
            await syncStoryboardToDuration(paths.storyboard, ts.duration);
          }
        } else {
          appendLog(
            "[Pipeline] Sin audio ElevenLabs: usando timestamps estándar del guion para vista previa.",
          );
          await generateEstimatedTimestampsFromScript(
            paths.script,
            paths.storyboard,
            paths.timestamps,
            meta.durationSeconds,
          );
        }
      }
      if (step === "render" || step === "all") {
        await renderFinalVideo({
          storyboardPath: paths.storyboard,
          timestampsPath: paths.timestamps,
          scenesDir: paths.scenesDir,
          voiceoverPath: paths.voiceover,
          bgMusicPath: fs.existsSync(paths.bgMusic) ? paths.bgMusic : PATHS.bgMusic,
          watermarkPath: PATHS.watermark,
          remotionStylePath: paths.remotionStyle,
          projectTone: meta.tone,
          outputPath: paths.finalVideo,
          previewMode: !fs.existsSync(paths.voiceover),
        });
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

async function saveImageAsPng(buffer: Buffer, destPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const isPng =
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (isPng) {
    await fsp.writeFile(destPath, buffer);
    return;
  }

  const ffmpegBin = ffmpegStatic as unknown as string | null;
  if (!ffmpegBin) {
    await fsp.writeFile(destPath, buffer);
    return;
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mega-scene-"));
  const tmpInput = path.join(tmpDir, "upload.img");
  try {
    await fsp.writeFile(tmpInput, buffer);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, ["-y", "-i", tmpInput, "-frames:v", "1", destPath]);
      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg falló al convertir imagen a PNG (${code}): ${stderr.slice(-200)}`));
      });
    });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

app.post("/api/flow/login", async (_req, res) => {
  if (jobState.running) {
    res.status(409).json({ error: "Espera a que termine la ejecución actual." });
    return;
  }
  try {
    const info = await openFlowLoginSession();
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "No se pudo abrir Google Flow en el navegador.",
    });
  }
});

app.post("/api/scenes/generate-flow", async (req, res) => {
  if (jobState.running) {
    res.status(409).json({ error: "Ya hay una ejecución en curso." });
    return;
  }

  const concurrency = Number(req.body?.concurrency) || undefined;
  const { meta, paths } = await getActiveProject();
  if (!fs.existsSync(paths.storyboard)) {
    res.status(400).json({
      error: "No existe storyboard.json. Pega y guarda primero el bloque 4 en 1.",
    });
    return;
  }

  jobState.running = true;
  jobState.step = "flow-batch";
  jobState.startedAt = new Date().toISOString();
  jobState.finishedAt = null;
  jobState.logs = [];
  jobState.error = null;
  jobState.flowProgress = { completed: 0, total: 0, lastSceneId: 0 };

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
      appendLog(`[${meta.name}] Generación por lotes en Google Flow iniciada...`);
      const summary = await generateFlowBatchScenes({
        storyboardPath: paths.storyboard,
        characterRefPath: PATHS.characterRef,
        scenesDir: paths.scenesDir,
        concurrency,
        onProgress: (progress) => {
          jobState.flowProgress = progress;
        },
      });
      await touchProject(meta.slug);
      appendLog(
        `Lote Flow completado: ${summary.generated} generadas, ${summary.skipped} existentes, ${summary.failed.length} fallidas.`,
      );
      if (summary.failed.length > 0) {
        jobState.error = `Fallaron ${summary.failed.length} escena(s): ${summary.failed
          .map((f) => `#${f.sceneId}`)
          .join(", ")}. Puedes reintentar el lote para generar solo las faltantes.`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jobState.error = msg;
      appendLog(`Fallo en lote Flow: ${msg}`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      jobState.running = false;
      jobState.finishedAt = new Date().toISOString();
    }
  })();

  res.json({ ok: true, started: "flow-batch" });
});

app.put("/api/timestamps", async (req, res) => {
  const words = req.body?.words;
  const duration = Number(req.body?.duration);
  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ error: "Se requiere una lista válida de palabras." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const existing = await readJsonSafe<TranscriptionResult>(paths.timestamps);
    const sanitized = words
      .map((w: { word?: unknown; start?: unknown; end?: unknown }) => {
        const word = String(w?.word ?? "").trim();
        const start = Number(w?.start);
        const end = Number(w?.end);
        return {
          word,
          start: Number.isFinite(start) && start >= 0 ? Number(start.toFixed(3)) : 0,
          end: Number.isFinite(end) && end > 0 ? Number(end.toFixed(3)) : 0.2,
        };
      })
      .filter((w) => w.word.length > 0);

    const lastEnd = sanitized.length > 0 ? sanitized[sanitized.length - 1].end : 0;
    const payload: TranscriptionResult = {
      duration:
        Number.isFinite(duration) && duration > 0
          ? Number(duration.toFixed(3))
          : existing?.duration || lastEnd,
      words: sanitized,
      source: existing?.source ?? "whisper",
    };

    await fsp.mkdir(path.dirname(paths.timestamps), { recursive: true });
    await fsp.writeFile(paths.timestamps, JSON.stringify(payload, null, 2), "utf-8");
    await touchProject(meta.slug);
    res.json({ ok: true, timestamps: payload });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al guardar timestamps.",
    });
  }
});

app.patch("/api/scenes/:sceneId", async (req, res) => {
  const sceneId = Number(req.params.sceneId);
  if (!Number.isInteger(sceneId) || sceneId <= 0) {
    res.status(400).json({ error: "Número de escena inválido." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const sb = await readJsonSafe<Storyboard>(paths.storyboard);
    if (!sb || !Array.isArray(sb.scenes)) {
      res.status(404).json({ error: "No existe storyboard.json en este proyecto." });
      return;
    }

    const scene = sb.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      res.status(404).json({ error: `No se encontró la escena ${sceneId}.` });
      return;
    }

    if (typeof req.body?.image_prompt === "string" && req.body.image_prompt.trim()) {
      scene.image_prompt = req.body.image_prompt.trim();
    }
    if (
      typeof req.body?.camera_motion === "string" &&
      ["zoom_in", "zoom_out", "pan_left", "pan_right"].includes(req.body.camera_motion)
    ) {
      scene.camera_motion = req.body.camera_motion;
    }
    if (typeof req.body?.use_character === "boolean") {
      scene.use_character = req.body.use_character;
    }

    await fsp.writeFile(paths.storyboard, JSON.stringify(sb, null, 2), "utf-8");
    await touchProject(meta.slug);
    res.json({ ok: true, scene });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al actualizar la escena.",
    });
  }
});

app.post("/api/scenes/:sceneId/generate-flow", async (req, res) => {
  const sceneId = Number(req.params.sceneId);
  if (!Number.isInteger(sceneId) || sceneId <= 0) {
    res.status(400).json({ error: "Número de escena inválido." });
    return;
  }
  if (jobState.running) {
    res.status(409).json({ error: "Ya hay una ejecución en curso." });
    return;
  }

  const { meta, paths } = await getActiveProject();
  if (!fs.existsSync(paths.storyboard)) {
    res.status(400).json({ error: "No existe storyboard.json." });
    return;
  }

  jobState.running = true;
  jobState.step = "flow-batch";
  jobState.startedAt = new Date().toISOString();
  jobState.finishedAt = null;
  jobState.logs = [];
  jobState.error = null;
  jobState.flowProgress = { completed: 0, total: 1, lastSceneId: sceneId };

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
      appendLog(`[${meta.name}] Regenerando escena #${sceneId} en Google Flow...`);
      const summary = await generateFlowBatchScenes({
        storyboardPath: paths.storyboard,
        characterRefPath: PATHS.characterRef,
        scenesDir: paths.scenesDir,
        concurrency: 1,
        sceneIds: [sceneId],
        onProgress: (progress) => {
          jobState.flowProgress = progress;
        },
      });
      await touchProject(meta.slug);
      if (summary.failed.length > 0) {
        jobState.error = `Falló la escena #${sceneId}: ${summary.failed[0].error}`;
      } else {
        appendLog(`Escena #${sceneId} regenerada con éxito.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jobState.error = msg;
      appendLog(`Error regenerando escena #${sceneId}: ${msg}`);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      jobState.running = false;
      jobState.finishedAt = new Date().toISOString();
    }
  })();

  res.json({ ok: true, started: "flow-single", sceneId });
});

app.post("/api/scenes/:sceneId/upload", upload.single("file"), async (req, res) => {
  const sceneId = Number(req.params.sceneId);
  if (!Number.isInteger(sceneId) || sceneId <= 0) {
    res.status(400).json({ error: "Número de escena inválido." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No se recibió ninguna imagen." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const filename = `scene_${String(sceneId).padStart(3, "0")}.png`;
    const destPath = path.join(paths.scenesDir, filename);
    await saveImageAsPng(req.file.buffer, destPath);
    await touchProject(meta.slug);
    res.json({ ok: true, sceneId, filename, size: req.file.size });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al guardar la imagen de la escena.",
    });
  }
});

app.post("/api/scenes/upload-batch", upload.array("files", 50), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "Selecciona al menos una imagen para subir." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const sb = await readJsonSafe<Storyboard>(paths.storyboard);
    const totalScenes = sb?.scenes?.length ?? 0;

    const sortedFiles = [...files].sort((a, b) =>
      a.originalname.localeCompare(b.originalname, undefined, { numeric: true }),
    );

    const existingSet = new Set<number>();
    if (fs.existsSync(paths.scenesDir)) {
      for (const entry of await fsp.readdir(paths.scenesDir)) {
        const m = entry.match(/^scene_(\d+)\.png$/);
        if (m) existingSet.add(Number(m[1]));
      }
    }

    const missingIds: number[] = [];
    for (let id = 1; id <= totalScenes; id++) {
      if (!existingSet.has(id)) missingIds.push(id);
    }

    const assigned: Array<{ sceneId: number; filename: string; originalname: string }> = [];
    let nextFallbackId = 1;

    for (const file of sortedFiles) {
      let targetId: number | undefined;
      if (missingIds.length > 0) {
        targetId = missingIds.shift();
      } else if (totalScenes > 0) {
        if (nextFallbackId <= totalScenes) {
          targetId = nextFallbackId++;
        } else {
          break;
        }
      } else {
        targetId = nextFallbackId++;
      }

      if (!targetId) break;
      const filename = `scene_${String(targetId).padStart(3, "0")}.png`;
      await saveImageAsPng(file.buffer, path.join(paths.scenesDir, filename));
      assigned.push({ sceneId: targetId, filename, originalname: file.originalname });
    }

    await touchProject(meta.slug);
    res.json({ ok: true, assigned });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al subir imágenes en lote.",
    });
  }
});

app.delete("/api/scenes/:sceneId", async (req, res) => {
  const sceneId = Number(req.params.sceneId);
  if (!Number.isInteger(sceneId) || sceneId <= 0) {
    res.status(400).json({ error: "Número de escena inválido." });
    return;
  }

  try {
    const { meta, paths } = await getActiveProject();
    const filename = `scene_${String(sceneId).padStart(3, "0")}.png`;
    const destPath = path.join(paths.scenesDir, filename);
    if (fs.existsSync(destPath)) {
      await fsp.unlink(destPath);
      await touchProject(meta.slug);
    }
    res.json({ ok: true, sceneId, filename });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al eliminar la escena.",
    });
  }
});

// Media preview endpoints (per active project for voiceover, scenes & final video; shared for brand assets)
app.get("/media/voiceover", async (_req, res) => {
  const { paths } = await getActiveProject();
  if (!fs.existsSync(paths.voiceover)) return res.status(404).end();
  res.sendFile(paths.voiceover);
});
app.get("/media/final_video", async (_req, res) => {
  const { paths } = await getActiveProject();
  if (!fs.existsSync(paths.finalVideo)) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(paths.finalVideo);
});
app.get("/media/scenes/:filename", async (req, res) => {
  const { paths } = await getActiveProject();
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(paths.scenesDir, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath);
});
function detectImageMime(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  return "image/png";
}

async function sendImageFile(res: express.Response, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  const buf = await fsp.readFile(filePath);
  res.setHeader("Content-Type", detectImageMime(buf));
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
}

app.get("/media/character_ref", async (_req, res) => {
  await sendImageFile(res, PATHS.characterRef);
});
app.get("/media/bg_music", async (_req, res) => {
  const { paths } = await getActiveProject();
  const target = fs.existsSync(paths.bgMusic) ? paths.bgMusic : PATHS.bgMusic;
  if (!fs.existsSync(target)) return res.status(404).end();
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(target);
});
app.get("/media/watermark", async (_req, res) => {
  await sendImageFile(res, PATHS.watermark);
});

app.listen(PORT, () => {
  console.log(`Mega Studio disponible en http://localhost:${PORT}`);
});
