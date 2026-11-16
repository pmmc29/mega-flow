import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { PATHS } from "../config/styleConfig.js";
import type { MainCompositionProps } from "../remotion/MainComposition.js";
import { mergeVisualConfig } from "../remotion/presets.js";
import type {
  RemotionVisualConfig,
  Storyboard,
  TranscriptionResult,
} from "../types/pipeline.js";

export interface RenderVideoOptions {
  storyboardPath?: string;
  timestampsPath?: string;
  scenesDir?: string;
  voiceoverPath?: string;
  bgMusicPath?: string;
  watermarkPath?: string;
  remotionStylePath?: string;
  projectTone?: string;
  outputPath?: string;
  previewMode?: boolean;
}

export async function renderFinalVideo(
  options: RenderVideoOptions = {},
): Promise<string> {
  const storyboardPath = options.storyboardPath ?? PATHS.storyboard;
  const timestampsPath = options.timestampsPath ?? PATHS.timestamps;
  const scenesDir = options.scenesDir ?? PATHS.scenesDir;
  const voiceoverPath = options.voiceoverPath ?? PATHS.voiceover;
  const bgMusicPath = options.bgMusicPath ?? PATHS.bgMusic;
  const watermarkPath = options.watermarkPath ?? PATHS.watermark;
  const outputPath = options.outputPath ?? PATHS.finalVideo;

  if (!fs.existsSync(storyboardPath)) {
    throw new Error(`No se encontró el storyboard en: ${storyboardPath}`);
  }

  if (!fs.existsSync(scenesDir)) {
    throw new Error(`No se encontró la carpeta de escenas en: ${scenesDir}`);
  }

  const sceneEntries = (await fsp.readdir(scenesDir)).filter((f) => f.endsWith(".png"));
  if (sceneEntries.length === 0) {
    throw new Error("No hay imágenes generadas en workspace/scenes/ para renderizar.");
  }

  const storyboard = JSON.parse(
    await fsp.readFile(storyboardPath, "utf-8"),
  ) as Storyboard;

  let timestamps: TranscriptionResult | null = null;
  if (fs.existsSync(timestampsPath)) {
    timestamps = JSON.parse(
      await fsp.readFile(timestampsPath, "utf-8"),
    ) as TranscriptionResult;
  }

  let customVisual: Partial<RemotionVisualConfig> | null = null;
  if (options.remotionStylePath && fs.existsSync(options.remotionStylePath)) {
    try {
      const rawStyle = await fsp.readFile(options.remotionStylePath, "utf-8");
      if (rawStyle.trim()) {
        customVisual = JSON.parse(rawStyle) as Partial<RemotionVisualConfig>;
      }
    } catch (err) {
      console.warn(
        `[VideoRenderer] No se pudo parsear remotion_style.json (${err instanceof Error ? err.message : err}); usando preset del tono.`,
      );
    }
  }
  const visualConfig = mergeVisualConfig(options.projectTone, customVisual);

  const hasVoiceover = fs.existsSync(voiceoverPath);
  const hasBgMusic = fs.existsSync(bgMusicPath);
  const hasWatermark = fs.existsSync(watermarkPath);

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mega-studio-remotion-"));
  const stagingScenesDir = path.join(stagingDir, "scenes");

  try {
    await fsp.mkdir(stagingScenesDir, { recursive: true });
    await Promise.all(
      sceneEntries.map((file) =>
        fsp.copyFile(path.join(scenesDir, file), path.join(stagingScenesDir, file)),
      ),
    );

    if (hasVoiceover) {
      await fsp.copyFile(voiceoverPath, path.join(stagingDir, "voiceover.mp3"));
    }
    if (hasBgMusic) {
      await fsp.copyFile(bgMusicPath, path.join(stagingDir, "bg_music.mp3"));
    }
    if (hasWatermark) {
      await fsp.copyFile(watermarkPath, path.join(stagingDir, "watermark.png"));
    }

    const entryPoint = path.join(PATHS.root, "src", "remotion", "index.ts");
    console.log("[VideoRenderer] Empaquetando composición Remotion...");

    const serveUrl = await bundle({
      entryPoint,
      publicDir: stagingDir,
      webpackOverride: (currentConfiguration) => ({
        ...currentConfiguration,
        resolve: {
          ...currentConfiguration.resolve,
          extensionAlias: {
            ".js": [".ts", ".tsx", ".js", ".jsx"],
            ".jsx": [".tsx", ".jsx"],
          },
        },
      }),
    });

    const inputProps: MainCompositionProps = {
      storyboard,
      timestamps,
      hasVoiceover,
      hasBgMusic,
      hasWatermark,
      visualConfig,
    };

    const composition = await selectComposition({
      serveUrl,
      id: "MegaExplainsShort",
      inputProps,
    });

    const isPreview = Boolean(options.previewMode);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    console.log(
      `[VideoRenderer] Renderizando ${composition.durationInFrames} frames (${isPreview ? "540x960 Vista Previa" : `${composition.width}x${composition.height} Final`} @ ${composition.fps}fps)...`,
    );

    let lastLoggedPct = -10;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      scale: isPreview ? 0.5 : 1,
      crf: isPreview ? 28 : 18,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastLoggedPct + 10) {
          lastLoggedPct = pct;
          console.log(`[VideoRenderer] Progreso: ${pct}%`);
        }
      },
    });

    console.log(`[VideoRenderer] Video renderizado -> ${outputPath}`);
    return outputPath;
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}
