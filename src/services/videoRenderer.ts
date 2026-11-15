import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { PATHS } from "../config/styleConfig.js";
import type { MainCompositionProps } from "../remotion/MainComposition.js";
import type { Storyboard, TranscriptionResult } from "../types/pipeline.js";

export interface RenderVideoOptions {
  storyboardPath?: string;
  timestampsPath?: string;
  scenesDir?: string;
  voiceoverPath?: string;
  bgMusicPath?: string;
  watermarkPath?: string;
  outputPath?: string;
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
    });

    const inputProps: MainCompositionProps = {
      storyboard,
      timestamps,
      hasVoiceover,
      hasBgMusic,
      hasWatermark,
    };

    const composition = await selectComposition({
      serveUrl,
      id: "MegaExplainsShort",
      inputProps,
    });

    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    console.log(
      `[VideoRenderer] Renderizando ${composition.durationInFrames} frames (${composition.width}x${composition.height} @ ${composition.fps}fps)...`,
    );

    let lastLoggedPct = -10;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
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
