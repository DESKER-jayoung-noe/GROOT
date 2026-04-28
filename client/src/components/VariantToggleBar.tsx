/**
 * 변형 토글 바 — 세트 헤더 아래
 * 토글 ON/OFF 로 단품 활성/비활성 필터.
 */
import { TagChip } from "./TagChip";
import { getTagColor } from "../lib/tagColor";

export function VariantToggleBar({
  allTags,
  activeFilters,
  onToggle,
  onClearAll,
}: {
  /** 세트 안의 단품들이 가진 모든 고유 태그 (이름순 정렬됨) */
  allTags: string[];
  /** 현재 ON 상태인 태그들 */
  activeFilters: string[];
  onToggle: (tag: string) => void;
  onClearAll: () => void;
}) {
  if (allTags.length === 0) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
      padding: "8px 10px", marginTop: 8,
      background: "#fff", border: "1px solid #F0F0F0", borderRadius: 6,
    }}>
      <span style={{ fontSize: 10, color: "#7E7E7E", marginRight: 4 }}>변형</span>
      {allTags.map((t) => {
        const on = activeFilters.includes(t);
        const color = getTagColor(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: 500,
              background: on ? color.fg : color.bg,
              color: on ? "#fff" : color.fg,
              border: `1px solid ${on ? color.fg : "transparent"}`,
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all .12s",
            }}
          >
            {t}
          </button>
        );
      })}
      {activeFilters.length > 0 ? (
        <>
          <span style={{ width: 1, height: 16, background: "#E0E0E0", margin: "0 4px" }} />
          <button
            type="button"
            onClick={onClearAll}
            style={{
              padding: "3px 8px", fontSize: 10, color: "#7E7E7E",
              background: "transparent", border: "1px solid #D6D6D6",
              borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            전체 해제 · {activeFilters.length}
          </button>
        </>
      ) : null}
    </div>
  );
}

// 안 쓰지만 import 누락 방지용 더미 export (TagChip referenced 위해)
export const _UNUSED = TagChip;
