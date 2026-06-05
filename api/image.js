// Vercel API Route — OpenAI 이미지 생성 프록시
// 호출 경로: /api/image

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY 환경변수 필요' });
  }

  try {
    const { prompt, size = '1024x1024', quality = 'medium' } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt 필수' });

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size,
        quality,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[image] OpenAI 오류:', data);
      return res.status(response.status).json({
        error: `OpenAI 이미지 오류 (${response.status})`,
        detail: data,
      });
    }

    // gpt-image-1은 base64로 응답
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(500).json({ error: '이미지 데이터 누락', detail: data });
    }

    return res.status(200).json({
      ok: true,
      image_b64: b64,
      data_url: `data:image/png;base64,${b64}`,
    });
  } catch (e) {
    console.error('[image] handler 에러:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
