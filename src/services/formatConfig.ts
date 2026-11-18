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
      'Actúa como un showrunner, guionista de retención máxima, director de arte y editor jefe de videos verticales cortos (YouTube Shorts, TikTok, Instagram Reels) para el canal "Mega Studio".',
      "Tu objetivo es diseñar una pieza audiovisual completa y 100% coherente entre sí: guion, interpretación vocal, edición en Remotion, dirección visual, música y storyboard.",
      "",
      "Datos del proyecto:",
      "- Tema / Idea: {{topic}}",
      "- Duración objetivo: ~{{durationSeconds}} segundos (~{{targetWords}} palabras a ~140 palabras/min).",
      "- Escenas estimadas: ~{{approxScenes}} escenas visuales (3.0 a 5.0s cada una).",
      "- Tono base: {{tone}} (ajústalo y refínalo según lo que mejor retenga para este tema).",
      "- Personaje anfitrión: {{characterStatus}}",
      "{{customInstructions}}",
    ].join("\n"),
    retentionStructure: [
      "Estructura obligatoria de máxima retención:",
      '1. Hook (0–3s): Frena el scroll en la primera frase con un dato contraintuitivo, paradoja, pregunta incómoda o afirmación visual impactante. PROHIBIDO saludar ("Hola", "Bienvenidos", "Hoy veremos").',
      "2. Tensión / Promesa (3–10s): Abre una brecha de curiosidad explicando por qué esto importa o qué creencia común es falsa.",
      '3. Micro-beats + Re-Hook (10–{{midEndSeconds}}s): Avanza en bloques cortos (3–5s por idea) usando conectores de giro ("Pero aquí viene lo raro...", "Lo que nadie nota...") y analogías visuales claras. Si el video supera los 45s, incluye un mini re-hook hacia la mitad para reiniciar la atención.',
      '4. Clímax: Entrega la revelación principal o el momento "¡Aha!" de forma directa.',
      "5. Cierre en Loop / CTA orgánico: Termina con una frase que conecte de vuelta con el Hook inicial (loop fluido) o con una pregunta específica que invite a debatir en comentarios (prohibido pedir likes/suscripción genéricos).",
      "",
      "Coherencia obligatoria entre módulos (todos deben trabajar juntos):",
      "- La paleta/atmósfera de REMOTION_JSON (accent_color, color_grade, caption_style) debe combinar con la dirección de arte de FLOW_VISUAL y el mood de MUSICA_PROMPT.",
      '- En REMOTION_JSON: "highlight_keywords" debe usar palabras literales de GUION_LIMPIO; "scene_transitions" debe tener exactamente la misma cantidad de elementos que "scenes" en STORYBOARD_JSON; e "impact_scenes" debe señalar los IDs exactos del hook, giros y clímax.',
    ].join("\n"),
    outputRules: [
      "Formato de respuesta OBLIGATORIO (a prueba de errores de copiado):",
      "- Devuelve TODA tu respuesta dentro de UN ÚNICO bloque de código (```text ... ```) para copiarlo con un solo clic.",
      "- PROHIBIDO escribir texto, saludos o explicaciones fuera de ese bloque.",
      "- PROHIBIDO abrir sub-bloques (```json, ```txt) DENTRO del bloque principal; escribe los JSON en texto plano directamente debajo de su separador.",
      "- Respeta exactamente los nombres de los separadores solicitados y en este orden exacto:",
    ].join("\n"),
  },
  guion_limpio: {
    placeholderHint:
      "(Texto hablado limpio en español, sin títulos de bloques, sin markdown, sin emojis ni etiquetas entre corchetes; listo para leer en voz alta)",
    rules: [
      "Reglas para === GUION_LIMPIO === (guion maestro de locución y base exacta para subtítulos):",
      "1. ORALIDAD Y RITMO VERTICAL:",
      "- Escribe en español natural, directo y conversacional (como si se lo contaras a un amigo frente a cámara).",
      "- Usa frases cortas y contundentes (idealmente 6 a 14 palabras por oración) para mantener ritmo ágil y facilitar cortes visuales cada 3-5s.",
      '- PROHIBIDO saludar o rellenar ("Hola", "En este video veremos", "Sin más preámbulos"). Arranca directo en el hook.',
      "2. LIMPIEZA PARA TTS Y SUBTÍTULOS:",
      '- Prohibido usar títulos de secciones ("Hook:", "Desarrollo:", "Cierre:"), listas con guiones, negritas (**texto**), emojis, acotaciones entre paréntesis "(pausa)" o etiquetas "[...]".',
      '- Permite cifras y símbolos visuales claros ("85%", "$100", "1999") porque lucen mejor en subtítulos y el TTS los lee bien.',
      '- Evita abreviaturas ambiguas o símbolos que el TTS lee mal ("EE.UU.", "aprox.", "etc.", "km/h", "&", "/", "~"); escríbelos completos ("Estados Unidos", "aproximadamente", "kilómetros por hora").',
      "3. PUNTUACIÓN EXPRESIVA PARA VOZ Y SUBTÍTULOS:",
      "- Usa puntos, comas y signos de apertura/cierre (¿? ¡!) con intención clara: marcan dónde respira la locución y dónde se dividen los bloques de subtítulos en pantalla.",
      "- Evita oraciones de más de 20 palabras sin una coma o punto.",
      "4. EXTENSIÓN Y PARIDAD EXACTA:",
      "- Respeta la duración objetivo de ~{{durationSeconds}}s (~{{targetWords}} palabras; margen máximo ±10%).",
      "- Si se solicita === ELEVENLABS ===, las palabras habladas deben coincidir 1 a 1 con este guion limpio (solo agregando las etiquetas [...] en la versión de ElevenLabs).",
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
        hook_badge: "DATO OCULTO",
        hook_badge_style: "pill | neon_box | alert_banner",
        hook_shake: true,
        accent_color: "#FBBF24",
        color_grade: "neutral | cinematic_warm | dark_thriller | vibrant_pop | cyber_cool",
        vignette: 0.35,
        film_grain: 0.06,
        bottom_gradient: 0.6,
        progress_bar: true,
        caption_style: "bold_outline | pill_dark | glow | kinetic_box",
        caption_font: "sans_bold | impact | geometric | editorial_serif",
        caption_size: 60,
        caption_animation: "pop_spring | slide_fade | karaoke_scale | snap",
        caption_uppercase: true,
        caption_stroke_width: 4,
        captions_y: 1350,
        words_per_group: 3,
        highlight_keywords: ["PALABRA1", "PALABRA2", "PALABRA3"],
        default_transition: "cut | fade | slide_up | zoom_punch | flash_white | blur_dissolve | wipe_left | glitch",
        scene_transitions: ["zoom_punch", "cut", "flash_white", "slide_up"],
        impact_scenes: [1, 4],
        camera_intensity: 1.0,
        music_volume: 0.12,
        music_ducking: 0.45,
      },
      null,
      2,
    ),
    notes: [
      "Notas para === REMOTION_JSON === (JSON válido estricto: sin comentarios, sin comas finales, usa EXACTAMENTE los valores permitidos):",
      "",
      "1. LEGIBILIDAD DE SUBTÍTULOS (PRIORIDAD MÁXIMA en 1080x1920):",
      '- "caption_style": "bold_outline" (viral clásico), "pill_dark" (máxima lectura sobre fondos claros/caóticos), "glow" (misterio/tech oscuro, requiere bottom_gradient >= 0.55), "kinetic_box" (alto impacto).',
      '- "caption_font": "sans_bold" (limpia/moderna), "impact" (gruesa/viral), "geometric" (tech/educativa), "editorial_serif" (historia/documental).',
      '- REGLA TAMAÑO vs. PALABRAS (evita desbordes): si "words_per_group" es 1-2 usa "caption_size" 64-78; si es 3 usa 54-62; si es 4 usa 46-54.',
      '- "caption_animation": "karaoke_scale" o "slide_fade" para locución rápida/técnica (cero fatiga visual); "pop_spring" o "snap" para ritmo dinámico.',
      '- "caption_uppercase": true para impacto/curiosidades; false para tono cercano, narrativo o palabras largas.',
      '- "caption_stroke_width" (2 a 8): usa 5-7 si las escenas tienen fondos claros o mucho detalle; 3-4 si usas pill_dark o fondos oscuros.',
      '- "captions_y" (1050 a 1520): mantén entre 1240 y 1400 para respetar la Safe Zone (sin tapar rostros arriba ni botones de TikTok/Reels/Shorts abajo).',
      '- "highlight_keywords": 3 a 6 palabras clave del guion (sin signos de puntuación) que recibirán énfasis extra.',
      "",
      "2. CONTRASTE Y COLOR:",
      '- "accent_color": usa SIEMPRE un hex brillante y saturado (#FBBF24, #38BDF8, #A3E635, #FB7185, #2DD4BF, #F97316). PROHIBIDO usar colores oscuros porque hacen ilegible la palabra activa.',
      '- "bottom_gradient" (0 a 0.85): usa >= 0.55 siempre que uses "bold_outline" o "glow" para garantizar contraste en el tercio inferior.',
      "",
      "3. HOOK, ATMÓSFERA Y RITMO VISUAL:",
      '- "hook_badge" (máx. 2-4 palabras, <= 22 caracteres) y "hook_badge_style" ("pill" | "neon_box" | "alert_banner").',
      '- "hook_shake" (true/false): vibración de cámara en la escena 1 para frenar el scroll.',
      '- "color_grade": "neutral" | "cinematic_warm" | "dark_thriller" | "vibrant_pop" | "cyber_cool".',
      '- "vignette" (0 a 0.85) y "film_grain" (0 a 0.25): oscurecimiento de bordes y textura orgánica.',
      '- "progress_bar" (true/false): barra sutil de progreso superior con el accent_color.',
      '- "default_transition" y "scene_transitions": array con una transición por escena del storyboard ("cut", "fade", "slide_up", "zoom_punch", "flash_white", "blur_dissolve", "wipe_left", "glitch").',
      '- "impact_scenes": IDs de escena (1-indexado) para hook, giros o clímax (máx. 35% del total de escenas para no saturar).',
      '- "camera_intensity" (0.5 a 1.6): multiplicador del movimiento Ken Burns.',
      "",
      "4. AUDIO:",
      '- "music_volume" (0 a 0.6, recomendado 0.10-0.16) y "music_ducking" (0.15 a 0.85, recomendado 0.40-0.50).',
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
