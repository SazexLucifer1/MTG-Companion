/**
 * Reiner Server-Proxy für Scryfall-Kartenbilder - nötig für den PDF-Export (deck-pdf.service.ts):
 * Scryfalls Bilder-CDN (cards.scryfall.io) schickt keine CORS-Header, ein direktes fetch() aus dem
 * Browser zum Einbetten der Bild-Bytes ins PDF würde also blockiert. Läuft als Cloudflare Pages
 * Function (server-zu-server, kein CORS-Problem) und reicht nur echte Scryfall-Bild-URLs durch, um
 * nicht zum offenen Proxy für beliebige URLs zu werden.
 */
export const onRequestGet = async (context: { request: Request }): Promise<Response> => {
  const target = new URL(context.request.url).searchParams.get('url');
  if (!target) {
    return new Response('Fehlender "url"-Parameter', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Ungültige URL', { status: 400 });
  }

  if (parsed.hostname !== 'cards.scryfall.io') {
    return new Response('Nur Scryfall-Kartenbilder erlaubt', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return new Response(`Bild nicht erreichbar: ${detail}`, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('Bild nicht gefunden', { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
