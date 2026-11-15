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
    `Formato de respuesta OBLIGATORIO:`,
    `- Devuelve TODA tu respuesta dentro de UN ÚNICO bloque de código (\`\`\`text ... \`\`\`) para que pueda copiarlo con un solo clic.`,
    `- No escribas explicaciones ni texto fuera de ese bloque.`,
    `- Dentro de ese único bloque, usa exactamente estos tres separadores en este orden:`,
    ``,
    `\`\`\`text`,
    `=== GUION_LIMPIO ===`,
    `(Solo el texto hablado en español, fluido, sin títulos de bloques ni etiquetas entre corchetes)`,
    ``,
    `=== ELEVENLABS ===`,
    `(Exactamente el mismo texto hablado en español, pero con las etiquetas de audio [curious], [whispers], [laughs], etc. insertadas en los momentos clave)`,
    ``,
    `=== REMOTION_JSON ===`,
    `{`,
    `  "hook_badge": "TEXTO CORTO (2-4 palabras gancho para los primeros 2.6s, ej: DATO OCULTO)",`,
    `  "accent_color": "#HEX_COLOR",`,
    `  "caption_style": "bold_outline | pill_dark | glow",`,
    `  "vignette": 0.35,`,
    `  "hook_shake": true,`,
    `  "default_transition": "cut | fade | slide_up | zoom_punch",`,
    `  "scene_transitions": ["zoom_punch", "cut", "slide_up"]`,
    `}`,
    `\`\`\``,
    ``,
    `Notas para REMOTION_JSON (JSON válido sin comentarios, adaptado al tema, duración y tono "${options.tone}"):`,
    `- "vignette": número entre 0 y 0.8 (0 = sin viñeta, 0.55 = ambiente oscuro/misterio).`,
    `- "hook_shake" (true/false): vibración sutil en la escena 1 para frenar el scroll.`,
    `- "scene_transitions": array opcional con una transición por escena ("cut", "fade", "slide_up", "zoom_punch") acorde al ritmo del guion.`,
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

export interface UnifiedScriptBundle {
  cleanScript: string;
  elevenlabsScript: string;
  remotionStyle: string;
}

export function parseUnifiedScriptBundle(rawText: string): UnifiedScriptBundle {
  let text = rawText.trim();

  // Remove outer markdown code fence if the user pasted it with ```text ... ```
  const outerFenceMatch = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (outerFenceMatch) {
    text = outerFenceMatch[1].trim();
  }

  const cleanHeader = /^===\s*(?:1\.\s*)?GUION[_\s]+LIMPIO[^=]*===\s*$/im;
  const elevenHeader = /^===\s*(?:2\.\s*)?(?:GUION\s+)?ELEVENLABS[^=]*===\s*$/im;
  const remotionHeader = /^===\s*(?:3\.\s*)?(?:REMOTION[_\s]+JSON|DIRECCI[ÓO]N\s+VISUAL\s+REMOTION[^=]*)===\s*$/im;

  const cleanMatch = cleanHeader.exec(text);
  const elevenMatch = elevenHeader.exec(text);
  const remotionMatch = remotionHeader.exec(text);

  if (!cleanMatch && !elevenMatch && !remotionMatch) {
    throw new Error(
      "No se encontraron los separadores === GUION_LIMPIO ===, === ELEVENLABS === y === REMOTION_JSON ===.",
    );
  }

  const sections: Array<{ key: "clean" | "eleven" | "remotion"; start: number; endOfHeader: number }> = [];
  if (cleanMatch) {
    sections.push({
      key: "clean",
      start: cleanMatch.index,
      endOfHeader: cleanMatch.index + cleanMatch[0].length,
    });
  }
  if (elevenMatch) {
    sections.push({
      key: "eleven",
      start: elevenMatch.index,
      endOfHeader: elevenMatch.index + elevenMatch[0].length,
    });
  }
  if (remotionMatch) {
    sections.push({
      key: "remotion",
      start: remotionMatch.index,
      endOfHeader: remotionMatch.index + remotionMatch[0].length,
    });
  }

  sections.sort((a, b) => a.start - b.start);

  const extracted: Record<"clean" | "eleven" | "remotion", string> = {
    clean: "",
    eleven: "",
    remotion: "",
  };

  for (let i = 0; i < sections.length; i++) {
    const curr = sections[i];
    const nextStart = i + 1 < sections.length ? sections[i + 1].start : text.length;
    extracted[curr.key] = text.slice(curr.endOfHeader, nextStart).trim();
  }

  if (!extracted.clean) {
    throw new Error("Falta el contenido de === GUION_LIMPIO === en el bloque pegado.");
  }

  let formattedRemotion = "";
  if (extracted.remotion) {
    let rawJson = extracted.remotion
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error(
        "La sección === REMOTION_JSON === no contiene un JSON válido. Revisa llaves, comillas y comas.",
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("La sección === REMOTION_JSON === debe ser un objeto JSON { ... }.");
    }

    formattedRemotion = JSON.stringify(parsed, null, 2);
  }

  return {
    cleanScript: extracted.clean,
    elevenlabsScript: extracted.eleven,
    remotionStyle: formattedRemotion,
  };
}
