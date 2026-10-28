import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  ReceiptText,
  Utensils,
  WifiOff,
} from 'lucide-react';
import type { Locale, Order, OrderStatus } from './types';
import './order-journey.css';

type ConnectionState = 'live' | 'checking' | 'offline';

interface OrderJourneyProps {
  locale: Locale;
  order: Order;
  connection: ConnectionState;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  notificationsEnabled: boolean;
  onEnableNotifications: () => void | Promise<void>;
  notificationPromptBusy?: boolean;
  statusNotice?: string;
}

type JourneyStage = 0 | 1 | 2;

const copy = {
  en: {
    tracker: 'Order tracker',
    live: 'Live',
    checking: 'Checking',
    offline: 'Offline',
    received: 'Received',
    preparing: 'Preparing',
    ready: 'Ready',
    cancelled: 'Cancelled',
    receivedTitle: 'We have your order',
    receivedBody: 'The kitchen will confirm it shortly.',
    preparingTitle: 'Your order is being prepared',
    preparingBody: 'We will let you know as soon as it is ready.',
    readyTitle: 'Ready for pickup',
    readyBody: 'Please collect your order at the counter.',
    cancelledTitle: 'This order was cancelled',
    cancelledBody: 'Please speak to our team if you need help.',
    order: 'Order',
    summary: 'Order summary',
    total: 'Total',
    customer: 'For',
    notes: 'Notes',
    notificationsTitle: 'Get a ready alert',
    notificationsBody: 'Enable alerts and sound so you can keep browsing the menu.',
    enableNotifications: 'Enable alerts & sound',
    enabling: 'Enabling',
    notificationUnavailable: 'Alerts and sound could not be enabled. Check your browser permissions and try again.',
    connectionChecking: 'Checking for the latest update. Your order details are still available.',
    connectionOffline: 'Connection lost. Showing the last known order status.',
    expand: 'Expand order tracker',
    collapse: 'Collapse order tracker',
    current: 'Current status',
  },
  de: {
    tracker: 'Bestellstatus',
    live: 'Live',
    checking: 'Wird geprüft',
    offline: 'Offline',
    received: 'Eingegangen',
    preparing: 'In Zubereitung',
    ready: 'Abholbereit',
    cancelled: 'Storniert',
    receivedTitle: 'Wir haben deine Bestellung',
    receivedBody: 'Die Küche bestätigt sie in Kürze.',
    preparingTitle: 'Deine Bestellung wird zubereitet',
    preparingBody: 'Wir sagen dir Bescheid, sobald sie fertig ist.',
    readyTitle: 'Bereit zur Abholung',
    readyBody: 'Bitte hole deine Bestellung an der Theke ab.',
    cancelledTitle: 'Diese Bestellung wurde storniert',
    cancelledBody: 'Sprich bitte unser Team an, wenn du Hilfe brauchst.',
    order: 'Bestellung',
    summary: 'Bestellübersicht',
    total: 'Gesamt',
    customer: 'Für',
    notes: 'Hinweis',
    notificationsTitle: 'Abholhinweis erhalten',
    notificationsBody: 'Aktiviere Hinweise und Ton und stöbere entspannt weiter.',
    enableNotifications: 'Hinweise & Ton aktivieren',
    enabling: 'Wird aktiviert',
    notificationUnavailable: 'Hinweise und Ton konnten nicht aktiviert werden. Prüfe deine Browser-Berechtigungen und versuche es erneut.',
    connectionChecking: 'Der neueste Stand wird geprüft. Deine Bestelldaten bleiben sichtbar.',
    connectionOffline: 'Keine Verbindung. Der zuletzt bekannte Bestellstatus wird angezeigt.',
    expand: 'Bestellstatus öffnen',
    collapse: 'Bestellstatus einklappen',
    current: 'Aktueller Status',
  },
} satisfies Record<Locale, Record<string, string>>;

const stageByStatus: Record<OrderStatus, JourneyStage> = {
  new: 0,
  accepted: 0,
  preparing: 1,
  ready: 2,
  done: 2,
  cancelled: 0,
};

function formatMoney(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export function OrderJourney({
  locale,
  order,
  connection,
  expanded,
  onExpandedChange,
  notificationsEnabled,
  onEnableNotifications,
  notificationPromptBusy = false,
  statusNotice,
}: OrderJourneyProps) {
  const text = copy[locale];
  const cancelled = order.status === 'cancelled';
  const currentStage = stageByStatus[order.status];
  const [visibleNotice, setVisibleNotice] = useState(statusNotice ?? '');
  const verificationOrder = useRef<Order | null>(connection === 'live' ? null : order);
  const [displayConnection, setDisplayConnection] = useState<ConnectionState>(connection);
  const [notificationFeedback, setNotificationFeedback] = useState<'idle' | 'pending' | 'failed'>('idle');

  useEffect(() => {
    if (!statusNotice) {
      setVisibleNotice('');
      return undefined;
    }

    setVisibleNotice(statusNotice);
    const timeout = window.setTimeout(() => setVisibleNotice(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [statusNotice]);

  useEffect(() => {
    if (connection !== 'live') {
      verificationOrder.current = order;
      setDisplayConnection(connection);
      return;
    }

    if (verificationOrder.current === order) return;
    verificationOrder.current = null;
    setDisplayConnection('live');
  }, [connection, order]);

  useEffect(() => {
    if (notificationsEnabled) {
      setNotificationFeedback('idle');
    } else if (notificationFeedback === 'pending' && !notificationPromptBusy) {
      setNotificationFeedback('failed');
    }
  }, [notificationFeedback, notificationPromptBusy, notificationsEnabled]);

  const stageLabels = [text.received, text.preparing, text.ready];
  const stageIcons = [ReceiptText, Utensils, Check];
  const statusContent = cancelled
    ? { label: text.cancelled, title: text.cancelledTitle, body: text.cancelledBody }
    : currentStage === 2
      ? { label: text.ready, title: text.readyTitle, body: text.readyBody }
      : currentStage === 1
        ? { label: text.preparing, title: text.preparingTitle, body: text.preparingBody }
        : { label: text.received, title: text.receivedTitle, body: text.receivedBody };

  const connectionLabel = text[displayConnection];
  const orderNumber = order.orderNumber || order.id.slice(0, 8).toUpperCase();

  const enableNotifications = () => {
    setNotificationFeedback('pending');
    void Promise.resolve(onEnableNotifications()).catch(() => setNotificationFeedback('failed'));
  };

  return (
    <aside
      className={`order-journey ${expanded ? 'is-expanded' : 'is-collapsed'} ${cancelled ? 'is-cancelled' : ''}`}
      aria-label={text.tracker}
    >
      {visibleNotice && (
        <div className="order-journey__toast" role="status" aria-live="polite">
          <Check aria-hidden="true" />
          <span>{visibleNotice}</span>
        </div>
      )}

      {!expanded ? (
        <button
          type="button"
          className="order-journey__compact"
          onClick={() => onExpandedChange(true)}
          aria-label={text.expand}
          title={text.expand}
        >
          <span className={`order-journey__compact-icon stage-${currentStage}`}>
            {cancelled ? <CircleAlert aria-hidden="true" /> : currentStage === 2 ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
          </span>
          <span className="order-journey__compact-copy">
            <small>#{orderNumber}</small>
            <strong>{statusContent.label}</strong>
          </span>
          <span className={`order-journey__connection is-${displayConnection}`}>
            <i aria-hidden="true" />
            {connectionLabel}
          </span>
          <ChevronUp aria-hidden="true" />
        </button>
      ) : (
        <div className="order-journey__panel">
          <header className="order-journey__header">
            <div className="order-journey__identity">
              <span className={`order-journey__connection is-${displayConnection}`}>
                <i aria-hidden="true" />
                {connectionLabel}
              </span>
              <strong>{statusContent.label}</strong>
              <span className="order-journey__number">#{orderNumber}</span>
            </div>
            <div className="order-journey__header-actions">
              <button type="button" onClick={() => onExpandedChange(false)} aria-label={text.collapse} title={text.collapse}>
                <ChevronDown aria-hidden="true" />
              </button>
            </div>
          </header>

          {displayConnection !== 'live' && (
            <div className={`order-journey__connection-note is-${displayConnection}`} role="status">
              {displayConnection === 'checking' ? <LoaderCircle className="order-journey__spinner" aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
              <span>{displayConnection === 'checking' ? text.connectionChecking : text.connectionOffline}</span>
            </div>
          )}

          <div className="order-journey__body">
            <ol className="order-journey__progress" aria-label={text.current}>
              {stageLabels.map((label, index) => {
                const Icon = stageIcons[index];
                const complete = !cancelled && index <= currentStage;
                const current = !cancelled && index === currentStage;
                return (
                  <li
                    key={label}
                    className={`${complete ? 'is-complete' : ''} ${!cancelled && index < currentStage ? 'is-past' : ''}`}
                    aria-current={current ? 'step' : undefined}
                  >
                    <span className="order-journey__step-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>

            <section className="order-journey__status" aria-labelledby="order-journey-status-title">
              <span className="order-journey__status-icon">
                {cancelled ? <CircleAlert aria-hidden="true" /> : currentStage === 2 ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
              </span>
              <div>
                <small>{text.current}</small>
                <h2 id="order-journey-status-title">{statusContent.title}</h2>
                <p>{statusContent.body}</p>
              </div>
            </section>

            <section className="order-journey__summary" aria-labelledby="order-journey-summary-title">
              <div className="order-journey__section-heading">
                <h3 id="order-journey-summary-title">{text.summary}</h3>
                <span>{order.lines.reduce((sum, line) => sum + line.quantity, 0)}</span>
              </div>
              <div className="order-journey__lines">
                {order.lines.map((line) => (
                  <div className="order-journey__line" key={`${line.item.id}-${line.quantity}`}>
                    <span className="order-journey__quantity">{line.quantity}×</span>
                    <span>{line.item.name[locale]}</span>
                    <strong>{formatMoney(line.item.price * line.quantity, locale)}</strong>
                  </div>
                ))}
              </div>
              <dl className="order-journey__details">
                <div>
                  <dt>{text.customer}</dt>
                  <dd>{order.customerName}</dd>
                </div>
                {order.notes && (
                  <div>
                    <dt>{text.notes}</dt>
                    <dd>{order.notes}</dd>
                  </div>
                )}
              </dl>
              <div className="order-journey__total">
                <span>{text.total}</span>
                <strong>{formatMoney(order.total, locale)}</strong>
              </div>
            </section>

            {!notificationsEnabled && !cancelled && currentStage < 2 && (
              <section className="order-journey__notifications">
                <Bell aria-hidden="true" />
                <div>
                  <strong>{text.notificationsTitle}</strong>
                  <p>{text.notificationsBody}</p>
                </div>
                {notificationFeedback === 'failed' && (
                  <p className="order-journey__notification-error" role="alert">{text.notificationUnavailable}</p>
                )}
                <button type="button" onClick={enableNotifications} disabled={notificationPromptBusy}>
                  {notificationPromptBusy ? <LoaderCircle className="order-journey__spinner" aria-hidden="true" /> : <Bell aria-hidden="true" />}
                  {notificationPromptBusy ? text.enabling : text.enableNotifications}
                </button>
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
