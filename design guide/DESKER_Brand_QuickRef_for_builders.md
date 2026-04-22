# DESKER Brand Quick Reference
### 대시보드·툴 제작자를 위한 브랜드 적용 가이드

> 이 파일은 DESKER 구성원이 UI/UX 제작 시 브랜드 아이덴티티를 
> 일관되게 적용하기 위한 빠른 참조용 문서입니다.  
> AI(Claude, Kiro 등)에게 시스템 프롬프트 또는 스타일 지침으로 붙여넣어 사용할 수 있습니다.

---

## ⚡ 핵심 원칙 요약 (3줄)

1. **덜어낸다** — 불필요한 요소, 장식, 설명을 배제한다.
2. **명확하게 전달한다** — 모든 UI 텍스트는 두괄식, 10–30자 이내.
3. **무채색이 기본이다** — 컬러는 의미가 있을 때만, 소량만 사용한다.

---

## 🎨 COLOR TOKENS

```css
/* Primary — 전체 디자인의 80% */
--color-black:       #282828;   /* DESKER BLACK, 주 텍스트·배경 */
--color-dark-gray:   #515151;   /* 보조 텍스트 */
--color-light-gray:  #B3B3B3;   /* 비활성·캡션 */

/* Gray Scale */
--color-white:       #FFFFFF;
--color-gray-10:     #F0F0F0;   /* 기본 배경색 */
--color-gray-20:     #D6D6D6;
--color-gray-40:     #969696;
--color-gray-60:     #616161;
--color-gray-80:     #414141;

/* Secondary — 전체 디자인의 15%, 의미있는 순간에만 */
--color-blue:        #336DFF;   /* 여름(6–8월) */
--color-green:       #00B441;   /* 봄(2–5월) */
--color-red:         #F72B35;   /* 가을(9–10월) */
--color-yellow:      #FFDC1E;   /* 겨울(11–1월) */
--color-beige:       #B1A78A;

/* Attention — 전체 디자인의 5%, 경고·알림 등 기능적 목적만 */
--color-attention:   #FF5948;
```

**컬러 사용 비율 규칙**
| 용도 | 색상 | 비율 |
|---|---|---|
| 배경, 텍스트, 기본 UI | Primary (무채색) | **80%** |
| 강조, 포인트, 시즌 콘텐츠 | Secondary (유채색 1종) | **15%** |
| 오류, 필수 알림 | Attention Orange | **5%** |

> ⚠️ Secondary 컬러는 한 화면에 1종만 사용. 섞지 않는다.

---

## 🔤 TYPOGRAPHY

### 웹·Figma 기준

| 항목 | 국문 | 영문 |
|---|---|---|
| 서체 | **Pretendard** | **Proxima Nova** (유료) / 대체: **Figtree** |
| 기본 굵기 | Regular | Regular |
| 기본 행간 | **140%** | 140% |
| 타이틀 행간 | 100–120% | 100–120% |
| 기본 자간 | **3%** | 3% |
| 타이틀 자간 | **13%** | 13% |
| 캡션·본문 자간 | 0% | 0% |

```html
<!-- Proxima Nova 웹 적용 (Adobe Fonts 유료 라이선스) -->
<link rel="stylesheet" href="https://use.typekit.net/lzs4ixx.css">
```

```css
/* 웹 CSS 기준 */
font-family: "proxima-nova", 'Figtree', 'Pretendard', sans-serif;

/* 타이틀 */
letter-spacing: 0.13em;
line-height: 1.1;
text-align: left; /* 기본 왼쪽 정렬 */

/* 본문 */
letter-spacing: 0.03em;
line-height: 1.4;
text-align: left;

/* 캡션 */
letter-spacing: 0;
line-height: 1.4;
text-align: left;
```

> ⚠️ 영문은 **항상 대문자(ALL CAPS)** 가 기본. 소문자 단독 사용 금지.  
> Proxima Nova 라이선스가 없는 환경에서는 Figtree로 대체.  
> 텍스트 정렬은 **기본적으로 왼쪽 정렬(Left / Grid 기준)**. 중앙 정렬은 예외적 상황(짧은 태그라인, 히어로 카피 등)에만 사용.

---

## 📐 UI 디자인 원칙 (HOW WE SHOW UP)

| 원칙 | 의미 | UI 적용 예시 |
|---|---|---|
| **ESSENTIAL** | 불필요한 요소 배제 | 아이콘 없이 텍스트만, 그림자 없음, 테두리 최소화 |
| **CLEAR** | 직관적 경험 | 레이블은 설명적으로, 상태 변화는 명확하게 |
| **FLEXIBLE** | 맥락에 맞게 | 다크/라이트 모드, 다양한 화면 크기 대응 |
| **IMAGINATIVE** | 구조 속 새로운 해석 | 그리드를 지키되 레이아웃에 리듬감 |

**금지 사항 (NOT TO DO)**
- 그라디언트 배경
- 과도한 그림자 (box-shadow 남용)
- 여러 유채색 동시 사용
- 장식용 일러스트, 아이콘 과다
- 폰트 굵기 Bold 이상 남용

---

## 🗣 VOICE & TONE (UI 텍스트 작성 원칙)

### 기본 원칙
- 문장은 **두괄식** — 결론이 먼저
- 한 문장 **10–30자** 이내
- 느낌표 **0–1개**, 이모지 **0–1개** per 화면
- 응용형 어미 금지 (했답니다, 거랍니다 ✗)
- 어미는 **-다 다음 -요, -요 다음 -다** 교차

### 예시
| 나쁜 예 (DON'T) | 좋은 예 (DO) |
|---|---|
| 데이터를 불러오는 중이에요~! 🎉 | 데이터를 불러오고 있어요. |
| 이 기능은 ~을 위해 설계되었습니다. | 목재 수량을 자동으로 계산합니다. |
| 완벽하게 완료되었습니다!! | 저장되었습니다. |

---

## 🖼 VISUAL STYLE (이미지·그래픽 사용 시)

- 배경: **#F0F0F0** 또는 **#FFFFFF** 기반
- 무드: 모노톤, 매트 질감, 낮은 대비
- 여백을 충분히 — 빽빽하게 채우지 않는다
- 사람 이미지 사용 시: 얼굴 클로즈업 지양, 관찰자 시점

---

## 🤖 AI 프롬프트용 스타일 지침 (Claude / Kiro에 붙여넣기)

아래를 시스템 프롬프트 또는 `.kiro/steering/` 파일에 포함하세요.

```html
<!-- in <head> -->
<link rel="stylesheet" href="https://use.typekit.net/lzs4ixx.css">
```

```
You are building a UI that reflects DESKER brand identity.

VISUAL RULES:
- Background: #F0F0F0 (default) or #FFFFFF
- Primary text: #282828
- Secondary text: #515151
- Accent color: use ONE secondary color sparingly (max 15% of design)
- No gradients, no heavy shadows, no decorative icons
- All English labels: ALL CAPS
- Font: "proxima-nova" via Adobe Fonts (fallback: Figtree), Pretendard for Korean
- Letter spacing: 0.13em for titles, 0.03em for body, 0 for captions
- Line height: 1.4 for body, 1.1 for titles
- Text alignment: LEFT by default on all elements. Center-align only for short hero copy or taglines.

TONE RULES:
- All UI copy: concise (10–30 chars per sentence), conclusion-first
- No exclamation marks unless essential (max 1 per screen)
- Use plain, professional language — no trendy slang

DESIGN PRINCIPLES: ESSENTIAL · CLEAR · FLEXIBLE · IMAGINATIVE
Strip everything unnecessary. If an element doesn't serve the user, remove it.
```

---

## 📎 원문 참조

전체 브랜드 원문은 별도 `DESKER_brand_identity.md` 파일을 참조하세요.  
텍스트 원문은 임의 수정 없이 그대로 사용합니다.
