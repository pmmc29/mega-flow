import "dotenv/config";
import fs from "node:fs";
import { PATHS } from "./config/styleConfig.js";
import { transcribeVoiceover } from "./services/transcriber.js";
import { generateStoryboard } from "./services/sceneDirector.js";
import { generateSceneImages } from "./services/imageGenerator.js";

type PipelineStep = "transcribe" | "direct" | "images" | "all";

async function runPipeline(): Promise<void> {
  const stepArg = (process.argv[2] as PipelineStep | undefined) ?? "all";

  console.log("=== Mega Explains Pipeline (Pasos 1-3) ===");

  if (stepArg === "transcribe") {
    await transcribeVoiceover();
  } else if (stepArg === "all") {
    if (fs.existsSync(PATHS.voiceover)) {
      await transcribeVoiceover();
    } else {
      console.log(
        "[Pipeline] Sin audio en input/voiceover.mp3; omitiendo transcripción y generando storyboard desde el guion.",
      );
    }
  }

  if (stepArg === "direct" || stepArg === "all") {
    await generateStoryboard();
  }

  if (stepArg === "images" || stepArg === "all") {
    await generateSceneImages();
  }

  if (!["transcribe", "direct", "images", "all"].includes(stepArg)) {
    throw new Error(
      `Paso desconocido: "${stepArg}". Usa: transcribe | direct | images | all`,
    );
  }

  console.log("=== Pipeline finalizado correctamente ===");
}

runPipeline().catch((error: unknown) => {
  console.error("[Pipeline Error]", error instanceof Error ? error.message : error);
  process.exit(1);
});
