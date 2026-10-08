import { corsHeaders, getRequesterProfile, jsonResponse } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { client, profile } = await getRequesterProfile(request);
    const { error } = await client
      .from('profiles')
      .update({
        must_change_password: false,
        temporary_password_issued_at: null,
        password_changed_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    if (error) throw error;
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
