/** 라인 아이콘 — 비활성: currentColor(부모에서 color 제어), 활성: 흰색 */

const inactive = "currentColor";
const active = "#ffffff";

type IconProps = { active: boolean; className?: string };

export function IconHome({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 견적내기 — 연필만 (pencil-square는 작은 크기에서 세로·가로 획이 +처럼 보일 수 있음) */
export function IconPlus({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.68-8.681Zm0 0L19.5 7.125"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCompare({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke={stroke} strokeWidth="1.75" />
      <path d="M12 5.5v13" stroke={stroke} strokeWidth="1.75" />
    </svg>
  );
}

export function IconFolder({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLock({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <rect x="6" y="11" width="12" height="10" rx="2" stroke={stroke} strokeWidth="1.75" />
      <path d="M12 14.5v3" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
