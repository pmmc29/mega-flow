import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from "remotion";
import type { CameraMotion, RemotionTransition } from "../../types/pipeline.js";

export interface AnimatedSceneProps {
  src: string;
  durationInFrames: number;
  cameraMotion: CameraMotion;
  transition?: RemotionTransition;
  hookShake?: boolean;
  cameraIntensity?: number;
  isImpactScene?: boolean;
}

export const AnimatedScene: React.FC<AnimatedSceneProps> = ({
  src,
  durationInFrames,
  cameraMotion,
  transition = "cut",
  hookShake = false,
  cameraIntensity = 1.0,
  isImpactScene = false,
}) => {
  const frame = useCurrentFrame();
  const safeDuration = Math.max(1, durationInFrames);
  const intensity = Math.max(0.5, Math.min(1.6, cameraIntensity));

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let opacity = 1;
  let blurPx = 0;
  let clipPath: string | undefined;
  let flashOpacity = 0;
  let extraFilter = "";

  const zoomDelta = 0.12 * intensity;
  const panDelta = 28 * intensity;

  if (cameraMotion === "zoom_in") {
    scale = interpolate(frame, [0, safeDuration], [1.0, 1.0 + zoomDelta], {
      easing: Easing.inOut(Easing.quad),
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "zoom_out") {
    scale = interpolate(frame, [0, safeDuration], [1.0 + zoomDelta, 1.0], {
      easing: Easing.inOut(Easing.quad),
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "pan_left") {
    scale = 1.0 + Math.max(0.08, zoomDelta * 0.85);
    translateX = interpolate(frame, [0, safeDuration], [panDelta, -panDelta], {
      easing: Easing.inOut(Easing.sine),
      extrapolateRight: "clamp",
    });
  } else if (cameraMotion === "pan_right") {
    scale = 1.0 + Math.max(0.08, zoomDelta * 0.85);
    translateX = interpolate(frame, [0, safeDuration], [-panDelta, panDelta], {
      easing: Easing.inOut(Easing.sine),
      extrapolateRight: "clamp",
    });
  }

  const transitionFrames = Math.min(9, safeDuration);
  if (transition === "fade") {
    opacity = interpolate(frame, [0, transitionFrames], [0, 1], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
  } else if (transition === "slide_up") {
    opacity = interpolate(frame, [0, transitionFrames], [0.2, 1], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    translateY += interpolate(frame, [0, transitionFrames], [72, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
  } else if (transition === "zoom_punch") {
    const punchScale = interpolate(frame, [0, transitionFrames], [1.22, 1.0], {
      easing: Easing.out(Easing.exp),
      extrapolateRight: "clamp",
    });
    scale *= punchScale;
  } else if (transition === "flash_white") {
    flashOpacity = interpolate(frame, [0, Math.min(8, safeDuration)], [0.92, 0], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
    const flashScale = interpolate(frame, [0, Math.min(8, safeDuration)], [1.08, 1.0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    scale *= flashScale;
  } else if (transition === "blur_dissolve") {
    const blurFrames = Math.min(10, safeDuration);
    opacity = interpolate(frame, [0, blurFrames], [0, 1], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
    blurPx = interpolate(frame, [0, blurFrames], [14, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
  } else if (transition === "wipe_left") {
    const wipePct = interpolate(frame, [0, transitionFrames], [100, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
    clipPath = `inset(0 0 0 ${wipePct}%)`;
  } else if (transition === "glitch") {
    if (frame < 7) {
      const glitchDecay = 1 - frame / 7;
      translateX += (frame % 2 === 0 ? 1 : -1) * 18 * glitchDecay;
      translateY += (frame % 3 === 0 ? -8 : 6) * glitchDecay;
      scale *= 1.04;
      extraFilter = `contrast(${1 + 0.35 * glitchDecay}) saturate(${1 + 0.6 * glitchDecay})`;
    }
  }

  if (isImpactScene && frame < 10) {
    const impactScale = interpolate(frame, [0, 3, 10], [1.0, 1.05, 1.0], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
    scale *= impactScale;
  }

  if (hookShake && frame < 14) {
    const decay = interpolate(frame, [0, 14], [1, 0], {
      extrapolateRight: "clamp",
    });
    translateX += Math.sin(frame * 2.1) * 10 * decay;
    translateY += Math.cos(frame * 2.7) * 6 * decay;
  }

  const combinedFilter = [
    blurPx > 0.1 ? `blur(${blurPx.toFixed(1)}px)` : "",
    extraFilter,
  ]
    .filter(Boolean)
    .join(" ");

  const isTransparentBg = transition === "fade" || transition === "blur_dissolve";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: isTransparentBg ? "transparent" : "#000000",
        overflow: "hidden",
        clipPath,
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity,
          filter: combinedFilter || undefined,
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          transformOrigin: "center center",
        }}
      />
      {flashOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            backgroundColor: "#FFFFFF",
            opacity: flashOpacity,
            pointerEvents: "none",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
