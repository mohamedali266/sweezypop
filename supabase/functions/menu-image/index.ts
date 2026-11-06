import { createClient } from 'npm:@supabase/supabase-js@2';

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;

function imageResponse(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return new Response('Not found', { status: 404 });

  const binary = atob(match[2]);
  if (binary.length > 5_242_880) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': match[1],
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

Deno.serve(async request => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const requestUrl = new URL(request.url);
  const slug = requestUrl.searchParams.get('slug') || '';
  const itemId = requestUrl.searchParams.get('item') || '';
  if (!idPattern.test(slug) || !idPattern.test(itemId)) return new Response('Not found', { status: 404 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return new Response('Unavailable', { status: 503 });

  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc('get_public_menu_image', {
    p_slug: slug,
    p_item_id: itemId,
  });
  if (error || typeof data !== 'string') return new Response('Not found', { status: 404 });
  if (request.method === 'HEAD') {
    const response = imageResponse(data);
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return imageResponse(data);
});
