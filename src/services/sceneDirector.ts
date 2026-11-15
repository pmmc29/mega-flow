import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { MODELS, PATHS } from "../config/styleConfig.js";
import type { Storyboard, TranscriptionResult } from "../types/pipeline.js";

const STORYBOARD_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: "Título atractivo para redes sociales (YouTube Shorts, TikTok, Reels).",
    },
    caption: {
      type: Type.STRING,
      description: "Descripción corta con hashtags relevantes, incluyendo #MegaExplains.",
    },
    scenes: {
      type: Type.ARRAY,
      description: "Lista secuencial de escenas visuales que cubren toda la duración del audio.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: "Número secuencial de la escena comenzando en 1.",
          },
          start: {
            type: Type.NUMBER,
            description: "Tiempo de inicio en segundos.",
          },
          end: {
            type: Type.NUMBER,
            description: "Tiempo de fin en segundos (debe coincidir con el start de la siguiente escena).",
          },
          use_character: {
            type: Type.BOOLEAN,
            description:
              "true si la escena requiere reacción emocional, presentación o interacción del anfitrión; false para diagramas, objetos, escenarios o conceptos abstractos.",
          },
          image_prompt: {
            type: Type.STRING,
            description:
              "Prompt descriptivo en inglés para generar la imagen vertical, sin texto embebido (salvo etiqueta mínima) y dejando aire en el tercio inferior para subtítulos.",
          },
          camera_motion: {
            type: Type.STRING,
            enum: ["zoom_in", "zoom_out", "pan_left", "pan_right"],
            description: "Movimiento de cámara suave para la escena.",
          },
        },
        required: ["id", "start", "end", "use_character", "image_prompt", "camera_motion"],
      },
    },
  },
  required: ["title", "caption", "scenes"],
};

const SYSTEM_INSTRUCTION = `Eres el Director de Escenas de "Mega Explains", un canal de videos educativos y curiosidades en formato vertical (9:16).
Tu tarea es convertir un guion y sus marcas de tiempo palabra por palabra en un storyboard visual dinámico.

Reglas estrictas:
1. Divide la narración en bloques visuales de 3.0 a 5.0 segundos como máximo para mantener un ritmo dinámico de retención vertical.
2. La primera escena debe iniciar exactamente en 0.0 y la última debe terminar exactamente en la duración total del audio.
3. El campo "end" de cada escena debe coincidir exactamente con el "start" de la siguiente escena para evitar pantallas negras.
4. Determina "use_character":
   - true: cuando la escena requiera reacción emocional, presentación directa o interacción física del anfitrión.
   - false: para diagramas, objetos, escenarios, metáforas visuales o conceptos abstractos.
5. Escribe "image_prompt" en INGLÉS, muy descriptivo visualmente, evitando texto dentro de la imagen (a menos que sea una etiqueta mínima indispensable) y dejando espacio visual libre (aire) en el tercio inferior para los subtítulos.
6. Asigna un "camera_motion" variado entre: "zoom_in", "zoom_out", "pan_left", "pan_right".`;

export async function generateStoryboard(
  scriptPath: string = PATHS.script,
  timestampsPath: string = PATHS.timestamps,
  outputPath: string = PATHS.storyboard,
): Promise<Storyboard> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`No se encontró el guion en: ${scriptPath}`);
  }
  if (!fs.existsSync(timestampsPath)) {
    throw new Error(`No se encontraron los timestamps en: ${timestampsPath}`);
  }

  const [scriptText, timestampsRaw] = await Promise.all([
    fsp.readFile(scriptPath, "utf-8"),
    fsp.readFile(timestampsPath, "utf-8"),
  ]);

  const timestamps = JSON.parse(timestampsRaw) as TranscriptionResult;
  const ai = new GoogleGenAI({ apiKey });

  console.log(`[SceneDirector] Generando storyboard con ${MODELS.sceneDirector}...`);

  const userPrompt = [
    `Duración total del audio: ${timestamps.duration} segundos.`,
    "",
    "Guion original:",
    scriptText.trim(),
    "",
    "Timestamps palabra por palabra (JSON):",
    JSON.stringify(timestamps.words),
  ].join("\n");

  const response = await ai.models.generateContent({
    model: MODELS.sceneDirector,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: STORYBOARD_SCHEMA,
      temperature: 0.4,
    },
  });

  const rawJson = response.text;
  if (!rawJson) {
    throw new Error("Gemini no devolvió contenido en la respuesta del storyboard.");
  }

  const storyboard = JSON.parse(rawJson) as Storyboard;

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(storyboard, null, 2), "utf-8");

  console.log(
    `[SceneDirector] Storyboard generado (${storyboard.scenes.length} escenas) -> ${outputPath}`,
  );

  return storyboard;
}
