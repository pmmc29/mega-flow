export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  duration: number;
  words: WordTimestamp[];
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

export interface ScriptGenerationOptions {
  topic: string;
  durationSeconds: number;
  tone: string;
  customInstructions?: string;
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
