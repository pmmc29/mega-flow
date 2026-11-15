import React from "react";
import { Composition } from "remotion";
import { MainComposition, type MainCompositionProps } from "./MainComposition.js";
import { getTonePreset } from "./presets.js";

const DEFAULT_PROPS: MainCompositionProps = {
  storyboard: {
    title: "Mega Studio Short",
    caption: "#MegaStudio",
    scenes: [
      {
        id: 1,
        start: 0,
        end: 4,
        use_character: false,
        image_prompt: "Default preview scene",
        camera_motion: "zoom_in",
      },
    ],
  },
  timestamps: null,
  hasVoiceover: false,
  hasBgMusic: false,
  hasWatermark: false,
  visualConfig: getTonePreset(),
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MegaExplainsShort"
      component={MainComposition}
      durationInFrames={120}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }: { props: MainCompositionProps }) => {
        const lastSceneEnd =
          props.storyboard.scenes.length > 0
            ? props.storyboard.scenes[props.storyboard.scenes.length - 1].end
            : 4;
        const durationSeconds = props.timestamps?.duration
          ? Math.max(props.timestamps.duration, lastSceneEnd)
          : lastSceneEnd;

        return {
          durationInFrames: Math.max(30, Math.ceil(durationSeconds * 30)),
          fps: 30,
          width: 1080,
          height: 1920,
        };
      }}
    />
  );
};
