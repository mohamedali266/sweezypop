import type { MenuItem, Order } from './types';

export const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export function restaurantDay(date: Date | string = new Date()) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(value);
}

export function todayOrders(orders: Order[], now = new Date()) {
  return orders.filter((order) => order.status !== 'cancelled' && restaurantDay(order.createdAt) === restaurantDay(now));
}

export function canOrder(item: MenuItem, items: MenuItem[]) {
  if (!item.available || !item.categoryId) return false;
  if (item.categoryId !== 'offers' && !item.includedItemIds?.length) return true;
  return Boolean(item.includedItemIds?.length) && item.includedItemIds!.every((id) =>
    items.some((part) => part.id === id && part.available && part.categoryId && part.categoryId !== 'offers'));
}

export function parsePrice(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 999999.99 ? value : NaN;
  let text = String(value ?? '').trim().replace(/\s?€$/, '').trim();
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  return parsePrice(Number(text));
}
