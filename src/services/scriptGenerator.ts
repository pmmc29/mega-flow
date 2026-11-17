import type {
  CameraMotion,
  Scene,
  ScriptGenerationOptions,
  Storyboard,
} from "../types/pipeline.js";
import {
  applyTemplateVars,
  DEFAULT_GLOBAL_FORMATS,
  type ModularFormats,
} from "./formatConfig.js";

export type MasterPromptModuleKey =
  | "guion_limpio"
  | "elevenlabs"
  | "remotion"
  | "storyboard";

const ALL_MASTER_MODULES: MasterPromptModuleKey[] = [
  "guion_limpio",
  "elevenlabs",
  "remotion",
  "storyboard",
];

export function buildRetentionScriptPrompt(
  options: ScriptGenerationOptions,
  formats: ModularFormats = DEFAULT_GLOBAL_FORMATS,
  includedModules?: MasterPromptModuleKey[],
): string {
  const activeSet = new Set<MasterPromptModuleKey>(
    Array.isArray(includedModules) && includedModules.length > 0
      ? includedModules
      : ALL_MASTER_MODULES,
  );

  const targetWords = Math.round((options.durationSeconds / 60) * 140);
  const approxScenes = Math.max(4, Math.round(options.durationSeconds / 4));
  const midEndSeconds = Math.max(20, options.durationSeconds - 10);
  const customLine = options.customInstructions?.trim()
    ? `- Instrucciones adicionales: ${options.customInstructions.trim()}`
    : "";

  const vars = {
    topic: options.topic,
    durationSeconds: options.durationSeconds,
    targetWords,
    approxScenes,
    midEndSeconds,
    tone: options.tone,
    customInstructions: customLine,
  };

  const roleIntro = applyTemplateVars(formats.prompt_maestro.roleIntro, vars);
  const retentionStructure = applyTemplateVars(formats.prompt_maestro.retentionStructure, vars);
  const outputRules = applyTemplateVars(formats.prompt_maestro.outputRules, vars);

  const parts: string[] = [roleIntro, "", retentionStructure];

  if (activeSet.has("guion_limpio")) {
    parts.push("", applyTemplateVars(formats.guion_limpio.rules, vars));
  }
  if (activeSet.has("elevenlabs")) {
    parts.push("", applyTemplateVars(formats.elevenlabs.tagGuide, vars));
  }

  parts.push("", outputRules, "", "```text");

  if (activeSet.has("guion_limpio")) {
    parts.push(
      "=== GUION_LIMPIO ===",
      applyTemplateVars(formats.guion_limpio.placeholderHint, vars),
      "",
    );
  }
  if (activeSet.has("elevenlabs")) {
    parts.push(
      "=== ELEVENLABS ===",
      applyTemplateVars(formats.elevenlabs.placeholderHint, vars),
      "",
    );
  }
  if (activeSet.has("remotion")) {
    parts.push(
      "=== REMOTION_JSON ===",
      applyTemplateVars(formats.remotion.schemaExample, vars),
      "",
    );
  }
  if (activeSet.has("storyboard")) {
    parts.push(
      "=== STORYBOARD_JSON ===",
      applyTemplateVars(formats.storyboard.schemaExample, vars),
      "",
    );
  }

  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  parts.push("```");

  if (activeSet.has("remotion")) {
    parts.push("", applyTemplateVars(formats.remotion.notes, vars));
  }
  if (activeSet.has("storyboard")) {
    parts.push("", applyTemplateVars(formats.storyboard.notes, vars));
  }

  return parts.filter((line, idx, arr) => !(line === "" && arr[idx - 1] === "")).join("\n");
}

export function buildElevenLabsTagPrompt(
  cleanScript: string,
  tone: string = "curioso y dinámico",
  formats: ModularFormats = DEFAULT_GLOBAL_FORMATS,
): string {
  const elevenGuide = applyTemplateVars(formats.elevenlabs.tagGuide, { tone });
  return [
    `Actúa como un director de doblaje experto en ElevenLabs v3 y v4.`,
    `Toma el siguiente guion en español y devuélveme exactamente el mismo texto hablado, sin cambiar ni eliminar ninguna palabra, añadiendo únicamente etiquetas de audio de ElevenLabs entre corchetes.`,
    "",
    `Tono deseado: ${tone}`,
    "",
    elevenGuide,
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

  if (!extracted.clean && !extracted.eleven && !extracted.remotion && !extracted.storyboard) {
    throw new Error("El bloque pegado no contiene contenido en ninguna de las secciones.");
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

export function buildMusicPrompt(
  options: {
    topic: string;
    scriptText: string;
    durationSeconds?: number;
    tone?: string;
    remotionStyle?: {
      hook_badge?: string;
      vignette?: number;
      default_transition?: string;
    } | null;
  },
  formats: ModularFormats = DEFAULT_GLOBAL_FORMATS,
): string {
  const tone = (options.tone || "curioso y dinámico").trim().toLowerCase();
  const words = options.scriptText.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration =
    options.durationSeconds || Math.max(20, Math.round((words / 140) * 60));

  const moods = formats.musica.moods || DEFAULT_GLOBAL_FORMATS.musica.moods;
  const mood =
    moods[tone] ??
    moods["curioso y dinámico"] ??
    Object.values(moods)[0] ??
    DEFAULT_GLOBAL_FORMATS.musica.moods["curioso y dinámico"];
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

  return applyTemplateVars(formats.musica.template, {
    durationSeconds: estimatedDuration,
    topic: options.topic.trim(),
    hookSnippet,
    mood,
    atmosphereHint,
    pacingHint,
  });
}
