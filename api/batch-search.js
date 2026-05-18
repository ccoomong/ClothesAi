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

function matchesSlotCategory(category, slot) {
  if (!category || slot === 'default') return true;
  const allowed = SLOT_CATEGORIES[slot];
  if (!allowed) return true;
  const lower = category.toLowerCase();
  return allowed.some((kw) => lower.includes(kw.toLowerCase()));
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

  const { queries, gender } = req.body;
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: 'queries 배열이 필요합니다' });
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const slotType = (q.slot || '').split('-').pop() || 'default';
        const items = await searchNaver(q.keyword, 20, q.sort || 'sim', slotType, gender);
        const ranked = await rankByVisionClassification(items, slotType);
        // HEAD 검증은 제거 — frontend의 5단 cascade fallback이 죽은 URL 처리
        return { slot: q.slot, keyword: q.keyword, items: ranked.slice(0, q.display || 5) };
      } catch (e) {
        return { slot: q.slot, keyword: q.keyword, items: [], error: e.message };
      }
    })
  );

  return res.status(200).json({ ok: true, results });
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
  if (!Array.isArray(items) || items.length <= 1) return items;
  // 슬롯당 상위 2장만 분류 (분당 한도 안전: 12 슬롯 × 2 = 24회 < 30회)
  const head = items.slice(0, 2);

  const types = await Promise.all(
    head.map((it) =>
      it.image_url && /^https?:\/\//.test(it.image_url)
        ? classifySingleImageWithVision(it.image_url, slot)
        : Promise.resolve(null)
    )
  );

  // 모든 호출이 실패하면 원본 그대로 (텍스트 휴리스틱 정렬 유지)
  const validVerdicts = types.filter((t) => t !== null);
  if (validVerdicts.length === 0) {
    console.warn(`[Vision] all calls failed for slot ${slot} — falling back to text heuristics`);
    return items;
  }

  const scored = head.map((item, i) => {
    const type = types[i] || 'unknown';
    return { ...item, _vision_score: VISION_TYPE_SCORE[type] ?? 99, _vision_type: type };
  });
  scored.sort((a, b) => a._vision_score - b._vision_score);

  // 누끼 우선 통과 — clean/scene만 살리고 model/multi는 컷 (안전장치: 통과 결과 부족하면 정렬만)
  const cleanOrScene = scored.filter((item) => item._vision_type === 'clean' || item._vision_type === 'scene');
  const survivors = cleanOrScene.length >= 1 ? cleanOrScene : scored;
  const cleanedHead = survivors.map(({ _vision_score, _vision_type, ...rest }) => rest);
  return [...cleanedHead, ...items.slice(2)];
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

async function searchNaver(query, display, sort, slot = 'default', gender = null) {
  // 단계별 검색 폴백 — 0건이면 검색어 단순화해서 재시도
  let data = await callNaverApi(query, display, sort);
  let usedQuery = query;

  if (!data.items || data.items.length === 0) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length > 2) {
      const shorterQuery = tokens.slice(0, -1).join(' ');
      data = await callNaverApi(shorterQuery, display, sort);
      usedQuery = shorterQuery;
    }
  }

  if ((!data.items || data.items.length === 0) && SLOT_CATEGORIES[slot]) {
    const genderToken = gender || '';
    const slotToken = SLOT_CATEGORIES[slot][0];
    const fallbackQuery = `${genderToken} ${slotToken}`.trim();
    data = await callNaverApi(fallbackQuery, display, sort);
    usedQuery = fallbackQuery;
  }

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
      _link_type: linkType,
      _mall_tier: getMallTier(mall),
      _has_model_keyword: MODEL_SHOT_KEYWORDS.test(cleanName),
      _has_multi_keyword: MULTI_PRODUCT_KEYWORDS.test(cleanName),
      _is_clean_cdn: isCleanImageDomain(item.image),
      _matches_slot: matchesSlotCategory(category, slot),
      _violates_gender: violatesGender(haystack, gender),
    };
  });

  // 1차 필터 — 가격 하한
  const floor = PRICE_FLOOR[slot] || PRICE_FLOOR.default;
  let pool = items.filter((item) => item.price_num >= floor);
  if (pool.length < 3) pool = items; // 안전장치

  // 2차 필터 — 외부 직링만 통과 (naver.com 도메인 컷 → 사용자 요청: 쇼핑몰 페이지로만 이동)
  // 안전장치 제거: 네이버 redirect 페이지로 사용자가 가는 일은 절대 X
  const externalOnly = pool.filter((item) => item._link_type === 'external');

  // 3차 필터 — 사용자 요청: 무신사·29CM·지그재그 같은 셀렉트샵에서만
  // 1차: TIER1(전문 셀렉트샵) + TIER3(여성 패션앱) — 사용자가 명시한 몰들
  // 안전장치: TIER1~3까지 (TIER2 큐레이션몰까지 허용)
  // TIER4(일반 스마트스토어 셀러)는 어떤 경우에도 통과 X — 깨진 이미지·잡 상품의 주범
  let mallFiltered = externalOnly.filter((item) => item._mall_tier === 1 || item._mall_tier === 3);
  if (mallFiltered.length < 2) mallFiltered = externalOnly.filter((item) => item._mall_tier <= 3);

  // 4차 필터 — 슬롯 카테고리 매칭
  let categoryFiltered = mallFiltered.filter((item) => item._matches_slot);
  if (categoryFiltered.length < 2) categoryFiltered = mallFiltered; // 안전장치

  // 5차 필터 — 성별 위반 제거
  let genderFiltered = categoryFiltered.filter((item) => !item._violates_gender);
  if (genderFiltered.length < 2) genderFiltered = categoryFiltered; // 안전장치

  const final = genderFiltered;
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
  // 신뢰 가능한 셀렉트샵 CDN 이미지만 통과 (만료·404 가능성 ↓)
  const trustedImage = withImage.filter((item) => item._is_clean_cdn || isTrustedFallbackImage(item.image_url));
  const ready = trustedImage.length >= 2 ? trustedImage : (withImage.length > 0 ? withImage : final);

  return ready.map(({ _link_type, _mall_tier, _has_model_keyword, _has_multi_keyword, _is_clean_cdn, _matches_slot, _violates_gender, ...rest }) => rest);
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
