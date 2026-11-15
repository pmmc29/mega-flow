import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, type Part } from "@google/genai";
import pLimit from "p-limit";
import {
  CHARACTER_CONSISTENCY_PREFIX,
  IMAGE_GENERATION_CONCURRENCY,
  MODELS,
  PATHS,
  STYLE_ANCHOR,
  VIDEO_CONFIG,
} from "../config/styleConfig.js";
import type { Scene, Storyboard } from "../types/pipeline.js";

function formatSceneFilename(sceneId: number): string {
  return `scene_${String(sceneId).padStart(3, "0")}.png`;
}

async function loadCharacterReferencePart(refPath: string): Promise<Part> {
  if (!fs.existsSync(refPath)) {
    throw new Error(
      `Se requiere la imagen de referencia del personaje en: ${refPath}`,
    );
  }

  const buffer = await fsp.readFile(refPath);
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: "image/png",
    },
  };
}

function extractImageBuffer(
  response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>,
  sceneId: number,
): Buffer {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  throw new Error(
    `La respuesta de Gemini no incluyó datos de imagen para la escena ${sceneId}.`,
  );
}

async function generateSceneImage(
  ai: GoogleGenAI,
  scene: Scene,
  outputDir: string,
  characterRefPart: Part | null,
): Promise<string> {
  const isCharacterScene = scene.use_character;
  const model = isCharacterScene ? MODELS.characterImage : MODELS.conceptImage;

  const promptText = isCharacterScene
    ? `${CHARACTER_CONSISTENCY_PREFIX}${scene.image_prompt}, ${STYLE_ANCHOR}`
    : `${scene.image_prompt}, ${STYLE_ANCHOR}`;

  const contents: Part[] =
    isCharacterScene && characterRefPart
      ? [characterRefPart, { text: promptText }]
      : [{ text: promptText }];

  console.log(
    `[ImageGenerator] Escena ${scene.id} (${isCharacterScene ? "Nano Banana Pro" : "Nano Banana 2.1"}) -> ${model}`,
  );

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: VIDEO_CONFIG.aspectRatio,
      },
    },
  });

  const imageBuffer = extractImageBuffer(response, scene.id);
  const outputPath = path.join(outputDir, formatSceneFilename(scene.id));
  await fsp.writeFile(outputPath, imageBuffer);

  console.log(`[ImageGenerator] Guardada escena ${scene.id} -> ${outputPath}`);
  return outputPath;
}

export async function generateSceneImages(
  storyboardPath: string = PATHS.storyboard,
  characterRefPath: string = PATHS.characterRef,
  outputDir: string = PATHS.scenesDir,
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
  }

  if (!fs.existsSync(storyboardPath)) {
    throw new Error(`No se encontró el storyboard en: ${storyboardPath}`);
  }

  const storyboardRaw = await fsp.readFile(storyboardPath, "utf-8");
  const storyboard = JSON.parse(storyboardRaw) as Storyboard;

  const needsCharacter = storyboard.scenes.some((scene) => scene.use_character);
  const characterRefPart = needsCharacter
    ? await loadCharacterReferencePart(characterRefPath)
    : null;

  await fsp.mkdir(outputDir, { recursive: true });

  const ai = new GoogleGenAI({ apiKey });
  const limit = pLimit(IMAGE_GENERATION_CONCURRENCY);

  console.log(
    `[ImageGenerator] Generando ${storyboard.scenes.length} escenas (concurrencia: ${IMAGE_GENERATION_CONCURRENCY})...`,
  );

  const outputPaths = await Promise.all(
    storyboard.scenes.map((scene) =>
      limit(() => generateSceneImage(ai, scene, outputDir, characterRefPart)),
    ),
  );

  console.log(
    `[ImageGenerator] Completadas ${outputPaths.length} imágenes en ${outputDir}`,
  );

  return outputPaths;
}
