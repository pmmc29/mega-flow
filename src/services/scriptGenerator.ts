import type {
  CameraMotion,
  Scene,
  ScriptGenerationOptions,
  Storyboard,
} from "../types/pipeline.js";

const ELEVENLABS_TAG_GUIDE = `Reglas para la versión ElevenLabs v3 / v4:
- Conserva exactamente las mismas palabras habladas en español de la versión limpia.
- Inserta instrucciones breves entre corchetes en INGLÉS justo antes de la frase donde cambia la emoción, entonación o reacción:
  - Emociones: [curious], [excited], [serious], [surprised], [mischievously], [worried], [confident]
  - Entonación: [whispers], [shouts], [slows down], [fast]
  - Reacciones humanas: [sighs], [laughs], [chuckles], [gasps], [clears throat]
- Usa entre 4 y 8 etiquetas bien distribuidas para que suene natural y expresivo sin saturar cada frase.`;

export function buildRetentionScriptPrompt(options: ScriptGenerationOptions): string {
  const targetWords = Math.round((options.durationSeconds / 60) * 140);
  const approxScenes = Math.max(4, Math.round(options.durationSeconds / 4));

  const lines = [
    `Actúa como un guionista experto en retención máxima y director visual para videos verticales cortos (YouTube Shorts, TikTok, Instagram Reels) del canal "Mega Studio".`,
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
    `3. Micro-beats visuales (10–${Math.max(20, options.durationSeconds - 10)}s): bloques cortos (de 3 a 5 segundos cada uno) con cambios de ritmo ("Pero aquí viene lo raro...", "Lo que casi nadie nota...") y analogías fáciles de ilustrar.`,
    `4. Clímax: Entrega el momento "Aha!" o revelación principal.`,
    `5. Loop / CTA suave: Cierre circular que conecta con la primera frase o deja una pregunta abierta específica para comentarios (sin pedir likes genéricos).`,
    "",
    ELEVENLABS_TAG_GUIDE,
    "",
    `Formato de respuesta OBLIGATORIO:`,
    `- Devuelve TODA tu respuesta dentro de UN ÚNICO bloque de código (\`\`\`text ... \`\`\`) para que pueda copiarlo con un solo clic.`,
    `- No escribas explicaciones ni texto fuera de ese bloque.`,
    `- Dentro de ese único bloque, usa exactamente estos cuatro separadores en este orden:`,
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
    `  "scene_transitions": ["zoom_punch", "cut", "slide_up"],`,
    `  "music_volume": 0.12`,
    `}`,
    ``,
    `=== STORYBOARD_JSON ===`,
    `{`,
    `  "title": "Título atractivo y corto para Shorts/Reels/TikTok",`,
    `  "caption": "Descripción breve para redes + #MegaExplains #Curiosidades",`,
    `  "scenes": [`,
    `    {`,
    `      "id": 1,`,
    `      "start": 0.0,`,
    `      "end": 3.8,`,
    `      "use_character": true,`,
    `      "image_prompt": "Detailed vertical 9:16 scene prompt in English, no embedded text, leaving clean negative space in the lower third for subtitles...",`,
    `      "camera_motion": "zoom_in"`,
    `    }`,
    `  ]`,
    `}`,
    `\`\`\``,
    ``,
    `Notas para REMOTION_JSON (JSON válido sin comentarios, adaptado al tema, duración y tono "${options.tone}"):`,
    `- "vignette": número entre 0 y 0.8 (0 = sin viñeta, 0.55 = ambiente oscuro/misterio).`,
    `- "hook_shake" (true/false): vibración sutil en la escena 1 para frenar el scroll.`,
    `- "scene_transitions": array opcional con una transición por escena ("cut", "fade", "slide_up", "zoom_punch").`,
    ``,
    `Notas para STORYBOARD_JSON (JSON válido sin comentarios):`,
    `- Divide el guion en ~${approxScenes} escenas secuenciales de 3.0 a 5.0 segundos cada una, cubriendo desde 0.0 hasta ${options.durationSeconds}.0 segundos (el "end" de cada escena debe coincidir exactamente con el "start" de la siguiente).`,
    `- "use_character": true cuando la escena requiera reacción emocional, presentación o interacción del anfitrión; false para diagramas, objetos, escenarios o conceptos abstractos.`,
    `- "image_prompt": SIEMPRE en INGLÉS, muy descriptivo, sin texto dentro de la imagen y dejando espacio visual libre en el tercio inferior para los subtítulos.`,
    `- "camera_motion": varía entre "zoom_in", "zoom_out", "pan_left", "pan_right".`,
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
  storyboard?: string;
}

const VALID_MOTIONS = new Set<CameraMotion>(["zoom_in", "zoom_out", "pan_left", "pan_right"]);

function validateAndFormatStoryboard(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("La sección === STORYBOARD_JSON === debe ser un objeto JSON { ... }.");
  }

  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Video Mega Studio";
  const caption =
    typeof obj.caption === "string" && obj.caption.trim()
      ? obj.caption.trim()
      : "#MegaExplains #Curiosidades";

  if (!Array.isArray(obj.scenes) || obj.scenes.length === 0) {
    throw new Error("STORYBOARD_JSON debe incluir un array 'scenes' con al menos una escena.");
  }

  const normalizedScenes: Scene[] = obj.scenes.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`La escena ${idx + 1} en STORYBOARD_JSON no es un objeto válido.`);
    }
    const s = item as Record<string, unknown>;
    const start = Number(s.start);
    const end = Number(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`La escena ${idx + 1} en STORYBOARD_JSON tiene tiempos start/end inválidos.`);
    }
    const imagePrompt = typeof s.image_prompt === "string" ? s.image_prompt.trim() : "";
    if (!imagePrompt) {
      throw new Error(`La escena ${idx + 1} en STORYBOARD_JSON no tiene image_prompt.`);
    }
    const motionRaw = typeof s.camera_motion === "string" ? s.camera_motion.trim() : "zoom_in";
    const camera_motion: CameraMotion = VALID_MOTIONS.has(motionRaw as CameraMotion)
      ? (motionRaw as CameraMotion)
      : "zoom_in";

    return {
      id: idx + 1,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      use_character: Boolean(s.use_character),
      image_prompt: imagePrompt,
      camera_motion,
    };
  });

  // Asegurar continuidad entre escenas sin huecos
  for (let i = 0; i < normalizedScenes.length - 1; i++) {
    normalizedScenes[i].end = normalizedScenes[i + 1].start;
  }

  const formatted: Storyboard = {
    title,
    caption,
    scenes: normalizedScenes,
  };
  return JSON.stringify(formatted, null, 2);
}

export function parseUnifiedScriptBundle(rawText: string): UnifiedScriptBundle {
  let text = rawText.trim();

  // Remove outer markdown code fence if the user pasted it with ```text ... ```
  const outerFenceMatch = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (outerFenceMatch) {
    text = outerFenceMatch[1].trim();
  }

  const cleanHeader = /^[#*\s-]*===\s*(?:1\.\s*)?GUION[_\s]+LIMPIO[^\n=]*===[*\s]*$/im;
  const elevenHeader = /^[#*\s-]*===\s*(?:2\.\s*)?(?:GUION\s+)?ELEVENLABS[^\n=]*===[*\s]*$/im;
  const remotionHeader = /^[#*\s-]*===\s*(?:3\.\s*)?(?:REMOTION[^\n=]*|DIRECCI[ÓO]N\s+VISUAL[^\n=]*)===[*\s]*$/im;
  const storyboardHeader = /^[#*\s-]*===\s*(?:4\.\s*)?STORYBOARD[^\n=]*===[*\s]*$/im;

  const cleanMatch = cleanHeader.exec(text);
  const elevenMatch = elevenHeader.exec(text);
  const remotionMatch = remotionHeader.exec(text);
  const storyboardMatch = storyboardHeader.exec(text);

  if (!cleanMatch && !elevenMatch && !remotionMatch && !storyboardMatch) {
    throw new Error(
      "No se encontraron los separadores === GUION_LIMPIO ===, === ELEVENLABS ===, === REMOTION_JSON === y === STORYBOARD_JSON ===.",
    );
  }

  const sections: Array<{
    key: "clean" | "eleven" | "remotion" | "storyboard";
    start: number;
    endOfHeader: number;
  }> = [];
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
  if (storyboardMatch) {
    sections.push({
      key: "storyboard",
      start: storyboardMatch.index,
      endOfHeader: storyboardMatch.index + storyboardMatch[0].length,
    });
  }

  sections.sort((a, b) => a.start - b.start);

  const extracted: Record<"clean" | "eleven" | "remotion" | "storyboard", string> = {
    clean: "",
    eleven: "",
    remotion: "",
    storyboard: "",
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
    const rawJson = extracted.remotion
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

  let formattedStoryboard: string | undefined;
  if (extracted.storyboard) {
    const rawSbJson = extracted.storyboard
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsedSb: unknown;
    try {
      parsedSb = JSON.parse(rawSbJson);
    } catch {
      throw new Error(
        "La sección === STORYBOARD_JSON === no contiene un JSON válido. Revisa llaves, comillas y comas.",
      );
    }

    formattedStoryboard = validateAndFormatStoryboard(parsedSb);
  }

  return {
    cleanScript: extracted.clean,
    elevenlabsScript: extracted.eleven,
    remotionStyle: formattedRemotion,
    storyboard: formattedStoryboard,
  };
}

export function buildMusicPrompt(options: {
  topic: string;
  scriptText: string;
  durationSeconds?: number;
  tone?: string;
  remotionStyle?: {
    hook_badge?: string;
    vignette?: number;
    default_transition?: string;
  } | null;
}): string {
  const tone = (options.tone || "curioso y dinámico").trim().toLowerCase();
  const words = options.scriptText.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration =
    options.durationSeconds || Math.max(20, Math.round((words / 140) * 60));

  const moodByTone: Record<string, string> = {
    "curioso y dinámico":
      "curious, upbeat, inquisitive marimba plucks, soft analog synth pulse, crisp minimal percussion, 112 BPM",
    "misterio y urgencia":
      "mysterious, tense, cinematic low synth bass, subtle ticking percussion, atmospheric pads, 100 BPM",
    "educativo cercano":
      "warm, friendly, lo-fi acoustic guitar, soft Rhodes electric piano, gentle groove, 95 BPM",
    "humorístico e irónico":
      "playful, quirky, pizzicato strings, bouncy bassline, lighthearted woodwinds, 118 BPM",
  };

  const mood = moodByTone[tone] ?? moodByTone["curioso y dinámico"];
  const hookSnippet = options.scriptText.trim().replace(/\s+/g, " ").slice(0, 140);
  const pacingHint =
    options.remotionStyle?.default_transition === "zoom_punch" ||
    options.remotionStyle?.default_transition === "cut"
      ? "punchy modern pacing with subtle rhythmic lift"
      : "smooth flowing progression with gentle build-up";
  const atmosphereHint =
    typeof options.remotionStyle?.vignette === "number" && options.remotionStyle.vignette >= 0.4
      ? ", slightly dark cinematic atmosphere"
      : "";

  return [
    `Instrumental background track (~${estimatedDuration}s) for a vertical explainer video about "${options.topic.trim()}".`,
    `Script opening context: "${hookSnippet}..."`,
    `Style: ${mood}${atmosphereHint}; ${pacingHint}.`,
    `Clean, uncluttered mix leaving midrange space for Spanish voiceover, soft intro for the hook, steady loopable groove, NO vocals, NO lyrics, NO harsh leads.`,
  ].join(" ");
}
