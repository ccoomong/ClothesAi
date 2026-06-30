// Vercel API Route — 네이버 쇼핑 배치 검색
// 호출 경로: /api/batch-search

const PRICE_FLOOR = {
  hat: 8000, top: 12000, bottom: 15000, shoes: 25000, default: 10000,
};

// 슬롯별 카테고리 화이트리스트 — 잘못된 슬롯 매칭 방지
const SLOT_CATEGORIES = {
  hat: ['모자', '캡', '비니', '버킷', '햇'],
  top: ['셔츠', '티셔츠', '맨투맨', '후드', '니트', '가디건', '재킷', '자켓', '코트', '블라우스', '상의', '점퍼', '베스트', '조끼'],
  bottom: ['바지', '팬츠', '슬랙스', '데님', '청바지', '조거', '트레이닝', '스커트', '치마', '하의', '쇼츠', '반바지'],
  shoes: ['신발', '스니커즈', '스니커', '구두', '부츠', '샌들', '슬리퍼', '로퍼', '슈즈'],
};

// 누끼 비중 높은 셀렉트샵 CDN — 이미지 URL이 이런 도메인에서 오면 단독컷 가능성 ↑
const CLEAN_IMAGE_DOMAINS = [
  'image.msscdn.net',     // 무신사
  'msscdn',
  'img.29cm.co.kr',       // 29CM
  '29cm',
  'cdn.wconcept.co.kr',   // W컨셉
  'wconcept',
  'eqlstore',             // EQL
  'image.lookpin',        // 룩핀
];

// 누끼 단독컷이 아닐 가능성 높은 시그널
const MODEL_SHOT_KEYWORDS = /모델|착용샷|코디|룩북|화보|기획전|model|outfit|lookbook|wear/i;
const MULTI_PRODUCT_KEYWORDS = /세트|묶음|콤보|패키지|풀세트|풀구성|컬러구성|컬러별|2종|3종|4종|5종|6종|모음|기획|set|combo|pack|bundle|multipack|pcs/i;

// 성별 키워드 — 사용자 성별과 반대인 상품 제거
const WOMEN_KEYWORDS = ['여성', '여자', 'women', 'womens', 'womans', 'female', '우먼', '걸즈', 'girls', '레이디', 'lady', '와이프', '엄마'];
const MEN_KEYWORDS = ['남성', '남자', 'mens', 'mans', 'male', '맨즈', '보이즈', 'boys', '아빠', '신랑', '아저씨'];

// 누끼 비중에 따라 몰을 티어로 분류 — 낮은 티어가 우선 노출됨
const TIER1_MALLS = [
  '무신사', 'MUSINSA',
  '29CM', '29cm',
  'W컨셉', 'WCONCEPT', 'wconcept',
  'EQL',
  'OCO',
  '하이버',
  '4910',          // 무신사 산하 셀렉트샵
  '무탠다드', 'MUTNDARD',
  '어글리쉽', 'UGLYSHIP',
  '커버낫', 'COVERNAT',
  '디스이즈네버댓', 'thisisneverthat',
];
const TIER2_MALLS = ['스타일쉐어', 'LOOKPIN', '룩핀', 'SSF', 'LF몰', '한섬', '코오롱몰'];
const TIER3_MALLS = ['ABLY', '에이블리', 'ZIGZAG', '지그재그', 'BRANDI', '브랜디'];

function getMallTier(mallName) {
  if (!mallName) return 99;
  const upper = mallName.toUpperCase();
  if (TIER1_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 1;
  if (TIER2_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 2;
  if (TIER3_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 3;
  return 4; // 그 외 (스마트스토어 등)
}

function isCleanImageDomain(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CLEAN_IMAGE_DOMAINS.some((d) => host.includes(d.toLowerCase()));
  } catch {
    return false;
  }
}

// 슬롯 매칭: 카테고리 OR 이름에 해당 슬롯 어휘가 있어야 통과.
// Naver 카테고리가 잘리거나 일반적("패션의류")인 경우 이름으로 보완.
function matchesSlot(name, category, slot) {
  if (slot === 'default') return true;
  const allowed = SLOT_CATEGORIES[slot];
  if (!allowed) return true;
  const haystack = `${category || ''} ${name || ''}`.toLowerCase();
  return allowed.some((kw) => haystack.includes(kw.toLowerCase()));
}

// 크로스 슬롯 배제: 이름에 다른 슬롯 어휘가 강하게 들어가면 위양성 차단
// (예: bottom 슬롯에 "셔츠" 들어간 이름이 카테고리 우연 매칭으로 통과하는 케이스)
function looksLikeOtherSlot(name, slot) {
  if (!name || slot === 'default') return false;
  const lower = name.toLowerCase();
  const ownKws = SLOT_CATEGORIES[slot] || [];
  // 본인 슬롯 어휘도 있으면 OK (예: "셔츠형 원피스" 같은 합성어 케이스)
  if (ownKws.some((kw) => lower.includes(kw.toLowerCase()))) return false;
  return Object.entries(SLOT_CATEGORIES)
    .filter(([s]) => s !== slot)
    .some(([_, kws]) => kws.some((kw) => lower.includes(kw.toLowerCase())));
}

function violatesGender(haystack, gender) {
  if (!gender) return false;
  const lower = haystack.toLowerCase();
  if (gender === '남성') {
    return WOMEN_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  }
  if (gender === '여성') {
    return MEN_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  try {
    const body = req.body || {};
    const { queries, gender } = body;
    if (!Array.isArray(queries)) {
      return res.status(400).json({ error: 'queries 배열이 필요합니다' });
    }

    const results = await Promise.all(
      queries.map(async (q) => {
        try {
          const slotType = (q.slot || '').split('-').pop() || 'default';
          const items = await searchNaver(q.keyword, 20, q.sort || 'sim', slotType, gender);
          const ranked = await rankByVisionClassification(items, slotType);
          return { slot: q.slot, keyword: q.keyword, items: ranked.slice(0, q.display || 5) };
        } catch (e) {
          console.error(`[batch] slot=${q.slot} q="${q.keyword}" err=${e.message}\n${e.stack}`);
          return { slot: q.slot, keyword: q.keyword, items: [], error: e.message };
        }
      })
    );

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    console.error('[batch] handler fatal:', e.message, '\n', e.stack);
    return res.status(500).json({
      error: 'batch-search handler 에러',
      message: e.message,
      stack: e.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Vision 분류 — Groq Llama 3.2 Vision으로 사진 직접 보고 "단독컷 vs 모델샷" 판별
// ─────────────────────────────────────────────────────────────

const SLOT_LABEL_KO = { hat: '모자', top: '상의', bottom: '하의', shoes: '신발', default: '상품' };
const VISION_TYPE_SCORE = { clean: 0, scene: 1, multi: 2, model: 3 }; // 작을수록 우선

async function classifySingleImageWithVision(imageUrl, slot) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !imageUrl) return null;

  const slotKo = SLOT_LABEL_KO[slot] || '상품';
  const content = [
    {
      type: 'text',
      text: `이 ${slotKo} 상품 사진을 매우 엄격하게 분류하라. 의심되면 multi 또는 model.

기준:
- "clean": 단 하나의 상품만 흰색·단색 배경에 단독으로 있는 사진. 사람 없음.
- "multi": 2개 이상의 상품이 한 사진에 (같은 상품의 다른 컬러·각도 라인업도 multi).
- "model": 사람의 일부(얼굴·팔·다리·몸·손·발)가 보이는 사진.
- "scene": 야외·실내 환경에 자연스럽게 놓인 단일 상품.

핵심: 상품 모양이 2개 이상 보이면 무조건 multi.

JSON으로만 답하라.
{"type":"clean"}`,
    },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user', content }],
        max_tokens: 50,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Vision] HTTP ${response.status}:`, errText.slice(0, 200));
      return null;
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    return parsed.type || null;
  } catch (e) {
    console.error('[Vision] Exception:', e.message);
    return null;
  }
}

async function rankByVisionClassification(items, slot) {
  if (!Array.isArray(items) || items.length === 0) return items;
  // 상위 N장 Vision 분류 — 단독컷(clean) 판별 강화 (12 슬롯 × 2 = 24회 < Groq 30 RPM)
  const HEAD = 2;
  const head = items.slice(0, HEAD);

  const types = await Promise.all(
    head.map((it) =>
      it.image_url && /^https?:\/\//.test(it.image_url)
        ? classifySingleImageWithVision(it.image_url, slot)
        : Promise.resolve(null)
    )
  );

  // 모든 호출이 실패하면 원본 그대로 (텍스트 휴리스틱 정렬 유지) — is_clean 미상은 false
  const validVerdicts = types.filter((t) => t !== null);
  if (validVerdicts.length === 0) {
    console.warn(`[Vision] all calls failed for slot ${slot} — falling back to text heuristics`);
    return items.map((it) => ({ ...it, is_clean: false }));
  }

  // 누끼 도입 후 정책: clean(단독컷)은 is_clean=true로 표시하고 우선 노출.
  // model/multi도 버리지 않음 — 프론트가 착용샷도 누끼하므로 빈 슬롯 방지(사용자 1순위).
  const scored = head.map((item, i) => {
    const type = types[i] || 'unknown';
    return { ...item, _vision_score: VISION_TYPE_SCORE[type] ?? 99, is_clean: type === 'clean' };
  });
  scored.sort((a, b) => a._vision_score - b._vision_score);

  const tail = items.slice(HEAD).map((it) => ({ ...it, is_clean: false }));
  const cleanedHead = scored.map(({ _vision_score, ...rest }) => rest);
  return [...cleanedHead, ...tail];
}

async function callNaverApi(query, display, sort) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('네이버 API 키가 설정되지 않았습니다');
  }

  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
  const response = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!response.ok) {
    throw new Error(`네이버 API 오류 ${response.status}`);
  }

  return response.json();
}

// 검색 쿼리 캐스케이드 — 풀 키워드(트렌디) 우선, 결과 부족 시 토큰 깎아 보충.
function generateSearchVariants(query, slot, gender) {
  const tokens = (query || '').split(/\s+/).filter(Boolean);
  const allowed = SLOT_CATEGORIES[slot] || [];
  const slotCat = tokens.find((t) => allowed.some((kw) => t.includes(kw))) || allowed[0] || '';
  const genderTok = gender || tokens.find((t) => /남성|여성|남자|여자/.test(t)) || '';
  const full = (query || '').trim();

  const variants = [];
  if (full) variants.push(full);                                      // 0순위: LLM 풀 키워드 (핏+아이템) — A1 핵심
  if (full && !full.includes('무신사')) variants.push(`${full} 무신사`.trim()); // 1순위: 풀 키워드 + 무신사
  if (slotCat) variants.push(`${genderTok} ${slotCat}`.trim());       // 2순위(폴백): 성별+아이템 (결과 보충용)

  return variants.filter((v, i, a) => a.indexOf(v) === i && v.length > 0);
}

async function searchNaver(query, display, sort, slot = 'default', gender = null) {
  // A1 수정: LLM이 만든 풀 키워드("여성 와이드 슬랙스")를 1순위로 검색하고,
  // 결과 부족 시에만 토큰 깎은 폴백("여성 슬랙스")으로 보충.
  // (예전엔 거꾸로 — 깎은 2단어부터 검색해 트렌디 키워드를 통째로 버림 = 추천이 촌스러운 원인)
  const variants = generateSearchVariants(query, slot, gender);
  const variantResults = await Promise.all(
    variants.map((q, vi) =>
      callNaverApi(q, display, sort)
        .then((d) => ({ items: d.items || [], query: q, rank: vi }))
        .catch(() => ({ items: [], query: q, rank: vi }))
    )
  );

  // 결과 병합 — 중복 제거, 풀 키워드(rank 0) 결과 우선. rank로 검색어 정확도 추적.
  const allItems = [];
  const seen = new Set();
  for (const result of variantResults) {
    for (const item of result.items) {
      if (!seen.has(item.link)) {
        seen.add(item.link);
        item.__qrank = result.rank;
        allItems.push(item);
      }
    }
  }

  let data = { items: allItems.slice(0, 30) };
  let usedQuery = variants[0] || (query || '');

  // 무신사 booster — 결과 안에 무신사가 3개 미만이면 "검색어 + 무신사"로 추가 검색
  const musinsaInPrimary = (data.items || []).filter((it) => /무신사|musinsa/i.test(it.mallName || ''));
  if (musinsaInPrimary.length < 3) {
    try {
      const boosterData = await callNaverApi(`${usedQuery} 무신사`, display, sort);
      const merged = [...(data.items || []), ...(boosterData.items || [])];
      const seen = new Set();
      const unique = [];
      for (const it of merged) {
        if (!seen.has(it.link)) {
          seen.add(it.link);
          unique.push(it);
        }
      }
      data.items = unique.slice(0, 30);
    } catch {
      // booster 실패는 silent — 1차 결과 그대로 사용
    }
  }

  let items = (data.items || []).map((item) => {
    const cleanUrl = cleanProductUrl(item.link);
    const linkType = classifyUrl(cleanUrl);
    const mall = item.mallName || '';
    const cleanName = stripHtml(item.title);
    const category = [item.category1, item.category2, item.category3, item.category4].filter(Boolean).join(' > ');
    const haystack = `${cleanName} ${category} ${mall}`;

    return {
      name: cleanName,
      image_url: item.image,
      product_url: cleanUrl,
      price: item.lprice ? `${Number(item.lprice).toLocaleString()}원` : null,
      price_num: Number(item.lprice) || 0,
      mall: mall || null,
      brand: item.brand || null,
      category,
      is_direct_product: true,
      _query_rank: item.__qrank ?? 9,
      _link_type: linkType,
      _mall_tier: getMallTier(mall),
      _has_model_keyword: MODEL_SHOT_KEYWORDS.test(cleanName),
      _has_multi_keyword: MULTI_PRODUCT_KEYWORDS.test(cleanName),
      _is_clean_cdn: isCleanImageDomain(item.image),
      _matches_slot: matchesSlot(cleanName, category, slot),
      _looks_other_slot: looksLikeOtherSlot(cleanName, slot),
      _violates_gender: violatesGender(haystack, gender),
    };
  });

  const rawCount = items.length;

  // 1차 필터 — 가격 하한
  const floor = PRICE_FLOOR[slot] || PRICE_FLOOR.default;
  let pool = items.filter((item) => item.price_num >= floor);
  if (pool.length < 3) pool = items; // 안전장치
  const priceCount = pool.length;

  // 2차 필터 — 쇼핑몰 자체 도메인(external) + 셀러 스토어(smartstore)만 통과
  // brand.naver.com(보안 인증 트리거)·search.shopping.naver.com(검색결과 페이지)은 절대 X
  const externalOnly = pool.filter((item) =>
    item._link_type === 'external' || item._link_type === 'smartstore'
  );

  // 3차 필터 — 사용자 요청: 무신사·29CM·지그재그 같은 셀렉트샵에서만
  // 1차: TIER1(전문 셀렉트샵) + TIER3(여성 패션앱) — 사용자가 명시한 몰들
  // 안전장치: TIER1~3까지 (TIER2 큐레이션몰까지 허용)
  // TIER4(일반 스마트스토어 셀러)는 어떤 경우에도 통과 X — 깨진 이미지·잡 상품의 주범
  let mallFiltered = externalOnly.filter((item) => item._mall_tier === 1 || item._mall_tier === 3);
  if (mallFiltered.length < 2) mallFiltered = externalOnly.filter((item) => item._mall_tier <= 3);

  // 4차 필터 — 슬롯 매칭. _looks_other_slot은 절대 유지(셔츠가 모자에 들어가는 사고 차단),
  // _matches_slot만 안전장치 — 너무 빡세서 0건되면 풀어줌
  let categoryFiltered = mallFiltered.filter((item) => item._matches_slot && !item._looks_other_slot);
  if (categoryFiltered.length < 2) {
    categoryFiltered = mallFiltered.filter((item) => !item._looks_other_slot);
  }

  // 5차 필터 — 성별 위반 제거
  let genderFiltered = categoryFiltered.filter((item) => !item._violates_gender);
  if (genderFiltered.length < 2) genderFiltered = categoryFiltered; // 안전장치

  // 최종 안전장치 — 필터가 슬롯을 통째로 비우면 단계적으로 풀어 "이미지 있는 후보"를 반드시 확보.
  // 사용자 1순위: 상품/이미지는 무조건 떠야 한다(빈 슬롯=삭제 방지). 정렬이 무신사·클린CDN을
  // 위로 올리므로, 하위 티어가 폴백에 섞여도 화면엔 베스트가 먼저 노출됨.
  const withImg = (arr) => arr.filter((it) => it.image_url && /^https?:\/\//.test(it.image_url));
  let final = withImg(genderFiltered);
  if (final.length === 0) {
    for (const tier of [categoryFiltered, mallFiltered, externalOnly, pool, items]) {
      const c = withImg(tier);
      if (c.length > 0) { final = c; break; }
    }
  }
  const linkPriority = { smartstore: 1, external: 2, brand: 3, shopping: 4, unknown: 5 };

  const isMusinsa = (m) => {
    const u = (m || '').toUpperCase();
    return u.includes('무신사') || u.includes('MUSINSA');
  };

  final.sort((a, b) => {
    // 0순위: 이미지 URL 있는 항목 우선 (없으면 화면에서 깨짐)
    const aHasImg = !!(a.image_url && a.image_url.startsWith('http'));
    const bHasImg = !!(b.image_url && b.image_url.startsWith('http'));
    if (aHasImg !== bHasImg) return aHasImg ? -1 : 1;
    // 1순위: 무신사 절대 우선 (사용자 요청 80%+ 노출)
    const aMs = isMusinsa(a.mall);
    const bMs = isMusinsa(b.mall);
    if (aMs !== bMs) return aMs ? -1 : 1;
    // 1.5순위: 검색어 정확도 — LLM 풀 키워드 결과 우선 (A1: 트렌디 키워드 보존)
    if (a._query_rank !== b._query_rank) return (a._query_rank ?? 9) - (b._query_rank ?? 9);
    // 2순위: 셀렉트샵 CDN 이미지 우선
    if (a._is_clean_cdn !== b._is_clean_cdn) return a._is_clean_cdn ? -1 : 1;
    // 3순위: 멀티컷/세트 상품 강력 후순위
    if (a._has_multi_keyword !== b._has_multi_keyword) return a._has_multi_keyword ? 1 : -1;
    // 4순위: 몰 티어 (낮을수록 누끼 비중 높음)
    if (a._mall_tier !== b._mall_tier) return a._mall_tier - b._mall_tier;
    // 5순위: 모델/착용샷 키워드 없는 거 우선
    if (a._has_model_keyword !== b._has_model_keyword) return a._has_model_keyword ? 1 : -1;
    // 6순위: 직링 종류
    const lp = (linkPriority[a._link_type] || 99) - (linkPriority[b._link_type] || 99);
    if (lp !== 0) return lp;
    // 7순위: 가격 낮은 순
    return (a.price_num || 0) - (b.price_num || 0);
  });

  // 이미지 URL 없는 항목은 화면에서 깨지므로 통째 제거
  const withImage = final.filter((item) => item.image_url && /^https?:\/\//.test(item.image_url));
  const trustedImage = withImage.filter((item) => item._is_clean_cdn || isTrustedFallbackImage(item.image_url));
  const ready = trustedImage.length >= 2 ? trustedImage : (withImage.length > 0 ? withImage : final);

  // 디버그 로그 — 슬롯별 검색어 + 단계별 통과 개수
  console.log(
    `[search] slot=${slot} q="${usedQuery}" naver=${rawCount} price=${priceCount} ` +
    `ext=${externalOnly.length} mall=${mallFiltered.length} cat=${categoryFiltered.length} ` +
    `gen=${genderFiltered.length} img=${withImage.length} trust=${trustedImage.length} → final=${ready.length}`
  );

  return ready.map(({ _link_type, _mall_tier, _has_model_keyword, _has_multi_keyword, _is_clean_cdn, _matches_slot, _looks_other_slot, _violates_gender, _query_rank, ...rest }) => rest);
}

// 폴백 신뢰 도메인 — 셀렉트샵 외에도 안정적으로 image 호스팅하는 CDN
function isTrustedFallbackImage(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [
      'shopping-phinf.pstatic.net',
      'pstatic.net',
      'akamaized.net',
      'cloudfront.net',
      'naver.net',
    ].some((d) => host.includes(d));
  } catch {
    return false;
  }
}

// 이미지 URL이 진짜 살아있는지 HEAD 검증 (timeout 2초)
async function isImageAlive(url) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// 결과의 상위 N개만 HEAD 검증, 죽은 URL은 image_url 비움
async function verifyTopImages(items, topN = 5) {
  const head = items.slice(0, topN);
  const verdicts = await Promise.all(head.map((it) => isImageAlive(it.image_url)));
  for (let i = 0; i < head.length; i++) {
    if (!verdicts[i]) head[i].image_url = '';
  }
  return [...head, ...items.slice(topN)].filter((it) => it.image_url);
}

function cleanProductUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    ['NaPm', 'frm', 'cat_id', 'ctxt', 'origQuery', 'searchAdSeq'].forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function classifyUrl(url) {
  if (!url) return 'unknown';
  if (url.includes('smartstore.naver.com')) return 'smartstore';
  if (url.includes('brand.naver.com')) return 'brand';
  if (url.includes('search.shopping.naver.com') || url.includes('cr.shopping.naver.com')) return 'shopping';
  if (!url.includes('naver.com')) return 'external';
  return 'unknown';
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
}
