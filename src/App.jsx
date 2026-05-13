import { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, ShoppingBag, Loader2, RefreshCw, X, Info, ExternalLink, Search, ChevronLeft, ChevronRight, Check } from 'lucide-react';

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

// ─────────────────────────────────────────────────────────────
// 🔥 v7 핵심 변경점
// 이전: fetch('https://api.anthropic.com/v1/messages', ...) → CORS 차단
// 이제: fetch(`${WORKER_URL}/ai`, ...) → Worker 프록시 경유 → Vercel 배포 OK
// ─────────────────────────────────────────────────────────────

const callAI = async (profile, styleQuery) => {
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
1. 입력을 무드/색/핏으로 해석. mood_label은 **한국 MZ가 실제 쓰는 트렌디한 코디 컨셉**을 한 줄로 표현. 같은 표현 절대 반복 금지, 매번 새로운 어휘.

   ### mood_label 시드 (이 톤 참고, 같은 거 쓰지 말고 비슷한 결로 새로 만들 것)
   - "꾸안꾸 선데이 카페크루" / "미니멀 캠퍼스 데이" / "워크웨어 스트릿"
   - "프렌치 빈티지 무드" / "올드머니 프레피" / "다크 아카데미아"
   - "코어홈 라운지 셋업" / "고프코어 어반" / "Y2K 레트로 키치"
   - "노멀코어 베이직" / "어반 미니멀리스트" / "재패니즈 모더니즘"
   - "성수 카페 호퍼" / "이태원 나잇 아웃" / "한강 피크닉 무드"
   - "강남 미팅 비즈" / "압구정 오마카세 핏" / "홍대 댄디"
   - "위켄드 브런치 룩" / "데이트 디너 셋업" / "와인바 칠 핏"
   - "트래블 휴양지 리조트" / "갤러리 오프닝" / "북카페 학구파"
   - "스튜디오 작업 핏" / "도시 산책 슬렁슬렁" / "음악 페스티벌 라이브"
   - "발레코어 댄스" / "테니스 클럽 무드" / "오피스 캐주얼 모던"
   - "퇴근길 친구 만남" / "썸머 페스티벌 보헤미안" / "윈터 코지 워머스"

   → 입력의 상황·계절·동네·기분 어휘를 자유롭게 조합해 **새로운 라벨**을 만든다.

2. **반드시 outfits 배열에 정확히 3개의 서로 다른 코디**를 만든다 (각: 모자/상의/하의/신발 — 가방·양말 X). 1·2개만 만들면 무효.
3. 각 코디는 **명확히 다른 무드 방향성**을 가져야 한다 (예: 1번-미니멀 / 2번-빈티지 / 3번-스트릿 / 또는 1번-캐주얼 / 2번-스마트 / 3번-시즈널).
4. **각 outfit의 title도 mood_label만큼 다양하게** — "코디 1", "코디 2" 식 단조로움 금지. 각 outfit이 어떤 자리·상황 위주인지 한 줄로.
5. 각 아이템(총 12개)마다 네이버 쇼핑에서 검색할 한국어 검색어(search_keyword)를 만든다.

## 검색어 작성 규칙 (매우 중요)
- 반드시 [성별] + [카테고리] + [색상] **3단어**만 사용 (총 4단어 이하)
- 성별 토큰 필수: "${profile.gender === '남성' ? '남성' : '여성'}"
- 카테고리는 구체 명칭: 셔츠, 슬랙스, 스니커즈, 첼시부츠, 볼캡, 비니, 맨투맨, 후드, 데님, 카디건 등
- 색상은 한 단어: 블랙, 화이트, 차콜, 베이지, 네이비, 그레이, 카키, 브라운, 아이보리 등
- **금지 단어**: "오버핏", "와이드", "슬림", "빈티지", "헤비", "코튼", "스판", "무지", "프리미엄" 등 핏/소재/디테일 형용사 절대 X
- 색상은 검색어와 별도로 color/color_hex 필드로 전달 (mood 표현용)
- 좋은 예: "남성 셔츠 차콜" / "여성 슬랙스 베이지" / "남성 첼시부츠 블랙"
- 나쁜 예: "남성 오버핏 셔츠 차콜 빈티지" (너무 좁음, 검색 결과 0건 위험)
- 브랜드명 절대 X

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
      max_tokens: 2500,
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

  // 가드 — outfits이 3개 미만이면 부족분을 첫 번째 코디 복제로 채워 화살표 동작 보장
  if (!Array.isArray(result.outfits) || result.outfits.length === 0) {
    throw new Error('AI가 코디를 생성하지 못했습니다. 다시 시도해 주세요.');
  }
  while (result.outfits.length < 3) {
    const base = JSON.parse(JSON.stringify(result.outfits[0]));
    base.title = `${base.title || '코디'} · 변형 ${result.outfits.length + 1}`;
    result.outfits.push(base);
  }

  // ─── 2단계 — Worker /batch-search로 12개 검색어 동시 질의 ───
  const queries = [];
  result.outfits.forEach((outfit, oi) => {
    ['hat', 'top', 'bottom', 'shoes'].forEach((slot) => {
      const item = outfit.items[slot];
      if (!item || !item.search_keyword) return;
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
    throw new Error(`상품 검색 서버 오류 (${searchResponse.status})`);
  }

  const searchData = await searchResponse.json();
  const slotMap = {};
  (searchData.results || []).forEach((r) => {
    slotMap[r.slot] = r.items || [];
  });

  // ─── 3단계 — 검색 결과 1순위로 슬롯 합성 ───
  result.outfits.forEach((outfit, oi) => {
    let totalPrice = 0;
    ['hat', 'top', 'bottom', 'shoes'].forEach((slot) => {
      const item = outfit.items[slot];
      if (!item) return;
      const candidates = slotMap[`${oi}-${slot}`] || [];
      const validCandidates = candidates.filter((c) => c.image_url && /^https?:\/\//.test(c.image_url));
      const pool = validCandidates.length > 0 ? validCandidates : candidates;
      const idx = pool.length > 0 ? oi % pool.length : 0;
      const picked = pool[idx];
      // 이미지 로드 실패 시 cascade할 backup URLs (같은 슬롯의 다른 후보 4개까지)
      const altImages = pool
        .filter((_, i) => i !== idx)
        .slice(0, 4)
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
        // 백엔드 폴백도 통과 못한 극히 드문 케이스 — 네이버 검색 페이지로 안내
        item.name = item.search_keyword;
        item.image_url = '';
        item.product_url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(item.search_keyword)}`;
        item.price = '비슷한 상품 보기';
        item.price_num = 0;
        item.is_direct_product = false;
      }
    });
    outfit.total_price = totalPrice > 0 ? `${totalPrice.toLocaleString()}원` : '';
  });

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
  { role: 'ai', type: 'text', content: '안녕하세요, 클로예요.\n친구처럼 코디 같이 골라드릴게요.' },
  { role: 'ai', type: 'text', content: '먼저 성별이 어떻게 되세요?' },
  { role: 'ai', type: 'quickReplies', content: ['남성', '여성'] },
];

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
  const [stage, setStage] = useState(0); // 0:성별 1:나이 2:키 3:체형 4:예산 5:스타일 (이후 자유 대화)
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

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

  // 자유 입력이 필요한 단계(나이·키·체형·예산·스타일)에선 자동으로 포커스
  useEffect(() => {
    if (loading) return;
    if (stage >= 1 && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [stage, loading]);

  const appendAi = (...items) => setMessages((prev) => [...prev, ...items.map((it) => ({ role: 'ai', ...it }))]);
  const appendUser = (text) => setMessages((prev) => [
    ...prev.filter((m) => m.type !== 'quickReplies'),
    { role: 'user', type: 'text', content: text },
  ]);

  const generateLookbook = async (text, nextProfile) => {
    setLoading(true);
    try {
      const data = await callAI(nextProfile, text);
      await delay(300);
      appendAi(
        { type: 'text', content: `'${data.mood_label}' 무드로 골라봤어요. 마음에 드는 한 벌이 있길!` },
        { type: 'lookbook', content: data },
        { type: 'text', content: '상품 카드를 누르면 구매 페이지로 가요. 다른 무드나 변형도 자유롭게 말해주세요.' },
      );
    } catch (e) {
      console.error(e);
      appendAi({ type: 'error', content: `이번엔 잘 안 됐어요. 잠시 후 다시 시도해 주세요. (${e.message})` });
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = async (text) => {
    const userText = text.trim();
    if (!userText || loading) return;

    appendUser(userText);
    setInput('');

    // 단계별 정보 수집
    if (stage === 0) {
      if (!['남성', '여성'].includes(userText)) {
        await delay(350);
        appendAi({ type: 'text', content: '아래 버튼 중 하나로 선택해주세요.' }, { type: 'quickReplies', content: ['남성', '여성'] });
        return;
      }
      const next = { ...profile, gender: userText };
      setProfile(next);
      setStage(1);
      await delay(400);
      appendAi({ type: 'text', content: `${userText}분이군요. 나이가 어떻게 되세요?` });
      return;
    }
    if (stage === 1) {
      const age = userText.replace(/[^0-9]/g, '').slice(0, 2);
      if (!age) {
        await delay(350);
        appendAi({ type: 'text', content: '숫자만 적어주세요. 예: 22' });
        return;
      }
      const next = { ...profile, age };
      setProfile(next);
      setStage(2);
      await delay(400);
      appendAi({ type: 'text', content: `${age}살이시군요. 키는 어떻게 되세요?` });
      return;
    }
    if (stage === 2) {
      const height = userText.replace(/[^0-9]/g, '').slice(0, 3);
      if (!height) {
        await delay(350);
        appendAi({ type: 'text', content: '숫자로 적어주세요. 예: 175' });
        return;
      }
      const next = { ...profile, height };
      setProfile(next);
      setStage(3);
      await delay(400);
      appendAi({ type: 'text', content: '체형은 어떻게 표현해볼까요?\n자유롭게 적어주세요 (예: 마른편, 어깨가 넓음, 뱃살 살짝 있음, 하체비만 등)' });
      return;
    }
    if (stage === 3) {
      if (userText.length < 2) {
        await delay(350);
        appendAi({ type: 'text', content: '조금 더 구체적으로 적어주세요.' });
        return;
      }
      const next = { ...profile, bodyType: userText };
      setProfile(next);
      setStage(4);
      await delay(400);
      appendAi({ type: 'text', content: '예산은 어느 정도로 보세요?' });
      return;
    }
    if (stage === 4) {
      const budget = userText.replace(/[^0-9]/g, '').slice(0, 4);
      if (!budget) {
        await delay(350);
        appendAi({ type: 'text', content: '숫자만 적어주세요. 예: 20' });
        return;
      }
      const next = { ...profile, budget };
      setProfile(next);
      setStage(5);
      await delay(400);
      appendAi(
        { type: 'text', content: '좋아요, 다 받았어요!\n이제 어떤 스타일·분위기로 가고 싶어요?' },
        { type: 'quickReplies', content: SAMPLE_PROMPTS },
      );
      return;
    }

    // stage 5+: 스타일 입력 → 룩북 생성, 이후 자유 대화
    await generateLookbook(userText, profile);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAnswer(input);
    }
  };

  const restart = () => {
    setMessages(INITIAL_MESSAGES);
    setProfile(INITIAL_PROFILE);
    setStage(0);
    setInput('');
    setLoading(false);
  };

  const placeholder = (() => {
    if (loading) return 'Clo가 답하는 중…';
    if (stage === 0) return '성별을 선택해주세요';
    if (stage === 1) return '나이를 적어주세요 (예: 22)';
    if (stage === 2) return '키를 적어주세요 (cm)';
    if (stage === 3) return '체형을 자유롭게 적어주세요';
    if (stage === 4) return '예산을 적어주세요 (만원)';
    return '원하는 스타일이나 변경 요청을 적어주세요';
  })();

  return (
    <section className="max-w-2xl md:max-w-5xl mx-auto fade-in flex flex-col" style={{ height: '100dvh', overflow: 'hidden' }}>
      <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 18, background: 'var(--ink)' }}>
          <Sparkles size={15} style={{ color: '#FFFFFF' }} />
        </div>
        <div className="leading-tight flex-1">
          <div className="font-display italic text-base" style={{ color: 'var(--ink)', fontWeight: 500 }}>Clo</div>
          <div className="font-body text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--muted)' }}>ClothesAi · Assistant</div>
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
          if (msg.type === 'lookbook') {
            return (
              <div key={i} data-lookbook="true" className="fade-in" style={{ padding: '4px 0' }}>
                <LookbookGallery outfits={msg.content.outfits} />
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

function ProductImage({ item, slot, alt, className, style }) {
  const sources = getImageSources(item);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const src = sources[sourceIdx];

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

  return (
    <div className={className} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
      {!loaded && (
        <div className="absolute inset-0 image-shimmer" />
      )}
      <img
        src={src}
        alt={alt || ''}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
        onLoad={() => setLoaded(true)}
        onError={() => {
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

function LookbookCard({ outfit, index, total }) {
  const items = SLOT_ORDER.map((slot) => ({ slot, item: outfit.items[slot] })).filter(({ item }) => item);

  return (
    <div className="lookbook-paper relative overflow-hidden" style={{ minHeight: 720 }}>
      <div className="absolute top-0 left-0 right-0 px-6 pt-6 z-20 flex items-start justify-between">
        <div>
          <div className="font-body text-[10px] tracking-[0.35em] uppercase" style={{ color: 'var(--ink-soft)' }}>
            ClothesAi · LookBook
          </div>
          <div className="font-display italic text-base mt-0.5" style={{ color: 'var(--ink-soft)' }}>
            No. {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </div>
        </div>
        <div className="px-5 py-2.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
          <span className="font-body text-sm" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            상하의 {outfit.total_price || '—'}
          </span>
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
        <div className="flex flex-col items-center" style={{ gap: 0 }}>
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

        <div className="mt-6 space-y-2">
          {items.map(({ slot, item }) => (
            <a key={slot} href={item.product_url} target="_blank" rel="noopener noreferrer"
              className="price-card-shadow btn-press flex items-center gap-3 px-3 py-2 bg-white block cursor-pointer hover:shadow-lg transition-shadow"
              style={{ borderRadius: 4 }}>
              <div className="w-12 h-12 flex-shrink-0 overflow-hidden" style={{ background: '#f5f5f5' }}>
                <ProductImage item={item} slot={slot} alt={item.name} className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-body text-[10px] tracking-[0.2em] uppercase mb-0.5" style={{ color: 'var(--muted)' }}>
                  {ITEM_LABELS[slot].ko}
                </div>
                <div className="font-body text-xs truncate" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {item.name}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="font-body text-sm" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                  {item.price || '가격 확인'}
                </div>
                {item.is_direct_product && (
                  <div className="font-body text-[8px] tracking-[0.15em] uppercase mt-0.5 flex items-center gap-1 justify-end" style={{ color: 'var(--accent)' }}>
                    <ExternalLink size={8} /> {item.mall || '네이버'}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function LookbookGallery({ outfits }) {
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
            <LookbookCard outfit={outfits[current]} index={current} total={total} />
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

  return (
    <div className="font-body min-h-screen" style={{ background: 'var(--cream)', color: 'var(--ink)' }}>
      <ChatView />
    </div>
  );
}