// API del diario: legge e salva tutti i dati in Cloudflare KV.
// Protetta da una password impostata come variabile d'ambiente APP_PASSWORD.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env }) {
  if (!env.APP_PASSWORD) return json({ error: 'APP_PASSWORD non impostata su Cloudflare' }, 500);
  if (!env.DIARIO) return json({ error: 'KV "DIARIO" non collegato su Cloudflare' }, 500);

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameString(token, env.APP_PASSWORD)) return json({ error: 'Password errata' }, 401);

  if (request.method === 'GET') {
    const data = await env.DIARIO.get('data', 'json');
    return json(data);
  }

  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'JSON non valido' }, 400); }
    if (!body || typeof body !== 'object' || !body.version) return json({ error: 'Dati non validi' }, 400);

    // Non sovrascrivere dati più recenti salvati da un altro dispositivo
    const current = await env.DIARIO.get('data', 'json');
    if (current && current.updatedAt > body.updatedAt) return json({ conflict: true, data: current }, 409);

    await env.DIARIO.put('data', JSON.stringify(body));
    return json({ ok: true, updatedAt: body.updatedAt });
  }

  return json({ error: 'Metodo non consentito' }, 405);
}
