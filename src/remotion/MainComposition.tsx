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

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {storyboard.scenes.map((scene, index) => {
        const startFrame = Math.round(scene.start * fps);
        const endFrame = Math.round(scene.end * fps);
        const sceneFrames = Math.max(1, endFrame - startFrame);
        const transition =
          config.scene_transitions?.[index] ?? config.default_transition;

        return (
          <Sequence
            key={`${scene.id}-${index}`}
            from={startFrame}
            durationInFrames={sceneFrames}
          >
            <AnimatedScene
              src={staticFile(sceneFilename(scene.id))}
              durationInFrames={sceneFrames}
              cameraMotion={scene.camera_motion}
              transition={transition}
              hookShake={index === 0 && config.hook_shake}
            />
          </Sequence>
        );
      })}

      {config.vignette > 0 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: `radial-gradient(circle at center, rgba(0,0,0,0) 46%, rgba(0,0,0,${Math.min(0.85, config.vignette)}) 100%)`,
          }}
        />
      )}

      {hasBgMusic && (
        <Audio
          src={staticFile("bg_music.mp3")}
          volume={(f) =>
            interpolate(f, [fadeStartFrame, durationInFrames], [baseMusicVolume, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
          loop
        />
      )}

      {hasVoiceover && (
        <Audio src={staticFile("voiceover.mp3")} volume={1.0} />
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
            style={{
              backgroundColor: "rgba(10, 12, 18, 0.85)",
              border: `3px solid ${config.accent_color}`,
              color: config.accent_color,
              fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 34,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "12px 28px",
              borderRadius: 999,
              boxShadow: `0 10px 28px rgba(0,0,0,0.55), 0 0 20px ${config.accent_color}33`,
            }}
          >
            {config.hook_badge}
          </div>
        </div>
      )}

      {timestamps && timestamps.words.length > 0 && (
        <DynamicCaptions
          words={timestamps.words}
          captionsY={1350}
          accentColor={config.accent_color}
          captionStyle={config.caption_style}
        />
      )}
    </AbsoluteFill>
  );
};
