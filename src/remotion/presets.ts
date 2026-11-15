import type {
  CaptionStyle,
  RemotionTransition,
  RemotionVisualConfig,
} from "../types/pipeline.js";

const VALID_TRANSITIONS = new Set<RemotionTransition>([
  "cut",
  "fade",
  "slide_up",
  "zoom_punch",
]);

const VALID_CAPTION_STYLES = new Set<CaptionStyle>([
  "bold_outline",
  "pill_dark",
  "glow",
]);

export const TONE_PRESETS: Record<string, RemotionVisualConfig> = {
  "curioso y dinámico": {
    accent_color: "#FBBF24",
    caption_style: "bold_outline",
    vignette: 0.25,
    hook_shake: true,
    default_transition: "zoom_punch",
  },
  "misterio y urgencia": {
    accent_color: "#EF4444",
    caption_style: "glow",
    vignette: 0.55,
    hook_shake: true,
    default_transition: "fade",
  },
  "educativo cercano": {
    accent_color: "#38BDF8",
    caption_style: "pill_dark",
    vignette: 0.15,
    hook_shake: false,
    default_transition: "slide_up",
  },
  "humorístico e irónico": {
    accent_color: "#A3E635",
    caption_style: "bold_outline",
    vignette: 0.2,
    hook_shake: true,
    default_transition: "cut",
  },
};

export function getTonePreset(tone?: string): RemotionVisualConfig {
  const normalized = tone?.trim().toLowerCase() ?? "";
  const preset = TONE_PRESETS[normalized] ?? TONE_PRESETS["curioso y dinámico"];
  return { ...preset };
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

  const default_transition =
    typeof custom.default_transition === "string" &&
    VALID_TRANSITIONS.has(custom.default_transition as RemotionTransition)
      ? (custom.default_transition as RemotionTransition)
      : base.default_transition;

  const vignette =
    typeof custom.vignette === "number" && Number.isFinite(custom.vignette)
      ? Math.max(0, Math.min(0.85, custom.vignette))
      : base.vignette;

  const hook_shake =
    typeof custom.hook_shake === "boolean" ? custom.hook_shake : base.hook_shake;

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

  return {
    ...(hook_badge ? { hook_badge } : {}),
    accent_color,
    caption_style,
    vignette,
    hook_shake,
    default_transition,
    ...(scene_transitions ? { scene_transitions } : {}),
  };
}
