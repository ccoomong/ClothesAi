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

  const groqPayload = {
    model: 'llama-3.3-70b-versatile',
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    max_tokens,
    temperature: 0.7,
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

    return res.status(200).json({
      id: `groq-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: 'llama-3.3-70b-versatile',
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