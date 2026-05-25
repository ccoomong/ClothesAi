// Vercel API Route — Groq AI 프록시
// 호출 경로: /api/ai

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 허용됩니다' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY 환경변수 미설정' });
  }

  const { messages, max_tokens = 2500 } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다' });
  }

  // 무료 tier에서 70b는 TPM 한도가 좁아 429 빈발 → 8b instant로 다운그레이드 (안정성 우선)
  // 결선 단계에서 paid tier 또는 다른 백본(Cerebras Llama 70B 등)으로 업그레이드 검토
  // 무료 tier에서 70b는 TPM 한도가 좁아 429 빈발 → 8b instant로 다운그레이드 (안정성 우선)
  // JSON mode 활성화 — 8b가 가끔 깨진 JSON 뱉는 문제 차단
  const groqPayload = {
    model: 'llama-3.1-8b-instant',
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    max_tokens,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqPayload),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: `Groq API 오류 (${response.status})`,
        detail: data,
      });
    }

    const groqText = data.choices?.[0]?.message?.content || '';

    // 디버그 로그 — outfits 개수 + 각 슬롯 검색어 (Vercel Functions Logs에서 확인)
    try {
      const parsed = JSON.parse(groqText);
      const outfits = parsed.outfits || [];
      const summary = outfits.map((o, i) => {
        const kws = ['hat', 'top', 'bottom', 'shoes']
          .map((s) => `${s}="${o.items?.[s]?.search_keyword || '?'}"`)
          .join(' ');
        return `  [${i}] title="${o.title || ''}" ${kws}`;
      }).join('\n');
      console.log(`[AI] mood="${parsed.mood_label || '?'}" outfits=${outfits.length}\n${summary}`);
    } catch {
      console.log('[AI] JSON parse failed. Raw response (first 400):', groqText.slice(0, 400));
    }

    return res.status(200).json({
      id: `groq-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: 'llama-3.1-8b-instant',
      content: [{ type: 'text', text: groqText }],
      stop_reason: data.choices?.[0]?.finish_reason || 'end_turn',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}