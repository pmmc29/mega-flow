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
  scriptElevenLabs: path.join(ROOT_DIR, "workspace", "script_elevenlabs.txt"),
  scriptStructure: path.join(ROOT_DIR, "workspace", "script_structure.json"),
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
  localWhisper: process.env.WHISPER_MODEL || "onnx-community/whisper-small",
  transcriber: "whisper-1",
  sceneDirector: process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash",
  characterImage: process.env.GEMINI_CHARACTER_IMAGE_MODEL || "gemini-3-pro-image-preview",
  conceptImage: process.env.GEMINI_CONCEPT_IMAGE_MODEL || "gemini-2.5-flash-image",
} as const;

export const STYLE_ANCHOR = [
  "modern stylized 2D/3D explainer illustration",
  "vibrant cinematic lighting",
  "clean bold silhouettes and rich textures",
  "vertical 9:16 composition with clear negative space in the lower third for subtitles",
  "no text, no watermarks, no UI overlays",
].join(", ");

export const CHARACTER_CONSISTENCY_PREFIX =
  "Keep the host character's facial features, hairstyle, and core identity from the reference image, rendered in the exact visual style of the scene and naturally lit to match the environment. ";

export const IMAGE_GENERATION_CONCURRENCY = 4;
