// Vercel API Route — Naver DataLab 쇼핑인사이트로 패션 트렌드 시그널 산출
// 호출 경로: /api/trends
//
// 동작: 후보 5개 키워드를 DataLab에 던져 최근 8주 검색량 추이를 받고,
//   - 최근 2주 평균 → "hot" (지금 절대적으로 많이 검색되는 것)
//   - 최근 2주 / 직전 6주 비율 → "rising" (지금 빠르게 뜨는 것)
//
// 주의: 이 엔드포인트가 동작하려면 Naver 개발자 콘솔에서 같은 앱에
// "데이터랩(쇼핑인사이트)" API가 활성화되어 있어야 함.
// (쇼핑검색만 켜져있고 DataLab은 꺼진 상태면 401/403 떨어짐 → 그땐 manual 트렌드만 사용)

const FASHION_CID = '50000000'; // 네이버 쇼핑 패션의류 카테고리
const CANDIDATES = ['발레코어', '올드머니', '워크웨어', 'Y2K', '미니멀'];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // CDN 6시간 캐시, 24시간 stale-while-revalidate — DataLab 호출 부담 최소화
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(200).json({
      error: 'NAVER_CLIENT 환경변수 미설정',
      hot: [], rising: [], detail: [],
    });
  }

  const body = {
    startDate: daysAgo(56),
    endDate: daysAgo(1),
    timeUnit: 'week',
    category: FASHION_CID,
    keyword: CANDIDATES.map((k) => ({ name: k, param: [k] })),
  };

  try {
    const response = await fetch('https://openapi.naver.com/v1/datalab/shopping/category/keywords', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      // DataLab 활성화 안 됐거나 한도 초과 — 빈 결과로 graceful fallback
      return res.status(200).json({
        error: `DataLab 오류 (${response.status})`,
        detail_error: errText.slice(0, 200),
        hot: [], rising: [], detail: [],
      });
    }

    const data = await response.json();
    const scored = (data.results || []).map((r) => {
      const points = r.data || [];
      if (points.length === 0) return { name: r.title, recent: 0, prior: 0, growth: 0 };
      // 마지막 2개 구간 = 최근, 앞쪽 = 직전. 데이터 짧으면 모두 recent로.
      const splitAt = Math.max(1, points.length - 2);
      const recentPts = points.slice(splitAt);
      const priorPts = points.slice(0, splitAt);
      const avg = (arr) => (arr.length ? arr.reduce((s, p) => s + (p.ratio || 0), 0) / arr.length : 0);
      const recent = avg(recentPts);
      const prior = avg(priorPts);
      const growth = prior > 0 ? recent / prior : (recent > 0 ? 2 : 1);
      return { name: r.title, recent, prior, growth };
    });

    const hot = [...scored].sort((a, b) => b.recent - a.recent).slice(0, 3).map((s) => s.name);
    const rising = [...scored].sort((a, b) => b.growth - a.growth).slice(0, 2).map((s) => s.name);

    return res.status(200).json({
      asOf: body.endDate,
      hot,
      rising,
      detail: scored,
    });
  } catch (e) {
    return res.status(200).json({
      error: e.message,
      hot: [], rising: [], detail: [],
    });
  }
}
