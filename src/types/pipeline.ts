export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  duration: number;
  words: WordTimestamp[];
  source?: "whisper" | "estimated";
}

export type CameraMotion = "zoom_in" | "zoom_out" | "pan_left" | "pan_right";

export interface Scene {
  id: number;
  start: number;
  end: number;
  use_character: boolean;
  image_prompt: string;
  camera_motion: CameraMotion;
}

export interface Storyboard {
  title: string;
  caption: string;
  scenes: Scene[];
}

export type MasterPromptModuleKey =
  | "guion_limpio"
  | "elevenlabs"
  | "remotion"
  | "flow_visual"
  | "musica"
  | "storyboard";

export interface ScriptGenerationOptions {
  topic: string;
  durationSeconds: number;
  tone?: string;
  customInstructions?: string;
  hasCharacter?: boolean;
  includeModules?: MasterPromptModuleKey[];
}

export interface GeneratedScript {
  title: string;
  retention_structure: {
    hook: string;
    tension: string;
    beats: string[];
    climax: string;
    loop_cta: string;
  };
  clean_script: string;
  elevenlabs_script: string;
}

export type RemotionTransition =
  | "cut"
  | "fade"
  | "slide_up"
  | "zoom_punch"
  | "flash_white"
  | "blur_dissolve"
  | "wipe_left"
  | "glitch";

export type CaptionStyle = "bold_outline" | "pill_dark" | "glow" | "kinetic_box";
export type CaptionFont = "sans_bold" | "impact" | "geometric" | "editorial_serif";
export type CaptionAnimation = "pop_spring" | "slide_fade" | "karaoke_scale" | "snap";
export type HookBadgeStyle = "pill" | "neon_box" | "alert_banner";
export type ColorGradePreset =
  | "neutral"
  | "cinematic_warm"
  | "dark_thriller"
  | "vibrant_pop"
  | "cyber_cool";

export interface RemotionVisualConfig {
  hook_badge?: string;
  hook_badge_style?: HookBadgeStyle;
  hook_shake: boolean;
  accent_color: string;
  color_grade?: ColorGradePreset;
  vignette: number;
  film_grain?: number;
  bottom_gradient?: number;
  progress_bar?: boolean;
  caption_style: CaptionStyle;
  caption_font?: CaptionFont;
  caption_size?: number;
  caption_animation?: CaptionAnimation;
  caption_uppercase?: boolean;
  caption_stroke_width?: number;
  captions_y?: number;
  words_per_group?: number;
  highlight_keywords?: string[];
  default_transition: RemotionTransition;
  scene_transitions?: RemotionTransition[];
  impact_scenes?: number[];
  camera_intensity?: number;
  music_volume?: number;
  music_ducking?: number;
}
