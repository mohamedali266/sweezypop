import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!@#$%*?';
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const base = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  const firstSymbol = symbols[bytes[0] % symbols.length];
  const secondSymbol = symbols[bytes[1] % symbols.length];
  return `${base.slice(0, 6)}${firstSymbol}${base.slice(6, 12)}${secondSymbol}${base.slice(12)}`;
}

export function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getRequesterProfile(request: Request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Missing authorization token.');

  const client = getServiceClient();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new Error('Invalid authorization token.');

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('auth_user_id', userData.user.id)
    .eq('active', true)
    .single();

  if (profileError || !profile) throw new Error('Active profile not found.');
  return { client, authUser: userData.user, profile };
}

export async function requireAdmin(request: Request) {
  const context = await getRequesterProfile(request);
  if (context.profile.role !== 'admin') throw new Error('Admin role required.');
  return context;
}
