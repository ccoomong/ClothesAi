// Vercel API Route — 자연어 표현 분석
// 호출 경로: /api/analyze-mood
// 목적: "개강해서 봄꽃 나들이 용 꾸안꾸" → 구조화된 속성 추출

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const { styleQuery, gender = '여성' } = req.body;
  if (!styleQuery) return res.status(400).json({ error: 'styleQuery 필수' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY 환경변수 필수' });

  try {
    // 1단계: 분석 모드 (gpt-4o-mini, 저렴)
    const analysisPrompt = `사용자의 패션 표현을 분석하고 구체적 속성을 추출하세요.

입력: "${styleQuery}"
성별: "${gender}"

분석 항목:
1. occasions: 상황·장소 배열 (예: ["캠퍼스", "야외"])
2. moods: 분위기 배열 (예: ["꾸안꾸", "내추럴", "프레시"])
3. season: 계절 (봄|여름|가을|겨울)
4. color_hints: 색상 톤 배열 (예: ["파스텔", "밝은톤"])
5. aesthetic: 한 문장 미적 설명

결과: JSON 형식으로만 반환`;

    const analysisResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: 400,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });

    if (!analysisResp.ok) {
      throw new Error(`OpenAI gpt-4o-mini 오류: ${analysisResp.status}`);
    }

    const analysisData = await analysisResp.json();
    const analysisText = analysisData.choices?.[0]?.message?.content || '{}';
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      analysis = {
        occasions: ['일상'],
        moods: ['캐주얼'],
        season: '봄',
        color_hints: ['중성톤'],
        aesthetic: '자연스러운 분위기',
      };
    }

    // 2단계: 검색 쿼리 생성 (gpt-4o, 더 정확)
    const gridPrompt = `사용자의 패션 분석 결과를 바탕으로 3개 outfit 각각의 슬롯별 검색 쿼리를 만들어라.

분석 결과:
- 상황: ${analysis.occasions?.join(', ') || '일상'}
- 무드: ${analysis.moods?.join(', ') || '캐주얼'}
- 계절: ${analysis.season || '봄'}
- 색상 톤: ${analysis.color_hints?.join(', ') || '중성톤'}
- 미적: ${analysis.aesthetic || '자연스러움'}

각 outfit마다 4개 슬롯(hat, top, bottom, shoes)의 (색상, 카테고리) 조합을 만들어라.
색상 다양성을 최우선으로.

JSON:
{
  "outfits": [
    {
      "title": "코디 1 이름",
      "items": [
        { "slot": "hat", "color": "크림색", "category": "캡" },
        { "slot": "top", "color": "밝은 옐로우", "category": "셔츠" },
        { "slot": "bottom", "color": "카키", "category": "슬랙스" },
        { "slot": "shoes", "color": "흰색", "category": "스니커즈" }
      ]
    },
    { "title": "...", "items": [...] },
    { "title": "...", "items": [...] }
  ]
}`;

    const gridResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: gridPrompt }],
        max_tokens: 1200,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
    });

    if (!gridResp.ok) {
      throw new Error(`OpenAI gpt-4o 오류: ${gridResp.status}`);
    }

    const gridData = await gridResp.json();
    const gridText = gridData.choices?.[0]?.message?.content || '{}';
    let grid;
    try {
      grid = JSON.parse(gridText);
    } catch {
      grid = {
        outfits: [
          {
            title: '기본 코디',
            items: [
              { slot: 'hat', color: '크림색', category: '캡' },
              { slot: 'top', color: '화이트', category: '셔츠' },
              { slot: 'bottom', color: '네이비', category: '슬랙스' },
              { slot: 'shoes', color: '흰색', category: '스니커즈' },
            ],
          },
        ],
      };
    }

    return res.status(200).json({
      ok: true,
      analysis,
      grid,
      usage: {
        analysis_cost: 'gpt-4o-mini',
        grid_cost: 'gpt-4o',
      },
    });
  } catch (e) {
    console.error('[analyze-mood] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
