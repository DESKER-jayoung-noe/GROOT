/**
 * 태그 칩 1개. 색상 자동, hover 시 × 표시 → 클릭 제거.
 */
import { useState } from "react";
import { getTagColor } from "../lib/tagColor";

export function TagChip({
  tag,
  onRemove,
  size = "md",
}: {
  tag: string;
  onRemove?: (tag: string) => void;
  /** "sm" 은 변형 토글 바용 살짝 작은 사이즈 */
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState(false);
  const color = getTagColor(tag);
  const px = size === "sm" ? "2px 8px" : "2px 8px";
  const fs = size === "sm" ? 10 : 11;
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        height: 20, padding: px, borderRadius: 999,
        background: color.bg, color: color.fg,
        fontSize: fs, fontWeight: 500, whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {tag}
      {onRemove && hover ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          aria-label={`${tag} 태그 제거`}
          style={{
            width: 14, height: 14, padding: 0, border: "none",
            background: "transparent", color: color.fg, opacity: 0.7,
            cursor: "pointer", fontSize: 11, lineHeight: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >×</button>
      ) : null}
    </span>
  );
}
