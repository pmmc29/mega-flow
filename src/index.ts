import "dotenv/config";
import fs from "node:fs";
import { getActiveProject } from "./config/projectManager.js";
import { PATHS } from "./config/styleConfig.js";
import { transcribeVoiceover } from "./services/transcriber.js";
import { generateStoryboard } from "./services/sceneDirector.js";
import { generateSceneImages } from "./services/imageGenerator.js";
import { renderFinalVideo } from "./services/videoRenderer.js";

type PipelineStep = "transcribe" | "direct" | "images" | "render" | "all";

async function runPipeline(): Promise<void> {
  const stepArg = (process.argv[2] as PipelineStep | undefined) ?? "all";
  const { meta, paths } = await getActiveProject();

  if (!["transcribe", "direct", "images", "render", "all"].includes(stepArg)) {
    throw new Error(
      `Paso desconocido: "${stepArg}". Usa: transcribe | direct | images | render | all`,
    );
  }

  console.log(`=== Mega Studio Pipeline (Proyecto: ${meta.name} [${meta.slug}]) ===`);

  if (stepArg === "transcribe") {
    await transcribeVoiceover(paths.voiceover, paths.timestamps);
  } else if (stepArg === "all") {
    if (fs.existsSync(paths.voiceover)) {
      await transcribeVoiceover(paths.voiceover, paths.timestamps);
    } else {
      console.log(
        `[Pipeline] Sin audio en projects/${meta.slug}/input/voiceover.mp3; omitiendo transcripción y generando storyboard desde el guion.`,
      );
    }
  }

  if (stepArg === "direct" || stepArg === "all") {
    await generateStoryboard(paths.script, paths.timestamps, paths.storyboard);
  }

  if (stepArg === "images" || stepArg === "all") {
    await generateSceneImages(paths.storyboard, PATHS.characterRef, paths.scenesDir);
  }

  if (stepArg === "render" || stepArg === "all") {
    await renderFinalVideo({
      storyboardPath: paths.storyboard,
      timestampsPath: paths.timestamps,
      scenesDir: paths.scenesDir,
      voiceoverPath: paths.voiceover,
      bgMusicPath: PATHS.bgMusic,
      watermarkPath: PATHS.watermark,
      outputPath: paths.finalVideo,
    });
  }

  console.log("=== Pipeline finalizado correctamente ===");
}

runPipeline().catch((error: unknown) => {
  console.error("[Pipeline Error]", error instanceof Error ? error.message : error);
  process.exit(1);
});
