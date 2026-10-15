import type { AppUser, Category, MenuItem, MenuLayout, OpeningHour, Order, SocialLink, ThemeSettings } from './types';
import { isSupabaseConfigured, supabase } from './supabase';

export interface RemoteState {
  categories: Category[];
  items: MenuItem[];
  orders: Order[];
  users: AppUser[];
  theme: ThemeSettings;
  hours: OpeningHour[];
  layout: MenuLayout;
}

const restaurantSlug = import.meta.env.VITE_RESTAURANT_SLUG || 'sweezypop';

type DbRestaurant = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_text: string | null;
  menu_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  lavender_color: string | null;
  background_color: string | null;
  surface_color: string | null;
  text_color: string | null;
  muted_text_color: string | null;
  button_text_color: string | null;
  card_color: string | null;
  border_color: string | null;
  menu_layout?: string | null;
  social_links?: unknown | null;
  phone_country_code?: string | null;
  phone_number?: string | null;
};

function appId(prefix: string, id: string) {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}`;
}

const offerMetaPrefix = '__offer_meta__:';

function readOfferDescription(descriptionDe: string | null) {
  const value = descriptionDe || '';
  const [description, meta] = value.split(offerMetaPrefix);
  if (!meta) return { descriptionDe: value, includedItemIds: [] };

  try {
    const parsed = JSON.parse(meta.trim()) as { includedItemIds?: string[] };
    return {
      descriptionDe: description.trim(),
      includedItemIds: Array.isArray(parsed.includedItemIds) ? parsed.includedItemIds : [],
    };
  } catch {
    return { descriptionDe: description.trim(), includedItemIds: [] };
  }
}

function normalizeSocialLinks(value: unknown, fallback: SocialLink[]) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((link): SocialLink | null => {
      if (!link || typeof link !== 'object') return null;
      const candidate = link as Partial<SocialLink>;
      const normalized: SocialLink = {
        id: String(candidate.id || `social-${Date.now()}`),
        label: String(candidate.label || ''),
        url: String(candidate.url || ''),
        active: Boolean(candidate.active),
      };
      if (typeof candidate.platform === 'string') normalized.platform = candidate.platform;
      return normalized;
    })
    .filter((link): link is SocialLink => Boolean(link && link.label));
}

function restaurantToTheme(restaurant: DbRestaurant, fallback: ThemeSettings): ThemeSettings {
  return {
    ...fallback,
    siteName: restaurant.name || fallback.siteName,
    logoText: restaurant.logo_text || restaurant.name || fallback.logoText,
    logoUrl: restaurant.logo_url || '',
    menuUrl: restaurant.menu_url || fallback.menuUrl,
    primary: restaurant.primary_color || fallback.primary,
    accent: restaurant.accent_color || fallback.accent,
    lavender: restaurant.lavender_color || fallback.lavender,
    background: restaurant.background_color || fallback.background,
    surface: restaurant.surface_color || fallback.surface,
    text: restaurant.text_color || fallback.text,
    mutedText: restaurant.muted_text_color || fallback.mutedText,
    buttonText: restaurant.button_text_color || fallback.buttonText,
    card: restaurant.card_color || fallback.card,
    border: restaurant.border_color || fallback.border,
    socialLinks: normalizeSocialLinks(restaurant.social_links, fallback.socialLinks || []),
    phoneCountryCode: restaurant.phone_country_code || fallback.phoneCountryCode || '+49',
    phoneNumber: restaurant.phone_number || fallback.phoneNumber || '',
  };
}

function restaurantToLayout(restaurant: DbRestaurant, fallback: MenuLayout): MenuLayout {
  return restaurant.menu_layout === 'list' || restaurant.menu_layout === 'grid' ? restaurant.menu_layout : fallback;
}

async function getRestaurant() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('restaurants').select('*').eq('public_slug', restaurantSlug).single();
  if (error) throw error;
  return data as DbRestaurant;
}

function restaurantSettingsPayload(theme: ThemeSettings) {
  return {
    name: theme.siteName,
    logo_text: theme.logoText,
    logo_url: theme.logoUrl || null,
    menu_url: theme.menuUrl,
    primary_color: theme.primary,
    accent_color: theme.accent,
    lavender_color: theme.lavender,
    background_color: theme.background,
    surface_color: theme.surface,
    text_color: theme.text,
    muted_text_color: theme.mutedText,
    button_text_color: theme.buttonText,
    card_color: theme.card,
    border_color: theme.border,
  };
}

async function saveOptionalRestaurantSettings(restaurantId: string, theme: ThemeSettings, layout: MenuLayout) {
  if (!supabase) return;
  const { error } = await supabase
    .from('restaurants')
    .update({
      menu_layout: layout,
      social_links: theme.socialLinks || [],
      phone_country_code: theme.phoneCountryCode || null,
      phone_number: theme.phoneNumber || null,
    })
    .eq('id', restaurantId);

  if (error) {
    throw error;
  }
}

export async function saveRemoteSiteSettings(theme: ThemeSettings, layout: MenuLayout) {
  if (!isSupabaseConfigured || !supabase) return;
  const restaurant = await getRestaurant();
  const restaurantId = restaurant.id;

  const { error } = await supabase.from('restaurants').update(restaurantSettingsPayload(theme)).eq('id', restaurantId);
  if (error) throw error;
  await saveOptionalRestaurantSettings(restaurantId, theme, layout);
}

export async function loadRemoteState(fallback: RemoteState): Promise<RemoteState | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const restaurant = await getRestaurant();
  const restaurantId = restaurant.id;

  const [categoriesResult, itemsResult, hoursResult] = await Promise.all([
    supabase.from('categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
    supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
    supabase.from('opening_hours').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (hoursResult.error) throw hoursResult.error;

  const categories: Category[] = (categoriesResult.data || []).map((category) => ({
    id: category.id,
    name: { en: category.name_en, de: category.name_de },
    sortOrder: category.sort_order || 0,
  }));

  const items: MenuItem[] = (itemsResult.data || []).map((item) => {
    const offerDescription = readOfferDescription(item.description_de);
    return {
      id: item.id,
      categoryId: item.category_id,
      name: { en: item.name_en, de: item.name_de },
      description: { en: item.description_en || '', de: offerDescription.descriptionDe },
      price: Number(item.price || 0),
      badge: item.badge_en || item.badge_de ? { en: item.badge_en || '', de: item.badge_de || item.badge_en || '' } : undefined,
      imageStyle: item.image_style || 'pink',
      imageUrl: item.image_url || '',
      available: Boolean(item.available),
      sortOrder: item.sort_order || 0,
      includedItemIds: item.included_item_ids ?? offerDescription.includedItemIds,
    };
  });

  const privateState = await loadPrivateRemoteState(restaurantId);

  return {
    categories,
    items,
    hours: (hoursResult.data || []).length
      ? (hoursResult.data || []).map((hour) => ({
          day: hour.day,
          open: hour.open_time,
          close: hour.close_time,
          enabled: Boolean(hour.enabled),
        }))
      : fallback.hours,
    orders: privateState.orders,
    users: privateState.users,
    theme: restaurantToTheme(restaurant, fallback.theme),
    layout: restaurantToLayout(restaurant, fallback.layout),
  };
}

async function loadPrivateRemoteState(restaurantId: string) {
  if (!supabase) return { orders: [], users: [] };
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { orders: [], users: [] };
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role, active, must_change_password, restaurant_id')
    .eq('auth_user_id', session.session.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.active || profile.must_change_password || profile.restaurant_id !== restaurantId) return { orders: [], users: [] };

  const [ordersResult, usersResult] = await Promise.all([
    supabase.from('orders').select('id,order_number,source,customer_name,notes,total,status,created_at,order_lines(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(500),
    profile.role === 'admin' ? supabase.from('profiles').select('*').eq('restaurant_id', restaurantId).order('created_at') : Promise.resolve({ data: [], error: null }),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (usersResult.error) throw usersResult.error;
  const orders: Order[] = (ordersResult.data || []).map((order) => ({
        id: order.id,
        orderNumber: String(order.order_number ?? order.id),
        source: order.source,
        customerName: order.customer_name,
        notes: order.notes || '',
        total: Number(order.total || 0),
        status: order.status,
        createdAt: order.created_at || '',
        lines: (order.order_lines || []).map((line: { menu_item_id: string; quantity: number; unit_price: number; name_en?: string; name_de?: string }) => ({
          item:
            ({
              id: line.menu_item_id,
              categoryId: 'deleted',
              name: { en: line.name_en || 'Historical item', de: line.name_de || 'Archivierter Artikel' },
              description: { en: '', de: '' },
              price: Number(line.unit_price || 0),
              imageStyle: 'pink',
              available: false,
              sortOrder: 0,
            } satisfies MenuItem),
          quantity: line.quantity,
        })),
      }));

  const users: AppUser[] = (usersResult.data || []).map((user) => ({
        id: user.id,
        authUserId: user.auth_user_id || undefined,
        name: user.name,
        email: user.email,
        role: user.role,
        restaurant: user.restaurant_name || '',
        active: Boolean(user.active),
        mustChangePassword: Boolean(user.must_change_password),
      }));

  return { orders, users };
}

type Row = Record<string, unknown> & { id: string };
function catalogRows(state: RemoteState, restaurantId: string): Record<string, Row[]> {
  return {
    categories: state.categories.map(c => ({ id:c.id, restaurant_id:restaurantId, name_en:c.name.en, name_de:c.name.de, sort_order:c.sortOrder })),
    menu_items: state.items.map(i => ({ id:i.id, restaurant_id:restaurantId, category_id:i.categoryId, name_en:i.name.en, name_de:i.name.de,
      description_en:i.description.en, description_de:i.description.de, price:i.price, badge_en:i.badge?.en || null, badge_de:i.badge?.de || null,
      image_style:i.imageStyle, image_url:i.imageUrl || null, available:i.available, sort_order:i.sortOrder, included_item_ids:i.includedItemIds || [] })),
    opening_hours: state.hours.map((h,index) => ({ id:appId('hour',h.day), restaurant_id:restaurantId, day:h.day, open_time:h.open, close_time:h.close, enabled:h.enabled, sort_order:index+1 })),
  };
}

export async function saveRemoteState(state: RemoteState, previous: RemoteState) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const restaurant = await getRestaurant();
  const next = catalogRows(state, restaurant.id);
  const before = catalogRows(previous, restaurant.id);
  const changes: { table: string; id: string; before: Row | null; after: Row | null }[] = [];
  // Only changed entities are sent; absent rows elsewhere in the database are never deleted.
  for (const table of ['categories','menu_items','opening_hours']) {
    const previousRows = new Map(before[table].map(row => [row.id, row]));
    for (const row of next[table]) {
      const old = previousRows.get(row.id) || null;
      if (JSON.stringify(old) !== JSON.stringify(row)) changes.push({ table, id:row.id, before:old, after:row });
      previousRows.delete(row.id);
    }
    for (const row of previousRows.values()) changes.push({ table,id:row.id,before:row,after:null });
  }
  if (!changes.length) return;
  const { error } = await supabase.rpc('save_catalog_changes', { p_restaurant:restaurant.id, p_changes:changes });
  if (error) throw error;
}

export interface OrderInput {
  name: string;
  notes: string;
  lines: { item: MenuItem; quantity: number }[];
  requestKey: string;
  source?: 'menu' | 'pos';
}

export async function createRemoteOrder(input: OrderInput): Promise<Order> {
  if (!supabase) throw new Error('Bestellungen sind derzeit nicht verfuegbar.');
  const { data, error } = await supabase.rpc('place_order', {
    p_slug:restaurantSlug, p_request_key:input.requestKey, p_name:input.name.trim(), p_notes:input.notes.trim(),
    p_lines:input.lines.map(line => ({ id:line.item.id, quantity:line.quantity })), p_source:input.source || 'menu',
  });
  if (error) throw error;
  if (!data?.id || !data?.created_at) throw new Error('Keine Bestaetigung vom Server. Bitte erneut versuchen.');
  return { id:data.id, orderNumber:String(data.order_number), total:Number(data.total), createdAt:data.created_at,
    source:input.source || 'menu', customerName:input.name.trim(), notes:input.notes.trim(),
    status:'new', lines:(data.lines as { id:string; name_en:string; name_de:string; price:number; quantity:number }[]).map(line => ({
      quantity:line.quantity, item:{ id:line.id, name:{en:line.name_en,de:line.name_de}, price:Number(line.price),
        categoryId:'snapshot',description:{en:'',de:''},available:false,sortOrder:0,imageStyle:'' },
    })) };
}

export async function updateRemoteOrderStatus(order: Order, status: Order['status']) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('set_order_status', { p_id:order.id, p_expected:order.status, p_status:status });
  if (error) throw error;
}

export async function saveRemoteUsers(users: AppUser[], previous: AppUser[]) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const fields = (u: AppUser) => ({ name:u.name,role:u.role,active:u.active,restaurant_name:u.restaurant });
  const changes = previous.flatMap(old => {
    const next = users.find(u => u.id===old.id);
    if (!next) return [];
    const before = fields(old);
    const after = fields(next);
    return JSON.stringify(before)===JSON.stringify(after) ? [] : [{ id:old.id,before,after }];
  });
  if (!changes.length) return;
  const restaurant = await getRestaurant();
  const { error } = await supabase.rpc('save_profile_changes', { p_restaurant:restaurant.id,p_changes:changes });
  if (error) throw error;
}

export interface AdminUserPayload {
  name: string;
  email: string;
  role: AppUser['role'];
  restaurant: string;
  active: boolean;
}

export async function createAdminUser(payload: AdminUserPayload) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });
  if (error) throw error;
  if (!data?.user || !data?.temporaryPassword) throw new Error('User function returned an invalid response.');
  return data as { user: AppUser; temporaryPassword: string };
}

export async function resetAdminUserPassword(profileId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('admin-reset-password', { body: { profileId } });
  if (error) throw error;
  if (!data?.temporaryPassword) throw new Error('Reset function returned an invalid response.');
  return data as { profileId: string; temporaryPassword: string };
}

export async function deleteAdminUser(profileId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('admin-delete-user', { body: { profileId } });
  if (error) throw error;
  if (!data?.ok) throw new Error('User deletion was not confirmed.');
}

export async function completeTemporaryPasswordChange(password: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.functions.invoke('complete-password-change', { body: { password } });
  if (error) throw error;
}
