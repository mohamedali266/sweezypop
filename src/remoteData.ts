import type { AppUser, Category, MenuItem, MenuLayout, OpeningHour, Order, ThemeSettings } from './types';
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

function writeOfferDescription(item: MenuItem) {
  if (item.categoryId !== 'offers' || !item.includedItemIds?.length) return item.description.de;
  return `${item.description.de || item.description.en}\n${offerMetaPrefix}${JSON.stringify({ includedItemIds: item.includedItemIds })}`;
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
      includedItemIds: offerDescription.includedItemIds,
    };
  });

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const privateState = await loadPrivateRemoteState(restaurantId, itemMap, fallback);

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

async function loadPrivateRemoteState(restaurantId: string, itemMap: Map<string, MenuItem>, fallback: RemoteState) {
  if (!supabase) return { orders: fallback.orders, users: fallback.users };

  const [ordersResult, usersResult] = await Promise.all([
    supabase.from('orders').select('*, order_lines(*)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').eq('restaurant_id', restaurantId).order('created_at'),
  ]);

  const orders: Order[] = ordersResult.error
    ? fallback.orders
    : (ordersResult.data || []).map((order) => ({
        id: order.id,
        customerName: order.customer_name,
        address: order.address || '',
        phone: order.phone || '',
        notes: order.notes || '',
        total: Number(order.total || 0),
        status: order.status,
        createdAt: order.created_at ? new Date(order.created_at).toLocaleString() : '',
        lines: (order.order_lines || []).map((line: { menu_item_id: string; quantity: number; unit_price: number }) => ({
          item:
            itemMap.get(line.menu_item_id) ||
            ({
              id: line.menu_item_id,
              categoryId: 'deleted',
              name: { en: 'Deleted item', de: 'Geloschter Artikel' },
              description: { en: '', de: '' },
              price: Number(line.unit_price || 0),
              imageStyle: 'pink',
              available: false,
              sortOrder: 0,
            } satisfies MenuItem),
          quantity: line.quantity,
        })),
      }));

  const users: AppUser[] = usersResult.error
    ? fallback.users
    : (usersResult.data || []).map((user) => ({
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

export async function saveRemoteState(state: RemoteState) {
  if (!isSupabaseConfigured || !supabase) return;
  const restaurant = await getRestaurant();
  const restaurantId = restaurant.id;

  await supabase
    .from('restaurants')
    .update({
      name: state.theme.siteName,
      logo_text: state.theme.logoText,
      logo_url: state.theme.logoUrl || null,
      menu_url: state.theme.menuUrl,
      primary_color: state.theme.primary,
      accent_color: state.theme.accent,
      lavender_color: state.theme.lavender,
      background_color: state.theme.background,
      surface_color: state.theme.surface,
      text_color: state.theme.text,
      muted_text_color: state.theme.mutedText,
      button_text_color: state.theme.buttonText,
      card_color: state.theme.card,
      border_color: state.theme.border,
    })
    .eq('id', restaurantId);

  const { error: layoutError } = await supabase.from('restaurants').update({ menu_layout: state.layout }).eq('id', restaurantId);
  if (layoutError && layoutError.code !== 'PGRST204') {
    throw layoutError;
  }

  await syncCategories(restaurantId, state.categories);
  await syncMenuItems(restaurantId, state.items);
  await deleteMissing('categories', restaurantId, state.categories.map((category) => category.id));
  await syncHours(restaurantId, state.hours);
  await syncOrders(restaurantId, state.orders);
  await syncUsers(restaurantId, state.users, state.theme.siteName);
}

export async function createRemoteOrder(order: Order) {
  if (!isSupabaseConfigured || !supabase) return;
  const restaurant = await getRestaurant();
  const restaurantId = restaurant.id;

  const { error: orderError } = await supabase.from('orders').insert({
    id: order.id,
    restaurant_id: restaurantId,
    customer_name: order.customerName,
    address: order.address || null,
    phone: order.phone,
    notes: order.notes,
    status: order.status,
    total: order.total,
  });
  if (orderError) throw orderError;

  const lines = order.lines.map((line) => ({
    id: appId(`${order.id}-line`, line.item.id),
    order_id: order.id,
    menu_item_id: line.item.id,
    quantity: line.quantity,
    unit_price: line.item.price,
  }));

  if (lines.length) {
    const { error: linesError } = await supabase.from('order_lines').insert(lines);
    if (linesError) throw linesError;
  }
}

async function deleteMissing(table: string, restaurantId: string, ids: string[]) {
  if (!supabase) return;
  if (ids.length === 0) {
    await supabase.from(table).delete().eq('restaurant_id', restaurantId);
    return;
  }

  const { data, error } = await supabase.from(table).select('id').eq('restaurant_id', restaurantId);
  if (error) throw error;

  const keepIds = new Set(ids);
  const deleteIds = (data || []).map((row) => String(row.id)).filter((id) => !keepIds.has(id));
  if (deleteIds.length) {
    const { error: deleteError } = await supabase.from(table).delete().in('id', deleteIds);
    if (deleteError) throw deleteError;
  }
}

async function syncCategories(restaurantId: string, categories: Category[]) {
  if (!supabase) return;
  const rows = categories.map((category) => ({
    id: category.id,
    restaurant_id: restaurantId,
    name_en: category.name.en,
    name_de: category.name.de,
    sort_order: category.sortOrder,
  }));
  if (rows.length) await supabase.from('categories').upsert(rows);
}

async function syncMenuItems(restaurantId: string, items: MenuItem[]) {
  if (!supabase) return;
  const rows = items.map((item) => ({
    id: item.id,
    restaurant_id: restaurantId,
    category_id: item.categoryId,
    name_en: item.name.en,
    name_de: item.name.de,
    description_en: item.description.en,
    description_de: writeOfferDescription(item),
    price: item.price,
    badge_en: item.badge?.en || null,
    badge_de: item.badge?.de || null,
    image_style: item.imageStyle,
    image_url: item.imageUrl || null,
    available: item.available,
    sort_order: item.sortOrder,
  }));
  if (rows.length) await supabase.from('menu_items').upsert(rows);
  await deleteMissing('menu_items', restaurantId, items.map((item) => item.id));
}

async function syncHours(restaurantId: string, hours: OpeningHour[]) {
  if (!supabase) return;
  const rows = hours.map((hour, index) => ({
    id: appId('hour', hour.day),
    restaurant_id: restaurantId,
    day: hour.day,
    open_time: hour.open,
    close_time: hour.close,
    enabled: hour.enabled,
    sort_order: index + 1,
  }));
  if (rows.length) await supabase.from('opening_hours').upsert(rows);
}

async function syncOrders(restaurantId: string, orders: Order[]) {
  if (!supabase) return;
  const rows = orders.map((order) => ({
    id: order.id,
    restaurant_id: restaurantId,
    customer_name: order.customerName,
    address: order.address || null,
    phone: order.phone,
    notes: order.notes,
    status: order.status,
    total: order.total,
  }));
  if (rows.length) await supabase.from('orders').upsert(rows);
  await deleteMissing('orders', restaurantId, orders.map((order) => order.id));

  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    await supabase.from('order_lines').delete().in('order_id', orderIds);
    const lines = orders.flatMap((order) =>
      order.lines.map((line) => ({
        id: appId(`${order.id}-line`, line.item.id),
        order_id: order.id,
        menu_item_id: line.item.id,
        quantity: line.quantity,
        unit_price: line.item.price,
      })),
    );
    if (lines.length) await supabase.from('order_lines').insert(lines);
  }
}

async function syncUsers(restaurantId: string, users: AppUser[], restaurantName: string) {
  if (!supabase) return;
  const rows = users.map((user) => ({
    id: user.id,
    restaurant_id: restaurantId,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurant_name: user.restaurant || restaurantName,
    active: user.active,
    must_change_password: Boolean(user.mustChangePassword),
  }));
  if (rows.length) await supabase.from('profiles').upsert(rows);
  await deleteMissing('profiles', restaurantId, users.map((user) => user.id));
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

export async function completeTemporaryPasswordChange() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.functions.invoke('complete-password-change', { body: {} });
  if (error) throw error;
}
