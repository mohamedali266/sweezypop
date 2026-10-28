export type Locale = 'en' | 'de';
export type MenuLayout = 'grid' | 'list';
export type UserRole = 'admin' | 'owner' | 'staff';
export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'done' | 'cancelled';

export interface ItemPreparation {
  station: string;
  estimatedMinutes: number;
  ingredients: Record<Locale, string[]>;
  tools: Record<Locale, string[]>;
  steps: Record<Locale, string[]>;
  warning: Record<Locale, string>;
}

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
  preparation?: ItemPreparation;
}

export interface CartLine {
  item: MenuItem;
  quantity: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  trackingToken?: string;
  source?: 'menu' | 'pos';
  customerName: string;
  notes: string;
  lines: CartLine[];
  total: number;
  status: OrderStatus;
  createdAt: string;
}

export interface StaffShift {
  id: string;
  status: 'open' | 'closed' | 'force_closed';
  startedAt: string;
  endedAt?: string;
  ordersHandled: number;
  staffProfileId: string;
}

export interface StaffBoardOrder extends Order {
  acceptedAt?: string;
  preparingAt?: string;
  readyAt?: string;
}

export interface StaffDirectoryEntry {
  id: string;
  authUserId?: string;
  name: string;
  email: string;
  active: boolean;
  station: string;
  restaurant: string;
  currentShift?: StaffShift;
  recentShifts: StaffShift[];
}

export interface StaffGuide {
  id: string;
  restaurantId: string;
  menuItemId?: string;
  name: Record<Locale, string>;
  ingredients: Record<Locale, string[]>;
  steps: Record<Locale, string[]>;
  createdAt: string;
  updatedAt: string;
}

export type StaffGuideInput = Pick<StaffGuide, 'menuItemId' | 'name' | 'ingredients' | 'steps'>;

export interface SocialLink {
  id: string;
  platform?: string;
  label: string;
  url: string;
  active: boolean;
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
  station?: string;
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
  socialLinks: SocialLink[];
  phoneCountryCode: string;
  phoneNumber: string;
}

export interface OpeningHour {
  day: string;
  open: string;
  close: string;
  enabled: boolean;
}
