import path from "node:path";

const ROOT_DIR = process.cwd();

export const PATHS = {
  root: ROOT_DIR,
  characterRef: path.join(ROOT_DIR, "assets", "brand", "character_ref.png"),
  watermark: path.join(ROOT_DIR, "assets", "brand", "watermark.png"),
  bgMusic: path.join(ROOT_DIR, "assets", "brand", "bg_music.mp3"),
  script: path.join(ROOT_DIR, "input", "script.txt"),
  voiceover: path.join(ROOT_DIR, "input", "voiceover.mp3"),
  timestamps: path.join(ROOT_DIR, "workspace", "timestamps.json"),
  storyboard: path.join(ROOT_DIR, "workspace", "storyboard.json"),
  scenesDir: path.join(ROOT_DIR, "workspace", "scenes"),
  finalVideo: path.join(ROOT_DIR, "output", "final_video.mp4"),
} as const;

export const VIDEO_CONFIG = {
  width: 1080,
  height: 1920,
  fps: 30,
  aspectRatio: "9:16" as const,
} as const;

export const SAFE_ZONES = {
  captionsY: 1350,
  topMarginPx: 180,
  bottomMarginPx: 420,
} as const;

export const MODELS = {
  transcriber: "whisper-1",
  sceneDirector: "gemini-2.5-flash",
  characterImage: "gemini-3-pro-image-preview",
  conceptImage: "gemini-2.5-flash-image",
} as const;

export const STYLE_ANCHOR = [
  "modern stylized 2D/3D explainer illustration",
  "vibrant cinematic lighting",
  "clean bold silhouettes and rich textures",
  "vertical 9:16 composition with clear negative space in the lower third for subtitles",
  "no text, no watermarks, no UI overlays",
].join(", ");

export const CHARACTER_CONSISTENCY_PREFIX =
  "Maintain exact character design, facial features, and outfit from the reference image. ";

export const IMAGE_GENERATION_CONCURRENCY = 4;
