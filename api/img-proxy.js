// Vercel API Route — 이미지 프록시 (누끼용 CORS 우회)
// 호출 경로: /api/img-proxy?url=<네이버 이미지 URL>
// 클라이언트 누끼(@imgly)가 네이버 이미지를 같은 origin으로 가져오게 해줌.

export default async function handler(req, res) {
  const { url } = req.query;

  // SSRF 방지 — 네이버 쇼핑 CDN(pstatic)만 허용
  if (!url || !/^https?:\/\/[^/]*pstatic\.net\//.test(url)) {
    return res.status(400).json({ error: 'pstatic.net 이미지 URL만 허용됩니다' });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[img-proxy] error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}
