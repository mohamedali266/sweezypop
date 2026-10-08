import { corsHeaders, generateTemporaryPassword, jsonResponse, requireAdmin } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { client, profile: adminProfile } = await requireAdmin(request);
    const body = await request.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const role = body.role === 'admin' ? 'admin' : 'owner';
    const restaurantName = String(body.restaurant || adminProfile.restaurant_name || '').trim();
    const active = body.active !== false;

    if (!name || !email) return jsonResponse({ error: 'Name and email are required.' }, 400);

    const temporaryPassword = generateTemporaryPassword();
    const { data: authData, error: authError } = await client.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });

    if (authError || !authData.user) throw authError || new Error('User was not created.');

    const profileRow = {
      id: crypto.randomUUID(),
      auth_user_id: authData.user.id,
      restaurant_id: adminProfile.restaurant_id,
      name,
      email,
      role,
      restaurant_name: restaurantName,
      active,
      must_change_password: true,
      temporary_password_issued_at: new Date().toISOString(),
      password_changed_at: null,
    };

    const { data: savedProfile, error: profileError } = await client.from('profiles').insert(profileRow).select('*').single();
    if (profileError) throw profileError;

    return jsonResponse({
      user: {
        id: savedProfile.id,
        authUserId: savedProfile.auth_user_id,
        name: savedProfile.name,
        email: savedProfile.email,
        role: savedProfile.role,
        restaurant: savedProfile.restaurant_name || '',
        active: Boolean(savedProfile.active),
        mustChangePassword: Boolean(savedProfile.must_change_password),
      },
      temporaryPassword,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
