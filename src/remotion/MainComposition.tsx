import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  ColorGradePreset,
  HookBadgeStyle,
  RemotionVisualConfig,
  Storyboard,
  TranscriptionResult,
} from "../types/pipeline.js";
import { getTonePreset } from "./presets.js";
import { AnimatedScene } from "./components/AnimatedScene.js";
import { DynamicCaptions } from "./components/DynamicCaptions.js";

export interface MainCompositionProps extends Record<string, unknown> {
  storyboard: Storyboard;
  timestamps: TranscriptionResult | null;
  hasVoiceover: boolean;
  hasBgMusic: boolean;
  hasWatermark: boolean;
  visualConfig?: RemotionVisualConfig;
}

function sceneFilename(id: number): string {
  return `scenes/scene_${String(id).padStart(3, "0")}.png`;
}

const COLOR_GRADE_FILTERS: Record<ColorGradePreset, string> = {
  neutral: "none",
  cinematic_warm: "contrast(1.06) saturate(1.12) sepia(0.12)",
  dark_thriller: "contrast(1.16) saturate(0.78) brightness(0.92)",
  vibrant_pop: "contrast(1.08) saturate(1.28) brightness(1.03)",
  cyber_cool: "contrast(1.12) saturate(1.15) hue-rotate(-8deg)",
};

const FILM_GRAIN_SVG =
  "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.85'/%3E%3C/svg%3E";

function getHookBadgeContainerStyle(
  style: HookBadgeStyle,
  accentColor: string,
): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
    fontWeight: 900,
    fontSize: 34,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    padding: "12px 28px",
  };

  if (style === "neon_box") {
    return {
      ...base,
      backgroundColor: "rgba(6, 9, 16, 0.9)",
      border: `3px solid ${accentColor}`,
      color: "#FFFFFF",
      borderRadius: 12,
      boxShadow: `0 0 24px ${accentColor}88, inset 0 0 14px ${accentColor}33`,
    };
  }

  if (style === "alert_banner") {
    return {
      ...base,
      backgroundColor: accentColor,
      border: "3px solid #0A0C12",
      color: "#0A0C12",
      borderRadius: 10,
      boxShadow: "0 12px 28px rgba(0,0,0,0.65)",
    };
  }

  return {
    ...base,
    backgroundColor: "rgba(10, 12, 18, 0.85)",
    border: `3px solid ${accentColor}`,
    color: accentColor,
    borderRadius: 999,
    boxShadow: `0 10px 28px rgba(0,0,0,0.55), 0 0 20px ${accentColor}33`,
  };
}

export const MainComposition: React.FC<MainCompositionProps> = ({
  storyboard,
  timestamps,
  hasVoiceover,
  hasBgMusic,
  hasWatermark,
  visualConfig,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const config = visualConfig ?? getTonePreset();
  const baseMusicVolume = config.music_volume ?? 0.12;
  const musicDucking = config.music_ducking ?? 0.45;
  const fadeOutFrames = Math.min(Math.round(1.5 * fps), Math.max(1, durationInFrames - 1));
  const fadeStartFrame = Math.max(0, durationInFrames - fadeOutFrames);

  const hookBadgeFrames = Math.round(2.6 * fps);
  const showHookBadge = Boolean(config.hook_badge && frame < hookBadgeFrames);
  const badgeOpacity = showHookBadge
    ? interpolate(
        frame,
        [0, 6, Math.max(7, hookBadgeFrames - 8), hookBadgeFrames],
        [0, 1, 1, 0],
        { extrapolateRight: "clamp" },
      )
    : 0;
  const badgeScale = showHookBadge
    ? interpolate(frame, [0, 7], [0.85, 1], { extrapolateRight: "clamp" })
    : 1;

  const words = timestamps?.words ?? [];
  const isSpeakingAtFrame = (f: number): boolean => {
    if (!hasVoiceover || words.length === 0) return false;
    const t = f / fps;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (t >= w.start - 0.12 && t <= w.end + 0.16) return true;
      if (w.start - 0.12 > t) break;
    }
    return false;
  };

  const CROSSFADE_FRAMES = 6;
  const colorGradeFilter = COLOR_GRADE_FILTERS[config.color_grade ?? "neutral"];
  const filmGrainOpacity = config.film_grain ?? 0;
  const bottomGradientAlpha = config.bottom_gradient ?? 0;
  const progressPct =
    durationInFrames > 1 ? Math.min(100, Math.max(0, (frame / (durationInFrames - 1)) * 100)) : 100;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <AbsoluteFill style={{ filter: colorGradeFilter === "none" ? undefined : colorGradeFilter }}>
        {storyboard.scenes.map((scene, index) => {
          const startFrame = Math.round(scene.start * fps);
          const endFrame = Math.round(scene.end * fps);
          const baseFrames = Math.max(1, endFrame - startFrame);
          const transition =
            config.scene_transitions?.[index] ?? config.default_transition;
          const isCrossfade = transition === "fade" || transition === "blur_dissolve";
          const overlap = index > 0 && isCrossfade ? Math.min(CROSSFADE_FRAMES, startFrame) : 0;
          const fromFrame = startFrame - overlap;
          const sceneFrames = baseFrames + overlap;
          const isImpactScene = Boolean(config.impact_scenes?.includes(scene.id));

          return (
            <Sequence
              key={`${scene.id}-${index}`}
              from={fromFrame}
              durationInFrames={sceneFrames}
            >
              <AnimatedScene
                src={staticFile(sceneFilename(scene.id))}
                durationInFrames={sceneFrames}
                cameraMotion={scene.camera_motion}
                transition={transition}
                hookShake={index === 0 && config.hook_shake}
                cameraIntensity={config.camera_intensity}
                isImpactScene={isImpactScene}
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {bottomGradientAlpha > 0 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: `linear-gradient(to top, rgba(0,0,0,${bottomGradientAlpha}) 0%, rgba(0,0,0,${(bottomGradientAlpha * 0.45).toFixed(2)}) 28%, rgba(0,0,0,0) 52%)`,
          }}
        />
      )}

      {config.vignette > 0 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: `radial-gradient(circle at center, rgba(0,0,0,0) 46%, rgba(0,0,0,${Math.min(0.85, config.vignette)}) 100%)`,
          }}
        />
      )}

      {filmGrainOpacity > 0 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            opacity: filmGrainOpacity,
            mixBlendMode: "overlay",
            backgroundImage: `url("${FILM_GRAIN_SVG}")`,
            backgroundSize: "200px 200px",
            backgroundPosition: `${(frame * 37) % 200}px ${(frame * 53) % 200}px`,
          }}
        />
      )}

      {hasBgMusic && (
        <Audio
          src={staticFile("bg_music.mp3")}
          volume={(f) => {
            const fadeOut = interpolate(
              f,
              [fadeStartFrame, durationInFrames],
              [1, 0],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );
            const duck = isSpeakingAtFrame(f) ? musicDucking : 1.0;
            return baseMusicVolume * duck * fadeOut;
          }}
          loop
        />
      )}

      {hasVoiceover && (
        <Audio src={staticFile("voiceover.mp3")} volume={1.0} />
      )}

      {config.progress_bar && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            backgroundColor: "rgba(255, 255, 255, 0.14)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              backgroundColor: config.accent_color,
              boxShadow: `0 0 12px ${config.accent_color}`,
            }}
          />
        </div>
      )}

      {hasWatermark && (
        <Img
          src={staticFile("watermark.png")}
          style={{
            position: "absolute",
            top: 96,
            right: 48,
            width: 110,
            height: "auto",
            opacity: 0.78,
            pointerEvents: "none",
          }}
        />
      )}

      {showHookBadge && config.hook_badge && (
        <div
          style={{
            position: "absolute",
            top: 155,
            left: 72,
            right: 72,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            opacity: badgeOpacity,
            transform: `scale(${badgeScale})`,
          }}
        >
          <div
            style={getHookBadgeContainerStyle(
              config.hook_badge_style ?? "pill",
              config.accent_color,
            )}
          >
            {config.hook_badge}
          </div>
        </div>
      )}

      {timestamps && timestamps.words.length > 0 && (
        <DynamicCaptions
          words={timestamps.words}
          captionsY={config.captions_y ?? 1350}
          accentColor={config.accent_color}
          captionStyle={config.caption_style}
          captionFont={config.caption_font ?? "sans_bold"}
          captionSize={config.caption_size ?? 60}
          captionAnimation={config.caption_animation ?? "pop_spring"}
          captionUppercase={config.caption_uppercase ?? true}
          captionStrokeWidth={config.caption_stroke_width ?? 4}
          wordsPerGroup={config.words_per_group ?? 3}
          highlightKeywords={config.highlight_keywords}
        />
      )}
    </AbsoluteFill>
  );
};
