// Vercel API Route — AI 프록시 (OpenAI 우선, Groq 폴백)
// 호출 경로: /api/ai

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용됩니다' });

  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!openaiKey && !groqKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY 또는 GROQ_API_KEY 환경변수가 필요합니다' });
  }

  const { messages, max_tokens = 2500 } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다' });
  }

  const normMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  // 프로바이더 우선순위: Groq(무료·llama-3.3-70b, 똑똑함) 우선 → 실패 시 OpenAI 폴백.
  // OpenAI 한도/장애가 나도 추천이 죽지 않게 자동 우회.
  const providers = [];
  if (groqKey) {
    providers.push({ name: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: groqKey, model: 'llama-3.3-70b-versatile' });
  }
  if (openaiKey) {
    providers.push({ name: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: openaiKey, model: 'gpt-4o-mini' });
  }

  const callProvider = async (p) => {
    const response = await fetch(p.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model,
        messages: normMessages,
        max_tokens,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  };

  let last = null;
  for (const p of providers) {
    try {
      const r = await callProvider(p);
      if (!r.ok) {
        console.warn(`[AI] ${p.name} 실패 ${r.status} → 다음 프로바이더 시도`);
        last = { p, ...r };
        continue;
      }
      const text = r.data.choices?.[0]?.message?.content || '';
      try {
        const parsed = JSON.parse(text);
        const outfits = parsed.outfits || [];
        const summary = outfits.map((o, i) => {
          const kws = ['hat', 'top', 'bottom', 'shoes'].map((s) => `${s}="${o.items?.[s]?.search_keyword || '?'}"`).join(' ');
          return `  [${i}] title="${o.title || ''}" ${kws}`;
        }).join('\n');
        console.log(`[AI:${p.name}/${p.model}] mood="${parsed.mood_label || '?'}" outfits=${outfits.length}\n${summary}`);
      } catch {
        console.log(`[AI:${p.name}] JSON parse failed. Raw (first 400):`, text.slice(0, 400));
      }
      return res.status(200).json({
        id: `${p.name}-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: p.model,
        content: [{ type: 'text', text }],
        stop_reason: r.data.choices?.[0]?.finish_reason || 'end_turn',
        usage: {
          input_tokens: r.data.usage?.prompt_tokens || 0,
          output_tokens: r.data.usage?.completion_tokens || 0,
        },
      });
    } catch (e) {
      console.warn(`[AI] ${p.name} 예외: ${e.message} → 다음 프로바이더 시도`);
      last = { p, ok: false, status: 500, data: { error: e.message } };
    }
  }

  return res.status(last?.status || 500).json({
    error: `모든 AI 프로바이더 실패 (마지막: ${last?.p?.name || '없음'})`,
    detail: last?.data,
  });
}
