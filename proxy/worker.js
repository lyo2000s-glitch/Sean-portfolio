const ALLOWED_ORIGIN = 'https://lyo2000s-glitch.github.io';
const RATE_LIMIT = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost' || /^http:\/\/localhost:\d+$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const kvKey = `rate:${ip}`;

    let record = { count: 0, windowStart: now };
    const stored = await env.RATE_LIMIT_KV.get(kvKey, 'json');
    if (stored && (now - stored.windowStart) < WINDOW_MS) {
      record = stored;
    }

    if (record.count >= RATE_LIMIT) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again tomorrow.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...cors(origin) },
      });
    }

    record.count += 1;
    const ttl = Math.ceil((WINDOW_MS - (now - record.windowStart)) / 1000);
    await env.RATE_LIMIT_KV.put(kvKey, JSON.stringify(record), { expirationTtl: ttl });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors(origin) },
      });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.text();

    return new Response(data, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...cors(origin),
      },
    });
  },
};
