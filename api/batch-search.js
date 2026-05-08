// Vercel API Route — 네이버 쇼핑 배치 검색
// 호출 경로: /api/batch-search

const PRICE_FLOOR = {
  hat: 8000, top: 12000, bottom: 15000, shoes: 25000, default: 10000,
};

// 누끼 사진 비중에 따라 몰을 티어로 분류 — 낮은 티어가 우선 노출됨
// 티어 1 — 누끼/단독 컷 비중 매우 높음 (전문 셀렉트샵)
const TIER1_MALLS = [
  '무신사', 'MUSINSA',
  '29CM', '29cm',
  'W컨셉', 'WCONCEPT', 'wconcept',
  'EQL',
  'OCO',
  '하이버',
];

// 티어 2 — 누끼 비중 중간 (커뮤니티/큐레이션)
const TIER2_MALLS = [
  '스타일쉐어',
  'LOOKPIN', '룩핀',
];

// 티어 3 — 모델샷/생활샷 비중 큼 (여성 패션앱)
const TIER3_MALLS = [
  'ABLY', '에이블리',
  'ZIGZAG', '지그재그',
  'BRANDI', '브랜디',
];

function getMallTier(mallName) {
  if (!mallName) return 99;
  const upper = mallName.toUpperCase();
  if (TIER1_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 1;
  if (TIER2_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 2;
  if (TIER3_MALLS.some((m) => upper.includes(m.toUpperCase()))) return 3;
  return 4; // 그 외 (스마트스토어 등)
}

// 모델샷·멀티컷·세트 시그널 — 누끼 단독컷이 아닐 가능성 높음
const MODEL_SHOT_KEYWORDS = /모델|착용샷|코디|룩북|화보|기획전|model|outfit/i;
const MULTI_PRODUCT_KEYWORDS = /세트|묶음|콤보|패키지|풀세트|풀구성|컬러구성|컬러별|2종|3종|4종|5종|set|combo|pack|bundle|multipack/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const { queries } = req.body;
  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: 'queries 배열이 필요합니다' });
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const slotType = (q.slot || '').split('-').pop() || 'default';
        const items = await searchNaver(q.keyword, 20, q.sort || 'sim', slotType);
        return { slot: q.slot, keyword: q.keyword, items: items.slice(0, q.display || 5) };
      } catch (e) {
        return { slot: q.slot, keyword: q.keyword, items: [], error: e.message };
      }
    })
  );

  return res.status(200).json({ ok: true, results });
}

async function searchNaver(query, display, sort, slot = 'default') {
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

  const data = await response.json();

  let items = (data.items || []).map((item) => {
    const cleanUrl = cleanProductUrl(item.link);
    const linkType = classifyUrl(cleanUrl);
    const mall = item.mallName || '';
    const cleanName = stripHtml(item.title);
    const mallTier = getMallTier(mall);
    const hasModelKeyword = MODEL_SHOT_KEYWORDS.test(cleanName);
    const hasMultiProductKeyword = MULTI_PRODUCT_KEYWORDS.test(cleanName);

    return {
      name: cleanName,
      image_url: item.image,
      product_url: cleanUrl,
      price: item.lprice ? `${Number(item.lprice).toLocaleString()}원` : null,
      price_num: Number(item.lprice) || 0,
      mall: mall || null,
      brand: item.brand || null,
      category: [item.category1, item.category2, item.category3, item.category4].filter(Boolean).join(' > '),
      is_direct_product: true,
      _link_type: linkType,
      _mall_tier: mallTier,
      _has_model_keyword: hasModelKeyword,
      _has_multi_keyword: hasMultiProductKeyword,
    };
  });

  const floor = PRICE_FLOOR[slot] || PRICE_FLOOR.default;
  const filtered = items.filter((item) => item.price_num >= floor);
  const final = filtered.length >= 3 ? filtered : items;

  const linkPriority = { smartstore: 1, external: 2, brand: 3, shopping: 4, unknown: 5 };

  final.sort((a, b) => {
    // 0순위: 이미지 URL 있는 항목 우선 (없으면 화면에서 깨짐)
    const aHasImg = !!(a.image_url && a.image_url.startsWith('http'));
    const bHasImg = !!(b.image_url && b.image_url.startsWith('http'));
    if (aHasImg !== bHasImg) return aHasImg ? -1 : 1;
    // 1순위: 멀티컷/세트 상품 강력 후순위 (모델 3명 카탈로그 컷 방지)
    if (a._has_multi_keyword !== b._has_multi_keyword) return a._has_multi_keyword ? 1 : -1;
    // 2순위: 몰 티어 (낮을수록 누끼 비중 높음)
    if (a._mall_tier !== b._mall_tier) return a._mall_tier - b._mall_tier;
    // 3순위: 모델/착용샷 키워드 없는 거 우선
    if (a._has_model_keyword !== b._has_model_keyword) return a._has_model_keyword ? 1 : -1;
    // 4순위: 직링 종류
    const lp = (linkPriority[a._link_type] || 99) - (linkPriority[b._link_type] || 99);
    if (lp !== 0) return lp;
    // 5순위: 가격 낮은 순
    return (a.price_num || 0) - (b.price_num || 0);
  });

  return final.map(({ _link_type, _mall_tier, _has_model_keyword, _has_multi_keyword, ...rest }) => rest);
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