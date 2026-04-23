# DESKER 파싱 모듈 — 커서(Cursor AI) 관리 규칙
===============================================

이 폴더(`stp_api/`)에는 STP·PDF 파싱 핵심 로직이 들어 있습니다.
**아래 규칙을 반드시 지켜주세요.**

---

## ❌ 커서가 절대 건드리지 말아야 할 파일

| 파일 | 이유 |
|------|------|
| `stp_api/parser.py` | STP 치수/엣지/보링 파싱 핵심 로직 |
| `stp_api/pdf_parser.py` | PDF 도면 파싱 핵심 로직 |

이 두 파일은 **사람이 명시적으로 "수정해줘"라고 요청할 때만** 변경합니다.
자동 리팩토링, import 정리, 변수명 변경 등 어떠한 자동 수정도 하지 않습니다.

---

## ✅ 커서가 수정해도 되는 구간

각 파일 안에 `# EDIT:` 주석이 붙은 구간만 수정 가능합니다.

```python
# EDIT: 엣지 판별 임계값 변경 시 이 함수
def analyze_edge(...):
    ...

# EDIT: 하드웨어 키워드 목록 수정 시 이 상수만 변경
HARDWARE_KEYWORDS = [...]
```

**수정 요청 예시:**
- "엣지 판별 임계값을 0.3에서 0.5로 바꿔줘" → `# EDIT:` 해당 구간만 변경
- "하드웨어 키워드에 MAGNET 추가해줘" → `HARDWARE_KEYWORDS` 상수만 변경

---

## 📁 폴더 구조

```
stp_api/
├── main.py          ← FastAPI 엔드포인트 (수정 가능)
├── parser.py        ← STP 파싱 핵심 ⛔ 명시적 요청 시만 수정
├── pdf_parser.py    ← PDF 파싱 핵심 ⛔ 명시적 요청 시만 수정
├── requirements.txt ← 의존성 (수정 가능)
└── CURSOR_RULES.md  ← 이 파일
```

---

## 🛠 커서에게 수정 요청하는 올바른 방법

### ✅ 좋은 예
```
parser.py 의 analyze_edge 함수에서 엣지 판별 임계값(현재 0.3)을 
0.5로 변경해줘. # EDIT: 주석이 있는 구간만 수정.
```

### ❌ 나쁜 예
```
stp_api 폴더 전체를 리팩토링해줘.
파싱 로직을 더 효율적으로 바꿔줘.
```

---

## API 엔드포인트 스펙 (main.py 참조용)

### POST `/api/parse/stp-zip`
```
form-data:
  file: ZIP 파일 (필수)
  bom:  .bom.3 파일 (선택)

Response 200:
[
  {
    "id": "mat_1",
    "name": "뒷판 A",
    "W": 1169.0,
    "D": 550.0,
    "T": 15.0,
    "hole_1st": 8,
    "hole_2nd": 4,
    "edge": {
      "face_count": 4,
      "face_label": "4면",
      "edge_T": 1.0,
      "edge_length": "1169.0+550.0+1169.0+550.0",
      "faces": ["top","bottom","left","right"]
    },
    "asm_parts": []
  }
]
```

### POST `/api/parse/pdf`
```
form-data:
  file: PDF 파일 (필수)

Response 200:
{
  "name": "뒷판 A",
  "W": 1169.0,
  "D": 550.0,
  "T": 15.0,
  "material": "PB",
  "hole_1st": 8,
  "hole_2nd": 0,
  "confidence": 0.9
}
```

---

## 의존성 설치

```bash
pip install fastapi uvicorn[standard] python-multipart \
            build123d pdfplumber pymupdf \
            --break-system-packages

uvicorn stp_api.main:app --host 0.0.0.0 --port 8000 --reload
```
