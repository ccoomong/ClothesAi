import { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, ShoppingBag, Loader2, RefreshCw, X, Info, ExternalLink, Search, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { MANUAL_TRENDS } from './trends';
import { removeBackground, preload } from '@imgly/background-removal';

// 네이버 쇼핑 이미지(pstatic CDN)를 같은 origin 프록시로 변환 → 누끼 시 CORS 우회.
// dev: vite 프록시(/np-img) / prod: Vercel 함수(/api/img-proxy)
function toProxyUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('pstatic.net')) {
      if (import.meta.env.DEV) return `/np-img${u.pathname}${u.search}`;
      return `/api/img-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch { /* noop */ }
  return url;
}

// 누끼 추론 디바이스 — WebGPU 지원 시 GPU(수배 빠름), 아니면 CPU.
// 모델은 기본값(isnet_fp16) 유지 → 품질 손해 0.
let _nukiDevice = (typeof navigator !== 'undefined' && navigator.gpu) ? 'gpu' : 'cpu';

// 모델(WASM ~24MB) 1회 프리로드 — 첫 이미지가 다운로드 지연을 떠안지 않게 미리 받아둠.
let _nukiPreloaded = false;
export function warmupNuki() {
  if (_nukiPreloaded) return;
  _nukiPreloaded = true;
  preload({ device: _nukiDevice }).catch(() => { _nukiPreloaded = false; });
}

// ── 누끼 결과 영구 캐시 (IndexedDB) — 새로고침·재방문 시 재처리 0 ──
const IDB_NAME = 'clothesai-nuki';
const IDB_STORE = 'blobs';
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}
async function idbSet(key, blob) {
  try {
    const db = await idbOpen();
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(blob, key);
  } catch { /* noop — 캐시 실패는 무시, 다음 방문에 재처리 */ }
}

// 누끼 결과 캐시 — 같은 원본 URL 재처리 방지.
// 1) 메모리(objectURL 공유) → 2) IndexedDB 영구 → 3) 실제 누끼 추론.
const _nukiCache = new Map();
async function getNukiUrl(srcUrl) {
  if (_nukiCache.has(srcUrl)) return _nukiCache.get(srcUrl);

  // 2) 영구 캐시 히트 → 추론 건너뜀
  const cachedBlob = await idbGet(srcUrl);
  if (cachedBlob) {
    const objUrl = URL.createObjectURL(cachedBlob);
    _nukiCache.set(srcUrl, objUrl);
    return objUrl;
  }

  // 3) 실제 추론 — GPU 경로가 실패하면 CPU로 전역 폴백 후 1회 재시도
  const proxied = toProxyUrl(srcUrl);
  let blob;
  try {
    blob = await removeBackground(proxied, { device: _nukiDevice });
  } catch (e) {
    if (_nukiDevice === 'gpu') {
      _nukiDevice = 'cpu';
      _nukiPreloaded = false;
      blob = await removeBackground(proxied, { device: 'cpu' });
    } else {
      throw e;
    }
  }

  idbSet(srcUrl, blob); // 영구 저장 (비동기, await 불필요)
  const objUrl = URL.createObjectURL(blob);
  _nukiCache.set(srcUrl, objUrl);
  return objUrl;
}

// ─────────────────────────────────────────────────────────────
// ClothesAi v7 · Vercel 배포 가능 버전
// 모든 API 호출을 Worker로 통일 (Claude + 네이버)
// ─────────────────────────────────────────────────────────────

const WORKER_URL = '';

const FONT_LINK = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,800;1,9..144,400&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700;800;900&display=swap');

:root {
  --cream: #FFFFFF;
  --cream-deep: #FFFFFF;
  --paper: #FFFFFF;
  --ink: #0F1F4A;
  --ink-soft: #1B2D5C;
  --accent: #2C4A8B;
  --muted: #8B95A6;
  --line: #EEF1F6;
  --lookbook-bg: #FFFFFF;
}

@keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes drift { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
@keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes dotTyping {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}
.dot-typing {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink);
  display: inline-block;
  animation: dotTyping 1.2s infinite;
}

.font-display { font-family: 'Fraunces', 'Noto Serif KR', serif; font-feature-settings: "ss01", "ss02"; }
.font-serif-kr { font-family: 'Noto Serif KR', 'Fraunces', serif; }
.font-body { font-family: 'Pretendard', 'Inter', -apple-system, sans-serif; }

.fade-up { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
.fade-in { animation: fadeIn 0.6s ease both; }
.drift { animation: drift 4s ease-in-out infinite; }
.pulse-soft { animation: pulse 2s ease-in-out infinite; }
.slide-in-right { animation: slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
.slide-in-left { animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }

.btn-press { transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
.btn-press:active { transform: scale(0.97); }

.grain { background: transparent; }

.lookbook-paper {
  background: #FFFFFF;
}

.product-shadow { filter: drop-shadow(0 8px 16px rgba(15,31,74,0.12)) drop-shadow(0 2px 4px rgba(15,31,74,0.06)); }
.price-card-shadow { box-shadow: 0 2px 12px rgba(15,31,74,0.08), 0 0 0 1px rgba(15,31,74,0.04); }

.image-shimmer {
  background: linear-gradient(90deg, #F4F6FA 0%, #FFFFFF 50%, #F4F6FA 100%);
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}

input::placeholder, textarea::placeholder { color: #A6B0C2; }
input:focus, textarea:focus, select:focus { outline: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

const getImageSources = (item) => {
  const sources = [];
  if (item.image_url && /^https?:\/\//.test(item.image_url)) {
    sources.push(item.image_url);
  }
  if (Array.isArray(item._alt_images)) {
    item._alt_images.forEach((url) => {
      if (url && /^https?:\/\//.test(url)) sources.push(url);
    });
  }
  return sources;
};

const SAMPLE_PROMPTS = [
  '개강 첫날인데 너무 꾸민 느낌은 싫고 깔끔하게',
  '소개팅인데 부담스럽지 않게 꾸안꾸로',
  '힙하지만 과하지 않게, 무난한데 센스 있게',
  '면접 끝나고 친구 만나기 좋은 단정한 룩',
  '주말 카페 데이트, 편안한데 신경쓴 느낌',
];

// 한 번 탭으로 끝나는 스타일 입력 — TPO + 무드 칩
const TPO_CHIPS = [
  '개강 첫날', '주말 카페', '소개팅', '면접 후 약속',
  '데이트', '친구 만남', '출근·등교', '여행',
];

const MOOD_CHIPS = [
  '꾸안꾸', '미니멀', '올드머니', '스트릿',
  '프렌치 빈티지', '캐주얼', '댄디', '스포티', 'Y2K',
];

// 스타일 발견 풀 — 라벨 없는 무드컷(public/quiz/{성별}/{id}.webp). 각 룩에 숨은 속성 태그.
// 사용자가 고른 룩들의 태그를 모아 ① 비슷한 룩을 더 보여주고 ② 공통점을 추출해 추천에 주입.
const LOOKS = [
  { id: 'min_neutral', tags: ['minimal', 'neutral', 'tailored', 'oversized'] },
  { id: 'min_mono', tags: ['minimal', 'mono', 'sleek', 'tailored'] },
  { id: 'min_relaxed', tags: ['minimal', 'neutral', 'oversized', 'relaxed'] },
  { id: 'casual_denim', tags: ['casual', 'neutral', 'relaxed', 'denim'] },
  { id: 'casual_knit', tags: ['casual', 'classic', 'knit', 'neutral'] },
  { id: 'casual_sport', tags: ['casual', 'sporty', 'relaxed'] },
  { id: 'street_over', tags: ['street', 'oversized', 'earthy', 'casual'] },
  { id: 'street_mono', tags: ['street', 'mono', 'edgy'] },
  { id: 'street_tech', tags: ['street', 'outdoor', 'tech', 'earthy'] },
  { id: 'oldmoney_beige', tags: ['oldmoney', 'classic', 'neutral', 'tailored'] },
  { id: 'oldmoney_vest', tags: ['oldmoney', 'preppy', 'classic', 'knit'] },
  { id: 'oldmoney_coat', tags: ['oldmoney', 'classic', 'tailored', 'neutral'] },
  { id: 'lovely_pastel', tags: ['romantic', 'pastel', 'soft'] },
  { id: 'lovely_floral', tags: ['romantic', 'pastel', 'soft', 'print'] },
  { id: 'lovely_knit', tags: ['romantic', 'knit', 'soft', 'classic'] },
  { id: 'gorp_shell', tags: ['outdoor', 'earthy', 'tech', 'relaxed'] },
  { id: 'gorp_fleece', tags: ['outdoor', 'earthy', 'casual', 'relaxed'] },
  { id: 'sporty_track', tags: ['sporty', 'casual', 'relaxed'] },
  { id: 'sporty_active', tags: ['sporty', 'active', 'fitted'] },
  { id: 'y2k_denim', tags: ['retro', 'denim', 'bold', 'street'] },
  { id: 'y2k_color', tags: ['retro', 'bold', 'playful', 'street'] },
  { id: 'french_chic', tags: ['minimal', 'french', 'classic', 'neutral'] },
  { id: 'workwear', tags: ['casual', 'earthy', 'rugged', 'street'] },
  { id: 'smart_casual', tags: ['smart', 'classic', 'tailored', 'neutral'] },
];
const styleImgPath = (gender, id) => `/quiz/${gender === '남성' ? 'men' : 'women'}/${id}.webp`;

// 태그 → 한국어 스타일 단어 (공통점을 추천 쿼리로 변환)
const TAG_KO = {
  oldmoney: '올드머니', minimal: '미니멀', street: '스트릿', romantic: '러블리', sporty: '스포티',
  retro: 'Y2K', outdoor: '고프코어', classic: '클래식', casual: '캐주얼', preppy: '프레피',
  french: '프렌치', smart: '세미정장', edgy: '시크', rugged: '워크웨어',
  neutral: '뉴트럴', mono: '모노톤', earthy: '어스톤', pastel: '파스텔', bold: '비비드',
  oversized: '오버핏', tailored: '테일러드', relaxed: '루즈핏', fitted: '슬림',
  knit: '니트', denim: '데님', tech: '테크', soft: '소프트', sleek: '슬릭', print: '프린트',
  playful: '키치', active: '액티브',
};
// 무드 계열(추천 쿼리 우선) vs 보조(질감·실루엣)
const MOOD_TAGS = new Set(['oldmoney', 'minimal', 'street', 'romantic', 'sporty', 'retro', 'outdoor', 'classic', 'casual', 'preppy', 'french', 'smart', 'edgy', 'rugged']);

const lookById = (id) => LOOKS.find((l) => l.id === id);
// 고른 룩들의 태그 빈도 집계
function aggregateTags(ids) {
  const freq = {};
  ids.forEach((id) => (lookById(id)?.tags || []).forEach((t) => { freq[t] = (freq[t] || 0) + 1; }));
  return freq;
}
// 한 룩이 현재 취향(freq)과 얼마나 겹치나
const overlapScore = (tags, freq) => tags.reduce((s, t) => s + (freq[t] || 0), 0);
// 안 보여준 룩 중 취향과 가장 비슷한 N개
function similarUnseen(pickedIds, seenIds, n) {
  const freq = aggregateTags(pickedIds);
  const seen = new Set(seenIds);
  return LOOKS
    .filter((l) => !seen.has(l.id))
    .map((l) => ({ id: l.id, s: overlapScore(l.tags, freq) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.id);
}
// 공통점 → 상위 스타일 단어 (styleQuery용): 무드 우선 + 보조 1~2개
function commonalityQuery(ids) {
  const sorted = Object.entries(aggregateTags(ids)).sort((a, b) => b[1] - a[1]);
  const moods = sorted.filter(([t]) => MOOD_TAGS.has(t)).slice(0, 2).map(([t]) => TAG_KO[t]);
  const others = sorted.filter(([t]) => !MOOD_TAGS.has(t)).slice(0, 2).map(([t]) => TAG_KO[t]);
  return [...moods, ...others].filter(Boolean).join(' ');
}
// 초기 시드 — 무드별로 흩어진 다양한 9장
const SEED_IDS = ['min_neutral', 'casual_denim', 'street_over', 'oldmoney_beige', 'lovely_pastel', 'gorp_shell', 'sporty_track', 'y2k_denim', 'smart_casual'];

// 성별만 받으면 나머지 프로필은 평균값으로 채워 룩북 생성 진입을 단축
const buildDefaultProfile = (gender) => ({
  gender,
  age: '24',
  height: gender === '남성' ? '174' : '163',
  bodyType: '보통',
  budget: '30',
  dislikes: '',
});

// ─────────────────────────────────────────────────────────────
// 🔥 v7 핵심 변경점
// 이전: fetch('https://api.anthropic.com/v1/messages', ...) → CORS 차단
// 이제: fetch(`${WORKER_URL}/ai`, ...) → Worker 프록시 경유 → Vercel 배포 OK
// ─────────────────────────────────────────────────────────────

// 색 어휘 — outfit 간 폴백 시 AI가 의도한 색에 가까운 상품을 우선 선택하기 위함
const COLOR_VOCAB = [
  '블랙', '검정', '검은', '먹',
  '화이트', '아이보리', '크림', '오프화이트',
  '베이지', '샌드',
  '차콜', '그레이', '회색', '멜란지',
  '네이비', '남색', '딥블루',
  '브라운', '갈색', '모카', '초콜릿', '카멜',
  '카키', '올리브',
  '와인', '버건디', '레드', '빨간',
  '핑크', '코랄', '살구',
  '블루', '하늘', '청', '인디고',
  '옐로우', '머스타드', '버터',
  '그린', '민트', '세이지',
  '퍼플', '라벤더',
  '오렌지',
];

// 0 = 의도 색 정확히 포함 / 1 = 색 정보 없음 / 2 = 다른 색 포함 (배제 우선순위 ↑)
const colorMatchScore = (candidateName, intendedColor) => {
  if (!candidateName || !intendedColor) return 1;
  const name = candidateName.toLowerCase();
  const target = intendedColor.toLowerCase();
  if (name.includes(target)) return 0;
  const hasOtherColor = COLOR_VOCAB.some((c) => {
    const cl = c.toLowerCase();
    return cl !== target && name.includes(cl);
  });
  return hasOtherColor ? 2 : 1;
};

// 하이브리드 트렌드 블록 — 수동 큐레이션 + DataLab 자동 시그널
const buildTrendBlock = (trends) => {
  const lines = [];
  if (MANUAL_TRENDS.length > 0) {
    lines.push('[큐레이터 노트 (수동)]');
    MANUAL_TRENDS.forEach((t) => lines.push(`- ${t}`));
  }
  const hot = trends?.hot || [];
  const rising = trends?.rising || [];
  if (hot.length || rising.length) {
    lines.push('[Naver 검색량 시그널 (자동)]');
    if (hot.length) lines.push(`- 최근 2주 검색량 상위: ${hot.join(', ')}`);
    if (rising.length) lines.push(`- 빠르게 뜨는 중: ${rising.join(', ')}`);
  }
  if (lines.length === 0) return '';
  return `\n## 현재 시즌 트렌드 메타 (가이드)\n${lines.join('\n')}\n위 트렌드 결을 자연스럽게 반영하되, 사용자 요청·체형·예산을 최우선.\n`;
};

const callAI = async (profile, styleQuery, trends) => {
  // 트렌드 블록은 일시 비활성. Llama 3.1 8B + JSON mode 조합에서 컨텍스트 늘리면
  // outfits 1개·슬롯 누락 패턴이 잦아 비활성. 더 큰 모델로 올린 뒤 재활성.
  // const trendBlock = buildTrendBlock(trends);

  const prompt = `너는 한국 20대 패션 큐레이터다. 사용자의 추상적 스타일 표현을 해석해, 네이버 쇼핑에서 실제 검색 가능한 한국어 키워드로 변환한다.

## 사용자 프로필
- 성별: ${profile.gender}
- 나이: ${profile.age}세
- 키: ${profile.height}cm
- 체형: ${profile.bodyType}
- 예산: ${profile.budget}만원
- 싫어하는 스타일: ${profile.dislikes || '없음'}

## 사용자 입력
"${styleQuery}"

## 작업 순서

### 1. 사용자 입력 분석 (가장 중요)
사용자 입력 "${styleQuery}"의 **모든 토큰**(상황·무드·계절·동네·키워드)을 추출.
mood_label과 검색어는 **이 토큰들에서 직접 파생**되어야 한다. 입력 무시 금지.

예시:
- 입력 "여행 · 스포티 무드" → mood_label = "어반 스포티 트래블", "휴양지 액티브 룩" 등 (입력 어휘 직접 포함)
- 입력 "소개팅 · 데이트" → mood_label = "데이트 디너 셋업", "소개팅 단정 룩" 등
- 입력 "출근 · 깔끔" → mood_label = "오피스 캐주얼 모던", "깔끔 출근 비즈" 등

### 2. 입력별 카테고리 매핑 (검색어 결정에 직결)
입력 키워드에 따라 자연스러운 옷 카테고리 선택:

| 입력 키워드 | 추천 카테고리 |
|---|---|
| 여행 / 휴양지 / 트래블 | 후드티·맨투맨·반팔티 + 조거팬츠·트레이닝·반바지 + 스니커즈·샌들 + 볼캡·버킷햇 |
| 스포티 / 액티브 / 캐주얼 | 후드·맨투맨·티셔츠 + 트레이닝·조거 + 스니커즈 + 볼캡 |
| 미팅 / 오피스 / 비즈 | 셔츠·블레이저 + 슬랙스 + 로퍼·구두 + (모자X) |
| 데이트 / 소개팅 | 니트·셔츠·블라우스 + 슬랙스·스커트 + 로퍼·플랫·첼시부츠 + (모자 선택) |
| 캠퍼스 / 학교 | 맨투맨·후드·셔츠 + 데님·치노·슬랙스 + 스니커즈 + 볼캡 |
| 빈티지 / 레트로 | 니트·가디건·셔츠 + 데님·코듀로이 + 로퍼·스니커즈 + 비니·버킷햇 |
| 미니멀 / 모노톤 | 셔츠·니트·맨투맨 + 슬랙스·데님 + 스니커즈·로퍼 + (단색 모자) |

→ 입력 무드에 안 맞는 카테고리 절대 사용 금지. (예: 여행에 셔츠+슬랙스 X)

### 3. mood_label 톤 참고 (베끼지 말 것)
다음은 톤 참고용 시드. **입력에 없는 동네/상황 시드를 베끼면 안 된다.**
"꾸안꾸 선데이 카페크루" / "프렌치 빈티지" / "올드머니 프레피" / "다크 아카데미아"
/ "고프코어 어반" / "Y2K 레트로 키치" / "노멀코어 베이직" / "발레코어 댄스" 등

→ 톤만 참고하고, 사용자 입력 어휘로 **새 라벨**을 만든다.

### 4. outfits 생성 규칙
- **반드시 정확히 3개의 서로 다른 코디**. 각 코디는 **상의·하의·신발 필수**, **모자는 선택**(아래 모자 규칙).
- 가방·양말 X
- 각 코디는 **같은 입력 무드 안에서 다른 방향성** (예: 여행이면 1번-에어컨 카페형 / 2번-야외 액티브 / 3번-호텔 디너)
- 각 outfit의 title도 입력 어휘 반영 (예: "공항 패션", "리조트 디너", "휴양지 산책")
- 각 아이템마다 네이버 검색어(search_keyword) 작성

#### 모자 규칙 (중요 — 절대 항상 넣지 말 것)
- 스타일에 **어울릴 때만** 모자를 넣어라. 안 어울리면 hat 슬롯을 **아예 생략**(키 자체를 빼라).
- 포함 권장: **스트릿 · 스포티 · 고프코어 · 캐주얼/Y2K(어울리면)** → 볼캡/비니/버킷햇/스냅백
- 제외 권장: **미니멀 · 올드머니 · 러블리 · 단정한 데이트/오피스 룩** → 모자 생략 (캐주얼 캡이 무드를 깸)
- 굳이 단정한 스타일에 넣어야 하면 그 무드에 맞는 모자만: 올드머니→베레모/페도라/파나마햇, 러블리→리본 베레모/밀짚햇

## 검색어 작성 규칙 (매우 중요 — 트렌디한 상품을 띄우는 핵심)
- 형식: **[성별] + [핏/무드 수식어] + [구체 아이템명]** (3단어)
- 성별 토큰 필수: "${profile.gender === '남성' ? '남성' : '여성'}"
- ❌ "[성별]+[카테고리]" 2단어(예: "남성 셔츠", "여성 바지")는 **금지** — 너무 광범위해서 촌스럽고 오래된 상품만 뜬다. (옷이 별로인 정확한 원인)
- ✅ **핏/실루엣 수식어**를 꼭 붙여라. 핏 단어가 트렌드의 절반이다.
  - 핏/무드 수식어: 와이드, 세미와이드, 오버핏, 세미오버, 벌룬핏, 하이웨스트, 크롭, 일자, 원턱
  - 구체 아이템: 슬랙스, 치노팬츠, 와이드데님, 케이블니트, 오버핏후드티, 발마칸코트, 트랙자켓, 카고팬츠, 페니로퍼, 청키스니커즈, 트레킹화 등
- 스타일별 추천 어휘(참고):
  · 미니멀 → 케이블니트 · 반폴라니트 · 와이드슬랙스 · 일자데님 · 로퍼 · 발마칸코트
  · 캐주얼 → 오버핏맨투맨 · 옥스퍼드셔츠 · 와이드데님 · 데님자켓 · 스니커즈
  · 스트릿 → 오버핏후드티 · 그래픽맨투맨 · 와이드카고 · 청키스니커즈 · 볼캡
  · 올드머니 → 폴로니트 · 트위드자켓 · 치노팬츠 · 페니로퍼 · 트렌치코트
  · 러블리 → 레이스블라우스 · 셔링니트 · 플리츠스커트 · 발레플랫
  · 고프코어 → 후리스 · 아노락 · 카고팬츠 · 트레킹화 · 바람막이
  · 스포티 → 트랙자켓 · 트랙팬츠 · 바이커쇼츠 · 러닝화 · 볼캡
  · Y2K → 크롭티 · 로우라이즈카고 · 하이웨스트와이드데님 · 어글리슈즈
- 좋은 예: "여성 와이드 슬랙스" / "남성 오버핏 후드티" / "여성 케이블 니트" / "남성 발마칸 코트"
- 나쁜 예: "남성 셔츠" / "여성 바지" (2단어 = 촌스러움)
- ⚠️ 단, 네이버에서 결과가 나오는 **대중적 키워드**만 사용 (희귀한 조합 금지). 위 어휘는 검증된 대중어다.
- **색상은 검색어에 절대 포함 X** — color/color_hex 필드로만 전달
- 브랜드명 절대 X
- 색상 다양성은 outfit별 color 필드로 표현

## 시각적 스타일 가이드 (style_guide)
사용자가 한눈에 "어떤 느낌인지" 알 수 있도록 짧은 칩으로 변환:
- fit_chips: 핏 키워드 2-3개
- tone_chips: 컬러 톤 키워드 2-3개
- vibe_chips: 분위기 키워드 2-3개
- avoid_chips: 피해야 할 요소 2-3개

## 출력 (JSON only, 마크다운/설명 절대 금지)

{
  "mood_label": "코디 전체를 묶는 한 줄 컨셉",
  "style_guide": {
    "fit_chips": ["...", "..."],
    "tone_chips": ["...", "..."],
    "vibe_chips": ["...", "..."],
    "avoid_chips": ["...", "..."]
  },
  "outfits": [
    {
      "title": "코디 이름",
      "concept": "한 문장 컨셉",
      "tone_hex": "#XXXXXX",
      "items": {
        "hat":    { "search_keyword": "남성 무지 볼캡 블랙", "color": "블랙", "color_hex": "#1A1A1A", "reason": "왜 이걸 골랐는지 한 줄" },
        "top":    { ... 동일 ... },
        "bottom": { ... },
        "shoes":  { ... }
      }
    }
  ]
}`;

  // ─── 1단계 — Vercel /api/ai 엔드포인트로 Groq Llama 호출 (같은 도메인 상대경로) ───
  const aiResponse = await fetch(`/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    throw new Error(`AI 호출 오류 (${aiResponse.status}): ${errText.slice(0, 200)}`);
  }

  const aiData = await aiResponse.json();
  const text = aiData.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  const result = JSON.parse(cleaned.slice(start, end + 1));

  // 가드 — 0개면 에러. 1~2개면 가짜 복제하지 말고 있는 만큼만 정직하게 보여준다(A4).
  if (!Array.isArray(result.outfits) || result.outfits.length === 0) {
    throw new Error('AI가 코디를 생성하지 못했습니다. 다시 시도해 주세요.');
  }
  result.outfits = result.outfits.slice(0, 3);

  // ─── 2단계 — Worker /batch-search로 12개 검색어 동시 질의 ───
  // LLM이 일부 슬롯의 search_keyword를 누락해도 default 카테고리어로 자동 채워 항상 검색.
  // 상의·하의·신발은 필수. 모자는 AI가 스타일에 맞다고 판단해 넣었을 때만(=search_keyword 있을 때만) 검색.
  const DEFAULT_SLOT_CAT = { top: '셔츠', bottom: '바지', shoes: '신발' };
  const queries = [];
  result.outfits.forEach((outfit, oi) => {
    if (!outfit.items) outfit.items = {};
    // 모자: ① 없거나 검색어 없으면 제거(강제 안 함). ② 단정한 스타일에 캐주얼 캡이 끼면 제거(LLM 실수 방지).
    const hatKw = outfit.items.hat?.search_keyword || '';
    const dressyStyle = /올드머니|미니멀|클래식|러블리|단정|오피스|로맨틱|프레피|세미정장/.test(styleQuery);
    const casualHat = /볼캡|비니|스냅백|버킷|벙거지|캡/.test(hatKw);
    if (!hatKw || (dressyStyle && casualHat)) {
      delete outfit.items.hat;
    }
    const slots = ['top', 'bottom', 'shoes'];
    if (outfit.items.hat) slots.unshift('hat');
    slots.forEach((slot) => {
      let item = outfit.items[slot];
      if (!item) {
        item = outfit.items[slot] = {};
      }
      if (!item.search_keyword) {
        item.search_keyword = `${profile.gender || '남성'} ${DEFAULT_SLOT_CAT[slot]}`;
      }
      queries.push({
        slot: `${oi}-${slot}`,
        keyword: item.search_keyword,
        display: 10,
      });
    });
  });

  const searchResponse = await fetch(`/api/batch-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries, gender: profile.gender }),
  });

  if (!searchResponse.ok) {
    const errBody = await searchResponse.json().catch(() => ({}));
    const detail = errBody.message || errBody.error || JSON.stringify(errBody).slice(0, 200);
    throw new Error(`상품 검색 ${searchResponse.status}: ${detail}`);
  }

  const searchData = await searchResponse.json();
  const slotMap = {};
  (searchData.results || []).forEach((r) => {
    slotMap[r.slot] = r.items || [];
  });

  // ─── 2.5단계 — LLM 큐레이션: 후보 데이터 보고 outfit별 픽 ───
  // LLM이 실제 상품 이름·몰을 보고 mood/색 매칭 가장 좋은 인덱스 선택.
  // 실패 시 그냥 pool[0] 폴백.
  let llmPicks = null;
  try {
    const curationOutfits = result.outfits.map((o, oi) => ({
      i: oi,
      title: o.title || '',
      items: ['hat', 'top', 'bottom', 'shoes'].map((slot) => {
        const cand = (slotMap[`${oi}-${slot}`] || [])
          .filter((c) => c.image_url && /^https?:\/\//.test(c.image_url))
          .slice(0, 6);
        return {
          slot,
          color: o.items?.[slot]?.color || '',
          candidates: cand.map((c, ci) => ({ idx: ci, name: (c.name || '').slice(0, 60), mall: c.mall || '' })),
        };
      }),
    }));

    const curatePrompt = `다음은 룩북 후보 데이터다. 사용자 mood와 의도 색에 가장 잘 맞는 후보를 outfit별로 픽하라.

mood: ${result.mood_label || ''}

${curationOutfits.map((o) => `[outfit ${o.i}] ${o.title}
${o.items.map((it) => `  ${it.slot} (의도색: ${it.color || '자유'}):
${it.candidates.map((c) => `    [${c.idx}] ${c.name} (${c.mall})`).join('\n') || '    (후보 없음)'}`).join('\n')}`).join('\n\n')}

각 outfit·슬롯에 가장 mood/색 매칭 좋은 candidate idx를 픽. 후보 없으면 0.
JSON만:
{"picks":[{"hat":N,"top":N,"bottom":N,"shoes":N},{"hat":N,"top":N,"bottom":N,"shoes":N},{"hat":N,"top":N,"bottom":N,"shoes":N}]}`;

    const curateResp = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: 600,
        messages: [{ role: 'user', content: curatePrompt }],
      }),
    });
    if (curateResp.ok) {
      const curateData = await curateResp.json();
      const text = (curateData.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const s = cleaned.indexOf('{'); const e = cleaned.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(cleaned.slice(s, e + 1));
        if (Array.isArray(parsed.picks)) llmPicks = parsed.picks;
      }
    }
  } catch (e) {
    console.warn('[curation] LLM 픽 실패, pool[0] 폴백:', e.message);
  }

  // ─── 3단계 — 검색 결과 합성 (LLM 픽 우선, 폴백은 pool[0]) ───
  result.outfits.forEach((outfit, oi) => {
    let totalPrice = 0;
    ['hat', 'top', 'bottom', 'shoes'].forEach((slot) => {
      const item = outfit.items[slot];
      if (!item) return;
      // 1차: 본인 outfit 결과 (Naver sim 정렬 1순위가 곧 본인 키워드 베스트 매칭)
      let candidates = slotMap[`${oi}-${slot}`] || [];
      // 2차: 본인 풀의 image 있는 후보가 3개 미만이면 다른 outfit에서 보충 — 색 매칭 우선
      const ownValid = candidates.filter((c) => c.image_url && /^https?:\/\//.test(c.image_url));
      if (ownValid.length < 3) {
        const merged = [...candidates]; // 본인 결과 우선 보존, 다른 outfit으로 보충
        result.outfits.forEach((_, other) => {
          if (other !== oi) merged.push(...(slotMap[`${other}-${slot}`] || []));
        });
        const seen = new Set();
        const uniqueMerged = merged.filter((c) => {
          if (!c.product_url || seen.has(c.product_url)) return false;
          seen.add(c.product_url);
          return true;
        });
        const intendedColor = item.color || '';
        uniqueMerged.sort((a, b) => colorMatchScore(a.name, intendedColor) - colorMatchScore(b.name, intendedColor));
        candidates = uniqueMerged;
      }
      // 이미지 있는 후보만 사용. 빈 이미지 폴백 금지 — 회색 박스 렌더 차단.
      const pool = candidates.filter((c) => c.image_url && /^https?:\/\//.test(c.image_url));
      // LLM 큐레이션 픽이 있고 인덱스가 유효하면 그것 사용, 아니면 pool[0]
      const pickIdx = llmPicks?.[oi]?.[slot];
      const picked = (typeof pickIdx === 'number' && pool[pickIdx]) ? pool[pickIdx] : pool[0];
      // 이미지 로드 실패 시 cascade할 backup URLs (다음 후보 4개까지)
      const altImages = pool
        .slice(1, 5)
        .map((c) => c.image_url)
        .filter((u) => u && /^https?:\/\//.test(u));
      if (picked) {
        item.name = picked.name;
        item.image_url = picked.image_url;
        item._alt_images = altImages;
        item.product_url = picked.product_url;
        item.price = picked.price;
        item.price_num = picked.price_num;
        item.mall = picked.mall;
        item.brand = picked.brand;
        item.category = picked.category;
        item.is_direct_product = true;
        totalPrice += picked.price_num || 0;
      } else {
        // 사용자 요청: 네이버 검색 페이지로 보내는 fallback 금지. 슬롯 자체를 비움.
        // 프론트 렌더링은 outfit.items[slot] 부재를 조건부로 건너뜀.
        delete outfit.items[slot];
      }
    });
    outfit.total_price = totalPrice > 0 ? `${totalPrice.toLocaleString()}원` : '';
  });

  // ─── 4단계 — outfit별 모델 일러스트 생성 (gpt-image-1) ───
  // [비활성화 2026-06] 이미지 생성 비용(장당 ~$0.04) 절감 → 누끼 상품 표시에 집중.
  // 다시 켜려면 ENABLE_MODEL_IMAGE = true.
  const ENABLE_MODEL_IMAGE = false;
  if (ENABLE_MODEL_IMAGE) try {
    await Promise.all(result.outfits.map(async (outfit) => {
      const itemsDesc = ['hat', 'top', 'bottom', 'shoes']
        .map((slot) => outfit.items?.[slot]?.name ? `${slot}: ${outfit.items[slot].name.slice(0, 50)}` : null)
        .filter(Boolean)
        .join(', ');
      const genderKo = profile.gender === '여성' ? '여성' : '남성';
      const prompt = `한국 20대 ${genderKo} 패션 코디 일러스트, 인물 한 명. 머리 끝부터 신발 끝까지 전신이 프레임 안에 전부 보이게(머리와 발이 절대 잘리지 않게, 위아래 여백 충분히 확보). 배경 없이 인물만 단독으로(투명 배경). 깔끔한 플랫 일러스트 스타일, 정면 전신 풀샷, 자연스럽게 서 있는 포즈. 착용 아이템: ${itemsDesc}. 무드: ${outfit.title || ''} · ${outfit.concept || ''}. 키 ${profile.height || 175}cm, 체형 ${profile.bodyType || '보통'}. 얼굴은 단순하게 처리.`;
      try {
        const imgResp = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, size: '1024x1536', quality: 'medium', background: 'transparent' }),
        });
        if (imgResp.ok) {
          const imgData = await imgResp.json();
          if (imgData.data_url) outfit.model_image = imgData.data_url;
        }
      } catch (e) {
        console.warn('[image] outfit 일러스트 생성 실패:', e.message);
      }
    }));
  } catch (e) {
    console.warn('[image] Promise.all 에러:', e.message);
  }

  return result;
};

// ─────────────────────────────────────────────────────────────
// UI 컴포넌트 (v6와 동일)
// ─────────────────────────────────────────────────────────────

function Field({ label, sub, children }) {
  return (
    <div className="border-b pb-6" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between mb-3">
        <label className="font-body text-xs tracking-[0.15em] uppercase" style={{ color: 'var(--muted)' }}>{label}</label>
        {sub && <span className="font-body text-[10px]" style={{ color: 'var(--muted)' }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipGroup({ value, options, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className="btn-press font-body text-sm px-4 py-2"
          style={{
            background: value === o ? 'var(--ink)' : 'transparent',
            color: value === o ? 'var(--cream)' : 'var(--ink)',
            border: `1px solid ${value === o ? 'var(--ink)' : 'var(--line)'}`,
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Header({ step }) {
  const order = ['intro', 'profile', 'chat'];
  return (
    <header className="w-full border-b" style={{ borderColor: 'var(--line)' }}>
      <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <div className="font-display text-2xl tracking-tight" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Clothes</span>
            <span style={{ fontWeight: 600 }}>Ai</span>
          </div>
          <div className="font-body text-[10px] tracking-[0.25em] uppercase" style={{ color: 'var(--muted)' }}>Lookbook No. 001</div>
        </div>
        <div className="flex items-center gap-2">
          {order.map((s, i) => (
            <div key={s} className="h-[2px] transition-all duration-500"
              style={{ width: step === s ? 32 : 12, background: order.indexOf(step) >= i ? 'var(--ink)' : 'var(--line)' }} />
          ))}
        </div>
      </div>
    </header>
  );
}

function Intro({ onStart }) {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 grain">
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-1 fade-up">
          <div className="font-body text-[10px] tracking-[0.3em] uppercase" style={{ color: 'var(--muted)', writingMode: 'vertical-rl' }}>AI Fashion · 2026</div>
        </div>
        <div className="col-span-12 md:col-span-11">
          <div className="fade-up" style={{ animationDelay: '0.1s' }}>
            <div className="font-body text-xs tracking-[0.2em] uppercase mb-8" style={{ color: 'var(--accent)' }}>─── 룩북 시즌 1</div>
          </div>
          <h1 className="font-display fade-up" style={{ fontSize: 'clamp(48px, 9vw, 124px)', lineHeight: 0.92, letterSpacing: '-0.04em', color: 'var(--ink)', animationDelay: '0.2s', fontWeight: 400 }}>
            느낌만 말해도,<br />
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>입을 옷이</span> 정해진다.
          </h1>
          <div className="grid grid-cols-12 gap-6 mt-16">
            <div className="col-span-12 md:col-span-5 fade-up" style={{ animationDelay: '0.4s' }}>
              <p className="font-serif-kr text-lg leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
                <span className="font-display italic" style={{ fontSize: '1.15em' }}>꾸안꾸</span>,{' '}
                <span className="font-display italic" style={{ fontSize: '1.15em' }}>소개팅룩</span>,{' '}
                <span className="font-display italic" style={{ fontSize: '1.15em' }}>힙하지만 과하지 않게</span>.
                <br /><br />
                추상적 스타일 표현을 AI가 해석해, 실제 네이버 쇼핑 상품으로 구성된 코디 룩북을 갤러리처럼 넘겨가며 볼 수 있습니다.
              </p>
            </div>
            <div className="col-span-12 md:col-span-6 md:col-start-7 fade-up" style={{ animationDelay: '0.55s' }}>
              <div className="border-t pt-6" style={{ borderColor: 'var(--ink)' }}>
                <div className="grid grid-cols-2 gap-y-6 gap-x-8">
                  {[
                    { num: '01', label: '자연어 입력', desc: '"깔끔하게"면 충분' },
                    { num: '02', label: '의미 해석', desc: '무드·색·핏으로 변환' },
                    { num: '03', label: '실제 상품 검색', desc: '네이버 쇼핑 OpenAPI' },
                    { num: '04', label: '갤러리 룩북', desc: '넘겨보며 비교' },
                  ].map((item) => (
                    <div key={item.num}>
                      <div className="font-display text-3xl mb-1" style={{ fontWeight: 300, fontStyle: 'italic' }}>{item.num}</div>
                      <div className="font-body text-sm font-medium mb-1">{item.label}</div>
                      <div className="font-body text-xs" style={{ color: 'var(--muted)' }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-20 fade-up" style={{ animationDelay: '0.75s' }}>
            <button onClick={onStart} className="btn-press group inline-flex items-center gap-4 px-8 py-5 font-body text-sm tracking-[0.2em] uppercase" style={{ background: 'var(--ink)', color: 'var(--cream)' }}>
              <span>룩북 만들기</span><ArrowRight size={16} />
            </button>
            <span className="ml-6 font-body text-xs" style={{ color: 'var(--muted)' }}>AI 해석 + 실시간 카탈로그 조회 · 약 5~10초 소요</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfileForm({ profile, setProfile, onNext, onBack }) {
  const update = (k, v) => setProfile({ ...profile, [k]: v });
  const isValid = profile.gender && profile.age && profile.height && profile.bodyType && profile.budget;
  return (
    <section className="max-w-4xl mx-auto px-6 pt-12 pb-24 fade-in">
      <div className="mb-10">
        <div className="font-body text-[10px] tracking-[0.3em] uppercase mb-3" style={{ color: 'var(--accent)' }}>STEP 01 / 02</div>
        <h2 className="font-display text-5xl md:text-6xl" style={{ fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1 }}>당신을 알려주세요.</h2>
        <p className="font-serif-kr mt-4 text-base" style={{ color: 'var(--muted)' }}>맞춤 코디를 위한 최소한의 정보입니다.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
        <Field label="성별"><ChipGroup value={profile.gender} options={['남성', '여성']} onChange={(v) => update('gender', v)} /></Field>
        <Field label="나이" sub="만 나이">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={profile.age}
            onChange={(e) => update('age', e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            placeholder="22" className="w-full font-display text-4xl bg-transparent border-b-2 pb-2"
            style={{ borderColor: 'var(--ink)', color: 'var(--ink)' }} />
        </Field>
        <Field label="키" sub="cm">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={profile.height}
            onChange={(e) => update('height', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            placeholder="173" className="w-full font-display text-4xl bg-transparent border-b-2 pb-2"
            style={{ borderColor: 'var(--ink)', color: 'var(--ink)' }} />
        </Field>
        <Field label="체형"><ChipGroup value={profile.bodyType} options={['마른편', '보통', '근육질', '통통']} onChange={(v) => update('bodyType', v)} /></Field>
        <Field label="예산" sub="만원">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={profile.budget}
            onChange={(e) => update('budget', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="20" className="w-full font-display text-4xl bg-transparent border-b-2 pb-2"
            style={{ borderColor: 'var(--ink)', color: 'var(--ink)' }} />
        </Field>
        <Field label="싫어하는 스타일" sub="선택">
          <input type="text" value={profile.dislikes} onChange={(e) => update('dislikes', e.target.value)}
            placeholder="과한 로고, 너무 타이트한 옷..." className="w-full font-body text-base bg-transparent border-b pb-2"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
        </Field>
      </div>
      <div className="flex items-center justify-between mt-16 pt-8 border-t" style={{ borderColor: 'var(--line)' }}>
        <button onClick={onBack} className="btn-press font-body text-sm tracking-[0.15em] uppercase flex items-center gap-2" style={{ color: 'var(--muted)' }}><ArrowLeft size={14} /> 뒤로</button>
        <button onClick={onNext} disabled={!isValid}
          className="btn-press inline-flex items-center gap-3 px-8 py-4 font-body text-sm tracking-[0.2em] uppercase"
          style={{ background: 'var(--ink)', color: 'var(--cream)', opacity: isValid ? 1 : 0.3, cursor: isValid ? 'pointer' : 'not-allowed' }}>
          다음 <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

const INITIAL_PROFILE = { gender: '', age: '', height: '', bodyType: '', budget: '', dislikes: '' };
const INITIAL_MESSAGES = [
  { role: 'ai', type: 'text', content: '안녕하세요, 클로예요.\n취향에 맞는 코디를 골라드릴게요.\n먼저, 누구 옷을 찾으세요?' },
  { role: 'ai', type: 'quickReplies', content: ['남성', '여성'] },
];

function StyleChipRow({ label, items, value, onPick, disabled }) {
  return (
    <div>
      <div className="font-body text-[10px] tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => {
          const active = value === c;
          return (
            <button key={c} type="button" disabled={disabled}
              onClick={() => onPick(active ? '' : c)}
              className="btn-press font-body text-xs"
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
                background: active ? 'var(--ink)' : '#FFFFFF',
                color: active ? '#FFFFFF' : 'var(--ink)',
              }}>
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StylePicker({ onSubmit, disabled }) {
  const [tpo, setTpo] = useState('');
  const [mood, setMood] = useState('');
  const [text, setText] = useState('');

  const canSubmit = !disabled && (tpo || mood || text.trim().length > 1);

  const submit = () => {
    if (!canSubmit) return;
    const parts = [];
    if (tpo) parts.push(tpo);
    if (mood) parts.push(`${mood} 무드`);
    if (text.trim()) parts.push(text.trim());
    onSubmit(parts.join(' · '));
  };

  return (
    <div className="fade-in" style={{
      padding: 16,
      background: '#F4F6FA',
      borderRadius: 18,
      borderTopLeftRadius: 4,
      maxWidth: '90%',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <StyleChipRow label="상황 (선택)" items={TPO_CHIPS} value={tpo} onPick={setTpo} disabled={disabled} />
      <StyleChipRow label="무드 (선택)" items={MOOD_CHIPS} value={mood} onPick={setMood} disabled={disabled} />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          submit();
        }}
        placeholder="더 자세히 (예: 따뜻한 톤, 깔끔하게)"
        disabled={disabled}
        className="font-body"
        style={{
          padding: '10px 14px',
          borderRadius: 12,
          border: '1px solid var(--line)',
          background: '#FFFFFF',
          color: 'var(--ink)',
          fontSize: 14,
        }}
      />
      <button type="button" onClick={submit} disabled={!canSubmit}
        className="btn-press font-body text-xs tracking-[0.2em] uppercase"
        style={{
          padding: '12px 16px',
          background: 'var(--ink)',
          color: '#FFFFFF',
          borderRadius: 12,
          opacity: canSubmit ? 1 : 0.3,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}>
        코디 보기
      </button>
    </div>
  );
}

// 스타일 발견 — 라벨 없는 무드컷에서 끌리는 걸 탭하면, 그와 비슷한 룩이 아래로 더 떠오름(스포티파이식).
// 고른 룩들의 공통 속성을 추출해 추천 쿼리로 변환.
function StyleDiscovery({ gender, onSubmit, disabled }) {
  const [visible, setVisible] = useState(SEED_IDS);
  const [picked, setPicked] = useState([]);

  const toggle = (id) => {
    if (disabled) return;
    if (picked.includes(id)) { setPicked(picked.filter((x) => x !== id)); return; }
    const next = [...picked, id];
    setPicked(next);
    // 고른 것과 비슷한 안 보여준 룩 3개를 아래에 추가
    const more = similarUnseen(next, visible, 3);
    if (more.length) setVisible([...visible, ...more]);
  };

  const canSubmit = !disabled && picked.length >= 3;
  const hint = commonalityQuery(picked); // 실시간 공통점 미리보기

  return (
    <div className="fade-in" style={{ width: '100%' }}>
      {/* 헤더 */}
      <div className="text-center" style={{ marginBottom: 16 }}>
        <div className="font-body" style={{ fontSize: 10, letterSpacing: '0.38em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8 }}>
          Discover
        </div>
        <div className="font-display italic" style={{ fontSize: 23, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.15 }}>
          마음에 드는 스타일을 고르세요
        </div>
        <div className="font-body" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 7 }}>
          {picked.length >= 1
            ? <>고를수록 비슷한 게 더 떠요 — <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{hint || `${picked.length}개`}</span></>
            : <>끌리는 사진을 탭하세요 · 3개 이상</>}
        </div>
      </div>

      {/* 그리드 — 타이트한 룩북 컨택트시트 */}
      <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 8 }}>
        {visible.map((id) => {
          const order = picked.indexOf(id);
          const active = order !== -1;
          return (
            <button key={id} type="button" disabled={disabled} onClick={() => toggle(id)}
              className="btn-press fade-in"
              style={{
                position: 'relative', borderRadius: 12, overflow: 'hidden', padding: 0,
                aspectRatio: '3 / 4', background: '#E8E6E1', cursor: disabled ? 'default' : 'pointer',
                outline: active ? '2.5px solid var(--ink)' : '0 solid transparent', outlineOffset: -2,
                transform: active ? 'scale(0.985)' : 'none', transition: 'transform 0.2s ease',
              }}>
              <img src={styleImgPath(gender, id)} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.opacity = '0'; }}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                  filter: active ? 'none' : 'brightness(0.98)',
                  transform: active ? 'scale(1.03)' : 'none',
                  transition: 'filter 0.25s ease, transform 0.45s ease',
                }} />
              {!active && <div style={{ position: 'absolute', inset: 0, background: 'rgba(250,249,246,0.10)' }} />}
              {active && (
                <div style={{
                  position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12,
                  background: 'var(--ink)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, fontFamily: 'monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}>
                  {order + 1}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* CTA */}
      <button type="button" onClick={() => canSubmit && onSubmit(picked)} disabled={!canSubmit}
        className="btn-press font-body"
        style={{
          marginTop: 16, width: '100%', padding: '15px 16px', borderRadius: 12,
          background: 'var(--ink)', color: '#fff', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase',
          opacity: canSubmit ? 1 : 0.28, cursor: canSubmit ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        {canSubmit ? '이 취향으로 코디 받기' : `${picked.length}/3 — 더 골라주세요`}
        {canSubmit && <ArrowRight size={14} />}
      </button>
    </div>
  );
}

const LOADING_PHASES = [
  '스타일 표현 분석 중',
  '톤과 색감 잡는 중',
  '실제 상품 찾는 중',
  '룩북 엮는 중',
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function ChatView() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  // 0: 성별 → 1: 스타일 발견(StyleDiscovery) → 2+: 자유 대화 (룩북 이후 변형 요청)
  const [stage, setStage] = useState(0);
  const [styleQuery, setStyleQuery] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  // 코디 단위 재생성 추적: { msgIdx, outfitIdx } 또는 null
  const [regenInfo, setRegenInfo] = useState(null);
  // /api/trends 결과 — 못 가져오면 null로 두고 manual 트렌드만 사용
  const [trends, setTrends] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // 마운트 시 한 번만 트렌드 시그널 가져오기. 실패해도 무시 — manual block이 백업.
  useEffect(() => {
    let alive = true;
    fetch('/api/trends')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive && data) setTrends(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loading) { setLoadingPhase(0); return; }
    const t = setInterval(() => {
      setLoadingPhase((p) => Math.min(p + 1, LOADING_PHASES.length - 1));
    }, 1800);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    // 사용자가 끝 근처에 있을 때만 자동 스크롤 (카톡 패턴) — 위로 올려서 옛 룩북 보고 있으면 방해 안 함
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  // 자유 입력이 필요한 단계(룩북 이후 자유 대화)에선 자동으로 포커스
  useEffect(() => {
    if (loading) return;
    if (stage >= 2 && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [stage, loading]);

  const appendAi = (...items) => setMessages((prev) => [...prev, ...items.map((it) => ({ role: 'ai', ...it }))]);
  const appendUser = (text) => setMessages((prev) => [
    ...prev.filter((m) => m.type !== 'quickReplies' && m.type !== 'stylePicker' && m.type !== 'styleQuiz'),
    { role: 'user', type: 'text', content: text },
  ]);

  const generateLookbook = async (text, nextProfile) => {
    setLoading(true);
    try {
      const data = await callAI(nextProfile, text, trends);
      await delay(300);
      appendAi(
        { type: 'text', content: `'${data.mood_label}' 무드로 골라봤어요. 마음에 드는 한 벌이 있길!` },
        { type: 'lookbook', content: data },
        { type: 'text', content: '카드 위 "이 코디만 다시"로 코디 단위로 새로 받아볼 수 있어요. 상품 카드를 누르면 네이버 구매 페이지로 갑니다.' },
      );
    } catch (e) {
      console.error(e);
      appendAi({ type: 'error', content: `이번엔 잘 안 됐어요. 잠시 후 다시 시도해 주세요. (${e.message})` });
    } finally {
      setLoading(false);
    }
  };

  // 코디 한 벌만 다시 — 전체 룩북은 유지하고 해당 인덱스의 코디만 교체
  const regenerateOutfit = async (msgIdx, outfitIdx) => {
    if (regenInfo || loading) return;
    if (!profile.gender || !styleQuery) return;
    setRegenInfo({ msgIdx, outfitIdx });
    try {
      const data = await callAI(profile, styleQuery, trends);
      // 새 응답에서 같은 슬롯(outfitIdx) 우선, 없으면 첫 번째 코디로 교체
      const fresh = data.outfits[outfitIdx] || data.outfits[0];
      setMessages((prev) => prev.map((m, i) => {
        if (i !== msgIdx || m.type !== 'lookbook') return m;
        const updated = JSON.parse(JSON.stringify(m.content));
        updated.outfits[outfitIdx] = fresh;
        return { ...m, content: updated };
      }));
    } catch (e) {
      console.error(e);
      appendAi({ type: 'error', content: `코디를 다시 만드는 데 실패했어요. (${e.message})` });
    } finally {
      setRegenInfo(null);
    }
  };

  // 성별 선택 → 기본 프로필 채우고 스타일 퀴즈로 진입
  const advanceToQuiz = async (gender) => {
    const next = buildDefaultProfile(gender);
    setProfile(next);
    setStage(1);
    await delay(350);
    appendAi(
      { type: 'text', content: '좋아요! 끌리는 스타일 무드를 골라주세요.' },
      { type: 'styleQuiz' },
    );
  };

  // 스타일 발견 제출 — 고른 룩들의 공통 속성을 추출해 styleQuery로 변환 → 룩북 생성
  const handleStyleQuizSubmit = async (pickedIds) => {
    if (loading || stage !== 1) return;
    const query = commonalityQuery(pickedIds);
    if (!query) return;
    appendUser(query);
    setStyleQuery(query);
    setStage(2);
    await generateLookbook(query, profile);
  };

  const handleAnswer = async (text) => {
    const userText = text.trim();
    if (!userText || loading) return;
    setInput('');

    // stage 0: 성별 선택
    if (stage === 0) {
      appendUser(userText);
      if (!['남성', '여성'].includes(userText)) {
        await delay(300);
        appendAi(
          { type: 'text', content: '아래 버튼으로 선택해주세요.' },
          { type: 'quickReplies', content: ['남성', '여성'] },
        );
        return;
      }
      await advanceToQuiz(userText);
      return;
    }

    appendUser(userText);

    // stage 1: 퀴즈 대신 하단 입력창에 직접 스타일을 적은 경우 (자유 입력 fallback)
    if (stage === 1) {
      setStyleQuery(userText);
      setStage(2);
      await generateLookbook(userText, profile);
      return;
    }

    // stage 2+: 자유 대화 — 입력한 표현으로 새 룩북 생성
    setStyleQuery(userText);
    await generateLookbook(userText, profile);
  };

  const handleKey = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 한글 IME 조합 중 Enter 무시
    e.preventDefault();
    handleAnswer(input);
  };

  const restart = () => {
    setMessages(INITIAL_MESSAGES);
    setProfile(INITIAL_PROFILE);
    setStage(0);
    setStyleQuery('');
    setInput('');
    setLoading(false);
    setRegenInfo(null);
  };

  const placeholder = (() => {
    if (loading) return 'Clo가 답하는 중…';
    if (stage === 0) return '남성 / 여성 중 선택해주세요';
    if (stage === 1) return '위에서 무드를 골라주세요 (또는 자유롭게 적기)';
    return '바꾸고 싶은 표현을 적어주세요 (예: 더 캐주얼하게)';
  })();

  return (
    <section className="max-w-2xl md:max-w-5xl mx-auto fade-in flex flex-col" style={{ height: '100dvh', overflow: 'hidden' }}>
      <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--ink)' }}>
          <Sparkles size={15} style={{ color: '#FFFFFF' }} />
        </div>
        <div className="leading-tight flex-1">
          <div className="font-display italic text-base" style={{ color: 'var(--ink)', fontWeight: 500 }}>Clo</div>
          <div className="font-body text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--muted)' }}>
            ClothesAi · Assistant · <span style={{ fontFamily: 'monospace', letterSpacing: 0 }}>v.{__APP_VERSION__}</span>
          </div>
        </div>
        <button onClick={restart} disabled={loading} className="btn-press font-body text-[10px] tracking-[0.15em] uppercase px-3 py-1.5" style={{ color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 999 }}>
          <RefreshCw size={11} className="inline mr-1" /> 처음으로
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 px-4 py-6 space-y-4 overflow-y-auto" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
        {messages.map((msg, i) => {
          if (msg.type === 'text') {
            return (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} fade-in`}>
                <div
                  className="font-body text-sm leading-relaxed whitespace-pre-line"
                  style={{
                    padding: '12px 16px',
                    maxWidth: '78%',
                    background: msg.role === 'user' ? 'var(--ink)' : '#F4F6FA',
                    color: msg.role === 'user' ? '#FFFFFF' : 'var(--ink)',
                    borderRadius: 18,
                    borderTopRightRadius: msg.role === 'user' ? 4 : 18,
                    borderTopLeftRadius: msg.role === 'ai' ? 4 : 18,
                    boxShadow: '0 1px 2px rgba(15,31,74,0.04)',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }
          if (msg.type === 'quickReplies') {
            return (
              <div key={i} className="pt-1 space-y-2 fade-in">
                <div className="flex flex-wrap gap-2">
                  {msg.content.map((p, idx) => (
                    <button key={idx} type="button" onClick={() => handleAnswer(p)}
                      className="btn-press font-body text-xs"
                      style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--line)', background: '#FFFFFF', color: 'var(--ink)' }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (msg.type === 'styleQuiz') {
            // 한 번만 활성 — 이미 선택했으면(stage > 1) 비활성화. 채팅 버블이 아니라 전체 폭 사용.
            return (
              <div key={i} className="fade-in" style={{ padding: '4px 0' }}>
                <StyleDiscovery gender={profile.gender} onSubmit={handleStyleQuizSubmit} disabled={stage !== 1 || loading} />
              </div>
            );
          }
          if (msg.type === 'lookbook') {
            return (
              <div key={i} data-lookbook="true" className="fade-in" style={{ padding: '4px 0' }}>
                <LookbookGallery
                  outfits={msg.content.outfits}
                  onRegenerate={(outfitIdx) => regenerateOutfit(i, outfitIdx)}
                  regeneratingIndex={regenInfo?.msgIdx === i ? regenInfo.outfitIdx : null}
                />
              </div>
            );
          }
          if (msg.type === 'error') {
            return (
              <div key={i} className="flex justify-start fade-in">
                <div style={{ padding: 12, borderRadius: 18, borderTopLeftRadius: 4, background: '#FEF2F2', border: '1px solid #FECACA', maxWidth: '78%' }}>
                  <div className="font-body text-xs" style={{ color: '#991B1B' }}>{msg.content}</div>
                </div>
              </div>
            );
          }
          return null;
        })}

        {loading && (
          <div className="flex justify-start fade-in">
            <div className="flex items-center gap-2.5" style={{ padding: '12px 16px', borderRadius: 18, borderTopLeftRadius: 4, background: '#F4F6FA' }}>
              <div className="flex gap-1 items-end" style={{ height: 8 }}>
                <span className="dot-typing"></span>
                <span className="dot-typing" style={{ animationDelay: '0.15s' }}></span>
                <span className="dot-typing" style={{ animationDelay: '0.3s' }}></span>
              </div>
              <span className="font-body text-xs" style={{ color: 'var(--muted)' }}>{LOADING_PHASES[loadingPhase]}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0" style={{ background: '#FFFFFF', borderTop: '1px solid var(--line)' }}>
        <div className="px-4 py-3 flex items-end gap-2" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            rows={1}
            disabled={loading}
            className="flex-1 font-body"
            style={{
              padding: '12px 16px',
              border: '1px solid var(--line)',
              borderRadius: 22,
              resize: 'none',
              outline: 'none',
              color: 'var(--ink)',
              background: '#FFFFFF',
              maxHeight: 100,
              lineHeight: 1.4,
              fontSize: 16,
            }}
          />
          <button
            onClick={() => handleAnswer(input)}
            disabled={!input.trim() || loading}
            className="btn-press flex items-center justify-center"
            style={{
              width: 44, height: 44, borderRadius: 22,
              background: 'var(--ink)', color: '#FFFFFF',
              opacity: !input.trim() || loading ? 0.25 : 1,
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
            aria-label="보내기"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function _LegacyStyleInputUnused({ styleQuery, setStyleQuery, onSubmit, onBack, loading, error }) {
  const isValid = styleQuery.trim().length > 5;
  const messages = [
    { role: 'ai', content: '안녕하세요, 클로예요.\n오늘 어떤 분위기로 가고 싶으세요?' },
  ];
  if (styleQuery.trim()) {
    messages.push({ role: 'user', content: styleQuery });
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && isValid && !loading) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <section className="max-w-xl mx-auto fade-in flex flex-col" style={{ minHeight: '100vh' }}>
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3" style={{ background: '#FFFFFF', borderBottom: '1px solid var(--line)' }}>
        <button onClick={onBack} disabled={loading} className="btn-press p-1.5" style={{ color: 'var(--muted)' }} aria-label="뒤로">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--ink)' }}>
            <Sparkles size={15} style={{ color: '#FFFFFF' }} />
          </div>
          <div className="leading-tight">
            <div className="font-display italic text-base" style={{ color: 'var(--ink)', fontWeight: 500 }}>Clo</div>
            <div className="font-body text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--muted)' }}>ClothesAi · Assistant</div>
          </div>
        </div>
      </header>

      {/* 메시지 영역 */}
      <div className="flex-1 px-4 py-6 space-y-4 pb-32">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} fade-in`}>
            <div
              className="font-body text-sm leading-relaxed whitespace-pre-line"
              style={{
                padding: '12px 16px',
                maxWidth: '78%',
                background: msg.role === 'user' ? 'var(--ink)' : '#F4F6FA',
                color: msg.role === 'user' ? '#FFFFFF' : 'var(--ink)',
                borderRadius: 18,
                borderTopRightRadius: msg.role === 'user' ? 4 : 18,
                borderTopLeftRadius: msg.role === 'ai' ? 4 : 18,
                boxShadow: '0 1px 2px rgba(15,31,74,0.04)',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* 빠른 답변 — AI 첫 메시지 직후, 아직 입력 전에만 노출 */}
        {!styleQuery.trim() && (
          <div className="pt-1 space-y-2 fade-in">
            <div className="font-body text-[10px] tracking-[0.2em] uppercase pl-1" style={{ color: 'var(--muted)' }}>이렇게 표현해 보세요</div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStyleQuery(p)}
                  className="btn-press font-body text-xs"
                  style={{
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: '1px solid var(--line)',
                    background: '#FFFFFF',
                    color: 'var(--ink)',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="fade-in" style={{ padding: 12, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <div className="font-body text-xs" style={{ color: '#991B1B' }}>{error}</div>
          </div>
        )}

        {loading && (
          <div className="flex justify-start fade-in">
            <div className="flex items-center gap-2" style={{ padding: '10px 14px', borderRadius: 18, borderTopLeftRadius: 4, background: '#F4F6FA' }}>
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ink)' }} />
              <span className="font-body text-xs" style={{ color: 'var(--muted)' }}>룩북 만드는 중…</span>
            </div>
          </div>
        )}
      </div>

      {/* 하단 고정 입력창 */}
      <div className="fixed bottom-0 left-0 right-0" style={{ background: '#FFFFFF', borderTop: '1px solid var(--line)' }}>
        <div className="max-w-xl mx-auto px-4 py-3 flex items-end gap-2">
          <textarea
            value={styleQuery}
            onChange={(e) => setStyleQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="원하는 스타일을 자유롭게 적어주세요"
            rows={1}
            disabled={loading}
            className="flex-1 font-body text-sm"
            style={{
              padding: '12px 16px',
              border: '1px solid var(--line)',
              borderRadius: 22,
              resize: 'none',
              outline: 'none',
              color: 'var(--ink)',
              background: '#FFFFFF',
              maxHeight: 100,
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={onSubmit}
            disabled={!isValid || loading}
            className="btn-press flex items-center justify-center"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: 'var(--ink)',
              color: '#FFFFFF',
              opacity: !isValid || loading ? 0.25 : 1,
              cursor: !isValid || loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
            aria-label="보내기"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          </button>
        </div>
        <div className="text-center pb-2">
          <span className="font-body text-[10px]" style={{ color: 'var(--muted)' }}>AI 해석 + 실시간 카탈로그 조회 · 약 5~10초</span>
        </div>
      </div>
    </section>
  );
}

function LoadingScreen() {
  const [step, setStep] = useState(0);
  const phases = [
    '추상 표현을 해석하고 있습니다',
    '무드와 색감을 정의하고 있습니다',
    '핏과 실루엣을 결정하고 있습니다',
    '슬롯별 검색어를 만드는 중',
    '네이버 쇼핑 카탈로그를 조회하는 중',
    '룩북 갤러리를 엮는 중',
  ];
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, phases.length - 1)), 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="max-w-4xl mx-auto px-6 py-32 fade-in min-h-[60vh] flex flex-col items-center justify-center">
      <div className="font-body text-[10px] tracking-[0.3em] uppercase mb-12" style={{ color: 'var(--accent)' }}>─── CURATING</div>
      <div className="font-display italic text-3xl md:text-5xl text-center mb-16 drift" style={{ fontWeight: 300 }}>
        실제 상품을<br />검색하고 엮는 중
      </div>
      <div className="space-y-3 w-full max-w-md">
        {phases.map((p, i) => (
          <div key={i} className="font-body text-sm flex items-center gap-3 transition-all duration-500" style={{ opacity: i <= step ? 1 : 0.25 }}>
            <div className="w-1 h-1 rounded-full transition-all" style={{ background: i < step ? 'var(--accent)' : i === step ? 'var(--ink)' : 'var(--muted)', transform: i === step ? 'scale(2.2)' : 'scale(1)' }} />
            <span style={{ color: i === step ? 'var(--ink)' : 'var(--muted)' }}>{p}{i === step && '...'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const ITEM_LABELS = {
  hat:    { ko: '모자', en: 'HAT' },
  top:    { ko: '상의', en: 'TOP' },
  bottom: { ko: '하의', en: 'BOTTOM' },
  shoes:  { ko: '신발', en: 'SHOES' },
};

const SLOT_ORDER = ['hat', 'top', 'bottom', 'shoes'];

function ProductImage({ item, slot, alt, className, style, nuki = true }) {
  const sources = getImageSources(item);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [nukiUrl, setNukiUrl] = useState(null);
  const [nukiPending, setNukiPending] = useState(nuki);

  const src = sources[sourceIdx];

  // 누끼 처리 — 원본 URL이 정해지면 백그라운드에서 배경 제거
  useEffect(() => {
    if (!nuki || !src) return;
    let cancelled = false;
    setNukiUrl(null);
    setNukiPending(true);
    getNukiUrl(src)
      .then((u) => { if (!cancelled) { setNukiUrl(u); setNukiPending(false); } })
      .catch(() => { if (!cancelled) setNukiPending(false); }); // 실패 시 원본 사용
    return () => { cancelled = true; };
  }, [src, nuki]);

  if (!src) {
    // 텍스트·테두리 없이 룩북 분위기에 녹는 빈 박스 (사용자 인식 최소화)
    return (
      <div
        className={className}
        style={{
          ...style,
          background: 'transparent',
          position: 'relative',
        }}
      />
    );
  }

  const displaySrc = nukiUrl || src;

  return (
    <div className={className} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
      {(!loaded || nukiPending) && (
        <div className="absolute inset-0 image-shimmer" />
      )}
      <img
        src={displaySrc}
        alt={alt || ''}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: loaded && !nukiPending ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (nukiUrl) { setNukiUrl(null); return; } // 누끼 이미지 실패 → 원본
          setLoaded(false);
          setSourceIdx((i) => i + 1);
        }}
        loading="lazy"
      />
    </div>
  );
}

function HoverPreview({ item, slot }) {
  if (!item) return null;
  return (
    <div
      className="hidden md:group-hover:flex absolute top-1/2 -translate-y-1/2 pointer-events-none flex-col gap-1 px-3 py-2.5 bg-white"
      style={{
        left: 'calc(100% + 16px)',
        minWidth: 200,
        maxWidth: 260,
        borderLeft: '2px solid var(--ink)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 20,
      }}
    >
      <div className="font-body text-[9px] tracking-[0.25em] uppercase" style={{ color: 'var(--accent)' }}>
        {ITEM_LABELS[slot]?.ko} · {ITEM_LABELS[slot]?.en}
      </div>
      <div className="font-body text-xs leading-snug" style={{ color: 'var(--ink)', fontWeight: 500 }}>
        {item.name}
      </div>
      <div className="flex items-center justify-between mt-1 pt-1.5" style={{ borderTop: '1px solid var(--line)' }}>
        <span className="font-body text-sm" style={{ color: 'var(--ink)', fontWeight: 700 }}>
          {item.price || '가격 확인'}
        </span>
        {item.is_direct_product && (
          <span className="font-body text-[9px] tracking-[0.15em] uppercase flex items-center gap-1" style={{ color: 'var(--muted)' }}>
            <ExternalLink size={9} /> {item.mall || '네이버'}
          </span>
        )}
      </div>
    </div>
  );
}

function LookbookCard({ outfit, index, total, onRegenerate, regenerating }) {
  const items = SLOT_ORDER.map((slot) => ({ slot, item: outfit.items[slot] })).filter(({ item }) => item);

  return (
    <div className="lookbook-paper relative overflow-hidden" style={{ minHeight: 720, opacity: regenerating ? 0.55 : 1, transition: 'opacity 0.2s' }}>
      <div className="absolute top-0 left-0 right-0 px-6 pt-6 z-20 flex items-start justify-between gap-3">
        <div>
          <div className="font-body text-[10px] tracking-[0.35em] uppercase" style={{ color: 'var(--ink-soft)' }}>
            ClothesAi · LookBook
          </div>
          <div className="font-display italic text-base mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            No. {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(index)}
              disabled={regenerating}
              className="btn-press font-body text-[10px] tracking-[0.15em] uppercase flex items-center gap-1.5 px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.92)',
                color: 'var(--ink)',
                border: '1px solid var(--ink)',
                borderRadius: 999,
                cursor: regenerating ? 'wait' : 'pointer',
                opacity: regenerating ? 0.6 : 1,
              }}
            >
              {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {regenerating ? '만드는 중' : '이 코디만 다시'}
            </button>
          )}
          <div className="px-5 py-2.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
            <span className="font-body text-sm" style={{ color: 'var(--ink)', fontWeight: 700 }}>
              상하의 {outfit.total_price || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="absolute top-20 left-6 right-6 z-10">
        <div className="font-display italic text-xl" style={{ color: 'var(--ink)', fontWeight: 500 }}>
          {outfit.title}
        </div>
        <div className="font-serif-kr text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
          {outfit.concept}
        </div>
      </div>

      <div className="relative pt-32 pb-6 px-4">
        <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-5">
          <div className="md:flex-1 flex justify-center">
        {outfit.model_image ? (
          /* 메인: AI 생성 모델 일러스트 (gpt-image-1) */
          <div className="flex justify-center">
            <div style={{ maxWidth: 340, width: '100%' }}>
              <img
                src={outfit.model_image}
                alt={outfit.title || ''}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                loading="lazy"
              />
            </div>
          </div>
        ) : (
          /* 메인: 4-아이템 누끼 세로 스택 (image_sample식 회색 무드보드) */
          <div className="flex flex-col items-center" style={{ gap: 0, background: '#ECECEE', borderRadius: 16, padding: '28px 16px', width: '100%' }}>
            {outfit.items.hat && (
              <a href={outfit.items.hat.product_url} target="_blank" rel="noopener noreferrer"
                className="product-shadow btn-press relative group cursor-pointer"
                style={{ width: 140, height: 110, marginBottom: -8, zIndex: 4 }}>
                <ProductImage item={outfit.items.hat} slot="hat" alt={outfit.items.hat.name}
                  className="w-full h-full" style={{ background: 'transparent' }} />
                <HoverPreview item={outfit.items.hat} slot="hat" />
              </a>
            )}
            {outfit.items.top && (
              <a href={outfit.items.top.product_url} target="_blank" rel="noopener noreferrer"
                className="product-shadow btn-press relative group cursor-pointer"
                style={{ width: 240, height: 240, marginBottom: -16, zIndex: 3 }}>
                <ProductImage item={outfit.items.top} slot="top" alt={outfit.items.top.name}
                  className="w-full h-full" style={{ background: 'transparent' }} />
                <HoverPreview item={outfit.items.top} slot="top" />
              </a>
            )}
            {outfit.items.bottom && (
              <a href={outfit.items.bottom.product_url} target="_blank" rel="noopener noreferrer"
                className="product-shadow btn-press relative group cursor-pointer"
                style={{ width: 220, height: 260, marginBottom: -12, zIndex: 2 }}>
                <ProductImage item={outfit.items.bottom} slot="bottom" alt={outfit.items.bottom.name}
                  className="w-full h-full" style={{ background: 'transparent' }} />
                <HoverPreview item={outfit.items.bottom} slot="bottom" />
              </a>
            )}
            {outfit.items.shoes && (
              <a href={outfit.items.shoes.product_url} target="_blank" rel="noopener noreferrer"
                className="product-shadow btn-press relative group cursor-pointer"
                style={{ width: 160, height: 110, zIndex: 1 }}>
                <ProductImage item={outfit.items.shoes} slot="shoes" alt={outfit.items.shoes.name}
                  className="w-full h-full" style={{ background: 'transparent' }} />
                <HoverPreview item={outfit.items.shoes} slot="shoes" />
              </a>
            )}
          </div>
        )}
          </div>

          {/* THE PIECES — 구성 아이템 누끼 + 점선 라벨 (잡지 무드보드 사이드 컬럼) */}
          <div className="md:w-[42%] md:flex-shrink-0">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-display italic text-lg" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                The Pieces
              </div>
              <div className="font-body text-[9px] tracking-[0.3em] uppercase" style={{ color: 'var(--muted)' }}>
                구성 아이템
              </div>
            </div>
            <div style={{ borderTop: '1px dashed var(--ink-soft)', opacity: 0.5 }} />
            {items.map(({ slot, item }) => (
              <a key={slot} href={item.product_url} target="_blank" rel="noopener noreferrer"
                className="btn-press flex items-center gap-3 py-3 cursor-pointer"
                style={{ borderBottom: '1px dashed var(--line)' }}>
                <div className="flex-shrink-0 flex items-center justify-center"
                  style={{ width: 64, height: 80, background: 'transparent', border: '1px dashed var(--line)' }}>
                  <ProductImage item={item} slot={slot} alt={item.name} className="w-full h-full" style={{ background: 'transparent' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="inline-block font-body text-[9px] tracking-[0.25em] uppercase mb-1 pb-0.5"
                    style={{ color: 'var(--accent)', borderBottom: '1px dotted var(--accent)' }}>
                    {ITEM_LABELS[slot].ko} · {ITEM_LABELS[slot].en}
                  </span>
                  <div className="font-body text-xs leading-snug mb-1" style={{
                    color: 'var(--ink)', fontWeight: 500,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {item.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-body text-sm" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                      {item.price || '가격 확인'}
                    </span>
                    {item.is_direct_product && (
                      <span className="font-body text-[8px] tracking-[0.15em] uppercase flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                        <ExternalLink size={8} /> {item.mall || '네이버'}
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LookbookGallery({ outfits, onRegenerate, regeneratingIndex }) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState('right');
  const total = outfits.length;
  const touchStartX = useRef(null);

  const goPrev = () => { if (current > 0) { setDirection('left'); setCurrent((c) => c - 1); } };
  const goNext = () => { if (current < total - 1) { setDirection('right'); setCurrent((c) => c + 1); } };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'ArrowLeft') goPrev(); if (e.key === 'ArrowRight') goNext(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, total]);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > 50) goPrev();
    if (dx < -50) goNext();
    touchStartX.current = null;
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="font-body text-[10px] tracking-[0.3em] uppercase" style={{ color: 'var(--accent)' }}>
          ─── LOOKBOOK {String(current + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={goPrev} disabled={current === 0}
            className="btn-press font-body text-xs tracking-[0.15em] uppercase flex items-center gap-1 px-3 py-1.5"
            style={{ border: '1px solid var(--ink)', color: 'var(--ink)', opacity: current === 0 ? 0.3 : 1, cursor: current === 0 ? 'not-allowed' : 'pointer' }}>
            <ChevronLeft size={12} /> 이전
          </button>
          <div className="flex gap-2">
            {outfits.map((_, i) => (
              <button key={i} type="button" onClick={() => { setDirection(i > current ? 'right' : 'left'); setCurrent(i); }}
                className="h-1.5 transition-all btn-press"
                style={{ width: i === current ? 32 : 12, background: i === current ? 'var(--ink)' : 'var(--line)' }} />
            ))}
          </div>
          <button type="button" onClick={goNext} disabled={current === total - 1}
            className="btn-press font-body text-xs tracking-[0.15em] uppercase flex items-center gap-1 px-3 py-1.5"
            style={{ background: 'var(--ink)', color: 'var(--cream)', opacity: current === total - 1 ? 0.3 : 1, cursor: current === total - 1 ? 'not-allowed' : 'pointer' }}>
            다음 <ChevronRight size={12} />
          </button>
        </div>
      </div>

      <div className="relative">
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div key={current} className={direction === 'right' ? 'slide-in-right' : 'slide-in-left'}>
            <LookbookCard
              outfit={outfits[current]}
              index={current}
              total={total}
              onRegenerate={onRegenerate}
              regenerating={regeneratingIndex === current}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 text-center font-body text-xs" style={{ color: 'var(--muted)' }}>
        상단 이전/다음 버튼 · ← → 키보드 또는 좌우 스와이프 · 상품 클릭 시 네이버 쇼핑 페이지로 이동
      </div>
    </div>
  );
}

function StyleGuide({ guide }) {
  if (!guide) return null;

  const sections = [
    { key: 'fit_chips',   labelKo: '핏',     labelEn: 'FIT',   icon: null },
    { key: 'tone_chips',  labelKo: '톤',     labelEn: 'TONE',  icon: null },
    { key: 'vibe_chips',  labelKo: '분위기', labelEn: 'VIBE',  icon: null },
    { key: 'avoid_chips', labelKo: '피하기', labelEn: 'AVOID', icon: X },
  ];

  return (
    <div className="mt-12 fade-up">
      <div className="flex items-center gap-4 mb-6">
        <div className="font-body text-[10px] tracking-[0.3em] uppercase" style={{ color: 'var(--accent)' }}>
          ─── 어떤 느낌으로 입어야 할까
        </div>
        <div className="flex-1 h-px" style={{ background: 'var(--line)' }} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {sections.map(({ key, labelKo, labelEn, icon: Icon }) => {
          const chips = guide[key] || [];
          if (chips.length === 0) return null;

          const isAvoid = key === 'avoid_chips';
          const isVibe = key === 'vibe_chips';

          return (
            <div key={key} className="p-4" style={{
              background: isAvoid ? 'rgba(139,44,44,0.04)' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${isAvoid ? 'rgba(139,44,44,0.2)' : 'var(--line)'}`,
            }}>
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-display italic text-2xl" style={{
                  color: isAvoid ? 'var(--accent)' : 'var(--ink)',
                  fontWeight: 500,
                }}>
                  {labelKo}
                </div>
                <div className="font-body text-[9px] tracking-[0.3em] uppercase" style={{ color: 'var(--muted)' }}>
                  {labelEn}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip, i) => (
                  <span key={i}
                    className="font-body text-xs px-2.5 py-1 inline-flex items-center gap-1"
                    style={{
                      background: isAvoid ? 'rgba(139,44,44,0.08)' : (isVibe ? 'var(--ink)' : 'rgba(0,0,0,0.05)'),
                      color: isAvoid ? 'var(--accent)' : (isVibe ? 'var(--cream)' : 'var(--ink)'),
                      borderRadius: 2,
                      fontWeight: isVibe ? 600 : 500,
                    }}>
                    {Icon && <Icon size={10} strokeWidth={2.5} />}
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Result({ result, query, onRestart }) {
  return (
    <section className="max-w-5xl mx-auto px-6 pt-12 pb-32 fade-in">
      <div className="mb-10 fade-up">
        <div className="font-body text-[10px] tracking-[0.3em] uppercase mb-3" style={{ color: 'var(--accent)' }}>
          ─── 큐레이션 결과
        </div>
        <h2 className="font-display" style={{
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 400,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          color: 'var(--ink)',
        }}>
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>"</span>
          {result.mood_label}
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>"</span>
        </h2>
        <p className="font-serif-kr text-sm mt-3" style={{ color: 'var(--muted)' }}>
          입력 — "{query}"
        </p>
      </div>

      <div className="md:px-12">
        <LookbookGallery outfits={result.outfits} />
      </div>

      <StyleGuide guide={result.style_guide} />

      <div className="mt-12 mb-8 p-5 fade-up" style={{ background: 'var(--cream-deep)', border: '1px dashed var(--line)' }}>
        <div className="flex gap-3 items-start">
          <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 3 }} />
          <div>
            <div className="font-display italic text-sm mb-1" style={{ fontWeight: 500 }}>이렇게 동작합니다</div>
            <p className="font-serif-kr text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              AI가 의미를 해석해 슬롯별 검색어를 만들고, 네이버 쇼핑 OpenAPI에 실시간으로 질의해 실제 판매 중인 상품을 가져옵니다. 한 슬롯의 검색 결과가 비면 해당 카드는 네이버 쇼핑 검색 페이지로 연결됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="pt-8 border-t flex flex-col md:flex-row gap-3 items-start md:items-center justify-between" style={{ borderColor: 'var(--ink)' }}>
        <div className="font-serif-kr text-sm" style={{ color: 'var(--muted)' }}>마음에 드는 룩북을 찾으셨나요?</div>
        <button onClick={onRestart}
          className="btn-press inline-flex items-center gap-3 px-5 py-2.5 font-body text-xs tracking-[0.2em] uppercase"
          style={{ background: 'var(--ink)', color: 'var(--cream)' }}>
          <RefreshCw size={12} /> 다시 받기
        </button>
      </div>
    </section>
  );
}

export default function App() {
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = FONT_LINK;
    document.head.appendChild(styleEl);
    return () => { document.head.removeChild(styleEl); };
  }, []);

  // 누끼 모델 프리로드 — 첫 추천이 뜨기 전에 WASM 모델을 미리 받아둠
  useEffect(() => { warmupNuki(); }, []);

  return (
    <div className="font-body min-h-screen" style={{ background: 'var(--cream)', color: 'var(--ink)' }}>
      <ChatView />
    </div>
  );
}