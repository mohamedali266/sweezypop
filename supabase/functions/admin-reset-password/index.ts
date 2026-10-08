import { corsHeaders, generateTemporaryPassword, jsonResponse, requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { client, profile: adminProfile } = await requireAdmin(request);
    const body = await request.json();
    const profileId = String(body.profileId || '').trim();
    if (!profileId) return jsonResponse({ error: 'profileId is required.' }, 400);

    const { data: targetProfile, error: targetError } = await client
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .eq('restaurant_id', adminProfile.restaurant_id)
      .single();

    if (targetError || !targetProfile?.auth_user_id) throw targetError || new Error('Target profile not found.');

    const temporaryPassword = generateTemporaryPassword();
    const { error: updateUserError } = await client.auth.admin.updateUserById(targetProfile.auth_user_id, {
      password: temporaryPassword,
      user_metadata: { must_change_password: true },
    });
    if (updateUserError) throw updateUserError;

    const { error: profileError } = await client
      .from('profiles')
      .update({
        must_change_password: true,
        temporary_password_issued_at: new Date().toISOString(),
        password_changed_at: null,
      })
      .eq('id', profileId);

    if (profileError) throw profileError;

    return jsonResponse({ profileId, temporaryPassword });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
