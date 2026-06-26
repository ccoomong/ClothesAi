# ClothesAi — 인계 문서 (2026-06-27 갱신)

## 0. 최신 상태 (2026-06-27) — 먼저 읽어라

> 두 기계(윈도우/맥)에서 번갈아 작업 중. **작업 시작 전 `git pull --rebase`, 끝나면 push.** 같은 파일 동시 편집 금지.

**라이브 도메인: https://clothes-ai-three.vercel.app** (← 이게 진짜. `clothes-ai-seven`은 OpenAI 키 없는 옛 배포니 테스트 금지.)

**AI 백본 (현재):** OpenAI `gpt-4o-mini`(채팅·큐레이션) + `gpt-image-1`(코디별 모델 일러스트). 키 없으면 Groq Llama로 폴백. 비전 분류는 여전히 Groq Llama 4 Scout.

**로컬 개발:** `vite.config.js`가 `/api/*`를 clothes-ai-three로 프록시 → **로컬에 키 불필요**. `npm install && npm run dev`만. `.env` 만들지 말 것.

**방금 고쳐서 푸시한 것 (최신 main, 검증 완료):**
1. 룩북에서 신발만 뜨고 상의/하의/모자가 사라지던 문제 → `batch-search.js`: 필터가 슬롯을 0개로 깎으면 단계적으로 풀어 이미지 있는 후보를 항상 확보(`final` 폴백 cascade). **이 로직 깨지 말 것.**
2. 모델 일러스트 머리·발 잘리고 배경 있던 문제 → 전신(1024×1536) + `background:transparent`(인물만 단독 PNG) + "머리끝~발끝 안 잘리게" 프롬프트. `api/image.js`에 `background` 파라미터 추가됨.

**다음 할 일:** 모델 일러스트 옆/주변에 실제 상품 누끼 + 점선 라벨을 붙여 "이 룩의 구성 아이템"을 한눈에 보여주는 잡지 룩북형 레이아웃. 지금은 일러스트가 메인, 그 아래 상품 가격 카드 리스트 구조. 시작 전 `src/App.jsx`의 `LookbookCard` 읽고 붙일 방식 먼저 제안할 것.

**디버깅 원칙:** 추측 말고 라이브 API를 직접 curl로 찔러 어디서 깨지는지 확인. `/api/ai` 응답 id가 `openai-...`면 정상, `groq-...`면 OpenAI 키 폴백 상태.

---

## 1. 팀

- **임준우** (한양대 ERICA 인공지능학과) — 팀장
- **영균** — 신규 합류 (2026-05-14)
- 둘이 같은 Anthropic Claude 계정 공유, 각자 자기 컴퓨터에서 Claude Code 실행

## 2. 프로젝트 한 줄

추상 스타일 표현("꾸안꾸", "소개팅룩")을 LLM이 해석해 실제 네이버 쇼핑 상품으로 구성된 채팅형 룩북을 만들어주는 AI 패션 큐레이터. **2026 인공지능 루키 대회** 출전작.

## 3. 환경

| 항목 | 값 |
|------|---|
| 로컬 작업 폴더 | `C:\Users\<유저>\projects\clothesai` (각자 컴퓨터에 clone) |
| GitHub | https://github.com/limjunwoo04/ClothesAi |
| Vercel 라이브 | https://clothes-ai-three.vercel.app |
| 배포 | GitHub push → Vercel 자동 1~2분 |
| 환경변수 (Vercel) | `OPENAI_API_KEY`, `GROQ_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` — **절대 코드에 직접 적지 말 것**, `process.env`로만 참조 |

## 4. 기술 스택

- **프론트**: Vite + React + Tailwind CSS, 단일 파일 `src/App.jsx`
- **백엔드**: Vercel Serverless Functions (`api/ai.js`, `api/batch-search.js`, `api/health.js`)
- **AI 백본**:
  - 텍스트: **Groq Llama 3.1 8B Instant** (검색어 생성 + JSON mode 강제)
  - 비전: **Groq Llama 4 Scout 17B** (단독컷 vs 모델샷 분류)
- **데이터**: 네이버 쇼핑 OpenAPI (`shop.json`)
- **아이콘**: lucide-react

## 5. 디자인 원칙 (절대 X)

- 보라색 그라디언트, 둥근 모서리 남발, 이모지
- "AI가 만든 느낌"
- 베이지/크림 톤 — **현재 톤은 흰색 + 네이비** (잉크 `#0F1F4A`, 액센트 `#2C4A8B`, 라인 `#E5EAF2`)
- 폰트: Fraunces(이탤릭 디스플레이) + Pretendard(본문) + Noto Serif KR(한글 강조)
- 디테일은 `CLAUDE.md` 참조

## 6. 5/8 ~ 5/14 사이 한 일 (요약)

### 백엔드 마이그레이션
- ❌ Cloudflare Worker → ✅ Vercel API Routes (학교/회사 와이파이 `workers.dev` 차단 회피)
- ❌ Anthropic Claude Sonnet 4 → ✅ Groq Llama 3.1 8B (무료 tier + 한국 location)
- 검색어 폴백 3단: 원본 → 마지막 토큰 빼기 → 슬롯 일반어
- 무신사 booster: 1차 결과에 무신사 < 3개면 "검색어 + 무신사"로 재검색해 합침

### 5겹 휴리스틱 + Vision 통합
1. 외부 직링만 통과 (`naver.com` 도메인 컷 — 보안 인증 트리거 회피)
2. **TIER1·3 셀렉트샵만 통과** (TIER4 일반 스마트스토어 셀러는 hard exclude)
3. 슬롯 카테고리 화이트리스트 (hat→모자/캡/비니, top→셔츠/티셔츠/맨투맨…)
4. 성별 위반 키워드 제외 (남성 검색에 "여성" 토큰 있으면 컷)
5. 멀티컷·세트 키워드 제외 (`세트`, `2종`, `풀세트`, `컬러구성` 등)
6. **Vision 분류** — 슬롯당 상위 2장을 Llama 4 Scout에 보내 `clean / scene / multi / model` 판정, clean·scene만 통과

각 단계마다 결과 < 2개 안전장치로 풀어줌. TIER4 제외만 절대 풀지 않음.

### 이미지 안정성
- 백엔드: image_url 없는 항목 통째 제거, 신뢰 CDN 도메인 우선 (msscdn / 29cm / wconcept / eqlstore / lookpin / pstatic)
- 프론트: 5단 cascade fallback — picked의 image 깨지면 같은 슬롯의 다른 후보 image로 자동 swap (`_alt_images` 4개)
- 슬롯의 candidates가 빈약(<5)하면 다른 outfit의 같은 슬롯 결과를 합쳐 풀 키움 (outfit 2·3 빈 박스 방지)
- placeholder는 텍스트·테두리 없는 투명 박스

### UI 개편
- 인트로·프로필 페이지 통째 제거 → **첫 화면부터 채팅**
- AI 어시스턴트 `Clo`가 친구처럼 단계별로 프로필 수집: 성별 → 나이 → 키 → 체형(자유입력) → 예산 → 스타일
- 룩북 결과도 채팅 안에 박힘 (별도 페이지 X)
- 후속 질문 무한 가능 ("더 빈티지하게")
- 컬러: 크림 베이지 → 흰색 + 네이비
- 모바일 100dvh + flex 레이아웃 (키보드 올라와도 입력창 고정)
- 입력 자동 포커스 (자유 입력 단계에서)
- 카톡식 자동 스크롤 (사용자가 위로 올린 상태면 자동 점프 X)
- 데스크톱 max-w-5xl, 모바일 max-w-2xl
- 로딩 4-phase: "스타일 표현 분석 중 → 톤과 색감 잡는 중 → 실제 상품 찾는 중 → 룩북 엮는 중"

### mood_label 다양화
LLM 프롬프트에 30+ 시드 (꾸안꾸 선데이 카페크루, 올드머니 프레피, 다크 아카데미아, Y2K 레트로 키치, 성수 카페 호퍼, 한강 피크닉, 발레코어, 고프코어 등). 매번 새 표현.

## 7. 현재 빌드 상태

- 모든 단계 동작 확인 (5/14 기준)
- TIER4 hard exclude 후 빈 박스 거의 0
- 응답 시간 5~15초 (Vision 호출 포함)
- 라이브: https://clothes-ai-seven.vercel.app

## 8. 후속 작업 큐

### 우선순위 높음 (5월 후반)
- [ ] 사업계획서 PDF 백본 표기 갱신 (Anthropic Claude Sonnet 4 → Groq Llama 3.1 8B + 3.2/4 Vision)
- [ ] 도전제안서 7곳 + 추진일정 수정 (옛 `C:\Users\limju\OneDrive\바탕 화면\대회\clothesai\files\HANDOFF.md` 7곳 패치 참고)
- [ ] 친구 5~10명한테 라이브 시험시키고 피드백 모으기

### 중기 (6~7월) — 결선 차별점 후보
- [ ] **자체 누끼 처리 인프라**: HuggingFace `briaai/RMBG-1.4` + Vercel Blob 캐싱. 모든 상품 사진 흰배경 누끼화. 1~2주 작업.
- [ ] 4-아이템 콜라주 레이아웃 (인스타 #코디추천 톤)
- [ ] 후속 질문 컨텍스트 유지 ("이 신발만 바꿔줘" 식)

### 저우선
- [ ] 어필리에이트 등록 시도 (지그재그/링크프라이스 등 — 학생팀이 따내기 어려움. 결선 어필 카드로만)
- [ ] 발표 영상 시나리오 1분/3분 버전

## 9. 대회 일정

| 일정 | 단계 |
|------|------|
| 2026-05-13 ~ 05-25 | 예선심사 (서류) → 100팀 |
| 2026-06-04 | 기술 워크숍 |
| 2026-08-19 ~ 08-27 | 본선 심사 → 40팀 |
| 2026-11-03 ~ 11-05 | 1차 결선 → 10팀 |
| 2026-11-18 | 최종 결선 |

## 10. 워크플로우

### 코드 변경
```bash
# 매번 작업 시작 전
git pull

# 변경 후
git add .
git commit -m "<짧은 설명>"
git push
# → Vercel 1~2분 후 자동 배포
```

### Claude Code 사용
- 작업 폴더(`...\projects\clothesai`)에서 `claude` 실행
- `CLAUDE.md` 자동 로드 → 4원칙 (Think Before / Simplicity / Surgical / Goal-Driven) 적용
- 큰 변경 전엔 가정 명시 + 작은 단위로 push

### 디버깅
- Vercel Functions 로그: Vercel 대시보드 → Functions → Logs
- 라이브 헬스체크: https://clothes-ai-seven.vercel.app/api/health

## 11. 주의

- API 키는 **절대 코드/문서/커밋에 노출 금지**. Vercel 환경변수로만.
- TIER4 일반 셀러는 **어떤 안전장치에서도 통과 X** (이미지 깨짐 주범)
- 사용자(임준우) 코딩 경험 적음 → 영균이가 코딩 강하면 페어 작업이 자연스러움
- 새 기능보다 **안정·디자인 일관성** 우선

---

이 문서는 살아있는 문서. 큰 변경 있을 때마다 업데이트.
