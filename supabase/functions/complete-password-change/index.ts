import { corsHeaders, getRequesterProfile, jsonResponse } from '../_shared/admin.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const { client, profile, authUser } = await getRequesterProfile(request);
    const { password } = await request.json();
    if (typeof password !== 'string' || password.length < 12 || password.length > 128 ||
      !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
      return jsonResponse({ error: 'Use 12-128 characters with uppercase, lowercase, a number and a symbol.' }, 400);
    }
    if (!profile.must_change_password) return jsonResponse({ error: 'No password change pending.' }, 400);
    const { error: passwordError } = await client.auth.admin.updateUserById(authUser.id, { password });
    if (passwordError) throw passwordError;
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
