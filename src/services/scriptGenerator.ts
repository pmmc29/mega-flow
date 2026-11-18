import { STYLE_ANCHOR } from "../config/styleConfig.js";
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
  | "flow_visual"
  | "musica"
  | "storyboard";

const ALL_MASTER_MODULES: MasterPromptModuleKey[] = [
  "guion_limpio",
  "elevenlabs",
  "remotion",
  "flow_visual",
  "musica",
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
  const musicDurationSeconds = Math.max(
    options.durationSeconds + 15,
    Math.round(options.durationSeconds * 1.25),
  );
  const characterStatus =
    options.hasCharacter === false
      ? "No hay personaje anfitrión (usa use_character: false en todas las escenas)"
      : "Sí, hay personaje de referencia cargado (usa use_character: true en las escenas donde aparezca el anfitrión)";
  const customLine = options.customInstructions?.trim()
    ? `- Notas / Estilo deseado: ${options.customInstructions.trim()}`
    : "";
  const styleAnchor = (formats.flow_visual.styleAnchor || STYLE_ANCHOR).trim();

  const vars = {
    topic: options.topic,
    durationSeconds: options.durationSeconds,
    targetWords,
    approxScenes,
    midEndSeconds,
    musicDurationSeconds,
    characterStatus,
    tone: options.tone || "deducido del tema",
    styleAnchor,
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
  if (activeSet.has("flow_visual")) {
    parts.push(
      "=== FLOW_VISUAL ===",
      applyTemplateVars(formats.flow_visual.schemaExample, vars),
      "",
    );
  }
  if (activeSet.has("musica")) {
    parts.push(
      "=== MUSICA_PROMPT ===",
      applyTemplateVars(formats.musica.placeholderHint, vars),
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
  if (activeSet.has("flow_visual")) {
    parts.push("", applyTemplateVars(formats.flow_visual.promptRules, vars));
  }
  if (activeSet.has("musica")) {
    parts.push("", applyTemplateVars(formats.musica.promptRules, vars));
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
  flowVisual?: {
    styleAnchor?: string;
    characterPrefix?: string;
  };
  musicPrompt?: string;
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
  const flowHeader = /^[#*\s-]*===\s*(?:4\.\s*)?FLOW[_\s]+VISUAL[^\n=]*===[*\s]*$/im;
  const musicHeader = /^[#*\s-]*===\s*(?:5\.\s*)?MUSICA[_\s]+PROMPT[^\n=]*===[*\s]*$/im;
  const storyboardHeader = /^[#*\s-]*===\s*(?:[46]\.\s*)?STORYBOARD[^\n=]*===[*\s]*$/im;

  const cleanMatch = cleanHeader.exec(text);
  const elevenMatch = elevenHeader.exec(text);
  const remotionMatch = remotionHeader.exec(text);
  const flowMatch = flowHeader.exec(text);
  const musicMatch = musicHeader.exec(text);
  const storyboardMatch = storyboardHeader.exec(text);

  if (
    !cleanMatch &&
    !elevenMatch &&
    !remotionMatch &&
    !flowMatch &&
    !musicMatch &&
    !storyboardMatch
  ) {
    throw new Error(
      "No se encontraron los separadores (=== GUION_LIMPIO ===, === ELEVENLABS ===, === REMOTION_JSON ===, === FLOW_VISUAL ===, === MUSICA_PROMPT ===, === STORYBOARD_JSON ===).",
    );
  }

  type SectionKey = "clean" | "eleven" | "remotion" | "flow" | "music" | "storyboard";
  const sections: Array<{
    key: SectionKey;
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
  if (flowMatch) {
    sections.push({
      key: "flow",
      start: flowMatch.index,
      endOfHeader: flowMatch.index + flowMatch[0].length,
    });
  }
  if (musicMatch) {
    sections.push({
      key: "music",
      start: musicMatch.index,
      endOfHeader: musicMatch.index + musicMatch[0].length,
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

  const extracted: Record<SectionKey, string> = {
    clean: "",
    eleven: "",
    remotion: "",
    flow: "",
    music: "",
    storyboard: "",
  };

  for (let i = 0; i < sections.length; i++) {
    const curr = sections[i];
    const nextStart = i + 1 < sections.length ? sections[i + 1].start : text.length;
    extracted[curr.key] = text.slice(curr.endOfHeader, nextStart).trim();
  }

  if (
    !extracted.clean &&
    !extracted.eleven &&
    !extracted.remotion &&
    !extracted.flow &&
    !extracted.music &&
    !extracted.storyboard
  ) {
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

  let parsedFlowVisual: { styleAnchor?: string; characterPrefix?: string } | undefined;
  if (extracted.flow) {
    const rawFlowJson = extracted.flow
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    let parsedFlow: unknown;
    try {
      parsedFlow = JSON.parse(rawFlowJson);
    } catch {
      throw new Error(
        "La sección === FLOW_VISUAL === no contiene un JSON válido. Revisa llaves, comillas y comas.",
      );
    }
    if (!parsedFlow || typeof parsedFlow !== "object" || Array.isArray(parsedFlow)) {
      throw new Error("La sección === FLOW_VISUAL === debe ser un objeto JSON { ... }.");
    }
    const obj = parsedFlow as Record<string, unknown>;
    parsedFlowVisual = {};
    if (typeof obj.styleAnchor === "string" && obj.styleAnchor.trim()) {
      parsedFlowVisual.styleAnchor = obj.styleAnchor.trim();
    }
    if (typeof obj.characterPrefix === "string" && obj.characterPrefix.trim()) {
      parsedFlowVisual.characterPrefix = obj.characterPrefix.trim();
    }
  }

  let parsedMusicPrompt: string | undefined;
  if (extracted.music) {
    parsedMusicPrompt = extracted.music
      .replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .replace(/^["']|["']$/g, "")
      .trim();
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

  const cleanScript = extracted.clean ? sanitizeCleanScript(extracted.clean) : "";

  return {
    cleanScript,
    elevenlabsScript: extracted.eleven,
    remotionStyle: formattedRemotion,
    flowVisual: parsedFlowVisual,
    musicPrompt: parsedMusicPrompt,
    storyboard: formattedStoryboard,
  };
}

function sanitizeCleanScript(raw: string): string {
  return raw
    .replace(/^```(?:\w+)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")
    .replace(/^\s*(?:hook|intro|tensi[oó]n|desarrollo|cl[ií]max|cierre|cta|loop)\s*:\s*/gim, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const template = formats.musica.template?.trim() || DEFAULT_GLOBAL_FORMATS.musica.template;
  if (!/\{\{\w+\}\}/.test(template)) {
    return template;
  }

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

  return applyTemplateVars(template, {
    durationSeconds: estimatedDuration,
    topic: options.topic.trim(),
    hookSnippet,
    mood,
    atmosphereHint,
    pacingHint,
  });
}
