import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChefHat,
  CircleDot,
  Clock3,
  LogOut,
  PackageCheck,
  Play,
  RefreshCw,
  Timer,
  Utensils,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import type { Locale, Order, OrderStatus, StaffBoardOrder, StaffShift } from './types';
import {
  endStaffShift,
  loadCurrentStaffShift,
  loadStaffOrderBoard,
  startStaffShift,
  subscribeToStaffOrders,
  updateStaffOrderStatus,
} from './remoteData';
import './staff-workspace.css';

interface StaffWorkspaceProps {
  locale: Locale;
  siteName: string;
  logoUrl?: string;
  staffName: string;
  restaurantId: string;
  onToggleLocale: () => void;
  onLogout: () => void;
}
type BoardStatus = 'new' | 'accepted' | 'preparing' | 'ready';
type ConnectionState = 'live' | 'reconnecting' | 'offline';

type Preparation = {
  station?: string;
  estimatedMinutes?: number;
  ingredients?: Partial<Record<Locale, string[] | string>>;
  tools?: Partial<Record<Locale, string[] | string>>;
  steps?: Partial<Record<Locale, string[] | string>>;
  warnings?: Partial<Record<Locale, string[] | string>>;
  warning?: Partial<Record<Locale, string[] | string>>;
};

type SelectedPreparation = {
  name: string;
  quantity: number;
  preparation: Preparation;
};

const boardStatuses: BoardStatus[] = ['new', 'accepted', 'preparing', 'ready'];

const words = {
  de: {
    workspace: 'Servicebereich', startTitle: 'Bereit für den Service?', startBody: 'Starte deine Schicht, um neue Bestellungen live zu empfangen.',
    startShift: 'Schicht starten', starting: 'Schicht wird gestartet …', currentTime: 'Aktuelle Uhrzeit', signedInAs: 'Angemeldet als',
    live: 'Live verbunden', reconnecting: 'Verbindung wird hergestellt', offline: 'Offline', shiftTime: 'Schichtzeit',
    endShift: 'Schicht beenden', ending: 'Wird beendet …', logout: 'Abmelden', board: 'Bestellungen', boardHint: 'Aktive Bestellungen nach Arbeitsstand',
    new: 'Neu', accepted: 'Angenommen', preparing: 'In Zubereitung', ready: 'Abholbereit', collected: 'Abgeholt',
    accept: 'Annehmen', startPreparing: 'Zubereitung starten', markReady: 'Als bereit markieren', markCollected: 'Als abgeholt markieren',
    order: 'Bestellung', waiting: 'wartet', customer: 'Kunde', notes: 'Anmerkungen', onlineMenu: 'Online-Menü', register: 'Kasse',
    item: 'Artikel', items: 'Artikel', details: 'Zubereitung anzeigen', noOrders: 'Keine Bestellungen in diesem Status.',
    quietBoard: 'Alles erledigt', quietBoardBody: 'Neue Bestellungen erscheinen hier automatisch.', loading: 'Arbeitsbereich wird geladen …',
    loadFailed: 'Der Arbeitsbereich konnte nicht geladen werden.', actionFailed: 'Der Status konnte nicht gespeichert werden. Bitte erneut versuchen.',
    shiftFailed: 'Die Schicht konnte nicht aktualisiert werden.', retry: 'Erneut versuchen', close: 'Schließen', preparation: 'Zubereitung',
    station: 'Station', timing: 'Richtzeit', minutes: 'Min.', ingredients: 'Zutaten', tools: 'Werkzeuge', steps: 'Arbeitsschritte', warnings: 'Wichtige Hinweise',
    noPreparation: 'Für diesen Artikel sind noch keine Zubereitungsschritte hinterlegt.', confirmEnd: 'Schicht wirklich beenden?',
    confirmEndBody: 'Offene Bestellungen bleiben für das nächste aktive Team sichtbar.', keepWorking: 'Weiterarbeiten', confirm: 'Schicht beenden',
    summaryTitle: 'Schicht abgeschlossen', summaryBody: 'Deine Schicht wurde sicher beendet.', duration: 'Dauer', handled: 'Bearbeitet', completed: 'Abgeschlossen',
    backToStart: 'Zur Startseite', hourShort: 'Std.', minuteShort: 'Min.', justNow: 'gerade eben', elapsed: 'vergangen', refresh: 'Aktualisieren',
    enableSound: 'Ton aktivieren', enablingSound: 'Wird aktiviert …', soundFailed: 'Ton konnte nicht aktiviert werden. Bitte erneut versuchen.',
  },
  en: {
    workspace: 'Staff workspace', startTitle: 'Ready for service?', startBody: 'Start your shift to receive new orders live.',
    startShift: 'Start shift', starting: 'Starting shift …', currentTime: 'Current time', signedInAs: 'Signed in as',
    live: 'Live connected', reconnecting: 'Reconnecting', offline: 'Offline', shiftTime: 'Shift time',
    endShift: 'End shift', ending: 'Ending …', logout: 'Sign out', board: 'Orders', boardHint: 'Active orders grouped by workflow stage',
    new: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', collected: 'Collected',
    accept: 'Accept', startPreparing: 'Start preparing', markReady: 'Mark ready', markCollected: 'Mark collected',
    order: 'Order', waiting: 'waiting', customer: 'Customer', notes: 'Notes', onlineMenu: 'Online menu', register: 'Register',
    item: 'item', items: 'items', details: 'View preparation', noOrders: 'No orders in this stage.',
    quietBoard: 'All caught up', quietBoardBody: 'New orders will appear here automatically.', loading: 'Loading staff workspace …',
    loadFailed: 'The staff workspace could not be loaded.', actionFailed: 'The status could not be saved. Please try again.',
    shiftFailed: 'The shift could not be updated.', retry: 'Try again', close: 'Close', preparation: 'Preparation',
    station: 'Station', timing: 'Target time', minutes: 'min', ingredients: 'Ingredients', tools: 'Tools', steps: 'Steps', warnings: 'Important notes',
    noPreparation: 'No preparation instructions have been added for this item yet.', confirmEnd: 'End this shift?',
    confirmEndBody: 'Open orders will remain visible to the next active team.', keepWorking: 'Keep working', confirm: 'End shift',
    summaryTitle: 'Shift complete', summaryBody: 'Your shift was ended safely.', duration: 'Duration', handled: 'Handled', completed: 'Completed',
    backToStart: 'Back to start', hourShort: 'hr', minuteShort: 'min', justNow: 'just now', elapsed: 'elapsed', refresh: 'Refresh',
    enableSound: 'Enable sound', enablingSound: 'Enabling …', soundFailed: 'Sound could not be enabled. Please try again.',
  },
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function validDate(value: unknown) {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date : null;
}

function shiftStartedAt(shift: StaffShift | null) {
  const value = asRecord(shift).startedAt ?? asRecord(shift).started_at;
  return validDate(value) || new Date();
}

function localizedList(value: Preparation[keyof Preparation], locale: Locale): string[] {
  if (!value || typeof value !== 'object') return [];
  const localized = (value as Partial<Record<Locale, string[] | string>>)[locale]
    ?? (value as Partial<Record<Locale, string[] | string>>)[locale === 'de' ? 'en' : 'de'];
  if (Array.isArray(localized)) return localized.filter(Boolean).map(String);
  return typeof localized === 'string' ? localized.split(/\r?\n|,/).map(part => part.trim()).filter(Boolean) : [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  if (typeof value === 'string') return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  return [];
}

function localizedPreparationField(source: Record<string, unknown>, key: 'ingredients' | 'tools' | 'steps' | 'warning') {
  const nested = asRecord(source[key] ?? (key === 'warning' ? source.warnings : undefined));
  return {
    en: stringList(nested.en ?? source[`${key}_en`]),
    de: stringList(nested.de ?? source[`${key}_de`]),
  };
}

function normalizePreparation(value: unknown): Preparation {
  const source = asRecord(value);
  const estimated = Number(source.estimatedMinutes ?? source.estimated_minutes ?? 0);
  return {
    station: typeof source.station === 'string' ? source.station : undefined,
    estimatedMinutes: Number.isFinite(estimated) && estimated > 0 ? estimated : undefined,
    ingredients: localizedPreparationField(source, 'ingredients'),
    tools: localizedPreparationField(source, 'tools'),
    steps: localizedPreparationField(source, 'steps'),
    warning: localizedPreparationField(source, 'warning'),
  };
}

function linePreparation(line: StaffBoardOrder['lines'][number]): Preparation {
  const lineRecord = asRecord(line);
  const itemRecord = asRecord(line.item);
  return normalizePreparation(lineRecord.preparation ?? itemRecord.preparation);
}

function formatClock(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date);
}

function formatDuration(milliseconds: number, locale: Locale) {
  const text = words[locale];
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours} ${text.hourShort} ${remaining} ${text.minuteShort}` : `${remaining} ${text.minuteShort}`;
}

function orderAge(createdAt: string, now: number, locale: Locale) {
  const created = validDate(createdAt)?.getTime() ?? now;
  const minutes = Math.max(0, Math.floor((now - created) / 60000));
  if (minutes < 1) return words[locale].justNow;
  if (minutes < 60) return `${minutes} ${words[locale].minuteShort}`;
  return formatDuration(now - created, locale);
}

function statusLabel(status: BoardStatus, locale: Locale) {
  return words[locale][status];
}

function nextAction(status: BoardStatus, locale: Locale) {
  const text = words[locale];
  const map: Record<BoardStatus, { next: OrderStatus; label: string; icon: typeof Check }> = {
    new: { next: 'accepted' as OrderStatus, label: text.accept, icon: Check },
    accepted: { next: 'preparing' as OrderStatus, label: text.startPreparing, icon: ChefHat },
    preparing: { next: 'ready' as OrderStatus, label: text.markReady, icon: PackageCheck },
    ready: { next: 'done' as OrderStatus, label: text.markCollected, icon: Check },
  };
  return map[status];
}

export function StaffWorkspace({ locale, siteName, logoUrl, staffName, restaurantId, onToggleLocale, onLogout }: StaffWorkspaceProps) {
  const text = words[locale];
  const [shift, setShift] = useState<StaffShift | null>(null);
  const [orders, setOrders] = useState<StaffBoardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<ConnectionState>(navigator.onLine ? 'reconnecting' : 'offline');
  const [activeMobileStatus, setActiveMobileStatus] = useState<BoardStatus>('new');
  const [pendingOrderId, setPendingOrderId] = useState('');
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [selectedPreparation, setSelectedPreparation] = useState<SelectedPreparation | null>(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [summary, setSummary] = useState<{ duration: number; handled: number } | null>(null);
  const [endError, setEndError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioEnabling, setAudioEnabling] = useState(false);
  const [now, setNow] = useState(Date.now());
  const knownOrderIds = useRef<Set<string>>(new Set());
  const initialBoardLoaded = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const endShiftTrigger = useRef<HTMLButtonElement | null>(null);
  const endDialogClose = useRef<HTMLButtonElement | null>(null);

  const unlockAudio = useCallback(async () => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioContext.current) audioContext.current = new AudioContextClass();
    if (audioContext.current.state === 'suspended') await audioContext.current.resume();
    return audioContext.current.state === 'running';
  }, []);

  const playNewOrderSound = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== 'running') return;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    gain.connect(context.destination);
    [0, 0.16].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = index ? 740 : 620;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.2);
    });
  }, []);

  const refreshBoard = useCallback(async (initial = false) => {
    try {
      const next: StaffBoardOrder[] = await loadStaffOrderBoard();
      if (!mounted.current) return;
      const freshIds = next.filter(order => order.status === 'new' && !knownOrderIds.current.has(order.id)).map(order => order.id);
      setOrders(next);
      knownOrderIds.current = new Set(next.map(order => order.id));
      if (initial || !initialBoardLoaded.current) {
        initialBoardLoaded.current = true;
      } else if (freshIds.length) {
        setNewOrderIds(new Set(freshIds));
        playNewOrderSound();
        window.setTimeout(() => mounted.current && setNewOrderIds(new Set()), 1400);
      }
      setConnection(navigator.onLine ? 'live' : 'offline');
      setError('');
    } catch {
      if (!mounted.current) return;
      setConnection(navigator.onLine ? 'reconnecting' : 'offline');
      setError(text.loadFailed);
    }
  }, [playNewOrderSound, text.loadFailed]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      setLoading(true);
      try {
        const current = await loadCurrentStaffShift();
        if (!mounted.current) return;
        setShift(current);
        if (current) await refreshBoard(true);
        else setConnection(navigator.onLine ? 'live' : 'offline');
      } catch {
        if (mounted.current) setError(text.loadFailed);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, [refreshBoard, text.loadFailed]);

  useEffect(() => {
    if (!shift) return;
    const unsubscribe = subscribeToStaffOrders(restaurantId, () => void refreshBoard(), state => setConnection(state));
    const fallback = window.setInterval(() => void refreshBoard(), 15000);
    const onFocus = () => void refreshBoard();
    const onOnline = () => { setConnection('reconnecting'); void refreshBoard(); };
    const onOffline = () => setConnection('offline');
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(fallback);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubscribe();
    };
  }, [refreshBoard, restaurantId, shift]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedPreparation && !showEndConfirmation) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedPreparation(null);
      setShowEndConfirmation(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedPreparation, showEndConfirmation]);

  useEffect(() => {
    if (!showEndConfirmation) return;
    const trigger = endShiftTrigger.current;
    endDialogClose.current?.focus();
    return () => trigger?.focus();
  }, [showEndConfirmation]);

  const beginShift = async () => {
    setStarting(true);
    setError('');
    try {
      const soundReady = await unlockAudio();
      setAudioEnabled(soundReady);
      const nextShift = await startStaffShift();
      setShift(nextShift);
      setSummary(null);
      initialBoardLoaded.current = false;
      knownOrderIds.current = new Set();
      await refreshBoard(true);
    } catch {
      setError(text.shiftFailed);
    } finally {
      setStarting(false);
    }
  };

  const enableShiftAudio = async () => {
    setAudioEnabling(true);
    setError('');
    try {
      const enabled = await unlockAudio();
      setAudioEnabled(enabled);
      if (!enabled) setError(text.soundFailed);
    } catch {
      setAudioEnabled(false);
      setError(text.soundFailed);
    } finally {
      setAudioEnabling(false);
    }
  };

  const finishShift = async () => {
    if (!shift) return;
    setEnding(true);
    setEndError('');
    try {
      const endedShift = await endStaffShift();
      const started = shiftStartedAt(endedShift).getTime();
      const ended = validDate(endedShift.endedAt)?.getTime() ?? Date.now();
      setSummary({ duration: Math.max(0, ended - started), handled: endedShift.ordersHandled });
      setShift(null);
      setOrders([]);
      setAudioEnabled(false);
      setShowEndConfirmation(false);
      initialBoardLoaded.current = false;
      knownOrderIds.current = new Set();
    } catch {
      setEndError(text.shiftFailed);
    } finally {
      setEnding(false);
    }
  };

  const advanceOrder = async (order: StaffBoardOrder, status: BoardStatus) => {
    const action = nextAction(status, locale);
    setPendingOrderId(order.id);
    setError('');
    try {
      await updateStaffOrderStatus(order, action.next);
      await refreshBoard();
    } catch {
      setError(text.actionFailed);
    } finally {
      setPendingOrderId('');
    }
  };

  const groupedOrders = useMemo(() => Object.fromEntries(boardStatuses.map(status => [
    status,
    orders.filter(order => order.status === status).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  ])) as Record<BoardStatus, StaffBoardOrder[]>, [orders]);

  if (loading) {
    return <main className="staff-workspace staff-centered-state" lang={locale} aria-busy="true">
      <RefreshCw className="staff-spin" aria-hidden="true" />
      <strong>{text.loading}</strong>
    </main>;
  }

  if (summary) {
    return <main className="staff-workspace staff-shift-gate" lang={locale}>
      <section className="staff-summary-panel">
        <span className="staff-summary-check"><Check aria-hidden="true" /></span>
        <p className="staff-eyebrow">{siteName}</p>
        <h1>{text.summaryTitle}</h1>
        <p>{text.summaryBody}</p>
        <div className="staff-summary-stats">
          <div><Timer aria-hidden="true" /><span>{text.duration}</span><strong>{formatDuration(summary.duration, locale)}</strong></div>
          <div><ChefHat aria-hidden="true" /><span>{text.handled}</span><strong>{summary.handled}</strong></div>
        </div>
        <div className="staff-gate-actions">
          <button className="staff-primary-button" onClick={() => setSummary(null)}><ArrowRight aria-hidden="true" />{text.backToStart}</button>
          <button className="staff-secondary-button" onClick={onLogout}><LogOut aria-hidden="true" />{text.logout}</button>
        </div>
      </section>
    </main>;
  }

  if (!shift) {
    return <main className="staff-workspace staff-shift-gate" lang={locale}>
      <header className="staff-gate-header">
        <Brand siteName={siteName} logoUrl={logoUrl} />
        <div className="staff-gate-tools">
          <button className="staff-language-button" onClick={onToggleLocale} aria-label={locale === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}>{locale === 'de' ? 'EN' : 'DE'}</button>
          <button className="staff-icon-button" onClick={onLogout} aria-label={text.logout} title={text.logout}><LogOut /></button>
        </div>
      </header>
      <section className="staff-start-panel">
        <span className="staff-start-icon"><ChefHat aria-hidden="true" /></span>
        <p className="staff-eyebrow">{text.workspace}</p>
        <h1>{text.startTitle}</h1>
        <p>{text.startBody}</p>
        <div className="staff-start-facts">
          <div><span>{text.currentTime}</span><strong>{formatClock(new Date(now), locale)}</strong></div>
          <div><span>{text.signedInAs}</span><strong>{staffName}</strong></div>
        </div>
        {error && <ErrorMessage message={error} onRetry={() => void beginShift()} label={text.retry} />}
        <button className="staff-primary-button staff-start-button" disabled={starting} onClick={() => void beginShift()}>
          {starting ? <RefreshCw className="staff-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{starting ? text.starting : text.startShift}
        </button>
      </section>
    </main>;
  }

  const activeCount = boardStatuses.reduce((count, status) => count + groupedOrders[status].length, 0);

  return <main className="staff-workspace staff-active" lang={locale}>
    <header className="staff-topbar">
      <Brand siteName={siteName} logoUrl={logoUrl} />
      <div className={`staff-connection staff-connection-${connection}`} aria-live="polite">
        <CircleDot aria-hidden="true" />
        <span>{connection === 'live' ? text.live : connection === 'offline' ? text.offline : text.reconnecting}</span>
      </div>
      <div className="staff-shift-clock"><Clock3 aria-hidden="true" /><span>{text.shiftTime}</span><strong>{formatDuration(now - shiftStartedAt(shift).getTime(), locale)}</strong></div>
      <div className="staff-topbar-actions">
        <button className="staff-language-button" onClick={onToggleLocale} aria-label={locale === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}>{locale === 'de' ? 'EN' : 'DE'}</button>
        <button ref={endShiftTrigger} className="staff-end-button" onClick={() => { setEndError(''); setShowEndConfirmation(true); }}><Clock3 aria-hidden="true" />{text.endShift}</button>
        <button className="staff-icon-button" onClick={onLogout} aria-label={text.logout} title={text.logout}><LogOut /></button>
      </div>
    </header>

    <section className="staff-board-heading">
      <div><p className="staff-eyebrow">{text.workspace}</p><h1>{text.board}</h1><p>{text.boardHint}</p></div>
      <div className="staff-board-heading-actions">
        {!audioEnabled && <button className="staff-sound-button" disabled={audioEnabling} onClick={() => void enableShiftAudio()}>
          {audioEnabling ? <RefreshCw className="staff-spin" aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          <span>{audioEnabling ? text.enablingSound : text.enableSound}</span>
        </button>}
        <div className="staff-board-total"><strong>{activeCount}</strong><span>{activeCount === 1 ? text.item : text.items}</span></div>
      </div>
    </section>

    {error && <ErrorMessage message={error} onRetry={() => void refreshBoard()} label={text.retry} />}

    <nav className="staff-mobile-statuses" aria-label={text.board}>
      {boardStatuses.map(status => <button key={status} aria-pressed={activeMobileStatus === status} onClick={() => setActiveMobileStatus(status)}>
        <span>{statusLabel(status, locale)}</span><strong>{groupedOrders[status].length}</strong>
      </button>)}
    </nav>

    <section className="staff-board" aria-live="polite">
      {boardStatuses.map(status => <div key={status} className={`staff-column staff-column-${status} ${activeMobileStatus === status ? 'is-mobile-active' : ''}`}>
        <header><div><span className="staff-status-dot" /><h2>{statusLabel(status, locale)}</h2></div><strong>{groupedOrders[status].length}</strong></header>
        <div className="staff-column-scroll">
          {groupedOrders[status].length ? groupedOrders[status].map(order => <OrderCard
            key={order.id}
            order={order}
            status={status}
            locale={locale}
            now={now}
            isNew={newOrderIds.has(order.id)}
            busy={pendingOrderId === order.id}
            onAdvance={() => void advanceOrder(order, status)}
            onPreparation={setSelectedPreparation}
          />) : <div className="staff-column-empty"><Check aria-hidden="true" /><span>{text.noOrders}</span></div>}
        </div>
      </div>)}
      {!activeCount && <div className="staff-board-empty"><PackageCheck aria-hidden="true" /><h2>{text.quietBoard}</h2><p>{text.quietBoardBody}</p></div>}
    </section>

    {selectedPreparation && <PreparationDialog value={selectedPreparation} locale={locale} onClose={() => setSelectedPreparation(null)} />}
    {showEndConfirmation && <div className="staff-dialog-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && setShowEndConfirmation(false)}>
      <section className="staff-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="end-shift-title">
        <button ref={endDialogClose} className="staff-dialog-close" onClick={() => setShowEndConfirmation(false)} aria-label={text.close}><X /></button>
        <span className="staff-dialog-symbol"><Clock3 aria-hidden="true" /></span>
        <h2 id="end-shift-title">{text.confirmEnd}</h2>
        <p>{text.confirmEndBody}</p>
        {endError && <div className="staff-dialog-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{endError}</span></div>}
        <div className="staff-dialog-actions">
          <button className="staff-secondary-button" disabled={ending} onClick={() => setShowEndConfirmation(false)}>{text.keepWorking}</button>
          <button className="staff-danger-button" disabled={ending} onClick={() => void finishShift()}>{ending && <RefreshCw className="staff-spin" aria-hidden="true" />}{ending ? text.ending : text.confirm}</button>
        </div>
      </section>
    </div>}
  </main>;
}

function Brand({ siteName, logoUrl }: { siteName: string; logoUrl?: string }) {
  return <div className="staff-brand">
    {logoUrl ? <img src={logoUrl} alt="" /> : <span aria-hidden="true">{siteName.trim().charAt(0).toUpperCase()}</span>}
    <strong>{siteName}</strong>
  </div>;
}

function ErrorMessage({ message, onRetry, label }: { message: string; onRetry: () => void; label: string }) {
  return <div className="staff-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{message}</span><button onClick={onRetry}><RefreshCw aria-hidden="true" />{label}</button></div>;
}

function OrderCard({ order, status, locale, now, isNew, busy, onAdvance, onPreparation }: {
  order: StaffBoardOrder & Order;
  status: BoardStatus;
  locale: Locale;
  now: number;
  isNew: boolean;
  busy: boolean;
  onAdvance: () => void;
  onPreparation: (value: SelectedPreparation) => void;
}) {
  const text = words[locale];
  const action = nextAction(status, locale);
  const ActionIcon = action.icon;
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const number = order.orderNumber || order.id.slice(0, 8).toUpperCase();
  return <article className={`staff-order-card ${isNew ? 'staff-order-new' : ''}`}>
    <header>
      <div><small>{text.order}</small><strong>#{number}</strong></div>
      <span className={`staff-order-age ${status === 'new' ? 'is-urgent' : ''}`}><Timer aria-hidden="true" />{orderAge(order.createdAt, now, locale)}</span>
    </header>
    <div className="staff-order-customer"><strong>{order.customerName}</strong><span>{order.source === 'pos' ? text.register : text.onlineMenu} · {itemCount} {itemCount === 1 ? text.item : text.items}</span></div>
    {order.notes && <p className="staff-order-note"><span>{text.notes}</span>{order.notes}</p>}
    <div className="staff-order-lines">
      {order.lines.map((line, index) => {
        const preparation = linePreparation(line);
        const hasDetails = Boolean(preparation.station || preparation.estimatedMinutes || localizedList(preparation.steps, locale).length || localizedList(preparation.ingredients, locale).length || localizedList(preparation.tools, locale).length || localizedList(preparation.warnings ?? preparation.warning, locale).length);
        return <button key={`${line.item.id}-${index}`} disabled={!hasDetails} aria-haspopup={hasDetails ? 'dialog' : undefined} onClick={() => hasDetails && onPreparation({ name: line.item.name[locale] || line.item.name.en, quantity: line.quantity, preparation })}>
          <span className="staff-line-quantity">{line.quantity}×</span><span>{line.item.name[locale] || line.item.name.en}</span>
          {hasDetails && <ChefHat aria-label={text.details} />}
        </button>;
      })}
    </div>
    <footer>
      <span className={`staff-state-pill staff-state-${status}`}>{statusLabel(status, locale)}</span>
      <button className="staff-order-action" disabled={busy} onClick={onAdvance}>
        {busy ? <RefreshCw className="staff-spin" aria-hidden="true" /> : <ActionIcon aria-hidden="true" />}{action.label}
      </button>
    </footer>
  </article>;
}

function PreparationDialog({ value, locale, onClose }: { value: SelectedPreparation; locale: Locale; onClose: () => void }) {
  const text = words[locale];
  const ingredients = localizedList(value.preparation.ingredients, locale);
  const tools = localizedList(value.preparation.tools, locale);
  const steps = localizedList(value.preparation.steps, locale);
  const warnings = localizedList(value.preparation.warnings ?? value.preparation.warning, locale);
  const hasContent = ingredients.length || tools.length || steps.length || warnings.length || value.preparation.station || value.preparation.estimatedMinutes;
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const returnFocusTo = previousFocus.current;
    closeButton.current?.focus();
    return () => returnFocusTo?.focus();
  }, []);
  return <div className="staff-dialog-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="staff-preparation-dialog" role="dialog" aria-modal="true" aria-labelledby="preparation-title">
      <header>
        <div><p className="staff-eyebrow">{text.preparation}</p><h2 id="preparation-title">{value.quantity}× {value.name}</h2></div>
        <button ref={closeButton} className="staff-dialog-close" onClick={onClose} aria-label={text.close}><X /></button>
      </header>
      {hasContent ? <>
        <div className="staff-preparation-meta">
          {value.preparation.station && <div><ChefHat aria-hidden="true" /><span>{text.station}</span><strong>{value.preparation.station}</strong></div>}
          {value.preparation.estimatedMinutes && <div><Timer aria-hidden="true" /><span>{text.timing}</span><strong>{value.preparation.estimatedMinutes} {text.minutes}</strong></div>}
        </div>
        {warnings.length > 0 && <section className="staff-preparation-warning"><AlertTriangle aria-hidden="true" /><div><h3>{text.warnings}</h3>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></section>}
        <div className="staff-preparation-columns">
          {ingredients.length > 0 && <section><h3><Utensils aria-hidden="true" />{text.ingredients}</h3><ul>{ingredients.map((ingredient, index) => <li key={index}>{ingredient}</li>)}</ul></section>}
          {tools.length > 0 && <section><h3><Wrench aria-hidden="true" />{text.tools}</h3><ul>{tools.map((tool, index) => <li key={index}>{tool}</li>)}</ul></section>}
        </div>
        {steps.length > 0 && <section className="staff-preparation-steps"><h3>{text.steps}</h3><ol>{steps.map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>}
      </> : <p className="staff-no-preparation">{text.noPreparation}</p>}
    </section>
  </div>;
}
