import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent } from 'react';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import {
  BadgeDollarSign,
  CalendarClock,
  Check,
  CircleUserRound,
  Download,
  FileSpreadsheet,
  GripVertical,
  Image,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  Minus,
  Palette,
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
  createRemoteOrder,
  loadRemoteState,
  resetAdminUserPassword,
  saveRemoteState,
  type AdminUserPayload,
  type RemoteState,
} from './remoteData';
import { isSupabaseConfigured, supabase } from './supabase';
import type { AppUser, CartLine, Category, Locale, MenuItem, MenuLayout, OpeningHour, Order, ThemeSettings } from './types';

type View = 'menu' | 'login' | 'owner' | 'admin' | 'password-change';
type DashboardSection = 'overview' | 'items' | 'categories' | 'offers' | 'appearance' | 'hours' | 'orders' | 'users';
type AppearanceTab = 'brand' | 'colors' | 'layout' | 'qr';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });
const storageKeys = {
  layout: 'sweezypop.layout',
  items: 'sweezypop.items',
  categories: 'sweezypop.categories',
  orders: 'sweezypop.orders',
  users: 'sweezypop.users',
  theme: 'sweezypop.theme',
  hours: 'sweezypop.hours',
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
  window.localStorage.setItem(key, JSON.stringify(value));
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

function App() {
  const [view, setView] = useState<View>('menu');
  const [locale, setLocale] = useState<Locale>('en');
  const [layout, setLayout] = useState<MenuLayout>(() => loadStored(storageKeys.layout, 'grid'));
  const [items, setItems] = useState<MenuItem[]>(() => loadStored(storageKeys.items, seedItems));
  const [categories, setCategories] = useState<Category[]>(() => loadStored(storageKeys.categories, seedCategories));
  const [orders, setOrders] = useState<Order[]>(() => loadStored(storageKeys.orders, initialOrders));
  const [users, setUsers] = useState<AppUser[]>(() => loadStored(storageKeys.users, seedUsers));
  const [theme, setTheme] = useState<ThemeSettings>(() => loadStored(storageKeys.theme, defaultTheme));
  const [hours, setHours] = useState<OpeningHour[]>(() => loadStored(storageKeys.hours, seedHours));
  const [activeCategory, setActiveCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [authRole, setAuthRole] = useState<'owner' | 'admin' | null>(null);
  const [submittedOrderId, setSubmittedOrderId] = useState('');
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);

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
  useEffect(() => saveStored(storageKeys.orders, orders), [orders]);
  useEffect(() => saveStored(storageKeys.users, users), [users]);
  useEffect(() => saveStored(storageKeys.theme, theme), [theme]);
  useEffect(() => saveStored(storageKeys.hours, hours), [hours]);

  useEffect(() => {
    const syncStoredData = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue);
        if (event.key === storageKeys.items) setItems(value);
        if (event.key === storageKeys.categories) setCategories(value);
        if (event.key === storageKeys.orders) setOrders(value);
        if (event.key === storageKeys.users) setUsers(value);
        if (event.key === storageKeys.theme) setTheme(value);
        if (event.key === storageKeys.hours) setHours(value);
        if (event.key === storageKeys.layout) setLayout(value);
      } catch {
        // Ignore malformed external storage writes.
      }
    };
    window.addEventListener('storage', syncStoredData);
    return () => window.removeEventListener('storage', syncStoredData);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const fallback: RemoteState = { categories, items, orders, users, theme, hours };
    loadRemoteState(fallback)
      .then((remoteState) => {
        if (!remoteState) return;
        setCategories(remoteState.categories);
        setItems(remoteState.items);
        setOrders(remoteState.orders);
        setUsers(remoteState.users);
        setTheme(remoteState.theme);
        setHours(remoteState.hours);
      })
      .catch((error: unknown) => {
        console.warn('Supabase load failed. Using local demo data.', error);
      })
      .finally(() => setRemoteReady(true));
    // Run once on boot. Fallback values are only used when remote rows are empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteReady || !authRole) return;
    const syncId = window.setTimeout(() => {
      saveRemoteState({ categories, items, orders, users, theme, hours }).catch((error: unknown) => {
        console.warn('Supabase save failed. Check auth, RLS policies, and env variables.', error);
      });
    }, 900);

    return () => window.clearTimeout(syncId);
  }, [authRole, categories, hours, items, orders, remoteReady, theme, users]);

  const addToCart = (item: MenuItem) => {
    setSubmittedOrderId('');
    setCart((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (existing) {
        return current.map((line) => (line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...current, { item, quantity: 1 }];
    });
  };

  const updateCartQuantity = (itemId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) => (line.item.id === itemId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  };

  const removeCartLine = (itemId: string) => {
    setCart((current) => current.filter((line) => line.item.id !== itemId));
  };

  const submitOrder = (payload: { name: string; address: string; phone: string; notes: string }) => {
    if (!cart.length) return;
    const total = cart.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
    const order: Order = {
      id: `SP-${Math.floor(1100 + Math.random() * 9000)}`,
      customerName: payload.name || 'Guest',
      address: payload.address,
      phone: payload.phone,
      notes: payload.notes,
      lines: cart,
      total,
      status: 'new',
      createdAt: 'Just now',
    };
    setOrders((current) => [order, ...current]);
    if (isSupabaseConfigured) {
      createRemoteOrder(order).catch((error: unknown) => {
        console.warn('Supabase order insert failed. Order remains stored locally.', error);
      });
    }
    setCart([]);
    setSubmittedOrderId(order.id);
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
      const remoteState = await loadRemoteState({ categories, items, orders, users, theme, hours });
      if (remoteState) {
        setCategories(remoteState.categories);
        setItems(remoteState.items);
        setOrders(remoteState.orders);
        setUsers(remoteState.users);
        setTheme(remoteState.theme);
        setHours(remoteState.hours);
      }
      setAuthRole(profile.role);
      setView(profile.must_change_password ? 'password-change' : profile.role);
      window.history.replaceState(null, '', window.location.pathname);
      return null;
    }

    const matchedUser = users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase() && user.active);
    const role = matchedUser?.role || (email.toLowerCase().includes('admin') ? 'admin' : 'owner');
    setAuthRole(role);
    setView(role);
    window.history.replaceState(null, '', window.location.pathname);
    return null;
  };

  const handleLogout = () => {
    if (supabase) void supabase.auth.signOut();
    setAuthRole(null);
    setView('menu');
    window.history.replaceState(null, '', window.location.pathname);
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
      <TopNav view={view} setView={setView} locale={locale} setLocale={setLocale} theme={theme} authRole={authRole} onLogout={handleLogout} />
      {view === 'menu' ? (
        <MenuPage
          locale={locale}
          layout={layout}
          setLayout={setLayout}
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
          hours={hours}
          setHours={setHours}
        />
      )}
    </div>
  );
}

function TopNav({
  view,
  setView,
  locale,
  setLocale,
  theme,
  authRole,
  onLogout,
}: {
  view: View;
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
        <button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
          EN
        </button>
        <button className={locale === 'de' ? 'active' : ''} onClick={() => setLocale('de')}>
          DE
        </button>
        {authRole ? (
          <>
            <button className={view === authRole ? 'active' : ''} onClick={() => setView(authRole)}>
              <Settings size={16} />
              {t(locale, 'dashboard')}
            </button>
            <button onClick={onLogout}>
              <LogOut size={16} />
              {t(locale, 'signOut')}
            </button>
          </>
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
    supabase.auth
      .updateUser({ password })
      .then(async ({ error: updateError }) => {
        if (updateError) throw updateError;
        await completeTemporaryPasswordChange();
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
  setLayout: (layout: MenuLayout) => void;
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
  submitOrder: (payload: { name: string; address: string; phone: string; notes: string }) => void;
  submittedOrderId: string;
}) {
  const filtered = useMemo(() => {
    return props.items
      .filter((item) => item.available)
      .filter((item) => props.activeCategory === 'all' || item.categoryId === props.activeCategory)
      .filter((item) => `${item.name[props.locale]} ${item.description[props.locale]}`.toLowerCase().includes(props.query.toLowerCase()))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [props.activeCategory, props.items, props.locale, props.query]);

  const today = props.hours.find((hour) => hour.enabled);
  const featuredOffers = props.items.filter((item) => item.available && item.categoryId === 'offers').sort((a, b) => a.sortOrder - b.sortOrder);
  const showFeaturedOffers = featuredOffers.length > 0 && (props.activeCategory === 'all' || props.activeCategory === 'offers');
  const visibleMenuItems = props.activeCategory === 'all' ? filtered.filter((item) => item.categoryId !== 'offers') : props.activeCategory === 'offers' ? [] : filtered;

  return (
    <main className="menu-shell">
      <section className="menu-hero">
        <div className="hero-media">
          <div className="plate plate-one" />
          <div className="plate plate-two" />
          <div className="plate plate-three" />
        </div>
        <div className="hero-copy">
          <span className="eyebrow">{t(props.locale, 'openNow')} {today ? `${today.open}-${today.close}` : ''}</span>
          <h1>{props.theme.siteName}</h1>
          <p>{t(props.locale, 'heroCopy')}</p>
          <div className="hero-actions">
            <a href="#menu-list" className="primary-action">
              {t(props.locale, 'orderNow')}
            </a>
          </div>
        </div>
      </section>

      <section className="menu-tools">
        <label className="search-box">
          <Search size={18} />
          <input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder={t(props.locale, 'search')} />
        </label>
        <LayoutToggle locale={props.locale} layout={props.layout} setLayout={props.setLayout} />
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

      {showFeaturedOffers && <FeaturedOffers offers={featuredOffers} locale={props.locale} onAdd={props.addToCart} />}

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

function FeaturedOffers({ offers, locale, onAdd }: { offers: MenuItem[]; locale: Locale; onAdd: (item: MenuItem) => void }) {
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
          <MenuCard key={offer.id} item={offer} locale={locale} layout="grid" onAdd={onAdd} />
        ))}
      </div>
    </section>
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
        <p>{item.description[locale]}</p>
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
  submitOrder: (payload: { name: string; address: string; phone: string; notes: string }) => void;
  submittedOrderId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const total = cart.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

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
              <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t(locale, 'address')} />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t(locale, 'phone')} />
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t(locale, 'notes')} />
            </div>
            <button className="primary-action full" onClick={() => submitOrder({ name, address, phone, notes })}>
              {t(locale, 'checkout')}
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
  hours: OpeningHour[];
  setHours: (hours: OpeningHour[]) => void;
}) {
  const revenue = props.orders.reduce((sum, order) => sum + order.total, 0);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview');

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
    };
    props.setItems([...props.items, offer]);
  };

  const importItemsFromExcel = async (file: File) => {
    const rows = await readMenuRowsFromWorkbook(file);
    const categoryMap = new Map(props.categories.map((category) => [category.name.en.toLowerCase(), category]));
    const importedCategories = [...props.categories];
    const importedItems: MenuItem[] = [];

    rows.forEach((row, index) => {
      const nameEn = String(row.name_en || '').trim();
      const categoryName = String(row.category || '').trim();
      const price = Number(row.price || 0);
      if (!nameEn || !categoryName || Number.isNaN(price)) return;

      let category = categoryMap.get(categoryName.toLowerCase());
      if (!category) {
        category = {
          id: `cat-${Date.now()}-${index}`,
          name: { en: categoryName, de: categoryName },
          sortOrder: importedCategories.length + 1,
        };
        categoryMap.set(categoryName.toLowerCase(), category);
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

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="owner-card">
          <BrandMark theme={props.theme} />
          <div>
            <strong>{props.mode === 'admin' ? t(props.locale, 'adminWorkspace') : t(props.locale, 'ownerWorkspace')}</strong>
            <small>{props.theme.siteName}</small>
          </div>
        </div>
        {sidebarItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}>
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
                <StatCard label={t(props.locale, 'ordersToday')} value={String(props.orders.length)} icon={<ShoppingBag />} />
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
                    <OrderCard key={order.id} locale={props.locale} order={order} orders={props.orders} setOrders={props.setOrders} />
                  ))}
                </div>
              </section>
            </>
          )}

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
                  <button onClick={() => props.setCategories(props.categories.filter((current) => current.id !== category.id))}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            </section>
          )}

          {activeSection === 'offers' && (
            <OffersManager locale={props.locale} items={props.items} createOffer={createOffer} />
          )}

          {activeSection === 'appearance' && (
            <AppearanceSettings
              locale={props.locale}
              theme={props.theme}
              setTheme={props.setTheme}
              layout={props.layout}
              setLayout={props.setLayout}
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
                <OrderCard key={order.id} locale={props.locale} order={order} orders={props.orders} setOrders={props.setOrders} />
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

function OrderCard({ locale, order, orders, setOrders }: { locale: Locale; order: Order; orders: Order[]; setOrders: (orders: Order[]) => void }) {
  return (
    <article className="order-card">
      <div>
        <strong>{order.id}</strong>
        <p>
          {order.customerName} - {order.phone}
        </p>
        <small>{order.lines.map((line) => `${line.quantity}x ${line.item.name[locale]}`).join(', ')}</small>
      </div>
      <div>
        <strong>{currency.format(order.total)}</strong>
        <select value={order.status} onChange={(event) => setOrders(orders.map((current) => (current.id === order.id ? { ...current, status: event.target.value as Order['status'] } : current)))}>
          <option value="new">{t(locale, 'statusNew')}</option>
          <option value="preparing">{t(locale, 'statusPreparing')}</option>
          <option value="done">{t(locale, 'statusDone')}</option>
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
}: {
  locale: Locale;
  items: MenuItem[];
  createOffer: (payload: { name: string; description: string; imageUrl: string; itemIds: string[]; price: number }) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('Weekend Combo');
  const [description, setDescription] = useState('A curated offer built from your best menu items.');
  const [imageUrl, setImageUrl] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [price, setPrice] = useState(12);
  const [error, setError] = useState('');
  const availableItems = items.filter((item) => item.categoryId !== 'offers');
  const publishedOffers = items.filter((item) => item.categoryId === 'offers');

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

    createOffer({ name, description, imageUrl, itemIds: selectedIds, price });
    setSelectedIds([]);
    setImageUrl('');
    setError('');
    setFormOpen(false);
  };

  return (
    <section className="dashboard-card focus-card" id="offers">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'offers')}</h2>
          <p className="muted">{t(locale, 'offersCopy')}</p>
        </div>
        <button className="small-action" onClick={() => setFormOpen(true)}>
          <Plus size={16} /> {t(locale, 'createOffer')}
        </button>
      </div>

      <div className="published-offers">
        <div className="section-head compact-head">
          <h3>{t(locale, 'existingOffers')}</h3>
          <span className="count-pill">{publishedOffers.length}</span>
        </div>
        {publishedOffers.length ? (
          <div className="offer-menu-grid">
            {publishedOffers.map((offer) => (
              <MenuCard key={offer.id} item={offer} locale={locale} layout="grid" onAdd={() => undefined} />
            ))}
          </div>
        ) : (
          <div className="empty-state">{t(locale, 'noOffers')}</div>
        )}
      </div>

      {formOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setFormOpen(false)}>
          <div className="item-form-card offer-modal-card animated-panel" role="dialog" aria-modal="true" aria-label={t(locale, 'createOffer')} onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <span className="eyebrow dark">{t(locale, 'offers')}</span>
                <h2>{t(locale, 'createOffer')}</h2>
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
}: {
  locale: Locale;
  theme: ThemeSettings;
  setTheme: (theme: ThemeSettings) => void;
  layout: MenuLayout;
  setLayout: (layout: MenuLayout) => void;
}) {
  const [draftTheme, setDraftTheme] = useState<ThemeSettings>(theme);
  const [draftLayout, setDraftLayout] = useState<MenuLayout>(layout);
  const [activeTab, setActiveTab] = useState<AppearanceTab>('brand');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraftTheme(theme);
  }, [theme]);

  useEffect(() => {
    setDraftLayout(layout);
  }, [layout]);

  const saveAppearance = () => {
    setTheme(draftTheme);
    setLayout(draftLayout);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <section className="dashboard-card focus-card" id="appearance">
      <div className="section-head">
        <div>
          <h2>{t(locale, 'appearance')}</h2>
          <p className="muted">{t(locale, 'appearanceCopy')}</p>
        </div>
        <button className="small-action" onClick={saveAppearance}>
          <Save size={16} />
          {saved ? t(locale, 'saved') : t(locale, 'save')}
        </button>
      </div>

      <div className="appearance-tabs">
        {([
          ['brand', t(locale, 'brand')],
          ['colors', t(locale, 'colors')],
          ['layout', t(locale, 'layout')],
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

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
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

    if (!isSupabaseConfigured) {
      const localUser: AppUser = {
        id: `u-${Date.now()}`,
        name: form.name,
        email: form.email,
        role: form.role,
        restaurant: form.restaurant,
        active: form.active,
        mustChangePassword: true,
      };
      setUsers([...users, localUser]);
      setTemporaryPassword('DemoOnly-ChangeMe!42');
      setCreating(false);
      setFormOpen(false);
      return;
    }

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
    if (!isSupabaseConfigured) {
      setTemporaryPassword('DemoOnly-Reset!42');
      setUsers(users.map((current) => (current.id === user.id ? { ...current, mustChangePassword: true } : current)));
      return;
    }

    resetAdminUserPassword(user.id)
      .then(({ temporaryPassword: password }) => {
        setTemporaryPassword(password);
        setUsers(users.map((current) => (current.id === user.id ? { ...current, mustChangePassword: true } : current)));
      })
      .catch((error: unknown) => setActionError(error instanceof Error ? error.message : t(locale, 'passwordResetFailed')));
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
            <input value={user.email} onChange={(event) => setUsers(users.map((current) => (current.id === user.id ? { ...current, email: event.target.value } : current)))} />
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
            <button onClick={() => setUsers(users.filter((current) => current.id !== user.id))}>
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
