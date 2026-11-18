import type {
  CaptionAnimation,
  CaptionFont,
  CaptionStyle,
  ColorGradePreset,
  HookBadgeStyle,
  RemotionTransition,
  RemotionVisualConfig,
} from "../types/pipeline.js";

const VALID_TRANSITIONS = new Set<RemotionTransition>([
  "cut",
  "fade",
  "slide_up",
  "zoom_punch",
  "flash_white",
  "blur_dissolve",
  "wipe_left",
  "glitch",
]);

const VALID_CAPTION_STYLES = new Set<CaptionStyle>([
  "bold_outline",
  "pill_dark",
  "glow",
  "kinetic_box",
]);

const VALID_CAPTION_FONTS = new Set<CaptionFont>([
  "sans_bold",
  "impact",
  "geometric",
  "editorial_serif",
]);

const VALID_CAPTION_ANIMATIONS = new Set<CaptionAnimation>([
  "pop_spring",
  "slide_fade",
  "karaoke_scale",
  "snap",
]);

const VALID_HOOK_BADGE_STYLES = new Set<HookBadgeStyle>([
  "pill",
  "neon_box",
  "alert_banner",
]);

const VALID_COLOR_GRADES = new Set<ColorGradePreset>([
  "neutral",
  "cinematic_warm",
  "dark_thriller",
  "vibrant_pop",
  "cyber_cool",
]);

export const TONE_PRESETS: Record<string, RemotionVisualConfig> = {
  "curioso y dinámico": {
    accent_color: "#FBBF24",
    hook_badge_style: "pill",
    color_grade: "vibrant_pop",
    caption_style: "bold_outline",
    caption_font: "sans_bold",
    caption_size: 62,
    caption_animation: "pop_spring",
    caption_uppercase: true,
    caption_stroke_width: 4,
    captions_y: 1350,
    words_per_group: 3,
    vignette: 0.25,
    film_grain: 0.04,
    bottom_gradient: 0.55,
    progress_bar: true,
    hook_shake: true,
    default_transition: "zoom_punch",
    camera_intensity: 1.05,
    music_volume: 0.12,
    music_ducking: 0.45,
  },
  "misterio y urgencia": {
    accent_color: "#EF4444",
    hook_badge_style: "alert_banner",
    color_grade: "dark_thriller",
    caption_style: "glow",
    caption_font: "impact",
    caption_size: 66,
    caption_animation: "karaoke_scale",
    caption_uppercase: true,
    caption_stroke_width: 5,
    captions_y: 1350,
    words_per_group: 2,
    vignette: 0.55,
    film_grain: 0.12,
    bottom_gradient: 0.65,
    progress_bar: true,
    hook_shake: true,
    default_transition: "fade",
    camera_intensity: 1.15,
    music_volume: 0.14,
    music_ducking: 0.4,
  },
  "educativo cercano": {
    accent_color: "#38BDF8",
    hook_badge_style: "pill",
    color_grade: "cinematic_warm",
    caption_style: "pill_dark",
    caption_font: "geometric",
    caption_size: 56,
    caption_animation: "slide_fade",
    caption_uppercase: false,
    caption_stroke_width: 3,
    captions_y: 1360,
    words_per_group: 3,
    vignette: 0.15,
    film_grain: 0.02,
    bottom_gradient: 0.45,
    progress_bar: true,
    hook_shake: false,
    default_transition: "slide_up",
    camera_intensity: 0.85,
    music_volume: 0.11,
    music_ducking: 0.45,
  },
  "humorístico e irónico": {
    accent_color: "#A3E635",
    hook_badge_style: "neon_box",
    color_grade: "vibrant_pop",
    caption_style: "kinetic_box",
    caption_font: "impact",
    caption_size: 64,
    caption_animation: "snap",
    caption_uppercase: true,
    caption_stroke_width: 4,
    captions_y: 1340,
    words_per_group: 2,
    vignette: 0.2,
    film_grain: 0.03,
    bottom_gradient: 0.55,
    progress_bar: true,
    hook_shake: true,
    default_transition: "cut",
    camera_intensity: 1.15,
    music_volume: 0.12,
    music_ducking: 0.45,
  },
};

export function getTonePreset(tone?: string): RemotionVisualConfig {
  const normalized = tone?.trim().toLowerCase() ?? "";
  const preset = TONE_PRESETS[normalized] ?? TONE_PRESETS["curioso y dinámico"];
  return { ...preset };
}

function clampNumber(val: unknown, fallback: number, min: number, max: number): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(min, Math.min(max, val));
  }
  return fallback;
}

export function mergeVisualConfig(
  tone?: string,
  custom?: Partial<RemotionVisualConfig> | null,
): RemotionVisualConfig {
  const base = getTonePreset(tone);
  if (!custom || typeof custom !== "object") {
    return base;
  }

  const accent_color =
    typeof custom.accent_color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(custom.accent_color.trim())
      ? custom.accent_color.trim()
      : base.accent_color;

  const caption_style =
    typeof custom.caption_style === "string" &&
    VALID_CAPTION_STYLES.has(custom.caption_style as CaptionStyle)
      ? (custom.caption_style as CaptionStyle)
      : base.caption_style;

  const caption_font =
    typeof custom.caption_font === "string" &&
    VALID_CAPTION_FONTS.has(custom.caption_font as CaptionFont)
      ? (custom.caption_font as CaptionFont)
      : (base.caption_font ?? "sans_bold");

  const caption_animation =
    typeof custom.caption_animation === "string" &&
    VALID_CAPTION_ANIMATIONS.has(custom.caption_animation as CaptionAnimation)
      ? (custom.caption_animation as CaptionAnimation)
      : (base.caption_animation ?? "pop_spring");

  const caption_size = Math.round(clampNumber(custom.caption_size, base.caption_size ?? 60, 44, 82));
  const caption_uppercase =
    typeof custom.caption_uppercase === "boolean"
      ? custom.caption_uppercase
      : (base.caption_uppercase ?? true);
  const caption_stroke_width = Math.round(
    clampNumber(custom.caption_stroke_width, base.caption_stroke_width ?? 4, 2, 8),
  );

  const hook_badge_style =
    typeof custom.hook_badge_style === "string" &&
    VALID_HOOK_BADGE_STYLES.has(custom.hook_badge_style as HookBadgeStyle)
      ? (custom.hook_badge_style as HookBadgeStyle)
      : (base.hook_badge_style ?? "pill");

  const color_grade =
    typeof custom.color_grade === "string" &&
    VALID_COLOR_GRADES.has(custom.color_grade as ColorGradePreset)
      ? (custom.color_grade as ColorGradePreset)
      : (base.color_grade ?? "neutral");

  const default_transition =
    typeof custom.default_transition === "string" &&
    VALID_TRANSITIONS.has(custom.default_transition as RemotionTransition)
      ? (custom.default_transition as RemotionTransition)
      : base.default_transition;

  const vignette = clampNumber(custom.vignette, base.vignette, 0, 0.85);
  const film_grain = clampNumber(custom.film_grain, base.film_grain ?? 0.04, 0, 0.25);
  const bottom_gradient = clampNumber(custom.bottom_gradient, base.bottom_gradient ?? 0.55, 0, 0.85);
  const captions_y = Math.round(clampNumber(custom.captions_y, base.captions_y ?? 1350, 1050, 1520));
  const words_per_group = Math.round(clampNumber(custom.words_per_group, base.words_per_group ?? 3, 1, 4));
  const camera_intensity = clampNumber(custom.camera_intensity, base.camera_intensity ?? 1.0, 0.5, 1.6);
  const music_volume = clampNumber(custom.music_volume, base.music_volume ?? 0.12, 0, 0.6);
  const music_ducking = clampNumber(custom.music_ducking, base.music_ducking ?? 0.45, 0.15, 0.85);

  const hook_shake =
    typeof custom.hook_shake === "boolean" ? custom.hook_shake : base.hook_shake;

  const progress_bar =
    typeof custom.progress_bar === "boolean" ? custom.progress_bar : (base.progress_bar ?? true);

  const hook_badge =
    typeof custom.hook_badge === "string" && custom.hook_badge.trim().length > 0
      ? custom.hook_badge.trim()
      : undefined;

  const scene_transitions = Array.isArray(custom.scene_transitions)
    ? custom.scene_transitions.map((t) =>
        typeof t === "string" && VALID_TRANSITIONS.has(t as RemotionTransition)
          ? (t as RemotionTransition)
          : default_transition,
      )
    : undefined;

  const highlight_keywords = Array.isArray(custom.highlight_keywords)
    ? custom.highlight_keywords
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim())
    : undefined;

  const impact_scenes = Array.isArray(custom.impact_scenes)
    ? custom.impact_scenes.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
      )
    : undefined;

  return {
    ...(hook_badge ? { hook_badge } : {}),
    hook_badge_style,
    accent_color,
    color_grade,
    caption_style,
    caption_font,
    caption_size,
    caption_animation,
    caption_uppercase,
    caption_stroke_width,
    captions_y,
    words_per_group,
    ...(highlight_keywords && highlight_keywords.length > 0 ? { highlight_keywords } : {}),
    vignette,
    film_grain,
    bottom_gradient,
    progress_bar,
    hook_shake,
    default_transition,
    ...(scene_transitions ? { scene_transitions } : {}),
    ...(impact_scenes && impact_scenes.length > 0 ? { impact_scenes } : {}),
    camera_intensity,
    music_volume,
    music_ducking,
  };
}
