import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Storyboard, TranscriptionResult } from "../types/pipeline.js";
import { AnimatedScene } from "./components/AnimatedScene.js";
import { DynamicCaptions } from "./components/DynamicCaptions.js";

export interface MainCompositionProps extends Record<string, unknown> {
  storyboard: Storyboard;
  timestamps: TranscriptionResult | null;
  hasVoiceover: boolean;
  hasBgMusic: boolean;
  hasWatermark: boolean;
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
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {storyboard.scenes.map((scene, index) => {
        const startFrame = Math.round(scene.start * fps);
        const endFrame = Math.round(scene.end * fps);
        const durationInFrames = Math.max(1, endFrame - startFrame);

        return (
          <Sequence
            key={`${scene.id}-${index}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <AnimatedScene
              src={staticFile(sceneFilename(scene.id))}
              durationInFrames={durationInFrames}
              cameraMotion={scene.camera_motion}
            />
          </Sequence>
        );
      })}

      {hasBgMusic && (
        <Audio src={staticFile("bg_music.mp3")} volume={0.12} loop />
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

      {timestamps && timestamps.words.length > 0 && (
        <DynamicCaptions words={timestamps.words} captionsY={1350} />
      )}
    </AbsoluteFill>
  );
};
