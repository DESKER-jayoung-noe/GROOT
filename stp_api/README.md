# STP API 서버

STP ZIP + BOM 파일을 파싱해 자재 목록을 반환하는 FastAPI 서버입니다.

## 실행 방법 (로컬)

```bash
# 의존성 설치
pip install -r stp_api/requirements.txt

# 서버 실행
uvicorn stp_api.main:app --host 0.0.0.0 --port 8000 --reload
```

서버가 `http://localhost:8000`에서 실행됩니다.

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/parse/stp-zip` | STP ZIP + BOM 파싱 |
| POST | `/api/parse/bom-only` | BOM만 파싱 (치수 없음) |
| POST | `/api/parse/drawing-pdf` | 도면 PDF 텍스트 파싱 → 자재 1건 |
| GET  | `/api/health` | 헬스 체크 |

## Render 배포 (팀 공용)

1. `stp_api/` 폴더를 GitHub에 push
2. Render → New Web Service → 해당 레포 선택
3. Root Directory: `stp_api`
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. 배포 URL을 프론트엔드 `VITE_STP_API_URL` 환경변수로 설정

## 환경변수

프론트엔드 `client/.env`에서 API URL 설정:

```env
VITE_STP_API_URL=http://localhost:8000
```

Render 배포 후:

```env
VITE_STP_API_URL=https://your-app.onrender.com
```
