import fsp from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { MODELS, PATHS } from "../config/styleConfig.js";
import type { GeneratedScript, ScriptGenerationOptions } from "../types/pipeline.js";

const SCRIPT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: "Título breve y atractivo para el video.",
    },
    retention_structure: {
      type: Type.OBJECT,
      properties: {
        hook: {
          type: Type.STRING,
          description: "Gancho inicial (0-3s): dato contraintuitivo o pregunta disruptiva sin saludos.",
        },
        tension: {
          type: Type.STRING,
          description: "Tensión o brecha de curiosidad (3-10s): por qué importa o qué error común existe.",
        },
        beats: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "De 3 a 4 micro-beats cortos (3-5s cada uno) con cambios de ritmo y analogías visuales.",
        },
        climax: {
          type: Type.STRING,
          description: "Revelación o dato más sorprendente del guion.",
        },
        loop_cta: {
          type: Type.STRING,
          description: "Cierre circular o pregunta abierta para comentarios (sin pedir likes genéricos).",
        },
      },
      required: ["hook", "tension", "beats", "climax", "loop_cta"],
    },
    clean_script: {
      type: Type.STRING,
      description:
        "Guion completo en español listo para leer en voz alta, sin etiquetas ni corchetes, uniendo todos los bloques de forma fluida.",
    },
    elevenlabs_script: {
      type: Type.STRING,
      description:
        "El mismo guion exacto de clean_script pero enriquecido con etiquetas de audio oficiales de ElevenLabs v3/v4 entre corchetes en inglés (ej. [curious], [whispers], [excited], [sighs], [laughs], [serious], [mischievously]) colocadas justo donde cambia la emoción, entonación o reacción.",
    },
  },
  required: ["title", "retention_structure", "clean_script", "elevenlabs_script"],
};

const ELEVENLABS_TAG_ONLY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    elevenlabs_script: {
      type: Type.STRING,
      description:
        "Guion original con etiquetas de audio de ElevenLabs v3/v4 entre corchetes en inglés colocadas estratégicamente.",
    },
  },
  required: ["elevenlabs_script"],
};

const ELEVENLABS_GUIDELINES = `Reglas para las etiquetas de audio de ElevenLabs v3 y v4:
- Coloca instrucciones breves entre corchetes en INGLÉS justo antes de la frase o palabra donde deba cambiar la entonación.
- Ejemplos válidos:
  - Emociones: [curious], [excited], [serious], [surprised], [mischievously], [worried], [confident]
  - Entonación: [whispers], [shouts], [slows down], [fast]
  - Reacciones humanas: [sighs], [laughs], [chuckles], [gasps], [clears throat]
- NO alteres, traduzcas ni elimines ninguna palabra hablada del guion en español.
- Usa entre 4 y 8 etiquetas bien distribuidas para que la locución suene natural y expresiva, sin saturar cada frase.`;

export interface ScriptTargetPaths {
  script: string;
  scriptElevenLabs: string;
  scriptStructure: string;
}

export async function generateRetentionScript(
  options: ScriptGenerationOptions,
  targetPaths: ScriptTargetPaths = PATHS,
): Promise<GeneratedScript> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
  }

  const targetWords = Math.round((options.durationSeconds / 60) * 140);
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `Eres un guionista experto en retención máxima para videos verticales cortos (YouTube Shorts, TikTok, Reels) del canal "Mega Studio".

Estructura obligatoria de máxima retención:
1. Hook (0-3s): Frena el scroll al instante con un dato contraintuitivo, pregunta directa o afirmación impactante. PROHIBIDO saludar ("Hola", "Bienvenidos", "Hoy vamos a ver").
2. Tensión (3-10s): Abre una brecha de curiosidad explicando por qué importa o qué creencia común es falsa.
3. Micro-beats (10-35s): 3 a 4 bloques cortos y visuales (de ~3 a 5 segundos cada uno) con cambios de ritmo ("Pero aquí viene lo raro...", "Lo que casi nadie sabe...") para facilitar cortes visuales dinámicos.
4. Clímax (35-45s): Entrega el momento "Aha!" o revelación principal.
5. Loop / CTA suave: Cierre que conecta con el inicio o deja una pregunta abierta específica para comentarios.

Extensión objetivo: aproximadamente ${targetWords} palabras para una duración de ~${options.durationSeconds} segundos (a ~140 palabras/minuto).

${ELEVENLABS_GUIDELINES}`;

  const userPrompt = [
    `Tema / Idea: ${options.topic}`,
    `Duración objetivo: ${options.durationSeconds} segundos (~${targetWords} palabras)`,
    `Tono deseado: ${options.tone}`,
    options.customInstructions?.trim()
      ? `Instrucciones adicionales del usuario: ${options.customInstructions.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`[ScriptGenerator] Generando guion de retención (${options.durationSeconds}s) con ${MODELS.sceneDirector}...`);

  const response = await ai.models.generateContent({
    model: MODELS.sceneDirector,
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: SCRIPT_SCHEMA,
      temperature: 0.7,
    },
  });

  if (!response.text) {
    throw new Error("Gemini no devolvió contenido al generar el guion.");
  }

  const generated = JSON.parse(response.text) as GeneratedScript;

  await Promise.all([
    fsp.mkdir(path.dirname(targetPaths.script), { recursive: true }),
    fsp.mkdir(path.dirname(targetPaths.scriptElevenLabs), { recursive: true }),
  ]);

  await Promise.all([
    fsp.writeFile(targetPaths.script, generated.clean_script, "utf-8"),
    fsp.writeFile(targetPaths.scriptElevenLabs, generated.elevenlabs_script, "utf-8"),
    fsp.writeFile(targetPaths.scriptStructure, JSON.stringify(generated, null, 2), "utf-8"),
  ]);

  console.log(`[ScriptGenerator] Guion generado y guardado en ${targetPaths.script}`);

  return generated;
}

export async function tagScriptForElevenLabs(
  cleanScript: string,
  tone: string = "curioso y dinámico",
  outputPath: string = PATHS.scriptElevenLabs,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY.");
  }

  if (!cleanScript.trim()) {
    throw new Error("El guion está vacío; escribe o genera un guion primero.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: MODELS.sceneDirector,
    contents: `Tono deseado: ${tone}\n\nGuion original:\n${cleanScript.trim()}`,
    config: {
      systemInstruction: `Eres un director de doblaje experto en ElevenLabs v3 y v4. Tu tarea es tomar el guion en español y devolver exactamente el mismo texto hablado añadiendo etiquetas de audio de ElevenLabs entre corchetes.\n\n${ELEVENLABS_GUIDELINES}`,
      responseMimeType: "application/json",
      responseSchema: ELEVENLABS_TAG_ONLY_SCHEMA,
      temperature: 0.5,
    },
  });

  if (!response.text) {
    throw new Error("Gemini no devolvió contenido al etiquetar para ElevenLabs.");
  }

  const parsed = JSON.parse(response.text) as { elevenlabs_script: string };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, parsed.elevenlabs_script, "utf-8");

  return parsed.elevenlabs_script;
}
