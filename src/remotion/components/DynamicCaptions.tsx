import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, WordTimestamp } from "../../types/pipeline.js";

export interface DynamicCaptionsProps {
  words: WordTimestamp[];
  captionsY?: number;
  accentColor?: string;
  captionStyle?: CaptionStyle;
}

interface CaptionGroup {
  words: WordTimestamp[];
  start: number;
  end: number;
}

function groupWordsSmart(words: WordTimestamp[]): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: WordTimestamp[] = [];
  let charCount = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
    charCount = 0;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    current.push(w);
    charCount += w.word.length + 1;

    const endsSentence = /[.!?…:;]+$/.test(w.word);
    const endsClause = /[,]+$/.test(w.word);
    const gapToNext = next ? next.start - w.end : 0;

    if (
      current.length >= 3 ||
      (endsSentence && current.length >= 1) ||
      (endsClause && current.length >= 2) ||
      (charCount >= 20 && current.length >= 2) ||
      gapToNext > 0.35
    ) {
      flush();
    }
  }
  flush();
  return groups;
}

export const DynamicCaptions: React.FC<DynamicCaptionsProps> = ({
  words,
  captionsY = 1350,
  accentColor = "#FBBF24",
  captionStyle = "bold_outline",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const groups = React.useMemo(() => groupWordsSmart(words), [words]);
  const activeGroup = groups.find(
    (g) => currentTime >= g.start - 0.05 && currentTime <= g.end + 0.12,
  );

  if (!activeGroup) {
    return null;
  }

  const groupStartFrame = Math.max(0, Math.round((activeGroup.start - 0.04) * fps));
  const pop = spring({
    frame: Math.max(0, frame - groupStartFrame),
    fps,
    config: { damping: 14, stiffness: 220, mass: 0.55 },
  });
  const groupScale = 0.9 + 0.1 * pop;

  const isPillDark = captionStyle === "pill_dark";
  const isGlow = captionStyle === "glow";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: captionsY,
          left: 64,
          right: 64,
          transform: `translateY(-50%) scale(${groupScale})`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: isPillDark ? "10px" : "14px",
          textAlign: "center",
        }}
      >
        {activeGroup.words.map((item, idx) => {
          const isActive = currentTime >= item.start && currentTime <= item.end + 0.08;

          const baseStyle: React.CSSProperties = {
            fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: isPillDark ? 56 : 64,
            lineHeight: 1.15,
            textTransform: "uppercase",
            letterSpacing: "-0.01em",
            transform: isActive ? "scale(1.08)" : "scale(1)",
          };

          if (isPillDark) {
            return (
              <span
                key={`${item.word}-${item.start}-${idx}`}
                style={{
                  ...baseStyle,
                  padding: "6px 16px",
                  borderRadius: 14,
                  backgroundColor: isActive ? accentColor : "rgba(10, 12, 18, 0.78)",
                  color: isActive ? "#0A0C12" : "#FFFFFF",
                  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
                }}
              >
                {item.word}
              </span>
            );
          }

          if (isGlow) {
            return (
              <span
                key={`${item.word}-${item.start}-${idx}`}
                style={{
                  ...baseStyle,
                  color: isActive ? accentColor : "#FFFFFF",
                  textShadow: isActive
                    ? `0 0 18px ${accentColor}, 0 0 36px ${accentColor}, 0 4px 14px rgba(0,0,0,0.9)`
                    : "0 3px 12px rgba(0,0,0,0.9), -2px -2px 0 #000, 2px 2px 0 #000",
                }}
              >
                {item.word}
              </span>
            );
          }

          return (
            <span
              key={`${item.word}-${item.start}-${idx}`}
              style={{
                ...baseStyle,
                color: isActive ? accentColor : "#FFFFFF",
                textShadow: [
                  "-4px -4px 0 #000",
                  "4px -4px 0 #000",
                  "-4px 4px 0 #000",
                  "4px 4px 0 #000",
                  "0 8px 20px rgba(0,0,0,0.65)",
                ].join(", "),
              }}
            >
              {item.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
