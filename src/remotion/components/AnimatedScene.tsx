import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import type { CameraMotion } from "../../types/pipeline.js";

export interface AnimatedSceneProps {
  src: string;
  durationInFrames: number;
  cameraMotion: CameraMotion;
}

export const AnimatedScene: React.FC<AnimatedSceneProps> = ({
  src,
  durationInFrames,
  cameraMotion,
}) => {
  const frame = useCurrentFrame();
  const safeDuration = Math.max(1, durationInFrames);

  let scale = 1;
  let translateX = 0;

  if (cameraMotion === "zoom_in") {
    scale = interpolate(frame, [0, safeDuration], [1.0, 1.12], {
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "zoom_out") {
    scale = interpolate(frame, [0, safeDuration], [1.12, 1.0], {
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "pan_left") {
    scale = 1.1;
    translateX = interpolate(frame, [0, safeDuration], [28, -28], {
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "pan_right") {
    scale = 1.1;
    translateX = interpolate(frame, [0, safeDuration], [-28, 28], {
      extrapolateRight: "clamp",
    });
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${translateX}px)`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};
