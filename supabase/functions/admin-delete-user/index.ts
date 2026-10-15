import { corsHeaders, jsonResponse, requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  try {
    const { client, authUser, profile: admin } = await requireAdmin(request);
    const body = await request.json();
    const profileId = String(body.profileId || '');
    const { data: target, error } = await client.from('profiles').select('id,auth_user_id,restaurant_id').eq('id', profileId).single();
    if (error || !target || target.restaurant_id !== admin.restaurant_id) throw new Error('User not found.');
    if (target.auth_user_id === authUser.id) throw new Error('You cannot delete your own account.');
    if (!target.auth_user_id) {
      const { error: deleteProfileError } = await client.from('profiles').delete().eq('id', target.id);
      if (deleteProfileError) throw deleteProfileError;
    } else {
      const { error: deleteAuthError } = await client.auth.admin.deleteUser(target.auth_user_id);
      if (deleteAuthError) throw deleteAuthError;
    }
    return jsonResponse({ ok: true, profileId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
