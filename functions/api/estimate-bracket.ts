/**
 * Reiner Server-Proxy zu Commander Spellbooks Bracket-API (backend.commanderspellbook.com).
 * Nötig, weil deren Server nur Anfragen von commanderspellbook.com selbst per CORS erlaubt - ein
 * direkter Aufruf aus dem Browser der App würde von deren Server blockiert. Läuft als Cloudflare
 * Pages Function (server-zu-server, also kein CORS-Problem) und reicht Anfrage/Antwort 1:1 durch.
 */
export const onRequestPost = async (context: { request: Request }): Promise<Response> => {
  const body = await context.request.text();

  let upstream: Response;
  try {
    upstream = await fetch('https://backend.commanderspellbook.com/estimate-bracket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'Commander Spellbook nicht erreichbar', detail }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
