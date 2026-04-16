/** 라인 아이콘 — 비활성: 진한 회색, 활성: 흰색 + #2563EB 원 배경 */

const inactive = "#111827";
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

export function IconPlus({ active: isActive, className }: IconProps) {
  const stroke = isActive ? active : inactive;
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" />
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
