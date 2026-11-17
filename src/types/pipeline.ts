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

export type MasterPromptModuleKey = "guion_limpio" | "elevenlabs" | "remotion" | "storyboard";

export interface ScriptGenerationOptions {
  topic: string;
  durationSeconds: number;
  tone: string;
  customInstructions?: string;
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

export type RemotionTransition = "cut" | "fade" | "slide_up" | "zoom_punch";
export type CaptionStyle = "bold_outline" | "pill_dark" | "glow";

export interface RemotionVisualConfig {
  hook_badge?: string;
  accent_color: string;
  caption_style: CaptionStyle;
  vignette: number;
  hook_shake: boolean;
  default_transition: RemotionTransition;
  scene_transitions?: RemotionTransition[];
  music_volume?: number;
}
