import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  CaptionAnimation,
  CaptionFont,
  CaptionStyle,
  WordTimestamp,
} from "../../types/pipeline.js";

export interface DynamicCaptionsProps {
  words: WordTimestamp[];
  captionsY?: number;
  accentColor?: string;
  captionStyle?: CaptionStyle;
  captionFont?: CaptionFont;
  captionSize?: number;
  captionAnimation?: CaptionAnimation;
  captionUppercase?: boolean;
  captionStrokeWidth?: number;
  wordsPerGroup?: number;
  highlightKeywords?: string[];
}

interface CaptionGroup {
  words: WordTimestamp[];
  start: number;
  end: number;
}

const FONT_FAMILIES: Record<CaptionFont, string> = {
  sans_bold: "'Plus Jakarta Sans', 'Inter', 'Liberation Sans', system-ui, sans-serif",
  impact: "'Anton', 'Impact', 'Arial Black', 'Liberation Sans', sans-serif",
  geometric: "'Montserrat', 'Poppins', 'DejaVu Sans', system-ui, sans-serif",
  editorial_serif: "'Playfair Display', 'Georgia', 'Liberation Serif', serif",
};

function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function groupWordsSmart(words: WordTimestamp[], maxWords = 3): CaptionGroup[] {
  const limit = Math.max(1, Math.min(4, Math.round(maxWords)));
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
      current.length >= limit ||
      (endsSentence && current.length >= 1) ||
      (endsClause && current.length >= Math.min(2, limit)) ||
      (charCount >= 20 && current.length >= Math.min(2, limit)) ||
      gapToNext > 0.35
    ) {
      flush();
    }
  }
  flush();
  return groups;
}

function buildOutlineShadow(strokePx: number): string {
  const s = Math.max(2, Math.min(8, Math.round(strokePx)));
  return [
    `-${s}px -${s}px 0 #000`,
    `${s}px -${s}px 0 #000`,
    `-${s}px ${s}px 0 #000`,
    `${s}px ${s}px 0 #000`,
    `0 -${s}px 0 #000`,
    `0 ${s}px 0 #000`,
    `-${s}px 0 0 #000`,
    `${s}px 0 0 #000`,
    "0 8px 22px rgba(0,0,0,0.75)",
  ].join(", ");
}

export const DynamicCaptions: React.FC<DynamicCaptionsProps> = ({
  words,
  captionsY = 1350,
  accentColor = "#FBBF24",
  captionStyle = "bold_outline",
  captionFont = "sans_bold",
  captionSize = 60,
  captionAnimation = "pop_spring",
  captionUppercase = true,
  captionStrokeWidth = 4,
  wordsPerGroup = 3,
  highlightKeywords = [],
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const keywordSet = React.useMemo(
    () => new Set(highlightKeywords.map(normalizeWord).filter(Boolean)),
    [highlightKeywords],
  );

  const groups = React.useMemo(
    () => groupWordsSmart(words, wordsPerGroup),
    [words, wordsPerGroup],
  );
  const activeGroup = groups.find(
    (g) => currentTime >= g.start - 0.05 && currentTime <= g.end + 0.12,
  );

  if (!activeGroup) {
    return null;
  }

  const groupStartFrame = Math.max(0, Math.round((activeGroup.start - 0.04) * fps));
  const localFrame = Math.max(0, frame - groupStartFrame);

  let groupScale = 1;
  let groupTranslateY = 0;
  let groupOpacity = 1;

  if (captionAnimation === "pop_spring") {
    const pop = spring({
      frame: localFrame,
      fps,
      config: { damping: 14, stiffness: 220, mass: 0.55 },
    });
    groupScale = 0.9 + 0.1 * pop;
  } else if (captionAnimation === "slide_fade") {
    groupOpacity = interpolate(localFrame, [0, 5], [0, 1], {
      easing: Easing.out(Easing.quad),
      extrapolateRight: "clamp",
    });
    groupTranslateY = interpolate(localFrame, [0, 6], [18, 0], {
      easing: Easing.out(Easing.cubic),
      extrapolateRight: "clamp",
    });
  } else if (captionAnimation === "karaoke_scale") {
    groupOpacity = interpolate(localFrame, [0, 3], [0.7, 1], {
      extrapolateRight: "clamp",
    });
  }

  const isPillDark = captionStyle === "pill_dark";
  const isGlow = captionStyle === "glow";
  const isKineticBox = captionStyle === "kinetic_box";
  const safeFontSize = Math.max(44, Math.min(82, Math.round(captionSize)));
  const fontFamily = FONT_FAMILIES[captionFont] ?? FONT_FAMILIES.sans_bold;
  const outlineShadow = React.useMemo(
    () => buildOutlineShadow(captionStrokeWidth),
    [captionStrokeWidth],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: captionsY,
          left: 64,
          right: 64,
          opacity: groupOpacity,
          transform: `translateY(calc(-50% + ${groupTranslateY}px)) scale(${groupScale})`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: isPillDark || isKineticBox ? "10px" : "14px",
          textAlign: "center",
        }}
      >
        {activeGroup.words.map((item, idx) => {
          const isActive = currentTime >= item.start && currentTime <= item.end + 0.08;
          const isKeyword = keywordSet.has(normalizeWord(item.word));
          const activeBoost = captionAnimation === "karaoke_scale" ? 1.12 : 1.08;
          const scaleFactor = isActive
            ? isKeyword
              ? activeBoost + 0.04
              : activeBoost
            : isKeyword
              ? 1.04
              : 1;

          const baseStyle: React.CSSProperties = {
            fontFamily,
            fontWeight: 900,
            fontSize: isPillDark ? Math.max(42, safeFontSize - 4) : safeFontSize,
            lineHeight: 1.15,
            textTransform: captionUppercase ? "uppercase" : "none",
            letterSpacing: captionFont === "impact" ? "0.02em" : "-0.01em",
            transform: `scale(${scaleFactor})`,
          };

          if (isKineticBox) {
            const emphasized = isActive || isKeyword;
            return (
              <span
                key={`${item.word}-${item.start}-${idx}`}
                style={{
                  ...baseStyle,
                  padding: "6px 18px",
                  borderRadius: 10,
                  backgroundColor: isActive
                    ? accentColor
                    : isKeyword
                      ? "rgba(255, 255, 255, 0.95)"
                      : "rgba(10, 12, 18, 0.88)",
                  color: emphasized ? "#0A0C12" : "#FFFFFF",
                  border: emphasized ? "3px solid #0A0C12" : `2px solid ${accentColor}44`,
                  boxShadow: isActive
                    ? `0 10px 26px rgba(0,0,0,0.6), 0 0 18px ${accentColor}66`
                    : "0 6px 18px rgba(0, 0, 0, 0.5)",
                  transform: `${baseStyle.transform} rotate(${isActive ? "-1.5deg" : "0deg"})`,
                }}
              >
                {item.word}
              </span>
            );
          }

          if (isPillDark) {
            return (
              <span
                key={`${item.word}-${item.start}-${idx}`}
                style={{
                  ...baseStyle,
                  padding: "6px 16px",
                  borderRadius: 14,
                  backgroundColor: isActive
                    ? accentColor
                    : isKeyword
                      ? "rgba(17, 24, 39, 0.92)"
                      : "rgba(10, 12, 18, 0.8)",
                  color: isActive ? "#0A0C12" : isKeyword ? accentColor : "#FFFFFF",
                  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
                }}
              >
                {item.word}
              </span>
            );
          }

          if (isGlow) {
            const highlighted = isActive || isKeyword;
            return (
              <span
                key={`${item.word}-${item.start}-${idx}`}
                style={{
                  ...baseStyle,
                  color: highlighted ? accentColor : "#FFFFFF",
                  textShadow: isActive
                    ? `0 0 18px ${accentColor}, 0 0 36px ${accentColor}, ${outlineShadow}`
                    : isKeyword
                      ? `0 0 12px ${accentColor}88, ${outlineShadow}`
                      : outlineShadow,
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
                color: isActive || isKeyword ? accentColor : "#FFFFFF",
                textShadow: outlineShadow,
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
