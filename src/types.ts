export type Locale = 'en' | 'de';
export type MenuLayout = 'grid' | 'list';
export type UserRole = 'admin' | 'owner';
export type OrderStatus = 'new' | 'preparing' | 'done';

export interface Category {
  id: string;
  name: Record<Locale, string>;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  price: number;
  badge?: Record<Locale, string>;
  imageStyle: string;
  imageUrl?: string;
  available: boolean;
  sortOrder: number;
  includedItemIds?: string[];
}

export interface CartLine {
  item: MenuItem;
  quantity: number;
}

export interface Order {
  id: string;
  customerName: string;
  address?: string;
  phone: string;
  notes: string;
  lines: CartLine[];
  total: number;
  status: OrderStatus;
  createdAt: string;
}

export interface AppUser {
  id: string;
  authUserId?: string;
  name: string;
  email: string;
  role: UserRole;
  restaurant: string;
  active: boolean;
  mustChangePassword?: boolean;
}

export interface ThemeSettings {
  primary: string;
  accent: string;
  lavender: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  buttonText: string;
  card: string;
  border: string;
  siteName: string;
  logoText: string;
  logoUrl: string;
  menuUrl: string;
}

export interface OpeningHour {
  day: string;
  open: string;
  close: string;
  enabled: boolean;
}
