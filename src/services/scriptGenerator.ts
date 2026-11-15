import type { ScriptGenerationOptions } from "../types/pipeline.js";

const ELEVENLABS_TAG_GUIDE = `Reglas para la versión ElevenLabs v3 / v4:
- Conserva exactamente las mismas palabras habladas en español de la versión limpia.
- Inserta instrucciones breves entre corchetes en INGLÉS justo antes de la frase donde cambia la emoción, entonación o reacción:
  - Emociones: [curious], [excited], [serious], [surprised], [mischievously], [worried], [confident]
  - Entonación: [whispers], [shouts], [slows down], [fast]
  - Reacciones humanas: [sighs], [laughs], [chuckles], [gasps], [clears throat]
- Usa entre 4 y 8 etiquetas bien distribuidas para que suene natural y expresivo sin saturar cada frase.`;

export function buildRetentionScriptPrompt(options: ScriptGenerationOptions): string {
  const targetWords = Math.round((options.durationSeconds / 60) * 140);

  const lines = [
    `Actúa como un guionista experto en retención máxima para videos verticales cortos (YouTube Shorts, TikTok, Instagram Reels) del canal "Mega Studio".`,
    "",
    `Datos del video:`,
    `- Tema / Idea: ${options.topic}`,
    `- Duración objetivo: ~${options.durationSeconds} segundos (aproximadamente ${targetWords} palabras a ritmo de locución normal ~140 palabras/min).`,
    `- Tono deseado: ${options.tone}`,
  ];

  if (options.customInstructions?.trim()) {
    lines.push(`- Instrucciones adicionales: ${options.customInstructions.trim()}`);
  }

  lines.push(
    "",
    `Estructura obligatoria de máxima retención:`,
    `1. Hook (0–3s): Frena el scroll al instante con un dato contraintuitivo, pregunta directa o afirmación impactante. PROHIBIDO saludar ("Hola", "Bienvenidos", "Hoy vamos a ver").`,
    `2. Tensión (3–10s): Abre una brecha de curiosidad explicando por qué importa o qué creencia común es falsa.`,
    `3. Micro-beats visuales (10–35s): 3 o 4 bloques cortos (de 3 a 5 segundos cada uno) con cambios de ritmo ("Pero aquí viene lo raro...", "Lo que casi nadie nota...") y analogías fáciles de ilustrar.`,
    `4. Clímax (35–45s): Entrega el momento "Aha!" o revelación principal.`,
    `5. Loop / CTA suave: Cierre circular que conecta con la primera frase o deja una pregunta abierta específica para comentarios (sin pedir likes genéricos).`,
    "",
    ELEVENLABS_TAG_GUIDE,
    "",
    `Formato de respuesta obligatorio (entrégamelo en exactamente estas dos secciones listas para copiar y pegar):`,
    ``,
    `=== 1. GUION LIMPIO (pegar en Mega Studio -> Guion Limpio) ===`,
    `(Solo el texto hablado en español, fluido, sin títulos de bloques ni etiquetas entre corchetes).`,
    ``,
    `=== 2. GUION ELEVENLABS V3/V4 (pegar en Mega Studio -> ElevenLabs v3/v4) ===`,
    `(Exactamente el mismo texto hablado en español, pero con las etiquetas de audio [curious], [whispers], [laughs], etc. insertadas en los momentos clave).`,
  );

  return lines.join("\n");
}

export function buildElevenLabsTagPrompt(
  cleanScript: string,
  tone: string = "curioso y dinámico",
): string {
  return [
    `Actúa como un director de doblaje experto en ElevenLabs v3 y v4.`,
    `Toma el siguiente guion en español y devuélveme exactamente el mismo texto hablado, sin cambiar ni eliminar ninguna palabra, añadiendo únicamente etiquetas de audio de ElevenLabs entre corchetes.`,
    "",
    `Tono deseado: ${tone}`,
    "",
    ELEVENLABS_TAG_GUIDE,
    "",
    `Guion original:`,
    cleanScript.trim(),
    "",
    `Devuélveme únicamente el texto final listo para copiar y pegar en ElevenLabs (y en la pestaña "ElevenLabs v3 / v4" de Mega Studio).`,
  ].join("\n");
}
