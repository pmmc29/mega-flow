import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import type { CameraMotion, RemotionTransition } from "../../types/pipeline.js";

export interface AnimatedSceneProps {
  src: string;
  durationInFrames: number;
  cameraMotion: CameraMotion;
  transition?: RemotionTransition;
  hookShake?: boolean;
}

export const AnimatedScene: React.FC<AnimatedSceneProps> = ({
  src,
  durationInFrames,
  cameraMotion,
  transition = "cut",
  hookShake = false,
}) => {
  const frame = useCurrentFrame();
  const safeDuration = Math.max(1, durationInFrames);

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let opacity = 1;

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

  const transitionFrames = Math.min(8, safeDuration);
  if (transition === "fade") {
    opacity = interpolate(frame, [0, transitionFrames], [0, 1], {
      extrapolateRight: "clamp",
    });
  } else if (transition === "slide_up") {
    opacity = interpolate(frame, [0, transitionFrames], [0.25, 1], {
      extrapolateRight: "clamp",
    });
    translateY += interpolate(frame, [0, transitionFrames], [60, 0], {
      extrapolateRight: "clamp",
    });
  } else if (transition === "zoom_punch") {
    const punchScale = interpolate(frame, [0, transitionFrames], [1.18, 1.0], {
      extrapolateRight: "clamp",
    });
    scale *= punchScale;
  }

  if (hookShake && frame < 14) {
    const decay = interpolate(frame, [0, 14], [1, 0], {
      extrapolateRight: "clamp",
    });
    translateX += Math.sin(frame * 2.1) * 10 * decay;
    translateY += Math.cos(frame * 2.7) * 6 * decay;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity,
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};
