import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ErrorInfo, FormEvent, ReactNode } from 'react';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { PointOfSale, OrderReceipt } from './PointOfSale';
import { canOrder, euro, parsePrice, todayOrders } from './orderLogic';
import {
  BadgeDollarSign,
  CalendarClock,
  Check,
  ChevronRight,
  CircleUserRound,
  Download,
  FileSpreadsheet,
  GripVertical,
  Image,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  MessageCircle,
  Minus,
  Palette,
  PhoneCall,
  Plus,
  QrCode,
  Search,
  Save,
  Settings,
  ShoppingBag,
  Trash2,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { categories as seedCategories, defaultTheme, initialOrders, menuItems as seedItems, openingHours as seedHours, users as seedUsers } from './data';
import { t } from './i18n';
import {
  completeTemporaryPasswordChange,
  createAdminUser,
  deleteAdminUser,
  createRemoteOrder,
  loadRemoteState,
  resetAdminUserPassword,
  saveRemoteState,
  saveRemoteSiteSettings,
  saveRemoteUsers,
  updateRemoteOrderStatus,
  type AdminUserPayload,
  type RemoteState,
} from './remoteData';
import { isSupabaseConfigured, supabase } from './supabase';
import type { AppUser, CartLine, Category, Locale, MenuItem, MenuLayout, OpeningHour, Order, SocialLink, ThemeSettings } from './types';

type View = 'menu' | 'login' | 'owner' | 'admin' | 'password-change';
type DashboardSection = 'overview' | 'pos' | 'items' | 'categories' | 'offers' | 'appearance' | 'hours' | 'orders' | 'users';
type AppearanceTab = 'brand' | 'colors' | 'layout' | 'contact' | 'qr';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const currency = euro;
const isOfferItem = (item: MenuItem) => item.categoryId === 'offers' || Boolean(item.includedItemIds?.length);
const configuredMenuUrl = import.meta.env.VITE_MENU_PUBLIC_URL || (typeof window !== 'undefined' ? window.location.origin : defaultTheme.menuUrl);
const socialPlatformOptions = [
  { value: 'instagram', label: 'Instagram', iconSlug: 'instagram' },
  { value: 'facebook', label: 'Facebook', iconSlug: 'facebook' },
  { value: 'tiktok', label: 'TikTok', iconSlug: 'tiktok' },
  { value: 'youtube', label: 'YouTube', iconSlug: 'youtube' },
  { value: 'whatsapp', label: 'WhatsApp', iconSlug: 'whatsapp' },
  { value: 'linkedin', label: 'LinkedIn', iconSlug: 'linkedin' },
  { value: 'x', label: 'X', iconSlug: 'x' },
  { value: 'custom', label: 'Custom', iconSlug: '' },
] as const;
const socialPlatforms = new Map(socialPlatformOptions.map((platform) => [platform.value, platform]));
const devPosPreview = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'pos';

function itemDescription(item: MenuItem, locale: Locale) {
  return item.description[locale].split('__offer_meta__:')[0].trim();
}

function parseImportedPrice(value: unknown) {
  return parsePrice(value);
}

function normalizeContactNumber(countryCode: string, phoneNumber: string) {
  const dial = countryCode.trim().startsWith('+') ? countryCode.trim() : `+${countryCode.trim()}`;
  const digits = `${dial}${phoneNumber}`.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits;
}

function whatsappNumber(countryCode: string, phoneNumber: string) {
  return normalizeContactNumber(countryCode, phoneNumber).replace(/[^\d]/g, '');
}

const storageKeys = {
  layout: 'sweezypop.layout',
  items: 'sweezypop.items',
  categories: 'sweezypop.categories',
  orders: 'sweezypop.orders',
  users: 'sweezypop.users',
  theme: 'sweezypop.theme',
  hours: 'sweezypop.hours',
  dashboardView: 'sweezypop.dashboardView',
  pwaInstallDismissed: 'sweezypop.pwaInstallDismissed.v2',
} as const;

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}

function safeArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function normalizeLayout(value: unknown): MenuLayout {
  return value === 'list' || value === 'grid' ? value : 'grid';
}

function normalizeThemeSettings(value: unknown): ThemeSettings {
  const theme = value && typeof value === 'object' ? (value as Partial<ThemeSettings>) : {};
  return {
    ...defaultTheme,
    ...theme,
    socialLinks: Array.isArray(theme.socialLinks)
      ? theme.socialLinks.map((link) => ({
          ...link,
          platform: link.platform || socialPlatformKind(link),
        }))
      : defaultTheme.socialLinks,
    phoneCountryCode: theme.phoneCountryCode || defaultTheme.phoneCountryCode,
    phoneNumber: theme.phoneNumber || '',
  };
}

function socialPlatformKind(link: SocialLink) {
  if (link.platform && socialPlatforms.has(link.platform as (typeof socialPlatformOptions)[number]['value'])) return link.platform;
  const value = `${link.label} ${link.url}`.toLowerCase();
  if (value.includes('instagram')) return 'instagram';
  if (value.includes('facebook') || value.includes('fb.com')) return 'facebook';
  if (value.includes('tiktok')) return 'tiktok';
  if (value.includes('youtube') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('whatsapp') || value.includes('wa.me')) return 'whatsapp';
  if (value.includes('linkedin')) return 'linkedin';
  if (value.includes('x.com') || value.includes('twitter')) return 'x';
  return 'custom';
}

function SocialAppIcon({ link }: { link: SocialLink }) {
  const kind = socialPlatformKind(link);
  const platform = socialPlatforms.get(kind as (typeof socialPlatformOptions)[number]['value']);
  if (platform?.iconSlug) {
    return (
      <span className={`social-app-icon ${kind}`}>
        <img src={`/social-icons/${platform.iconSlug}.svg`} alt="" width={22} height={22} />
      </span>
    );
  }
  return <span className="social-app-icon website">↗</span>;
}

function BrandMark({ theme }: { theme: ThemeSettings }) {
  return (
    <span className="brand-mark">
      {theme.logoUrl ? <img src={theme.logoUrl} alt={`${theme.siteName} logo`} /> : theme.logoText.slice(0, 1).toUpperCase()}
    </span>
  );
}

async function readMenuRowsFromWorkbook(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('text');
  const sharedStrings = sharedXml
    ? Array.from(parser.parseFromString(sharedXml, 'application/xml').querySelectorAll('si')).map((item) =>
        Array.from(item.querySelectorAll('t'))
          .map((text) => text.textContent || '')
          .join(''),
      )
    : [];

  const workbookXml = await zip.file('xl/workbook.xml')?.async('text');
  const workbookRelsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('text');
  const workbookDoc = workbookXml ? parser.parseFromString(workbookXml, 'application/xml') : null;
  const relsDoc = workbookRelsXml ? parser.parseFromString(workbookRelsXml, 'application/xml') : null;
  const menuSheet = Array.from(workbookDoc?.querySelectorAll('sheet') || []).find((sheet) => sheet.getAttribute('name') === 'Menu Items') || workbookDoc?.querySelector('sheet');
  const relId = menuSheet?.getAttribute('r:id');
  const target = relId ? relsDoc?.querySelector(`Relationship[Id="${relId}"]`)?.getAttribute('Target') : null;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheetXml = await zip.file(sheetPath)?.async('text');
  if (!sheetXml) return [];

  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
  const rows = Array.from(sheetDoc.querySelectorAll('sheetData row')).map((row) => {
    const values: string[] = [];
    Array.from(row.querySelectorAll('c')).forEach((cell) => {
      const ref = cell.getAttribute('r') || '';
      const columnLetters = ref.replace(/\d+/g, '');
      const columnIndex = columnLetters.split('').reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = cell.getAttribute('t');
      const raw = cell.querySelector('v')?.textContent || cell.querySelector('is t')?.textContent || '';
      values[columnIndex] = type === 's' ? sharedStrings[Number(raw)] || '' : raw;
    });
    return values;
  });

  const headers = rows[0] || [];
  return rows.slice(1).map((row) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      if (header) record[String(header)] = row[index] || '';
      return record;
    }, {}),
  );
}

function AppContent() {
  const [view, setView] = useState<View>(devPosPreview ? 'admin' : 'menu');
  const [showLoader, setShowLoader] = useState(true);
  const [locale, setLocale] = useState<Locale>(() => loadStored<unknown>('sweezypop.locale', 'de') === 'en' ? 'en' : 'de');
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      saveStored('sweezypop.locale', locale);
    } catch {
      // Language switching remains available when browser storage is disabled.
    }
  }, [locale]);
  const [layout, setLayout] = useState<MenuLayout>(() => normalizeLayout(loadStored(storageKeys.layout, 'grid')));
  const [items, setItems] = useState<MenuItem[]>(devPosPreview ? seedItems : []);
  const [categories, setCategories] = useState<Category[]>(devPosPreview ? seedCategories : []);
  const [orders, setOrders] = useState<Order[]>(devPosPreview ? initialOrders : []);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [theme, setTheme] = useState<ThemeSettings>(() => normalizeThemeSettings(loadStored(storageKeys.theme, defaultTheme)));
  const [hours, setHours] = useState<OpeningHour[]>(() => safeArray(loadStored(storageKeys.hours, seedHours), seedHours));
  const [activeCategory, setActiveCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [authRole, setAuthRole] = useState<'owner' | 'admin' | null>(devPosPreview ? 'admin' : null);
  const [submittedOrderId, setSubmittedOrderId] = useState('');
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const baseline = useRef<RemoteState | null>(null);
  const saveInFlight = useRef(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [syncVersion, setSyncVersion] = useState(0);
  const requestAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const orderInFlight = useRef(false);

  const applyRemoteState = (remoteState: RemoteState) => {
    baseline.current = remoteState;
    setCategories(safeArray(remoteState.categories, seedCategories));
    setItems(safeArray(remoteState.items, seedItems));
    setOrders(safeArray(remoteState.orders, initialOrders));
    setUsers(safeArray(remoteState.users, seedUsers));
    setTheme(normalizeThemeSettings(remoteState.theme));
    setHours(safeArray(remoteState.hours, seedHours));
    setLayout(normalizeLayout(remoteState.layout));
  };

  const restoreDashboardSession = async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data: sessionResult } = await supabase.auth.getSession();
    const user = sessionResult.session?.user;
    if (!user) return;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle();

    if (profileError || !profile) return;

    const remoteState = await loadRemoteState({ categories, items, orders, users, theme: normalizeThemeSettings(theme), hours, layout });
    if (remoteState) applyRemoteState(remoteState);

    setAuthRole(profile.role);
    setView(profile.must_change_password ? 'password-change' : profile.role);
  };

  useEffect(() => {
    const loaderTimer = window.setTimeout(() => setShowLoader(false), 3000);
    return () => window.clearTimeout(loaderTimer);
  }, []);

  useEffect(() => {
    const manifest = {
      name: `${theme.siteName} Dashboard`,
      short_name: theme.siteName.slice(0, 12) || 'Sweezypop',
      description: 'Restaurant menu dashboard and QR ordering workspace.',
      start_url: '/#login',
      scope: '/',
      display: 'standalone',
      background_color: theme.background,
      theme_color: theme.primary,
      icons: [
        { src: theme.logoUrl || '/pwa-icon.svg', sizes: '192x192', type: theme.logoUrl ? undefined : 'image/svg+xml', purpose: 'any maskable' },
        { src: theme.logoUrl || '/pwa-icon.svg', sizes: '512x512', type: theme.logoUrl ? undefined : 'image/svg+xml', purpose: 'any maskable' },
      ],
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const manifestUrl = URL.createObjectURL(blob);
    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = manifestUrl;
    let appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = theme.logoUrl || '/pwa-icon.svg';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.primary);
    return () => URL.revokeObjectURL(manifestUrl);
  }, [theme.background, theme.logoUrl, theme.primary, theme.siteName]);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      if (authRole && !standalone && !loadStored(storageKeys.pwaInstallDismissed, false)) setShowInstallBanner(true);
    };

    const onInstalled = () => {
      setIsStandalone(true);
      setShowInstallBanner(false);
      setShowInstallGuide(false);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [authRole]);

  useEffect(() => {
    if (authRole && !isStandalone) {
      if (loadStored(storageKeys.pwaInstallDismissed, false)) return;
      const timer = window.setTimeout(() => setShowInstallBanner(true), 1200);
      return () => window.clearTimeout(timer);
    }
    setShowInstallBanner(false);
  }, [authRole, isStandalone]);

  useEffect(() => {
    void restoreDashboardSession().catch(() => setLoadError('Sitzung konnte nicht geladen werden. Bitte erneut anmelden.'));
    // Restore the persisted Supabase session once on boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncHashRoute = () => {
      if (window.location.hash === '#login') {
        setView('login');
      }
    };

    syncHashRoute();
    window.addEventListener('hashchange', syncHashRoute);
    return () => window.removeEventListener('hashchange', syncHashRoute);
  }, []);

  useEffect(() => saveStored(storageKeys.layout, layout), [layout]);
  useEffect(() => saveStored(storageKeys.items, items), [items]);
  useEffect(() => saveStored(storageKeys.categories, categories), [categories]);
  useEffect(() => {
    window.localStorage.removeItem(storageKeys.orders);
    window.localStorage.removeItem(storageKeys.users);
  }, []);
  useEffect(() => saveStored(storageKeys.theme, theme), [theme]);
  useEffect(() => saveStored(storageKeys.hours, hours), [hours]);
  useEffect(() => {
    if (authRole && (view === 'owner' || view === 'admin')) {
      saveStored(storageKeys.dashboardView, view);
    }
  }, [authRole, view]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouchDevice) return;

    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY <= 0) {
        touchStartY.current = event.touches[0]?.clientY ?? null;
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchStartY.current === null || window.scrollY > 0 || refreshing) return;
      const currentY = event.touches[0]?.clientY ?? touchStartY.current;
      const delta = currentY - touchStartY.current;
      if (delta <= 0) return;
      if (delta > 8) event.preventDefault();
      setPullDistance(Math.min(104, delta * 0.55));
    };

    const onTouchEnd = () => {
      if (pullDistance > 76) {
        setRefreshing(true);
        window.setTimeout(() => window.location.reload(), 220);
      } else {
        setPullDistance(0);
      }
      touchStartY.current = null;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [pullDistance, refreshing]);

  useEffect(() => {
    const syncStoredData = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue);
        if (event.key === storageKeys.items) setItems(safeArray(value, seedItems));
        if (event.key === storageKeys.categories) setCategories(safeArray(value, seedCategories));
        if (event.key === storageKeys.theme) setTheme(normalizeThemeSettings(value));
        if (event.key === storageKeys.hours) setHours(safeArray(value, seedHours));
        if (event.key === storageKeys.layout) setLayout(normalizeLayout(value));
      } catch {
        // Ignore malformed external storage writes.
      }
    };
    window.addEventListener('storage', syncStoredData);
    return () => window.removeEventListener('storage', syncStoredData);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const fallback: RemoteState = { categories, items, orders, users, theme: normalizeThemeSettings(theme), hours, layout };
    loadRemoteState(fallback)
      .then((remoteState) => {
        if (!remoteState) return;
        applyRemoteState(remoteState);
      })
      .catch((error: unknown) => {
        console.warn('Supabase load failed.', error);
        setLoadError('Daten konnten nicht geladen werden. Bitte neu laden.');
      })
      .finally(() => setRemoteReady(true));
    // Run once on boot. Fallback values are only used when remote rows are empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (configuredMenuUrl && !theme.menuUrl) setTheme((current) => ({ ...current, menuUrl: configuredMenuUrl }));
  }, [theme.menuUrl]);

  useEffect(() => {
    if (!submittedOrderId) return;
    const successTimer = window.setTimeout(() => setSubmittedOrderId(''), 5000);
    return () => window.clearTimeout(successTimer);
  }, [submittedOrderId]);

  useEffect(() => {
    if (activeCategory === 'all') return;
    if (!categories.some((category) => category.id === activeCategory)) {
      setActiveCategory('all');
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    if (devPosPreview || !isSupabaseConfigured || !remoteReady || !authRole || !baseline.current || saveInFlight.current) return;
    const previous = baseline.current;
    if (JSON.stringify([categories,items,hours,users]) === JSON.stringify([previous.categories,previous.items,previous.hours,previous.users])) return;
    setSaveMessage('Nicht gespeicherte Änderungen');
    const syncId = window.setTimeout(() => {
      saveInFlight.current = true;
      setSaveMessage('Wird gespeichert …');
      const snapshot = { categories, items, orders, users, theme, hours, layout };
      saveRemoteState(snapshot, previous).then(async () => {
        baseline.current = { ...snapshot, users:previous.users };
        await saveRemoteUsers(users,previous.users);
        baseline.current = snapshot;
        setSaveMessage('Gespeichert');
        setSyncVersion((v) => v + 1);
      }).catch(() => {
        setSaveMessage('Nicht gespeichert. Verbindung oder Datenkonflikt: Bitte neu laden und erneut versuchen.');
      }).finally(() => { saveInFlight.current = false; });
    }, 900);

    return () => window.clearTimeout(syncId);
    // Theme and layout are saved explicitly from Appearance to avoid broad dashboard writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRole, categories, hours, items, users, remoteReady, syncVersion]);

  const persistSiteSettings = async (nextTheme: ThemeSettings, nextLayout: MenuLayout) => {
    if (isSupabaseConfigured && authRole) {
      await saveRemoteSiteSettings(nextTheme, nextLayout);
    }
    setTheme(nextTheme);
    setLayout(nextLayout);
  };

  useEffect(() => {
    if (!remoteReady || !isSupabaseConfigured) return;
    let stopped = false;
    let busy = false;
    const refresh = async () => {
      if (busy || saveInFlight.current || document.hidden) return;
      busy = true;
      try {
        const remote = await loadRemoteState({ categories, items, orders:[], users:[], theme, hours, layout });
        if (!remote || stopped) return;
        if (!authRole) applyRemoteState(remote);
        else { setOrders(remote.orders); }
        setLoadError('');
      } catch { if (!stopped) setLoadError('Verbindung unterbrochen. Daten werden erneut geladen.'); }
      finally { busy = false; }
    };
    const interval = window.setInterval(() => void refresh(), 5000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => { stopped = true; window.clearInterval(interval); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
    // Current catalog edits must never be overwritten by background order refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRole, remoteReady]);

  const addToCart = (item: MenuItem) => {
    if (!canOrder(item, items)) return;
    setSubmittedOrderId('');
    setCart((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) => (line.item.id === item.id ? { ...line, quantity: Math.min(99,line.quantity + 1) } : line));
      }
      return [...current, { item, quantity: 1 }];
    });
  };

  const updateCartQuantity = (itemId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) => (line.item.id === itemId ? { ...line, quantity: Math.min(99,line.quantity + delta) } : line))
        .filter((line) => line.quantity > 0),
    );
  };

  const removeCartLine = (itemId: string) => {
    setCart((current) => current.filter((line) => line.item.id !== itemId));
  };

  const submitOrder = async (payload: { name: string; notes: string }) => {
    if (!cart.length || orderInFlight.current) throw new Error('Bitte warten.');
    const fingerprint = JSON.stringify({ ...payload, lines:cart.map(l => [l.item.id,l.quantity]) });
    if (requestAttempt.current?.fingerprint !== fingerprint) requestAttempt.current = { fingerprint, key:crypto.randomUUID() };
    orderInFlight.current = true;
    try {
      const order = await createRemoteOrder({ ...payload, lines:cart, requestKey:requestAttempt.current.key });
      setCart([]);
      setSubmittedOrderId(order.orderNumber || order.id);
      requestAttempt.current = null;
    } finally { orderInFlight.current = false; }
  };

  const handleLogin = async (email: string, password: string): Promise<string | null> => {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) return error?.message || t(locale, 'loginInvalid');

      console.info('Sweezypop login user id:', data.user.id);

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_user_id', data.user.id)
        .eq('active', true)
        .maybeSingle();

      if (profileError) return `${t(locale, 'loginNoProfile')} (${profileError.message})`;
      if (!profile) return `${t(locale, 'loginNoProfile')} User id: ${data.user.id}`;
      const remoteState = await loadRemoteState({ categories, items, orders, users, theme: normalizeThemeSettings(theme), hours, layout });
      if (remoteState) {
        applyRemoteState(remoteState);
      }
      setAuthRole(profile.role);
      setView(profile.must_change_password ? 'password-change' : profile.role);
      saveStored(storageKeys.dashboardView, profile.role);
      window.history.replaceState(null, '', window.location.pathname);
      return null;
    }

    return 'Anmeldung nicht verfügbar. Supabase-Konfiguration fehlt.';
  };

  const handleLogout = () => {
    if (supabase) void supabase.auth.signOut();
    setAuthRole(null);
    setOrders([]);
    setUsers([]);
    setView('menu');
    window.localStorage.removeItem(storageKeys.dashboardView);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const installDashboardApp = async () => {
    if (!installPrompt) {
      setShowInstallGuide(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'accepted') {
      setShowInstallBanner(false);
    } else {
      setShowInstallGuide(true);
    }
  };

  const dismissInstallBanner = () => {
    saveStored(storageKeys.pwaInstallDismissed, true);
    setShowInstallGuide(false);
    setShowInstallBanner(false);
  };

  return (
    <div
      className="app"
      style={
        {
          '--primary': theme.primary,
          '--accent': theme.accent,
          '--lavender': theme.lavender,
          '--app-bg': theme.background,
          '--surface': theme.surface,
          '--text': theme.text,
          '--muted': theme.mutedText,
          '--button-text': theme.buttonText,
          '--card': theme.card,
          '--border': theme.border,
        } as CSSProperties
      }
    >
      {showLoader && <LoaderScreen />}
      <PullToRefreshIndicator distance={pullDistance} refreshing={refreshing} />
      {authRole && showInstallBanner && !isStandalone && !devPosPreview && (
        <InstallAppBanner
          locale={locale}
          theme={theme}
          canInstall={Boolean(installPrompt)}
          showGuide={showInstallGuide}
          onInstall={() => void installDashboardApp()}
          onDismissGuide={() => setShowInstallGuide(false)}
          onDismiss={dismissInstallBanner}
        />
      )}
      <TopNav setView={setView} locale={locale} setLocale={setLocale} theme={theme} authRole={authRole} onLogout={handleLogout} />
      {(loadError || (authRole && saveMessage)) && <div className="sync-message" role="status">{loadError || saveMessage}</div>}
      {!isSupabaseConfigured && !devPosPreview && <p className="form-error" role="alert">Supabase-Konfiguration fehlt. Bestellungen sind deaktiviert.</p>}
      {view === 'menu' ? (
        <MenuPage
          locale={locale}
          layout={layout}
          items={items}
          categories={categories}
          hours={hours}
          theme={theme}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          query={query}
          setQuery={setQuery}
          cart={cart}
          addToCart={addToCart}
          updateCartQuantity={updateCartQuantity}
          removeCartLine={removeCartLine}
          submitOrder={submitOrder}
          submittedOrderId={submittedOrderId}
        />
      ) : view === 'login' || !authRole ? (
        <LoginPage locale={locale} theme={theme} onLogin={handleLogin} />
      ) : view === 'password-change' ? (
        <PasswordChangePage locale={locale} theme={theme} onComplete={() => setView(authRole)} onLogout={handleLogout} />
      ) : (
        <Dashboard
          mode={view}
          locale={locale}
          layout={layout}
          setLayout={setLayout}
          items={items}
          setItems={setItems}
          categories={categories}
          setCategories={setCategories}
          orders={orders}
          setOrders={setOrders}
          users={users}
          setUsers={setUsers}
          theme={theme}
          setTheme={setTheme}
          persistSiteSettings={persistSiteSettings}
          hours={hours}
          setHours={setHours}
        />
      )}
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sweezypop render guard caught an error.', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-fallback" role="alert">
          <BrandMark theme={defaultTheme} />
          <h1>Sweezypop</h1>
          <p>The menu could not render with the current browser data. Refreshing usually restores the latest safe version.</p>
          <button
            className="primary-action"
            onClick={() => {
              window.localStorage.removeItem(storageKeys.theme);
              window.location.reload();
            }}
          >
            Reload menu
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

function LoaderScreen() {
  return (
    <div className="app-loader" role="status" aria-label="Loading Sweezypop">
      <img src="/sweezypop-loader-v3.svg" alt="SweezyPop by Ammaro" />
    </div>
  );
}

function PullToRefreshIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  if (distance <= 1 && !refreshing) return null;
  const progress = Math.min(1, distance / 76);
  return (
    <div className="pull-refresh" style={{ transform: `translate(-50%, ${Math.min(distance, 74)}px)`, opacity: Math.max(0.35, progress) }}>
      <span className={refreshing ? 'spinning' : ''}>↻</span>
      <small>{refreshing ? 'Refreshing' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}</small>
    </div>
  );
}

function InstallAppBanner({
  locale,
  theme,
  canInstall,
  showGuide,
  onInstall,
  onDismissGuide,
  onDismiss,
}: {
  locale: Locale;
  theme: ThemeSettings;
  canInstall: boolean;
  showGuide: boolean;
  onInstall: () => void;
  onDismissGuide: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className="install-banner animated-panel" role="status">
      <BrandMark theme={theme} />
      <div>
        <strong>{t(locale, 'installDashboard')}</strong>
        <p>{canInstall ? t(locale, 'installDashboardCopy') : t(locale, 'installIosCopy')}</p>
      </div>
      <button type="button" className="small-action" onClick={onInstall}>
        {t(locale, 'install')}
      </button>
      <button type="button" className="ghost-icon" onClick={onDismiss} aria-label={t(locale, 'close')}>
        x
      </button>
      {showGuide && !canInstall && (
        <div className="install-guide" role="status">
          <strong>{t(locale, 'installManualTitle')}</strong>
          <p>{t(locale, 'installManualSteps')}</p>
          <button type="button" onClick={onDismissGuide}>{t(locale, 'gotIt')}</button>
        </div>
      )}
    </aside>
  );
}

function TopNav({
  setView,
  locale,
  setLocale,
  theme,
  authRole,
  onLogout,
}: {
  setView: (view: View) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: ThemeSettings;
  authRole: 'owner' | 'admin' | null;
  onLogout: () => void;
}) {
  return (
    <header className="top-nav">
      <button className="brand" onClick={() => setView('menu')}>
        <BrandMark theme={theme} />
        <span>{theme.siteName}</span>
      </button>
      <div className="nav-spacer" />
      <div className="locale-switch" aria-label={t(locale, 'languageSwitch')}>
        <button className="active" onClick={() => setLocale(locale === 'en' ? 'de' : 'en')} aria-label={t(locale, 'languageSwitch')}>
          {locale.toUpperCase()}
        </button>
        {authRole ? (
          <button className="icon-only-nav" onClick={onLogout} aria-label={t(locale, 'signOut')} title={t(locale, 'signOut')}>
            <LogOut size={18} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function LoginPage({ locale, theme, onLogin }: { locale: Locale; theme: ThemeSettings; onLogin: (email: string, password: string) => Promise<string | null> }) {
  const [email, setEmail] = useState('owner@sweezypop.test');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) return;
    onLogin(email, password).then((message) => {
      setError(message || '');
    });
  };

  return (
    <main className="login-shell">
      <section className="login-card animated-panel">
        <div className="login-visual">
          <BrandMark theme={theme} />
          <h1>{theme.siteName} {t(locale, 'control')}</h1>
          <p>{t(locale, 'controlCopy')}</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow dark">{t(locale, 'loginTitle')}</span>
          <h2>{t(locale, 'welcomeBack')}</h2>
          <p className="muted">{t(locale, 'loginCopy')}</p>
          <label>
            {t(locale, 'email')}
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            {t(locale, 'password')}
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          <button className="primary-action full" type="submit">
            <LogIn size={18} />
            {t(locale, 'enterDashboard')}
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function PasswordChangePage({ locale, theme, onComplete, onLogout }: { locale: Locale; theme: ThemeSettings; onComplete: () => void; onLogout: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) {
      setError(t(locale, 'passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t(locale, 'passwordMismatch'));
      return;
    }
    if (!supabase) {
      onComplete();
      return;
    }

    setSaving(true);
    completeTemporaryPasswordChange(password)
      .then(() => {
        onComplete();
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t(locale, 'passwordChangeFailed')))
      .finally(() => setSaving(false));
  };

  return (
    <main className="login-shell">
      <section className="login-card animated-panel">
        <div className="login-visual">
          <BrandMark theme={theme} />
          <h1>{t(locale, 'changePasswordTitle')}</h1>
          <p>{t(locale, 'changePasswordCopy')}</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow dark">{t(locale, 'temporaryPassword')}</span>
          <h2>{t(locale, 'setNewPassword')}</h2>
          <p className="muted">{t(locale, 'passwordRules')}</p>
          <label>
            {t(locale, 'newPassword')}
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          <label>
            {t(locale, 'confirmPassword')}
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          <button className="primary-action full" type="submit" disabled={saving}>
            <Save size={18} />
            {saving ? t(locale, 'saving') : t(locale, 'updatePassword')}
          </button>
          <button type="button" className="small-action neutral full-width" onClick={onLogout}>
            {t(locale, 'signOut')}
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function MenuPage(props: {
  locale: Locale;
  layout: MenuLayout;
  items: MenuItem[];
  categories: Category[];
  hours: OpeningHour[];
  theme: ThemeSettings;
  activeCategory: string;
  setActiveCategory: (id: string) => void;
  query: string;
  setQuery: (query: string) => void;
  cart: CartLine[];
  addToCart: (item: MenuItem) => void;
  updateCartQuantity: (itemId: string, delta: number) => void;
  removeCartLine: (itemId: string) => void;
  submitOrder: (payload: { name: string; notes: string }) => Promise<void>;
  submittedOrderId: string;
}) {
  const filtered = useMemo(() => {
    return props.items
      .filter((item) => canOrder(item, props.items))
      .filter((item) => props.activeCategory === 'all' || item.categoryId === props.activeCategory)
      .filter((item) => `${item.name[props.locale]} ${item.description[props.locale]}`.toLowerCase().includes(props.query.toLowerCase()))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [props.activeCategory, props.items, props.locale, props.query]);

  const day = new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Berlin', weekday:'long' }).format(new Date());
  const today = props.hours.find((hour) => hour.day === day && hour.enabled);
  const featuredOffers = filtered.filter(isOfferItem);
  const showFeaturedOffers = featuredOffers.length > 0 && (props.activeCategory === 'all' || props.activeCategory === 'offers');
  const visibleMenuItems = props.activeCategory === 'all' ? filtered.filter((item) => !isOfferItem(item)) : props.activeCategory === 'offers' ? [] : filtered;

  return (
    <main className="menu-shell">
      <section className="menu-hero">
        <div className="hero-media">
          <div className="plate plate-one" />
          <div className="plate plate-two" />
          <div className="plate plate-three" />
        </div>
        <div className="hero-copy">
          <span className="eyebrow">{today ? `${props.locale === 'de' ? 'Heute' : 'Today'} ${today.open}–${today.close}` : props.locale === 'de' ? 'Heute geschlossen' : 'Closed today'}</span>
          <h1>{props.theme.siteName}</h1>
          <p>{t(props.locale, 'heroCopy')}</p>
          <div className="hero-actions">
            <a href="#menu-list" className="primary-action">
              {t(props.locale, 'orderNow')}
            </a>
          </div>
        </div>
      </section>

      <ContactStrip locale={props.locale} theme={props.theme} />

      <section className="menu-tools">
        <label className="search-box">
          <Search size={18} />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder={t(props.locale, 'search')} />
        </label>
      </section>

      <section className="category-rail" aria-label={t(props.locale, 'categories')}>
        <button className={props.activeCategory === 'all' ? 'active' : ''} onClick={() => props.setActiveCategory('all')}>
          {t(props.locale, 'all')}
        </button>
        {props.categories
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((category) => (
            <button key={category.id} className={props.activeCategory === category.id ? 'active' : ''} onClick={() => props.setActiveCategory(category.id)}>
              {category.name[props.locale]}
            </button>
          ))}
      </section>

      {showFeaturedOffers && <FeaturedOffers offers={featuredOffers} items={props.items} locale={props.locale} onAdd={props.addToCart} />}

      <div className="menu-content single-column">
        <section id="menu-list" className={`items ${props.layout}`}>
          {visibleMenuItems.map((item) => (
            <MenuCard key={item.id} item={item} locale={props.locale} layout={props.layout} onAdd={props.addToCart} />
          ))}
        </section>
      </div>
      <CartPanel
        locale={props.locale}
        cart={props.cart}
        updateCartQuantity={props.updateCartQuantity}
        removeCartLine={props.removeCartLine}
        submitOrder={props.submitOrder}
        submittedOrderId={props.submittedOrderId}
      />
    </main>
  );
}

function ContactStrip({ locale, theme }: { locale: Locale; theme: ThemeSettings }) {
  const [socialOpen, setSocialOpen] = useState(false);
  const activeLinks = (theme.socialLinks || []).filter((link) => link.active && link.label.trim() && link.url.trim());
  const phoneNumber = theme.phoneNumber || '';
  const phoneCountryCode = theme.phoneCountryCode || defaultTheme.phoneCountryCode;
  const hasPhone = Boolean(phoneNumber.trim());
  const displayPhone = hasPhone ? `${phoneCountryCode} ${phoneNumber}`.trim() : '';
  const callHref = hasPhone ? `tel:${normalizeContactNumber(phoneCountryCode, phoneNumber)}` : undefined;
  const whatsappHref = hasPhone ? `https://wa.me/${whatsappNumber(phoneCountryCode, phoneNumber)}` : undefined;

  if (!activeLinks.length && !hasPhone) return null;

  return (
    <section className="contact-strip" aria-label={t(locale, 'contactAndSocial')}>
      {activeLinks.length ? (
        <button type="button" className="social-trigger" onClick={() => setSocialOpen(true)}>
          <span className="social-mini-icons" aria-hidden="true">
            {activeLinks.slice(0, 3).map((link) => (
              <SocialAppIcon key={link.id} link={link} />
            ))}
          </span>
          <span>
            <strong>{t(locale, 'socialMedia')}</strong>
            <small>{activeLinks.length} {t(locale, 'links')}</small>
          </span>
        </button>
      ) : null}

      {hasPhone ? (
        <div className="phone-strip">
          <span>
            <strong>{displayPhone}</strong>
            <small>{t(locale, 'restaurantPhone')}</small>
          </span>
          <div>
            <a className="contact-icon-button" href={callHref} aria-label={t(locale, 'callRestaurant')}>
              <PhoneCall size={18} />
            </a>
            <a className="contact-icon-button whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" aria-label={t(locale, 'openWhatsapp')}>
              <MessageCircle size={18} />
            </a>
          </div>
        </div>
      ) : null}

      {socialOpen && <SocialLinksModal locale={locale} links={activeLinks} onClose={() => setSocialOpen(false)} />}
    </section>
  );
}

function SocialLinksModal({ locale, links, onClose }: { locale: Locale; links: SocialLink[]; onClose: () => void }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <article className="social-modal-card animated-panel" role="dialog" aria-modal="true" aria-label={t(locale, 'socialLinks')} onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <span className="eyebrow dark">{t(locale, 'socialMedia')}</span>
            <h2>{t(locale, 'socialLinks')}</h2>
            <p className="muted">{t(locale, 'socialLinksCopy')}</p>
          </div>
          <button type="button" className="ghost-icon dark" onClick={onClose} aria-label={t(locale, 'close')}>
            x
          </button>
        </div>
        <div className="social-link-list">
          {links.map((link) => (
            <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="social-link-card">
              <SocialAppIcon link={link} />
              <strong>{link.label}</strong>
            </a>
          ))}
        </div>
      </article>
    </div>
  );
}

function FeaturedOffers({ offers, items, locale, onAdd }: { offers: MenuItem[]; items: MenuItem[]; locale: Locale; onAdd: (item: MenuItem) => void }) {
  const [selectedOffer, setSelectedOffer] = useState<MenuItem | null>(null);

  return (
    <section className="featured-offers" aria-label={t(locale, 'specialOffers')}>
      <div className="section-head">
        <div>
          <span className="eyebrow dark">{t(locale, 'limitedOffers')}</span>
          <h2>{t(locale, 'specialOffers')}</h2>
        </div>
        <span className="count-pill">{offers.length}</span>
      </div>
      <div className="offer-menu-grid">
        {offers.map((offer) => (
          <OfferCard key={offer.id} offer={offer} locale={locale} onOpen={setSelectedOffer} />
        ))}
      </div>
      {selectedOffer && <OfferDetailsModal offer={selectedOffer} items={items} locale={locale} onAdd={onAdd} onClose={() => setSelectedOffer(null)} />}
    </section>
  );
}

function OfferCard({ offer, locale, onOpen }: { offer: MenuItem; locale: Locale; onOpen: (offer: MenuItem) => void }) {
  return (
    <button type="button" className="offer-card" onClick={() => onOpen(offer)}>
      <div className={`offer-card-media food-art ${offer.imageStyle} ${offer.imageUrl ? 'has-image' : ''}`}>
        {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.name[locale]} loading="lazy" /> : <BadgeDollarSign size={38} />}
        {offer.badge && <span>{offer.badge[locale]}</span>}
      </div>
      <div className="offer-card-body">
        <div>
          <h3>{offer.name[locale]}</h3>
          <p>{itemDescription(offer, locale)}</p>
        </div>
        <strong>{currency.format(offer.price)}</strong>
      </div>
    </button>
  );
}

function OfferDetailsModal({
  offer,
  items,
  locale,
  onAdd,
  onClose,
}: {
  offer: MenuItem;
  items: MenuItem[];
  locale: Locale;
  onAdd: (item: MenuItem) => void;
  onClose: () => void;
}) {
  const includedItems = (offer.includedItemIds || [])
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is MenuItem => Boolean(item));

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <article className="offer-detail-card animated-panel" role="dialog" aria-modal="true" aria-label={offer.name[locale]} onClick={(event) => event.stopPropagation()}>
        <div className={`offer-detail-media food-art ${offer.imageStyle} ${offer.imageUrl ? 'has-image' : ''}`}>
          {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.name[locale]} /> : <BadgeDollarSign size={48} />}
          {offer.badge && <span>{offer.badge[locale]}</span>}
        </div>
        <div className="offer-detail-content">
          <div className="section-head">
            <div>
              <span className="eyebrow dark">{t(locale, 'specialOffers')}</span>
              <h2>{offer.name[locale]}</h2>
            </div>
            <button type="button" className="ghost-icon dark" onClick={onClose} aria-label={t(locale, 'close')}>
              x
            </button>
          </div>
          <p className="muted">{itemDescription(offer, locale)}</p>
          <div className="included-items-list">
            <h3>{t(locale, 'includedItems')}</h3>
            {includedItems.length ? (
              includedItems.map((item) => (
                <div key={item.id} className="included-offer-item">
                  <div className={`selection-thumb food-art ${item.imageStyle} ${item.imageUrl ? 'has-image' : ''}`}>
                    {item.imageUrl && <img src={item.imageUrl} alt="" />}
                  </div>
                  <span>{item.name[locale]}</span>
                  <strong>{currency.format(item.price)}</strong>
                </div>
              ))
            ) : (
              <p className="muted">{t(locale, 'includedItemsUnavailable')}</p>
            )}
          </div>
          <div className="offer-detail-footer">
            <strong>{currency.format(offer.price)}</strong>
            <button type="button" className="primary-action" onClick={() => onAdd(offer)}>
              <Plus size={18} /> {t(locale, 'addToCart')}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function MenuCard({ item, locale, layout, onAdd }: { item: MenuItem; locale: Locale; layout: MenuLayout; onAdd: (item: MenuItem) => void }) {
  return (
    <article className={`menu-card ${layout}`}>
      <div className={`food-art ${item.imageStyle} ${item.imageUrl ? 'has-image' : ''}`}>
        {item.imageUrl && <img src={item.imageUrl} alt={item.name[locale]} loading="lazy" />}
        {item.badge && <span>{item.badge[locale]}</span>}
      </div>
      <div className="menu-card-body">
        <h3>{item.name[locale]}</h3>
        <p>{itemDescription(item, locale)}</p>
        <div className="card-footer">
          <strong>{currency.format(item.price)}</strong>
          <button aria-label={`${t(locale, 'addToCart')} ${item.name[locale]}`} onClick={() => onAdd(item)}>
            <Plus size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

function CartPanel({
  locale,
  cart,
  updateCartQuantity,
  removeCartLine,
  submitOrder,
  submittedOrderId,
}: {
  locale: Locale;
  cart: CartLine[];
  updateCartQuantity: (itemId: string, delta: number) => void;
  removeCartLine: (itemId: string) => void;
  submitOrder: (payload: { name: string; notes: string }) => Promise<void>;
  submittedOrderId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const total = cart.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  const handleSubmitOrder = async () => {
    if (submitting) return;
    if (!name.trim()) {
      setFormError(t(locale, 'nameRequired'));
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      await submitOrder({ name: name.trim(), notes: notes.trim() });
      setOpen(false); setName(''); setNotes('');
    } catch {
      setFormError(locale === 'de' ? 'Bestellung nicht bestätigt. Bitte erneut versuchen. Ihr Warenkorb bleibt erhalten.' : 'Order not confirmed. Please retry. Your basket has been kept.');
    } finally { setSubmitting(false); }
  };

  if (!cart.length && !submittedOrderId) {
    return null;
  }

  if (submittedOrderId && !cart.length) {
    return (
      <div className="cart-success-bubble" role="status">
        <span>
          <Check size={26} />
        </span>
        <strong>{t(locale, 'orderSuccess')}</strong>
        <small>{t(locale, 'orderNumber')} {submittedOrderId}</small>
      </div>
    );
  }

  return (
    <>
      <button className="cart-floating-button" onClick={() => setOpen(true)} aria-label={t(locale, 'cart')}>
        <ShoppingBag size={24} />
        <span>{count}</span>
      </button>
      {open && (
        <div className="cart-overlay" onClick={() => setOpen(false)}>
          <aside className="cart-panel floating animated-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title">
              <ShoppingBag size={19} />
              <h2>{t(locale, 'cart')}</h2>
              <button className="ghost-icon" onClick={() => setOpen(false)} aria-label={t(locale, 'close')}>
                x
              </button>
            </div>
            <div className="cart-lines">
              {cart.map((line) => (
                <div key={line.item.id} className="cart-line detailed">
                  <div>
                    <strong>{line.item.name[locale]}</strong>
                    <span>{currency.format(line.item.price)}</span>
                  </div>
                  <div className="quantity-controls">
                    <button onClick={() => updateCartQuantity(line.item.id, -1)} aria-label={`Decrease ${line.item.name[locale]}`}>
                      <Minus size={15} />
                    </button>
                    <strong>{line.quantity}</strong>
                    <button onClick={() => updateCartQuantity(line.item.id, 1)} aria-label={`Increase ${line.item.name[locale]}`}>
                      <Plus size={15} />
                    </button>
                    <button className="danger" onClick={() => removeCartLine(line.item.id)} aria-label={`Remove ${line.item.name[locale]}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-total">
              <span>{t(locale, 'total')}</span>
              <strong>{currency.format(total)}</strong>
            </div>
            <div className="checkout-fields">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t(locale, 'customerName')} />
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t(locale, 'notes')} />
            </div>
            {formError && <p className="form-error">{formError}</p>}
            <button className="primary-action full" disabled={submitting} onClick={() => void handleSubmitOrder()}>
              {submitting ? (locale === 'de' ? 'Wird gesendet …' : 'Submitting …') : t(locale, 'checkout')}
            </button>
          </aside>
        </div>
      )}
    </>
  );
}

function LayoutToggle({ locale, layout, setLayout }: { locale: Locale; layout: MenuLayout; setLayout: (layout: MenuLayout) => void }) {
  return (
    <div className="layout-toggle">
      <span>{t(locale, 'layout')}</span>
      <button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label={t(locale, 'grid')}>
        <LayoutGrid size={17} />
      </button>
      <button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label={t(locale, 'list')}>
        <List size={17} />
      </button>
    </div>
  );
}

function Dashboard(props: {
  mode: 'owner' | 'admin';
  locale: Locale;
  layout: MenuLayout;
  setLayout: (layout: MenuLayout) => void;
  items: MenuItem[];
  setItems: (items: MenuItem[]) => void;
  categories: Category[];
  setCategories: (categories: Category[]) => void;
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  users: AppUser[];
  setUsers: (users: AppUser[]) => void;
  theme: ThemeSettings;
  setTheme: (theme: ThemeSettings) => void;
  persistSiteSettings: (theme: ThemeSettings, layout: MenuLayout) => Promise<void>;
  hours: OpeningHour[];
  setHours: (hours: OpeningHour[]) => void;
}) {
  const todaysOrders = todayOrders(props.orders);
  const revenue = todaysOrders.reduce((sum, order) => sum + order.total, 0);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(props.theme.menuUrl, { width: 220, margin: 2, color: { dark: '#1d1a2e', light: '#ffffff' } }).then(setQrDataUrl);
  }, [props.theme.menuUrl]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'users' && props.mode !== 'admin') {
      setActiveSection('overview');
    }
  }, [activeSection, props.mode]);

  const sidebarItems: Array<{ id: DashboardSection; label: string; icon: LucideIcon }> = [
    { id: 'overview', label: t(props.locale, 'dashboard'), icon: Settings },
    { id: 'pos', label: props.locale === 'de' ? 'Kasse / POS' : 'Point of sale', icon: ShoppingBag },
    { id: 'items', label: t(props.locale, 'manageItems'), icon: ShoppingBag },
    { id: 'categories', label: t(props.locale, 'manageCategories'), icon: List },
    { id: 'offers', label: t(props.locale, 'offers'), icon: BadgeDollarSign },
    { id: 'appearance', label: t(props.locale, 'appearance'), icon: Palette },
    { id: 'hours', label: t(props.locale, 'hours'), icon: CalendarClock },
    { id: 'orders', label: t(props.locale, 'orders'), icon: BadgeDollarSign },
  ];

  if (props.mode === 'admin') {
    sidebarItems.push({ id: 'users', label: t(props.locale, 'users'), icon: UsersRound });
  }

  const addCategory = () => {
    props.setCategories([{ id: `cat-${Date.now()}`, name: { en: 'New category', de: 'Neue Kategorie' }, sortOrder: 0 }, ...props.categories]);
  };

  const deleteCategory = (categoryId: string) => {
    props.setCategories(props.categories.filter((category) => category.id !== categoryId));
    props.setItems(props.items.filter((item) => item.categoryId !== categoryId));
  };

  const createOffer = (payload: { name: string; description: string; imageUrl: string; itemIds: string[]; price: number }) => {
    if (!payload.name.trim() || !payload.itemIds.length || !payload.price) return;
    let offerCategory = props.categories.find((category) => category.id === 'offers' || category.name.en.toLowerCase() === 'offers');
    const nextCategories = [...props.categories];
    if (!offerCategory) {
      offerCategory = { id: 'offers', name: { en: 'Offers', de: 'Angebote' }, sortOrder: props.categories.length + 1 };
      nextCategories.push(offerCategory);
      props.setCategories(nextCategories);
    }

    const selected = props.items.filter((item) => payload.itemIds.includes(item.id));
    const offer: MenuItem = {
      id: `offer-${Date.now()}`,
      categoryId: offerCategory.id,
      name: { en: payload.name, de: payload.name },
      description: {
        en: payload.description.trim() || selected.map((item) => item.name.en).join(' + '),
        de: payload.description.trim() || selected.map((item) => item.name.de).join(' + '),
      },
      price: payload.price,
      badge: { en: 'Offer', de: 'Angebot' },
      imageStyle: 'combo',
      imageUrl: payload.imageUrl.trim(),
      available: true,
      sortOrder: props.items.length + 1,
      includedItemIds: payload.itemIds,
    };
    props.setItems([...props.items, offer]);
  };

  const updateOffer = (offerId: string, payload: { name: string; description: string; imageUrl: string; itemIds: string[]; price: number }) => {
    const selected = props.items.filter((item) => payload.itemIds.includes(item.id));
    props.setItems(
      props.items.map((item) =>
        item.id === offerId
          ? {
              ...item,
              name: { en: payload.name, de: payload.name },
              description: {
                en: payload.description.trim() || selected.map((selectedItem) => selectedItem.name.en).join(' + '),
                de: payload.description.trim() || selected.map((selectedItem) => selectedItem.name.de).join(' + '),
              },
              price: payload.price,
              imageUrl: payload.imageUrl.trim(),
              includedItemIds: payload.itemIds,
            }
          : item,
      ),
    );
  };

  const toggleOfferAvailability = (offerId: string) => {
    props.setItems(props.items.map((item) => (item.id === offerId ? { ...item, available: !item.available } : item)));
  };

  const deleteOffer = (offerId: string) => {
    props.setItems(props.items.filter((item) => item.id !== offerId));
  };

  const importItemsFromExcel = async (file: File) => {
    const rows = await readMenuRowsFromWorkbook(file);
    const categoryMap = new Map<string, Category>();
    props.categories.forEach((category) => {
      categoryMap.set(category.name.en.toLowerCase(), category);
      categoryMap.set(category.name.de.toLowerCase(), category);
    });
    const importedCategories = [...props.categories];
    const importedItems: MenuItem[] = [];

    rows.forEach((row, index) => {
      const nameEn = String(row.name_en || '').trim();
      const categoryName = String(row.category || '').trim();
      const categoryDe = String(row.category_de || row.category || '').trim();
      const price = parseImportedPrice(row.price);
      if (!nameEn || !categoryName || Number.isNaN(price)) return;

      let category = categoryMap.get(categoryName.toLowerCase());
      if (!category) {
        category = {
          id: `cat-${Date.now()}-${index}`,
          name: { en: categoryName, de: categoryDe || categoryName },
          sortOrder: importedCategories.length + 1,
        };
        categoryMap.set(categoryName.toLowerCase(), category);
        categoryMap.set((categoryDe || categoryName).toLowerCase(), category);
        importedCategories.push(category);
      }

      importedItems.push({
        id: `import-${Date.now()}-${index}`,
        categoryId: category.id,
        name: { en: nameEn, de: String(row.name_de || nameEn) },
        description: {
          en: String(row.description_en || ''),
          de: String(row.description_de || row.description_en || ''),
        },
        price,
        badge: row.badge_en || row.badge_de ? { en: String(row.badge_en || ''), de: String(row.badge_de || row.badge_en || '') } : undefined,
        imageStyle: String(row.image_style || 'pink'),
        imageUrl: String(row.image_url || ''),
        available: String(row.available || 'TRUE').toLowerCase() !== 'false',
        sortOrder: Number(row.sort_order || props.items.length + importedItems.length + 1),
      });
    });

    if (importedItems.length) {
      props.setCategories(importedCategories);
      props.setItems([...props.items, ...importedItems]);
    }
  };

  const downloadQrCode = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${props.theme.siteName.toLowerCase().replace(/\s+/g, '-')}-menu-qr.png`;
    link.click();
  };

  const activeLabel = sidebarItems.find((item) => item.id === activeSection)?.label || t(props.locale, 'dashboard');

  const selectDashboardSection = (id: DashboardSection) => {
    setActiveSection(id);
    setMobileMenuOpen(false);
  };

  return (
    <main className={`dashboard-shell ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
      <button
        type="button"
        className={`dashboard-menu-toggle ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen((current) => !current)}
        aria-label={mobileMenuOpen ? t(props.locale, 'close') : t(props.locale, 'menu')}
      >
        <ChevronRight size={20} />
      </button>
      {mobileMenuOpen && <button type="button" className="dashboard-sidebar-scrim" onClick={() => setMobileMenuOpen(false)} aria-label={t(props.locale, 'close')} />}
      <aside className={`dashboard-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="owner-card">
          <BrandMark theme={props.theme} />
          <div>
            <strong>{props.mode === 'admin' ? t(props.locale, 'adminWorkspace') : t(props.locale, 'ownerWorkspace')}</strong>
            <small>{props.theme.siteName}</small>
          </div>
        </div>
        {sidebarItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeSection === id ? 'active' : ''} onClick={() => selectDashboardSection(id)}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </aside>

      <section className="dashboard-main">
        <div className="dashboard-topbar animated-panel">
          <div>
            <span className="eyebrow dark">{props.mode === 'admin' ? t(props.locale, 'adminWorkspace') : t(props.locale, 'ownerWorkspace')}</span>
            <h1>{activeLabel}</h1>
          </div>
          <div className="status-banner compact">
            <Check size={18} />
            {t(props.locale, 'menuActive')}
          </div>
        </div>

        <div key={activeSection} className="dashboard-view animated-panel">
          {activeSection === 'overview' && (
            <>
              <section className="stats-grid">
                <StatCard label={t(props.locale, 'revenueToday')} value={currency.format(revenue)} icon={<BadgeDollarSign />} />
                <StatCard label={t(props.locale, 'ordersToday')} value={String(todaysOrders.length)} icon={<ShoppingBag />} />
                <StatCard label={t(props.locale, 'availableItems')} value={String(props.items.filter((item) => item.available).length)} icon={<Check />} />
                <StatCard label={t(props.locale, 'totalCategories')} value={String(props.categories.length)} icon={<List />} />
              </section>
              <section className="dashboard-grid one-card">
                <div className="dashboard-card qr-card">
                  <div className="section-head">
                    <h2>{t(props.locale, 'qrCode')}</h2>
                    <QrCode size={21} />
                  </div>
                  {qrDataUrl && <img src={qrDataUrl} alt="Generated QR code for the public menu" />}
                  <input value={props.theme.menuUrl} onChange={(event) => props.setTheme({ ...props.theme, menuUrl: event.target.value })} />
                  <button className="small-action full-width" onClick={downloadQrCode}>
                    <Download size={16} />
                    {t(props.locale, 'downloadQr')}
                  </button>
                </div>
              </section>
              <section className="dashboard-card">
                <div className="section-head">
                  <h2>{t(props.locale, 'latestOrders')}</h2>
                  <span className="count-pill">{props.orders.length}</span>
                </div>
                <div className="orders-list">
                  {props.orders.slice(0, 3).map((order) => (
                    <OrderCard key={order.id} locale={props.locale} order={order} orders={props.orders} setOrders={props.setOrders} siteName={props.theme.siteName} />
                  ))}
                </div>
              </section>
            </>
          )}

          {activeSection === 'pos' && <PointOfSale items={props.items} categories={props.categories} theme={props.theme} locale={props.locale} onCreated={(order) => props.setOrders([order,...props.orders])} />}
          {activeSection === 'items' && (
            <ItemsManager
              locale={props.locale}
              items={props.items}
              setItems={props.setItems}
              categories={props.categories}
              importItemsFromExcel={importItemsFromExcel}
            />
          )}

          {activeSection === 'categories' && (
            <section className="dashboard-card focus-card" id="manage-categories">
            <div className="section-head">
              <h2>{t(props.locale, 'manageCategories')}</h2>
              <button className="small-action" onClick={addCategory}>
                <Plus size={16} /> {t(props.locale, 'add')}
              </button>
            </div>
            <div className="editable-list">
              {props.categories.map((category) => (
                <div key={category.id} className="editable-row two">
                  <input
                    value={category.name[props.locale]}
                    onChange={(event) =>
                      props.setCategories(props.categories.map((current) => (current.id === category.id ? { ...current, name: { ...current.name, [props.locale]: event.target.value } } : current)))
                    }
                  />
                  <button onClick={() => deleteCategory(category.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            </section>
          )}

          {activeSection === 'offers' && (
            <OffersManager
              locale={props.locale}
              items={props.items}
              createOffer={createOffer}
              updateOffer={updateOffer}
              toggleOfferAvailability={toggleOfferAvailability}
              deleteOffer={deleteOffer}
            />
          )}

          {activeSection === 'appearance' && (
            <AppearanceSettings
              locale={props.locale}
              theme={props.theme}
              setTheme={props.setTheme}
              layout={props.layout}
              setLayout={props.setLayout}
              persistSiteSettings={props.persistSiteSettings}
            />
          )}

          {activeSection === 'hours' && (
            <section className="dashboard-card focus-card" id="opening-hours">
            <h2>{t(props.locale, 'hours')}</h2>
            <div className="hours-list">
              {props.hours.map((hour) => (
                <div key={hour.day} className="hours-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={hour.enabled}
                      onChange={(event) => props.setHours(props.hours.map((current) => (current.day === hour.day ? { ...current, enabled: event.target.checked } : current)))}
                    />
                    {hour.day}
                  </label>
                  <input value={hour.open} onChange={(event) => props.setHours(props.hours.map((current) => (current.day === hour.day ? { ...current, open: event.target.value } : current)))} />
                  <input value={hour.close} onChange={(event) => props.setHours(props.hours.map((current) => (current.day === hour.day ? { ...current, close: event.target.value } : current)))} />
                </div>
              ))}
            </div>
            </section>
          )}

          {activeSection === 'orders' && (
            <section className="dashboard-card focus-card" id="orders">
            <div className="section-head">
              <h2>{t(props.locale, 'orders')}</h2>
              <span className="count-pill">{props.orders.length}</span>
            </div>
            <div className="orders-list">
              {props.orders.map((order) => (
                <OrderCard key={order.id} locale={props.locale} order={order} orders={props.orders} setOrders={props.setOrders} siteName={props.theme.siteName} />
              ))}
            </div>
            </section>
          )}

          {activeSection === 'users' && props.mode === 'admin' && <UsersManager locale={props.locale} users={props.users} setUsers={props.setUsers} />}
        </div>
      </section>
    </main>
  );
}

function OrderCard({ locale, order, orders, setOrders, siteName }: { locale: Locale; order: Order; orders: Order[]; setOrders: (orders: Order[]) => void; siteName: string }) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const changeStatus = async (status: Order['status']) => {
    setBusy(true); setError('');
    try { await updateRemoteOrderStatus(order,status); setOrders(orders.map(o => o.id===order.id ? {...o,status} : o)); }
    catch { setError(locale === 'de' ? 'Status nicht gespeichert. Bitte aktualisieren.' : 'Status not saved. Please refresh.'); }
    finally { setBusy(false); }
  };
  return (
    <article className="order-card">
      <div>
        <strong>#{order.orderNumber || order.id}</strong>
        <p>
          {order.customerName}
        </p>
        {order.notes && <small>{order.notes}</small>}
        <small>{order.lines.map((line) => `${line.quantity}x ${line.item.name[locale]}`).join(', ')}</small>
        <OrderReceipt order={order} siteName={siteName} locale={locale} />
        {error && <p role="alert" className="form-error">{error}</p>}
      </div>
      <div>
        <strong>{currency.format(order.total)}</strong>
        <select aria-label={locale === 'de' ? 'Bestellstatus' : 'Order status'} disabled={busy || order.status==='done' || order.status==='cancelled'} value={order.status} onChange={(event) => void changeStatus(event.target.value as Order['status'])}>
          <option value="new" disabled={order.status!=='new'}>{t(locale, 'statusNew')}</option>
          <option value="preparing">{t(locale, 'statusPreparing')}</option>
          <option value="done" disabled={order.status==='new'}>{t(locale, 'statusDone')}</option>
          <option value="cancelled">{locale === 'de' ? 'Storniert' : 'Cancelled'}</option>
        </select>
      </div>
    </article>
  );
}

function ItemsManager({
  locale,
  items,
  setItems,
  categories,
  importItemsFromExcel,
}: {
  locale: Locale;
  items: MenuItem[];
  setItems: (items: MenuItem[]) => void;
  categories: Category[];
  importItemsFromExcel: (file: File) => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nameEn: '',
    nameDe: '',
    descriptionEn: '',
    descriptionDe: '',
    categoryId: categories[0]?.id || '',
    imageUrl: '',
    price: '',
    badgeEn: '',
    badgeDe: '',
    imageStyle: 'pink',
    available: true,
  });
  const [formError, setFormError] = useState('');

  const badgePresets = [
    { en: '', de: '', label: t(locale, 'noBadge') },
    { en: 'New', de: 'Neu', label: t(locale, 'newBadge') },
    { en: 'Best seller', de: 'Bestseller', label: t(locale, 'bestSeller') },
    { en: 'Popular', de: 'Beliebt', label: t(locale, 'popular') },
    { en: 'Chef pick', de: 'Chefwahl', label: t(locale, 'chefPick') },
  ];

  useEffect(() => {
    if (!form.categoryId && categories[0]) {
      setForm((current) => ({ ...current, categoryId: categories[0].id }));
    }
  }, [categories, form.categoryId]);

  const updateItem = (id: string, patch: Partial<MenuItem>) => {
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const moveDraggedItem = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const fromIndex = sorted.findIndex((item) => item.id === draggedId);
    const toIndex = sorted.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);
    setItems(sorted.map((item, index) => ({ ...item, sortOrder: index + 1 })));
    setDraggedId(null);
  };

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setFormError(t(locale, 'imageFileRequired'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, imageUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const submitItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const price = Number(form.price);
    if (!form.nameEn.trim()) {
      setFormError(t(locale, 'itemNameRequired'));
      return;
    }
    if (!form.categoryId) {
      setFormError(t(locale, 'categoryRequired'));
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setFormError(t(locale, 'priceRequired'));
      return;
    }

    const item: MenuItem = {
      id: `item-${Date.now()}`,
      categoryId: form.categoryId,
      name: { en: form.nameEn.trim(), de: form.nameDe.trim() || form.nameEn.trim() },
      description: {
        en: form.descriptionEn.trim(),
        de: form.descriptionDe.trim() || form.descriptionEn.trim(),
      },
      price,
      badge: form.badgeEn.trim() ? { en: form.badgeEn.trim(), de: form.badgeDe.trim() || form.badgeEn.trim() } : undefined,
      imageStyle: form.imageStyle,
      imageUrl: form.imageUrl.trim(),
      available: form.available,
      sortOrder: items.length + 1,
    };

    setItems([...items, item]);
    setForm({
      nameEn: '',
      nameDe: '',
      descriptionEn: '',
      descriptionDe: '',
      categoryId: categories[0]?.id || '',
      imageUrl: '',
      price: '',
      badgeEn: '',
      badgeDe: '',
      imageStyle: 'pink',
      available: true,
    });
    setFormError('');
    setFormOpen(false);
  };

  const sortedItems = [...items].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="dashboard-card focus-card" id="manage-items">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'manageItems')}</h2>
          <p className="muted">{t(locale, 'addRichItems')}</p>
        </div>
        <div className="action-row">
          <a className="small-action neutral" href="/menu-items-template.xlsx" download>
            <FileSpreadsheet size={16} /> {t(locale, 'template')}
          </a>
          <label className="small-action neutral file-action">
            <FileSpreadsheet size={16} /> {t(locale, 'uploadExcel')}
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importItemsFromExcel(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button className="small-action" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> {t(locale, 'addItem')}
          </button>
        </div>
      </div>

      <div className="editable-list item-list" aria-label={t(locale, 'sortableItems')}>
        {sortedItems.map((item) => (
          <div
            key={item.id}
            className={`editable-row item-row ${draggedId === item.id ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDraggedId(item.id)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
            onDrop={() => moveDraggedItem(item.id)}
          >
            <span className="drag-handle" title={t(locale, 'dragToReorder')}>
              <GripVertical size={17} />
            </span>
            <div className={`row-thumb food-art ${item.imageStyle} ${item.imageUrl ? 'has-image' : ''}`}>
              {item.imageUrl && <img src={item.imageUrl} alt="" />}
            </div>
            <input
              value={item.name[locale]}
              onChange={(event) => updateItem(item.id, { name: { ...item.name, [locale]: event.target.value } })}
            />
            <select value={item.categoryId} onChange={(event) => updateItem(item.id, { categoryId: event.target.value })}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name[locale]}
                </option>
              ))}
            </select>
            <input type="number" value={item.price} onChange={(event) => updateItem(item.id, { price: Number(event.target.value) })} />
            <button title={t(locale, 'delete')} onClick={() => setItems(items.filter((current) => current.id !== item.id))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setFormOpen(false)}>
          <form className="item-form-card animated-panel" role="dialog" aria-modal="true" aria-label={t(locale, 'addItem')} onClick={(event) => event.stopPropagation()} onSubmit={submitItem}>
            <div className="section-head">
              <div>
                <span className="eyebrow dark">{t(locale, 'newMenuItem')}</span>
                <h2>{t(locale, 'addItem')}</h2>
              </div>
              <button type="button" className="ghost-icon dark" onClick={() => setFormOpen(false)} aria-label={t(locale, 'close')}>
                x
              </button>
            </div>

            <div className="form-grid">
              <label>
                {t(locale, 'itemName')}
                <input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} placeholder="Pink waffle" />
              </label>
              <label>
                {t(locale, 'germanName')}
                <input value={form.nameDe} onChange={(event) => setForm({ ...form, nameDe: event.target.value })} placeholder="Rosa Waffel" />
              </label>
              <label>
                {t(locale, 'category')}
                <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name.en}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(locale, 'price')}
                <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="8.50" />
              </label>
              <label className="wide">
                {t(locale, 'description')}
                <textarea value={form.descriptionEn} onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })} placeholder="Short appetizing menu description" />
              </label>
              <label className="wide">
                {t(locale, 'germanDescription')}
                <textarea value={form.descriptionDe} onChange={(event) => setForm({ ...form, descriptionDe: event.target.value })} placeholder="Optional German description" />
              </label>
            </div>

            <div className="item-form-split">
              <div className="upload-panel">
                <div className={`image-preview food-art ${form.imageStyle} ${form.imageUrl ? 'has-image' : ''}`}>
                  {form.imageUrl ? <img src={form.imageUrl} alt="Item preview" /> : <Image size={34} />}
                  {form.badgeEn && <span>{form.badgeEn}</span>}
                </div>
                <label>
                  {t(locale, 'imageUrl')}
                  <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://..." />
                </label>
                <label className="small-action neutral upload-button">
                  <Image size={16} /> {t(locale, 'uploadImage')}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleImageFile(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>

              <div className="theme-form">
                <label>
                  {t(locale, 'visualStyle')}
                  <select value={form.imageStyle} onChange={(event) => setForm({ ...form, imageStyle: event.target.value })}>
                    {['pink', 'lavender', 'caramel', 'mochi', 'matcha', 'drink-pink', 'combo'].map((style) => (
                      <option key={style} value={style}>
                        {style}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="badge-options" aria-label={t(locale, 'badgePresets')}>
                  {badgePresets.map((badge) => (
                    <button
                      key={badge.en || 'none'}
                      type="button"
                      className={form.badgeEn === badge.en ? 'active' : ''}
                      onClick={() => setForm({ ...form, badgeEn: badge.en, badgeDe: badge.de })}
                    >
                      {badge.label}
                    </button>
                  ))}
                </div>
                <label>
                  {t(locale, 'customBadge')}
                  <input value={form.badgeEn} onChange={(event) => setForm({ ...form, badgeEn: event.target.value })} placeholder="New, Best seller..." />
                </label>
                <label className="toggle-line">
                  <input type="checkbox" checked={form.available} onChange={(event) => setForm({ ...form, available: event.target.checked })} />
                  {t(locale, 'availableOnMenu')}
                </label>
              </div>
            </div>

            {formError && <p className="form-error">{formError}</p>}
            <div className="modal-actions">
              <button type="button" className="small-action neutral" onClick={() => setFormOpen(false)}>
                {t(locale, 'cancel')}
              </button>
              <button type="submit" className="small-action">
                <Save size={16} /> {t(locale, 'saveItem')}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function OffersManager({
  locale,
  items,
  createOffer,
  updateOffer,
  toggleOfferAvailability,
  deleteOffer,
}: {
  locale: Locale;
  items: MenuItem[];
  createOffer: (payload: { name: string; description: string; imageUrl: string; itemIds: string[]; price: number }) => void;
  updateOffer: (offerId: string, payload: { name: string; description: string; imageUrl: string; itemIds: string[]; price: number }) => void;
  toggleOfferAvailability: (offerId: string) => void;
  deleteOffer: (offerId: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<MenuItem | null>(null);
  const [name, setName] = useState('Weekend Combo');
  const [description, setDescription] = useState('A curated offer built from your best menu items.');
  const [imageUrl, setImageUrl] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [price, setPrice] = useState(12);
  const [error, setError] = useState('');
  const availableItems = items.filter((item) => !isOfferItem(item));
  const publishedOffers = items.filter(isOfferItem);

  const resetForm = () => {
    setEditingOffer(null);
    setName('Weekend Combo');
    setDescription('A curated offer built from your best menu items.');
    setImageUrl('');
    setSelectedIds([]);
    setPrice(12);
    setError('');
  };

  const openCreateForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditForm = (offer: MenuItem) => {
    setEditingOffer(offer);
    setName(offer.name[locale] || offer.name.en);
    setDescription(itemDescription(offer, locale) || itemDescription(offer, 'en'));
    setImageUrl(offer.imageUrl || '');
    setSelectedIds(offer.includedItemIds || []);
    setPrice(offer.price);
    setError('');
    setFormOpen(true);
  };

  const toggleItem = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]));
  };

  const selectedItems = availableItems.filter((item) => selectedIds.includes(item.id));
  const selectedTotal = selectedItems.reduce((sum, item) => sum + item.price, 0);
  const discount = Math.max(0, selectedTotal - price);

  const handleOfferImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t(locale, 'imageFileRequired'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const submitOffer = () => {
    if (!name.trim()) {
      setError(t(locale, 'offerNameRequired'));
      return;
    }
    if (!selectedIds.length) {
      setError(t(locale, 'offerItemsRequired'));
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError(t(locale, 'offerPriceRequired'));
      return;
    }

    if (editingOffer) {
      updateOffer(editingOffer.id, { name, description, imageUrl, itemIds: selectedIds, price });
    } else {
      createOffer({ name, description, imageUrl, itemIds: selectedIds, price });
    }
    resetForm();
    setFormOpen(false);
  };

  return (
    <section className="dashboard-card focus-card" id="offers">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'offers')}</h2>
          <p className="muted">{t(locale, 'offersCopy')}</p>
        </div>
        <button className="small-action" onClick={openCreateForm}>
          <Plus size={16} /> {t(locale, 'createOffer')}
        </button>
      </div>

      <div className="published-offers">
        <div className="section-head compact-head">
          <h3>{t(locale, 'existingOffers')}</h3>
          <span className="count-pill">{publishedOffers.length}</span>
        </div>
        {publishedOffers.length ? (
          <div className="admin-offers-grid">
            {publishedOffers.map((offer) => (
              <article key={offer.id} className={`admin-offer-card ${offer.available ? '' : 'paused'}`}>
                <div className={`admin-offer-media food-art ${offer.imageStyle} ${offer.imageUrl ? 'has-image' : ''}`}>
                  {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.name[locale]} /> : <BadgeDollarSign size={34} />}
                  <span>{offer.available ? t(locale, 'active') : t(locale, 'inactive')}</span>
                </div>
                <div className="admin-offer-body">
                  <div>
                    <h3>{offer.name[locale]}</h3>
                    <p>{itemDescription(offer, locale)}</p>
                  </div>
                  <div className="admin-offer-meta">
                    <strong>{currency.format(offer.price)}</strong>
                    <span>{(offer.includedItemIds || []).length} {t(locale, 'items')}</span>
                  </div>
                  <div className="admin-offer-actions">
                    <button type="button" className="small-action neutral" onClick={() => openEditForm(offer)}>
                      {t(locale, 'edit')}
                    </button>
                    <button type="button" className="small-action neutral" onClick={() => toggleOfferAvailability(offer.id)}>
                      {offer.available ? t(locale, 'pauseOffer') : t(locale, 'publishOffer')}
                    </button>
                    <button type="button" className="small-action danger" onClick={() => deleteOffer(offer.id)}>
                      <Trash2 size={15} /> {t(locale, 'delete')}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t(locale, 'noOffers')}</div>
        )}
      </div>

      {formOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setFormOpen(false)}>
          <div className="item-form-card offer-modal-card animated-panel" role="dialog" aria-modal="true" aria-label={editingOffer ? t(locale, 'editOffer') : t(locale, 'createOffer')} onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <span className="eyebrow dark">{t(locale, 'offers')}</span>
                <h2>{editingOffer ? t(locale, 'editOffer') : t(locale, 'createOffer')}</h2>
              </div>
              <button type="button" className="ghost-icon dark" onClick={() => setFormOpen(false)} aria-label={t(locale, 'close')}>
                x
              </button>
            </div>

            <div className="offer-builder">
              <div className="offer-form-card">
                <div className={`offer-preview food-art combo ${imageUrl ? 'has-image' : ''}`}>
                  {imageUrl ? <img src={imageUrl} alt="Offer preview" /> : <BadgeDollarSign size={42} />}
                  <span>{t(locale, 'offers')}</span>
                </div>
                <div className="theme-form">
                  <label>
                    {t(locale, 'offerName')}
                    <input value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <label>
                    {t(locale, 'offerDescription')}
                    <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
                  </label>
                  <label>
                    {t(locale, 'offerImageUrl')}
                    <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." />
                  </label>
                  <label className="small-action neutral upload-button">
                    <Image size={16} /> {t(locale, 'uploadOfferImage')}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleOfferImageFile(file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <label>
                    {t(locale, 'offerPrice')}
                    <input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))} />
                  </label>
                </div>
                <div className="offer-summary-grid">
                  <div>
                    <span>{t(locale, 'selectedValue')}</span>
                    <strong>{currency.format(selectedTotal)}</strong>
                  </div>
                  <div>
                    <span>{t(locale, 'discount')}</span>
                    <strong>{currency.format(discount)}</strong>
                  </div>
                  <div>
                    <span>{t(locale, 'items')}</span>
                    <strong>{selectedIds.length}</strong>
                  </div>
                </div>
                {error && <p className="form-error">{error}</p>}
              </div>

              <div className="offer-selection-panel">
                <div className="section-head compact-head">
                  <h3>{t(locale, 'selectIncludedItems')}</h3>
                  <span className="count-pill">{selectedIds.length}</span>
                </div>
                {availableItems.map((item) => (
                  <button key={item.id} className={`selection-card ${selectedIds.includes(item.id) ? 'selected' : ''}`} onClick={() => toggleItem(item.id)}>
                    <div className={`selection-thumb food-art ${item.imageStyle} ${item.imageUrl ? 'has-image' : ''}`}>
                      {item.imageUrl && <img src={item.imageUrl} alt="" />}
                    </div>
                    <span>{item.name[locale]}</span>
                    <strong>{currency.format(item.price)}</strong>
                    <Check size={17} />
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="small-action neutral" onClick={() => setFormOpen(false)}>
                {t(locale, 'cancel')}
              </button>
              <button type="button" className="small-action" onClick={submitOffer}>
                <Save size={16} /> {t(locale, 'saveOffer')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AppearanceSettings({
  locale,
  theme,
  setTheme,
  layout,
  setLayout,
  persistSiteSettings,
}: {
  locale: Locale;
  theme: ThemeSettings;
  setTheme: (theme: ThemeSettings) => void;
  layout: MenuLayout;
  setLayout: (layout: MenuLayout) => void;
  persistSiteSettings: (theme: ThemeSettings, layout: MenuLayout) => Promise<void>;
}) {
  const [draftTheme, setDraftTheme] = useState<ThemeSettings>(theme);
  const [draftLayout, setDraftLayout] = useState<MenuLayout>(layout);
  const [activeTab, setActiveTab] = useState<AppearanceTab>('brand');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setDraftTheme(theme);
  }, [theme]);

  useEffect(() => {
    setDraftLayout(layout);
  }, [layout]);

  const updateSocialLink = (id: string, patch: Partial<SocialLink>) => {
    setDraftTheme({
      ...draftTheme,
      socialLinks: (draftTheme.socialLinks || []).map((link) => (link.id === id ? { ...link, ...patch } : link)),
    });
  };

  const updateSocialPlatform = (link: SocialLink, platform: string) => {
    const platformMeta = socialPlatforms.get(platform as (typeof socialPlatformOptions)[number]['value']);
    updateSocialLink(link.id, {
      platform,
      label: platform === 'custom' ? link.label : platformMeta?.label || link.label,
    });
  };

  const addSocialLink = () => {
    setDraftTheme({
      ...draftTheme,
      socialLinks: [...(draftTheme.socialLinks || []), { id: `social-${Date.now()}`, platform: 'instagram', label: 'Instagram', url: '', active: true }],
    });
  };

  const deleteSocialLink = (id: string) => {
    setDraftTheme({ ...draftTheme, socialLinks: (draftTheme.socialLinks || []).filter((link) => link.id !== id) });
  };

  const saveAppearance = async () => {
    setSaving(true);
    setSaveError('');
    try {
      setTheme(draftTheme);
      setLayout(draftLayout);
      await persistSiteSettings(draftTheme, draftLayout);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t(locale, 'saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dashboard-card focus-card" id="appearance">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'appearance')}</h2>
          <p className="muted">{t(locale, 'appearanceCopy')}</p>
        </div>
        <button className="small-action" onClick={() => void saveAppearance()} disabled={saving}>
          <Save size={16} />
          {saving ? t(locale, 'saving') : saved ? t(locale, 'saved') : t(locale, 'save')}
        </button>
      </div>
      {saveError && <p className="form-error">{saveError}</p>}

      <div className="appearance-tabs">
        {([
          ['brand', t(locale, 'brand')],
          ['colors', t(locale, 'colors')],
          ['layout', t(locale, 'layout')],
          ['contact', t(locale, 'contactAndSocial')],
          ['qr', 'QR'],
        ] as Array<[AppearanceTab, string]>).map(([id, label]) => (
          <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div key={activeTab} className="appearance-workspace animated-panel">
        {activeTab === 'brand' && (
          <>
            <div className="brand-preview">
              <BrandMark theme={draftTheme} />
              <div>
                <strong>{draftTheme.siteName}</strong>
                <span>{draftTheme.logoText}</span>
              </div>
            </div>
            <div className="theme-form">
              <label>
                {t(locale, 'siteName')}
                <input value={draftTheme.siteName} onChange={(event) => setDraftTheme({ ...draftTheme, siteName: event.target.value })} />
              </label>
              <label>
                {t(locale, 'logoText')}
                <input value={draftTheme.logoText} onChange={(event) => setDraftTheme({ ...draftTheme, logoText: event.target.value })} />
              </label>
              <label>
                {t(locale, 'logoImageUrl')}
                <span className="input-with-icon">
                  <Image size={18} />
                  <input value={draftTheme.logoUrl} onChange={(event) => setDraftTheme({ ...draftTheme, logoUrl: event.target.value })} placeholder="https://..." />
                </span>
              </label>
            </div>
          </>
        )}

        {activeTab === 'colors' && (
          <div className="theme-form color-grid">
            <ColorInput label={t(locale, 'primaryButtons')} value={draftTheme.primary} onChange={(value) => setDraftTheme({ ...draftTheme, primary: value })} />
            <ColorInput label={t(locale, 'accentActions')} value={draftTheme.accent} onChange={(value) => setDraftTheme({ ...draftTheme, accent: value })} />
            <ColorInput label={t(locale, 'lavender')} value={draftTheme.lavender} onChange={(value) => setDraftTheme({ ...draftTheme, lavender: value })} />
            <ColorInput label={t(locale, 'background')} value={draftTheme.background} onChange={(value) => setDraftTheme({ ...draftTheme, background: value })} />
            <ColorInput label={t(locale, 'surface')} value={draftTheme.surface} onChange={(value) => setDraftTheme({ ...draftTheme, surface: value })} />
            <ColorInput label={t(locale, 'cards')} value={draftTheme.card} onChange={(value) => setDraftTheme({ ...draftTheme, card: value })} />
            <ColorInput label={t(locale, 'text')} value={draftTheme.text} onChange={(value) => setDraftTheme({ ...draftTheme, text: value })} />
            <ColorInput label={t(locale, 'mutedText')} value={draftTheme.mutedText} onChange={(value) => setDraftTheme({ ...draftTheme, mutedText: value })} />
            <ColorInput label={t(locale, 'buttonText')} value={draftTheme.buttonText} onChange={(value) => setDraftTheme({ ...draftTheme, buttonText: value })} />
            <ColorInput label={t(locale, 'borders')} value={draftTheme.border} onChange={(value) => setDraftTheme({ ...draftTheme, border: value })} />
          </div>
        )}

        {activeTab === 'layout' && (
          <div className="layout-settings">
            <h3>{t(locale, 'layout')}</h3>
            <p className="muted">{t(locale, 'layoutCopy')}</p>
            <LayoutToggle locale={locale} layout={draftLayout} setLayout={setDraftLayout} />
          </div>
        )}

        {activeTab === 'contact' && (
          <div className="contact-settings">
            <div className="contact-settings-grid">
              <label>
                {t(locale, 'phoneCountryCode')}
                <input value={draftTheme.phoneCountryCode || ''} onChange={(event) => setDraftTheme({ ...draftTheme, phoneCountryCode: event.target.value })} placeholder="+49" />
              </label>
              <label>
                {t(locale, 'restaurantPhone')}
                <input value={draftTheme.phoneNumber || ''} onChange={(event) => setDraftTheme({ ...draftTheme, phoneNumber: event.target.value })} placeholder="151 000 2026" />
              </label>
            </div>

            <div className="social-links-editor">
              <div className="section-head">
                <div>
                  <h3>{t(locale, 'socialLinks')}</h3>
                  <p className="muted">{t(locale, 'socialSettingsCopy')}</p>
                </div>
                <button type="button" className="small-action neutral" onClick={addSocialLink}>
                  <Plus size={16} /> {t(locale, 'addSocialLink')}
                </button>
              </div>
              {(draftTheme.socialLinks || []).map((link) => (
                <div key={link.id} className="social-link-row">
                  <label>
                    {t(locale, 'socialPlatform')}
                    <select value={link.platform || socialPlatformKind(link)} onChange={(event) => updateSocialPlatform(link, event.target.value)}>
                      {socialPlatformOptions.map((platform) => (
                        <option key={platform.value} value={platform.value}>
                          {platform.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(link.platform || socialPlatformKind(link)) === 'custom' && (
                    <label>
                      {t(locale, 'socialLabel')}
                      <input value={link.label} onChange={(event) => updateSocialLink(link.id, { label: event.target.value })} placeholder="Website" />
                    </label>
                  )}
                  <label>
                    {t(locale, 'socialUrl')}
                    <input value={link.url} onChange={(event) => updateSocialLink(link.id, { url: event.target.value })} placeholder="https://..." />
                  </label>
                  <label className="toggle-field">
                    <input type="checkbox" checked={link.active} onChange={(event) => updateSocialLink(link.id, { active: event.target.checked })} />
                    {t(locale, 'showOnMenu')}
                  </label>
                  <button type="button" className="ghost-icon danger-icon" onClick={() => deleteSocialLink(link.id)} aria-label={t(locale, 'delete')}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'qr' && (
          <div className="theme-form">
            <label>
              {t(locale, 'menuPublicUrl')}
              <input value={draftTheme.menuUrl} onChange={(event) => setDraftTheme({ ...draftTheme, menuUrl: event.target.value })} />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <span className="color-control">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}

function UsersManager({ locale, users, setUsers }: { locale: Locale; users: AppUser[]; setUsers: (users: AppUser[]) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<AdminUserPayload>({
    name: '',
    email: '',
    role: 'owner',
    restaurant: 'Sweezypop',
    active: true,
  });

  const addUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setActionError('');

    createAdminUser(form)
      .then(({ user, temporaryPassword: password }) => {
        setUsers([...users, user]);
        setTemporaryPassword(password);
        setFormOpen(false);
        setForm({ name: '', email: '', role: 'owner', restaurant: form.restaurant, active: true });
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : t(locale, 'userCreateFailed')))
      .finally(() => setCreating(false));
  };

  const resetPassword = (user: AppUser) => {
    setActionError('');
    resetAdminUserPassword(user.id)
      .then(({ temporaryPassword: password }) => {
        setTemporaryPassword(password);
        setUsers(users.map((current) => (current.id === user.id ? { ...current, mustChangePassword: true } : current)));
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : t(locale, 'passwordResetFailed')));
  };

  const removeUser = async (user: AppUser) => {
    if (!window.confirm(locale === 'de' ? `${user.name} dauerhaft löschen?` : `Permanently delete ${user.name}?`)) return;
    setActionError('');
    try { await deleteAdminUser(user.id); setUsers(users.filter((current) => current.id !== user.id)); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'User deletion failed.'); }
  };

  return (
    <section className="dashboard-card" id="users">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'users')}</h2>
          <p className="muted">{t(locale, 'usersSecurityCopy')}</p>
        </div>
        <button className="small-action" onClick={() => setFormOpen(true)}>
          <CircleUserRound size={16} /> {t(locale, 'addOwner')}
        </button>
      </div>
      {actionError && <p className="form-error">{actionError}</p>}
      <div className="user-table">
        <div className="table-head">
          <span>{t(locale, 'name')}</span>
          <span>{t(locale, 'email')}</span>
          <span>{t(locale, 'role')}</span>
          <span>{t(locale, 'restaurant')}</span>
          <span>{t(locale, 'status')}</span>
          <span>{t(locale, 'password')}</span>
        </div>
        {users.map((user) => (
          <div key={user.id} className="table-row">
            <input value={user.name} onChange={(event) => setUsers(users.map((current) => (current.id === user.id ? { ...current, name: event.target.value } : current)))} />
            <input value={user.email} readOnly title="Login email is managed through Supabase Authentication" />
            <select value={user.role} onChange={(event) => setUsers(users.map((current) => (current.id === user.id ? { ...current, role: event.target.value as AppUser['role'] } : current)))}>
              <option value="owner">{t(locale, 'owner')}</option>
              <option value="admin">{t(locale, 'admin')}</option>
            </select>
            <input value={user.restaurant} onChange={(event) => setUsers(users.map((current) => (current.id === user.id ? { ...current, restaurant: event.target.value } : current)))} />
            <button className={user.active ? 'status active' : 'status'} onClick={() => setUsers(users.map((current) => (current.id === user.id ? { ...current, active: !current.active } : current)))}>
              {user.active ? t(locale, 'active') : t(locale, 'inactive')}
            </button>
            <button className={user.mustChangePassword ? 'status' : 'status active'} type="button" onClick={() => resetPassword(user)}>
              {user.mustChangePassword ? t(locale, 'pendingChange') : t(locale, 'resetPassword')}
            </button>
            <button onClick={() => void removeUser(user)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setFormOpen(false)}>
          <form className="item-form-card user-form-card animated-panel" role="dialog" aria-modal="true" aria-label={t(locale, 'addOwner')} onClick={(event) => event.stopPropagation()} onSubmit={addUser}>
            <div className="section-head">
              <div>
                <span className="eyebrow dark">{t(locale, 'users')}</span>
                <h2>{t(locale, 'createUser')}</h2>
              </div>
              <button type="button" className="ghost-icon dark" onClick={() => setFormOpen(false)} aria-label={t(locale, 'close')}>
                x
              </button>
            </div>
            <div className="form-grid">
              <label>
                {t(locale, 'name')}
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </label>
              <label>
                {t(locale, 'email')}
                <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" required />
              </label>
              <label>
                {t(locale, 'role')}
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AppUser['role'] })}>
                  <option value="owner">{t(locale, 'owner')}</option>
                  <option value="admin">{t(locale, 'admin')}</option>
                </select>
              </label>
              <label>
                {t(locale, 'restaurant')}
                <input value={form.restaurant} onChange={(event) => setForm({ ...form, restaurant: event.target.value })} />
              </label>
              <label className="toggle-line wide">
                <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
                {t(locale, 'active')}
              </label>
            </div>
            <p className="muted">{t(locale, 'temporaryPasswordNotice')}</p>
            <div className="modal-actions">
              <button type="button" className="small-action neutral" onClick={() => setFormOpen(false)}>
                {t(locale, 'cancel')}
              </button>
              <button type="submit" className="small-action" disabled={creating}>
                <Save size={16} /> {creating ? t(locale, 'saving') : t(locale, 'createUser')}
              </button>
            </div>
          </form>
        </div>
      )}

      {temporaryPassword && (
        <div className="modal-overlay" role="presentation" onClick={() => setTemporaryPassword('')}>
          <div className="item-form-card temp-password-card animated-panel" role="dialog" aria-modal="true" aria-label={t(locale, 'temporaryPassword')} onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <span className="eyebrow dark">{t(locale, 'temporaryPassword')}</span>
                <h2>{t(locale, 'copyTemporaryPassword')}</h2>
              </div>
              <button type="button" className="ghost-icon dark" onClick={() => setTemporaryPassword('')} aria-label={t(locale, 'close')}>
                x
              </button>
            </div>
            <p className="muted">{t(locale, 'temporaryPasswordOnce')}</p>
            <code className="temporary-password">{temporaryPassword}</code>
            <div className="modal-actions">
              <button
                type="button"
                className="small-action neutral"
                onClick={() => {
                  void navigator.clipboard?.writeText(temporaryPassword);
                }}
              >
                {t(locale, 'copy')}
              </button>
              <button type="button" className="small-action" onClick={() => setTemporaryPassword('')}>
                {t(locale, 'done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default App;
