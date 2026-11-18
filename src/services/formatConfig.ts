import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CHARACTER_CONSISTENCY_PREFIX, PATHS, STYLE_ANCHOR } from "../config/styleConfig.js";

export type FormatModuleKey =
  | "prompt_maestro"
  | "guion_limpio"
  | "elevenlabs"
  | "remotion"
  | "storyboard"
  | "flow_visual"
  | "musica";

export type PromptIncludedModule =
  | "guion_limpio"
  | "elevenlabs"
  | "remotion"
  | "flow_visual"
  | "musica"
  | "storyboard";

export interface PromptMaestroFormat {
  includedModules: PromptIncludedModule[];
  roleIntro: string;
  retentionStructure: string;
  outputRules: string;
}

export interface GuionLimpioFormat {
  placeholderHint: string;
  rules: string;
}

export interface ElevenLabsFormat {
  placeholderHint: string;
  tagGuide: string;
}

export interface RemotionFormat {
  schemaExample: string;
  notes: string;
}

export interface StoryboardFormat {
  schemaExample: string;
  notes: string;
}

export interface FlowVisualFormat {
  schemaExample: string;
  promptRules: string;
  styleAnchor: string;
  characterPrefix: string;
}

export interface MusicaFormat {
  placeholderHint: string;
  promptRules: string;
  template: string;
  moods: Record<string, string>;
}

export interface ModularFormats {
  prompt_maestro: PromptMaestroFormat;
  guion_limpio: GuionLimpioFormat;
  elevenlabs: ElevenLabsFormat;
  remotion: RemotionFormat;
  storyboard: StoryboardFormat;
  flow_visual: FlowVisualFormat;
  musica: MusicaFormat;
}

export type PartialModularFormats = {
  [K in FormatModuleKey]?: Partial<ModularFormats[K]>;
};

export const FORMAT_MODULE_META: Array<{
  key: FormatModuleKey;
  label: string;
  description: string;
  variables: string[];
  hasProjectData: boolean;
}> = [
  {
    key: "prompt_maestro",
    label: "Prompt Maestro (Base)",
    description:
      "Rol, estructura de retención y reglas de salida. Ensambla automáticamente todos los módulos seleccionados a la medida del tema.",
    variables: [
      "{{topic}}",
      "{{durationSeconds}}",
      "{{targetWords}}",
      "{{approxScenes}}",
      "{{characterStatus}}",
      "{{customInstructions}}",
    ],
    hasProjectData: false,
  },
  {
    key: "guion_limpio",
    label: "1. Guion Limpio",
    description: "Formato y reglas del texto hablado limpio (=== GUION_LIMPIO ===).",
    variables: ["{{durationSeconds}}", "{{targetWords}}"],
    hasProjectData: true,
  },
  {
    key: "elevenlabs",
    label: "2. ElevenLabs (v3 / v4)",
    description: "Reglas y etiquetas emocionales/entonación (=== ELEVENLABS ===) para generar el voiceover.",
    variables: ["{{topic}}"],
    hasProjectData: true,
  },
  {
    key: "remotion",
    label: "3. Remotion JSON",
    description: "Esquema visual y reglas de estilo para Remotion (=== REMOTION_JSON ===).",
    variables: ["{{durationSeconds}}"],
    hasProjectData: true,
  },
  {
    key: "flow_visual",
    label: "4. Estilo Visual (Google Flow)",
    description:
      "Instrucciones para que el Prompt Maestro genere styleAnchor y characterPrefix a medida, y valores actuales aplicados.",
    variables: ["{{topic}}", "{{characterStatus}}"],
    hasProjectData: true,
  },
  {
    key: "musica",
    label: "5. Música de Fondo (ACE-Step)",
    description:
      "Instrucciones para que el Prompt Maestro genere el prompt instrumental (>= duración + colchón) y prompt actual.",
    variables: ["{{topic}}", "{{musicDurationSeconds}}"],
    hasProjectData: true,
  },
  {
    key: "storyboard",
    label: "6. Storyboard JSON",
    description: "Esquema de escenas, tiempos aproximados por palabras y prompts visuales (=== STORYBOARD_JSON ===).",
    variables: ["{{approxScenes}}", "{{durationSeconds}}", "{{characterStatus}}"],
    hasProjectData: true,
  },
];

export const DEFAULT_GLOBAL_FORMATS: ModularFormats = {
  prompt_maestro: {
    includedModules: ["guion_limpio", "elevenlabs", "remotion", "flow_visual", "musica", "storyboard"],
    roleIntro: [
      'Actúa como un guionista experto en retención máxima, director visual y productor musical para videos verticales cortos (YouTube Shorts, TikTok, Instagram Reels) del canal "Mega Studio".',
      "A partir del tema, deduce automáticamente el tono narrativo, la estética visual, la dirección de arte y el estilo musical más efectivos para maximizar la retención.",
      "",
      "Datos del video:",
      "- Tema / Idea: {{topic}}",
      "- Duración objetivo: ~{{durationSeconds}} segundos (aproximadamente {{targetWords}} palabras a ritmo de locución normal ~140 palabras/min).",
      "- Personaje anfitrión: {{characterStatus}}",
      "{{customInstructions}}",
    ].join("\n"),
    retentionStructure: [
      "Estructura obligatoria de máxima retención:",
      '1. Hook (0–3s): Frena el scroll al instante con un dato contraintuitivo, pregunta directa o afirmación impactante. PROHIBIDO saludar ("Hola", "Bienvenidos", "Hoy vamos a ver").',
      "2. Tensión (3–10s): Abre una brecha de curiosidad explicando por qué importa o qué creencia común es falsa.",
      '3. Micro-beats visuales (10–{{midEndSeconds}}s): bloques cortos (de 3 a 5 segundos cada uno) con cambios de ritmo ("Pero aquí viene lo raro...", "Lo que casi nadie nota...") y analogías fáciles de ilustrar.',
      '4. Clímax: Entrega el momento "Aha!" o revelación principal.',
      "5. Loop / CTA suave: Cierre circular que conecta con la primera frase o deja una pregunta abierta específica para comentarios (sin pedir likes genéricos).",
    ].join("\n"),
    outputRules: [
      "Formato de respuesta OBLIGATORIO:",
      "- Devuelve TODA tu respuesta dentro de UN ÚNICO bloque de código (```text ... ```) para que pueda copiarlo con un solo clic.",
      "- No escribas explicaciones ni texto fuera de ese bloque.",
      "- Dentro de ese único bloque, incluye únicamente los separadores de los módulos solicitados en este orden exacto:",
    ].join("\n"),
  },
  guion_limpio: {
    placeholderHint: "(Solo el texto hablado en español, fluido, sin títulos de bloques ni etiquetas entre corchetes)",
    rules: [
      "Reglas para === GUION_LIMPIO ===:",
      "- Escribe únicamente el texto hablado en español natural y directo.",
      "- Sin títulos de secciones, sin acotaciones, sin emojis y sin etiquetas entre corchetes.",
      "- Respeta la duración aproximada de ~{{durationSeconds}}s (~{{targetWords}} palabras).",
    ].join("\n"),
  },
  elevenlabs: {
    placeholderHint:
      "(Exactamente el mismo texto hablado en español, pero con las etiquetas de audio [curious], [whispers], [laughs], etc. insertadas en los momentos clave)",
    tagGuide: [
      "Reglas para === ELEVENLABS === (v3 / v4):",
      "- Conserva exactamente las mismas palabras habladas en español de la versión limpia.",
      "- Inserta instrucciones breves entre corchetes en INGLÉS justo antes de la frase donde cambia la emoción, entonación o reacción:",
      "  - Emociones: [curious], [excited], [serious], [surprised], [mischievously], [worried], [confident]",
      "  - Entonación: [whispers], [shouts], [slows down], [fast]",
      "  - Reacciones humanas: [sighs], [laughs], [chuckles], [gasps], [clears throat]",
      "- Usa entre 4 y 8 etiquetas bien distribuidas para que suene natural y expresivo sin saturar cada frase.",
    ].join("\n"),
  },
  remotion: {
    schemaExample: JSON.stringify(
      {
        hook_badge: "TEXTO CORTO (2-4 palabras gancho para los primeros 2.6s, ej: DATO OCULTO)",
        accent_color: "#HEX_COLOR",
        caption_style: "bold_outline | pill_dark | glow",
        vignette: 0.35,
        hook_shake: true,
        default_transition: "cut | fade | slide_up | zoom_punch",
        scene_transitions: ["zoom_punch", "cut", "slide_up"],
        music_volume: 0.12,
      },
      null,
      2,
    ),
    notes: [
      "Notas para === REMOTION_JSON === (JSON válido sin comentarios, diseñado a la medida del tema y su tono ideal):",
      '- "vignette": número entre 0 y 0.8 (0 = sin viñeta, 0.55 = ambiente oscuro/misterio).',
      '- "hook_shake" (true/false): vibración sutil en la escena 1 para frenar el scroll.',
      '- "scene_transitions": array opcional con una transición por escena ("cut", "fade", "slide_up", "zoom_punch").',
    ].join("\n"),
  },
  storyboard: {
    schemaExample: JSON.stringify(
      {
        title: "Título atractivo y corto para Shorts/Reels/TikTok",
        caption: "Descripción breve para redes + #MegaExplains #Curiosidades",
        scenes: [
          {
            id: 1,
            start: 0.0,
            end: 3.8,
            use_character: true,
            image_prompt:
              "Detailed vertical 9:16 scene prompt in English, no embedded text, leaving clean negative space in the lower third for subtitles...",
            camera_motion: "zoom_in",
          },
        ],
      },
      null,
      2,
    ),
    notes: [
      "Notas para === STORYBOARD_JSON === (JSON válido sin comentarios):",
      '- Estima el tiempo de cada frase según su cantidad de palabras (~2.3 palabras/seg) y divide el guion en ~{{approxScenes}} escenas secuenciales de 3.0 a 5.0 segundos cada una, cubriendo desde 0.0 hasta {{durationSeconds}}.0 segundos (luego se re-sincronizará automáticamente con el audio real).',
      '- "use_character": {{characterStatus}}. Pon true solo cuando la escena requiera reacción o presencia del anfitrión; false para diagramas, objetos o escenarios.',
      '- "image_prompt": SIEMPRE en INGLÉS, muy descriptivo, coherente con el estilo definido en FLOW_VISUAL, sin texto dentro de la imagen y dejando espacio visual libre en el tercio inferior para los subtítulos.',
      '- "camera_motion": varía entre "zoom_in", "zoom_out", "pan_left", "pan_right".',
    ].join("\n"),
  },
  flow_visual: {
    schemaExample: JSON.stringify(
      {
        styleAnchor: "Global visual art style anchor in English tailored to the topic...",
        characterPrefix: "Character consistency integration prefix in English...",
      },
      null,
      2,
    ),
    promptRules: [
      "Notas para === FLOW_VISUAL === (JSON válido sin comentarios, en INGLÉS, diseñado específicamente para la atmósfera de \"{{topic}}\"):",
      '- "styleAnchor": Ancla de estilo global en inglés (técnica de ilustración/render, iluminación, paleta cromática, composición vertical 9:16, sin texto embebido).',
      '- "characterPrefix": Prefijo de consistencia en inglés que describe cómo debe integrarse el personaje de referencia en las escenas donde use_character=true (si no hay personaje, déjalo breve o genérico).',
    ].join("\n"),
    styleAnchor: STYLE_ANCHOR,
    characterPrefix: CHARACTER_CONSISTENCY_PREFIX,
  },
  musica: {
    placeholderHint:
      "(Prompt instrumental en inglés para ACE-Step 1.5, duración mínima ~{{musicDurationSeconds}}s, sin comillas ni JSON)",
    promptRules: [
      "Notas para === MUSICA_PROMPT === (texto plano en INGLÉS para ACE-Step 1.5, SIN JSON ni comillas):",
      '- Describe una pista instrumental de al menos ~{{musicDurationSeconds}}s (incluye margen extra sobre la duración de la voz) diseñada a la medida de "{{topic}}".',
      "- Incluye: género, atmósfera/emoción, instrumentos principales, BPM aproximado y mezcla limpia en frecuencias medias para no competir con la voz en español.",
      "- Termina siempre indicando: NO vocals, NO lyrics, steady loopable groove.",
    ].join("\n"),
    template: [
      'Instrumental background track (~{{durationSeconds}}s) for a vertical explainer video about "{{topic}}".',
      'Script opening context: "{{hookSnippet}}..."',
      "Style: {{mood}}{{atmosphereHint}}; {{pacingHint}}.",
      "Clean, uncluttered mix leaving midrange space for Spanish voiceover, soft intro for the hook, steady loopable groove, NO vocals, NO lyrics, NO harsh leads.",
    ].join(" "),
    moods: {
      "curioso y dinámico":
        "curious, upbeat, inquisitive marimba plucks, soft analog synth pulse, crisp minimal percussion, 112 BPM",
      "misterio y urgencia":
        "mysterious, tense, cinematic low synth bass, subtle ticking percussion, atmospheric pads, 100 BPM",
      "educativo cercano":
        "warm, friendly, lo-fi acoustic guitar, soft Rhodes electric piano, gentle groove, 95 BPM",
      "humorístico e irónico":
        "playful, quirky, pizzicato strings, bouncy bassline, lighthearted woodwinds, 118 BPM",
    },
  },
};

const GLOBAL_FORMATS_PATH = path.join(PATHS.root, "config", "global_formats.json");

function cloneDefaults(): ModularFormats {
  return JSON.parse(JSON.stringify(DEFAULT_GLOBAL_FORMATS)) as ModularFormats;
}

function mergeFormats(base: ModularFormats, override?: PartialModularFormats | null): ModularFormats {
  const result = JSON.parse(JSON.stringify(base)) as ModularFormats;
  if (!override || typeof override !== "object") return result;

  (Object.keys(DEFAULT_GLOBAL_FORMATS) as FormatModuleKey[]).forEach((key) => {
    const patch = override[key];
    if (patch && typeof patch === "object") {
      if (key === "musica") {
        const musicPatch = patch as Partial<MusicaFormat>;
        result.musica = {
          placeholderHint:
            typeof musicPatch.placeholderHint === "string"
              ? musicPatch.placeholderHint
              : result.musica.placeholderHint,
          promptRules:
            typeof musicPatch.promptRules === "string"
              ? musicPatch.promptRules
              : result.musica.promptRules,
          template:
            typeof musicPatch.template === "string"
              ? musicPatch.template
              : result.musica.template,
          moods:
            musicPatch.moods && typeof musicPatch.moods === "object"
              ? { ...result.musica.moods, ...musicPatch.moods }
              : result.musica.moods,
        };
      } else {
        Object.assign(result[key], patch);
      }
    }
  });

  return result;
}

async function readJsonFileSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getGlobalFormats(): Promise<ModularFormats> {
  const saved = await readJsonFileSafe<PartialModularFormats>(GLOBAL_FORMATS_PATH);
  return mergeFormats(cloneDefaults(), saved);
}

export async function saveGlobalFormatModule<K extends FormatModuleKey>(
  moduleKey: K,
  value: Partial<ModularFormats[K]>,
): Promise<ModularFormats> {
  const current = await getGlobalFormats();
  const updated = mergeFormats(current, { [moduleKey]: value } as PartialModularFormats);
  await fsp.mkdir(path.dirname(GLOBAL_FORMATS_PATH), { recursive: true });
  await fsp.writeFile(GLOBAL_FORMATS_PATH, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export async function resetGlobalFormatModule(moduleKey?: FormatModuleKey): Promise<ModularFormats> {
  const defaults = cloneDefaults();
  if (!moduleKey) {
    if (fs.existsSync(GLOBAL_FORMATS_PATH)) {
      await fsp.unlink(GLOBAL_FORMATS_PATH);
    }
    return defaults;
  }
  const current = await getGlobalFormats();
  (current as unknown as Record<string, unknown>)[moduleKey] = defaults[moduleKey];
  await fsp.mkdir(path.dirname(GLOBAL_FORMATS_PATH), { recursive: true });
  await fsp.writeFile(GLOBAL_FORMATS_PATH, JSON.stringify(current, null, 2), "utf-8");
  return current;
}

export async function getProjectFormatState(projectRoot: string): Promise<{
  global: ModularFormats;
  overrides: PartialModularFormats;
  effective: ModularFormats;
  customized: Record<FormatModuleKey, boolean>;
}> {
  const formatsFile = path.join(projectRoot, "formats.json");
  const [global, savedOverrides] = await Promise.all([
    getGlobalFormats(),
    readJsonFileSafe<PartialModularFormats>(formatsFile),
  ]);
  const overrides = savedOverrides && typeof savedOverrides === "object" ? savedOverrides : {};
  const effective = mergeFormats(global, overrides);
  const customized = {} as Record<FormatModuleKey, boolean>;
  for (const meta of FORMAT_MODULE_META) {
    const ov = overrides[meta.key];
    customized[meta.key] = Boolean(ov && typeof ov === "object" && Object.keys(ov).length > 0);
  }
  return { global, overrides, effective, customized };
}

export async function saveProjectFormatModule<K extends FormatModuleKey>(
  projectRoot: string,
  moduleKey: K,
  value: Partial<ModularFormats[K]>,
): Promise<ModularFormats> {
  const formatsFile = path.join(projectRoot, "formats.json");
  const existing = (await readJsonFileSafe<PartialModularFormats>(formatsFile)) || {};
  existing[moduleKey] = value;
  await fsp.mkdir(projectRoot, { recursive: true });
  await fsp.writeFile(formatsFile, JSON.stringify(existing, null, 2), "utf-8");
  const state = await getProjectFormatState(projectRoot);
  return state.effective;
}

export async function resetProjectFormatModule(
  projectRoot: string,
  moduleKey?: FormatModuleKey,
): Promise<ModularFormats> {
  const formatsFile = path.join(projectRoot, "formats.json");
  if (!moduleKey) {
    if (fs.existsSync(formatsFile)) {
      await fsp.unlink(formatsFile);
    }
    return getGlobalFormats();
  }
  const existing = (await readJsonFileSafe<PartialModularFormats>(formatsFile)) || {};
  delete existing[moduleKey];
  if (Object.keys(existing).length === 0) {
    if (fs.existsSync(formatsFile)) {
      await fsp.unlink(formatsFile);
    }
  } else {
    await fsp.writeFile(formatsFile, JSON.stringify(existing, null, 2), "utf-8");
  }
  const state = await getProjectFormatState(projectRoot);
  return state.effective;
}

export function applyTemplateVars(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      key in vars ? String(vars[key]) : `{{${key}}}`,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
