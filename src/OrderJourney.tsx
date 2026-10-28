import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Bell, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, LoaderCircle, ReceiptText, Send, Star, Utensils, WifiOff } from 'lucide-react';
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
  onConfirmReceived: (rating: number | null, feedback: string) => Promise<void>;
  onDismiss: () => void;
}

type JourneyStage = 0 | 1 | 2;

const copy = {
  en: {
    tracker: 'Order tracker', live: 'Live', checking: 'Checking', offline: 'Offline',
    received: 'Received', preparing: 'Preparing', ready: 'Ready', cancelled: 'Cancelled',
    receivedTitle: 'We have your order', receivedBody: 'The kitchen will confirm it shortly.',
    preparingTitle: 'Your order is being prepared', preparingBody: 'We will let you know as soon as it is ready.',
    readyTitle: 'Ready for pickup', readyBody: 'Please collect your order at the counter.',
    cancelledTitle: 'Order cancelled', cancelledBody: 'Please return to the cashier to ask why this order was cancelled.', cancelledAction: 'Close',
    order: 'Order', summary: 'Order details', total: 'Total', customer: 'For', notes: 'Notes', item: 'item', items: 'items',
    notificationsTitle: 'Get a ready alert', notificationsBody: 'Enable alerts and sound so you can keep browsing the menu.',
    enableNotifications: 'Enable alerts & sound', enabling: 'Enabling',
    notificationUnavailable: 'Alerts and sound could not be enabled. Check your browser permissions and try again.',
    connectionChecking: 'Checking for the latest update. Your order details are still available.',
    connectionOffline: 'Connection lost. Showing the last known order status.',
    expand: 'Expand order tracker', collapse: 'Collapse order tracker', current: 'Current status',
    rateTitle: 'How was your pickup?', rateBody: 'Your rating helps us improve.', rating: 'Rating',
    feedback: 'Optional feedback', feedbackPlaceholder: 'Tell us what went well or what we can improve',
    confirmReceived: 'I received my order', confirming: 'Confirming',
    confirmationError: 'We could not confirm your pickup. Please try again.',
    thankYouTitle: 'Thank you!', thankYouBody: 'Thank you — we look forward to seeing you next time.',
  },
  de: {
    tracker: 'Bestellstatus', live: 'Live', checking: 'Wird geprüft', offline: 'Offline',
    received: 'Eingegangen', preparing: 'In Zubereitung', ready: 'Abholbereit', cancelled: 'Storniert',
    receivedTitle: 'Wir haben deine Bestellung', receivedBody: 'Die Küche bestätigt sie in Kürze.',
    preparingTitle: 'Deine Bestellung wird zubereitet', preparingBody: 'Wir sagen dir Bescheid, sobald sie fertig ist.',
    readyTitle: 'Bereit zur Abholung', readyBody: 'Bitte hole deine Bestellung an der Theke ab.',
    cancelledTitle: 'Bestellung storniert', cancelledBody: 'Bitte wende dich an die Kasse, um den Grund für die Stornierung zu erfahren.', cancelledAction: 'Schließen',
    order: 'Bestellung', summary: 'Bestelldetails', total: 'Gesamt', customer: 'Für', notes: 'Hinweis', item: 'Artikel', items: 'Artikel',
    notificationsTitle: 'Abholhinweis erhalten', notificationsBody: 'Aktiviere Hinweise und Ton und stöbere entspannt weiter.',
    enableNotifications: 'Hinweise & Ton aktivieren', enabling: 'Wird aktiviert',
    notificationUnavailable: 'Hinweise und Ton konnten nicht aktiviert werden. Prüfe deine Browser-Berechtigungen und versuche es erneut.',
    connectionChecking: 'Der neueste Stand wird geprüft. Deine Bestelldaten bleiben sichtbar.',
    connectionOffline: 'Keine Verbindung. Der zuletzt bekannte Bestellstatus wird angezeigt.',
    expand: 'Bestellstatus öffnen', collapse: 'Bestellstatus einklappen', current: 'Aktueller Status',
    rateTitle: 'Wie war deine Abholung?', rateBody: 'Mit deiner Bewertung hilfst du uns, besser zu werden.', rating: 'Bewertung',
    feedback: 'Optionales Feedback', feedbackPlaceholder: 'Was war gut oder was können wir verbessern?',
    confirmReceived: 'Bestellung erhalten', confirming: 'Wird bestätigt',
    confirmationError: 'Die Abholung konnte nicht bestätigt werden. Bitte versuche es erneut.',
    thankYouTitle: 'Vielen Dank!', thankYouBody: 'Vielen Dank — wir freuen uns, dich beim nächsten Mal wiederzusehen.',
  },
} satisfies Record<Locale, Record<string, string>>;

const stageByStatus: Record<OrderStatus, JourneyStage> = { new: 0, accepted: 0, preparing: 1, ready: 2, done: 2, cancelled: 0 };
const stageVisuals = ['/order-received.gif', '/order-preparing.gif', '/order-ready.gif'] as const;

function formatMoney(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

export function OrderJourney({
  locale, order, connection, expanded, onExpandedChange, notificationsEnabled, onEnableNotifications,
  notificationPromptBusy = false, statusNotice, onConfirmReceived, onDismiss,
}: OrderJourneyProps) {
  const text = copy[locale];
  const cancelled = order.status === 'cancelled';
  const done = order.status === 'done';
  const currentStage = stageByStatus[order.status];
  const [visibleNotice, setVisibleNotice] = useState(statusNotice ?? '');
  const verificationOrder = useRef<Order | null>(connection === 'live' ? null : order);
  const [displayConnection, setDisplayConnection] = useState<ConnectionState>(connection);
  const [notificationFeedback, setNotificationFeedback] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirmationState, setConfirmationState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [dragOffset, setDragOffset] = useState(0);
  const [dragPreview, setDragPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [visualRetry, setVisualRetry] = useState(0);
  const [visualFailed, setVisualFailed] = useState(false);
  const journeyRef = useRef<HTMLElement | null>(null);
  const dragFrame = useRef<number | null>(null);
  const pendingDragHeight = useRef<number | null>(null);
  const drag = useRef({ pointerId: -1, startY: 0, startHeight: 0, lastY: 0, lastAt: 0, recentY: 0, recentAt: 0, moved: false, mobile: false, preview: false });
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!statusNotice) { setVisibleNotice(''); return undefined; }
    setVisibleNotice(statusNotice);
    const timeout = window.setTimeout(() => setVisibleNotice(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [statusNotice]);

  useEffect(() => {
    if (connection !== 'live') { verificationOrder.current = order; setDisplayConnection(connection); return; }
    if (verificationOrder.current === order) return;
    verificationOrder.current = null;
    setDisplayConnection('live');
  }, [connection, order]);

  useEffect(() => {
    if (notificationsEnabled) setNotificationFeedback('idle');
    else if (notificationFeedback === 'pending' && !notificationPromptBusy) setNotificationFeedback('failed');
  }, [notificationFeedback, notificationPromptBusy, notificationsEnabled]);

  useEffect(() => { setConfirmationState('idle'); }, [order.status]);

  useEffect(() => {
    stageVisuals.forEach((source) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = source;
    });
  }, []);

  useEffect(() => {
    setVisualRetry(0);
    setVisualFailed(false);
  }, [currentStage]);

  useEffect(() => () => {
    if (dragFrame.current !== null) window.cancelAnimationFrame(dragFrame.current);
  }, []);

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
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  const enableNotifications = () => {
    setNotificationFeedback('pending');
    void Promise.resolve(onEnableNotifications()).catch(() => setNotificationFeedback('failed'));
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const now = performance.now();
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    const shell = event.currentTarget.closest('.order-journey');
    const startHeight = shell instanceof HTMLElement ? shell.getBoundingClientRect().height : event.currentTarget.getBoundingClientRect().height;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight, lastY: event.clientY, lastAt: now, recentY: event.clientY, recentAt: now, moved: false, mobile, preview: false };
    setIsDragging(true);
    const captureTarget = event.currentTarget.closest('.order-journey');
    if (captureTarget instanceof HTMLElement) captureTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.current.startY;
    const now = performance.now();
    if (now - drag.current.recentAt > 48) {
      drag.current.recentY = drag.current.lastY;
      drag.current.recentAt = drag.current.lastAt;
    }
    drag.current.lastY = event.clientY;
    drag.current.lastAt = now;
    drag.current.moved ||= Math.abs(delta) > 6;
    if (drag.current.mobile) {
      const minimum = 84 + Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0');
      const maximum = window.innerHeight * 0.9;
      const height = Math.min(maximum, Math.max(minimum, drag.current.startHeight - delta));
      if (!expanded && height > 96 && !drag.current.preview) {
        drag.current.preview = true;
        setDragPreview(true);
      }
      pendingDragHeight.current = height;
      if (dragFrame.current === null) {
        dragFrame.current = window.requestAnimationFrame(() => {
          if (pendingDragHeight.current !== null) journeyRef.current?.style.setProperty('--drag-height', `${pendingDragHeight.current}px`);
          dragFrame.current = null;
        });
      }
    } else {
      setDragOffset(expanded ? Math.max(0, delta) : Math.min(0, delta));
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current.pointerId !== event.pointerId) return;
    const distance = drag.current.lastY - drag.current.startY;
    const velocity = (drag.current.lastY - drag.current.recentY) / Math.max(drag.current.lastAt - drag.current.recentAt, 1);
    suppressClick.current = drag.current.moved;
    drag.current.pointerId = -1;
    setDragOffset(0);
    setIsDragging(false);
    setDragPreview(false);
    pendingDragHeight.current = null;
    journeyRef.current?.style.removeProperty('--drag-height');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (expanded && (distance > 72 || velocity > 0.55)) onExpandedChange(false);
    if (!expanded && (distance < -36 || velocity < -0.45)) onExpandedChange(true);
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current.pointerId !== event.pointerId) return;
    suppressClick.current = false;
    drag.current.pointerId = -1;
    setDragOffset(0);
    setIsDragging(false);
    setDragPreview(false);
    pendingDragHeight.current = null;
    journeyRef.current?.style.removeProperty('--drag-height');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleToggleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onExpandedChange(!expanded);
  };

  const confirmReceived = async () => {
    if (order.status !== 'ready' || confirmationState === 'busy') return;
    setConfirmationState('busy');
    try { await onConfirmReceived(rating, feedback.trim()); setConfirmationState('idle'); }
    catch { setConfirmationState('failed'); }
  };

  const gestureStartProps = { onPointerDown: beginDrag };
  const gestureTrackingProps = {
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
    onLostPointerCapture: cancelDrag,
  };

  const showingPanel = expanded || dragPreview;

  return (
    <aside
      ref={journeyRef}
      className={`order-journey ${showingPanel ? 'is-expanded' : 'is-collapsed'} stage-${currentStage} ${cancelled ? 'is-cancelled' : ''} ${done ? 'is-done' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ '--drag-offset': `${dragOffset}px` } as CSSProperties}
      aria-label={text.tracker}
      {...gestureTrackingProps}
    >
      {visibleNotice && <div className="order-journey__toast" role="status" aria-live="polite"><Check aria-hidden="true" /><span>{visibleNotice}</span></div>}

      {!showingPanel ? (
        <button type="button" className="order-journey__compact" onClick={handleToggleClick} aria-label={text.expand} title={text.expand} {...gestureStartProps}>
          <span className="order-journey__grab" aria-hidden="true" />
          <span className="order-journey__compact-main">
            <span className="order-journey__compact-icon">{cancelled ? <CircleAlert aria-hidden="true" /> : currentStage === 2 ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}</span>
            <span className="order-journey__compact-copy"><small>#{orderNumber}</small><strong>{done ? text.thankYouTitle : statusContent.label}</strong></span>
            <span className={`order-journey__connection is-${displayConnection}`}><i aria-hidden="true" />{connectionLabel}</span>
            <ChevronUp aria-hidden="true" />
          </span>
          <span className="order-journey__compact-progress" aria-hidden="true"><i style={{ width: cancelled ? '0%' : `${((currentStage + 1) / 3) * 100}%` }} /></span>
        </button>
      ) : (
        <div className="order-journey__panel">
          <button type="button" className="order-journey__drag-handle" onClick={handleToggleClick} aria-label={text.collapse} title={text.collapse} {...gestureStartProps}><span className="order-journey__grab" aria-hidden="true" /></button>

          <header className="order-journey__header">
            <div className="order-journey__identity">
              <span className={`order-journey__connection is-${displayConnection}`}><i aria-hidden="true" />{connectionLabel}</span>
              <span className="order-journey__eyebrow">{done ? text.thankYouTitle : statusContent.label}</span>
              <strong>#{orderNumber}</strong>
            </div>
            <button type="button" className="order-journey__collapse" onClick={() => onExpandedChange(false)} aria-label={text.collapse} title={text.collapse}><ChevronDown aria-hidden="true" /></button>
          </header>

          {displayConnection !== 'live' && (
            <div className={`order-journey__connection-note is-${displayConnection}`} role="status">
              {displayConnection === 'checking' ? <LoaderCircle className="order-journey__spinner" aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
              <span>{displayConnection === 'checking' ? text.connectionChecking : text.connectionOffline}</span>
            </div>
          )}

          <div className="order-journey__body">
            {cancelled ? (
              <section className="order-journey__cancelled" aria-labelledby="order-journey-cancelled-title">
                <span className="order-journey__cancelled-icon"><CircleAlert aria-hidden="true" /></span>
                <small>{text.order} #{orderNumber}</small>
                <h2 id="order-journey-cancelled-title">{text.cancelledTitle}</h2>
                <p>{text.cancelledBody}</p>
                <button type="button" onClick={onDismiss}>{text.cancelledAction}</button>
              </section>
            ) : done ? (
              <section className="order-journey__thank-you" aria-labelledby="order-journey-thanks-title">
                <span className="order-journey__thank-you-check"><Check aria-hidden="true" /></span>
                <small>{text.order} #{orderNumber}</small><h2 id="order-journey-thanks-title">{text.thankYouTitle}</h2><p>{text.thankYouBody}</p>
              </section>
            ) : (
              <>
                <div className="order-journey__scene" key={order.status}>
                  {!visualFailed ? (
                    <img
                      src={`${stageVisuals[currentStage]}${visualRetry ? '?retry=1' : ''}`}
                      alt={statusContent.label}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      onError={() => visualRetry === 0 ? setVisualRetry(1) : setVisualFailed(true)}
                    />
                  ) : (
                    <span className="order-journey__scene-fallback" role="img" aria-label={statusContent.label}>
                      {currentStage === 0 ? <ReceiptText aria-hidden="true" /> : currentStage === 1 ? <Utensils aria-hidden="true" /> : <Check aria-hidden="true" />}
                      <strong>{statusContent.label}</strong>
                    </span>
                  )}
                </div>
                <ol className="order-journey__progress" aria-label={text.current}>
                  {stageLabels.map((label, index) => {
                    const Icon = stageIcons[index];
                    const complete = !cancelled && index <= currentStage;
                    const current = !cancelled && index === currentStage;
                    return <li key={label} className={`${complete ? 'is-complete' : ''} ${!cancelled && index < currentStage ? 'is-past' : ''}`} aria-current={current ? 'step' : undefined}><span className="order-journey__step-icon"><Icon aria-hidden="true" /></span><span>{label}</span></li>;
                  })}
                </ol>
                <section className="order-journey__status" aria-labelledby="order-journey-status-title">
                  <span className="order-journey__status-icon">{cancelled ? <CircleAlert aria-hidden="true" /> : currentStage === 2 ? <Check aria-hidden="true" /> : <Clock3 aria-hidden="true" />}</span>
                  <div><small>{text.current}</small><h2 id="order-journey-status-title">{statusContent.title}</h2><p>{statusContent.body}</p></div>
                </section>
              </>
            )}

            {!done && !cancelled && (
              <details className="order-journey__summary" open={cancelled}>
                <summary><span><strong>{text.summary}</strong><small>{itemCount} {itemCount === 1 ? text.item : text.items}</small></span><span className="order-journey__summary-total">{formatMoney(order.total, locale)}</span><ChevronDown aria-hidden="true" /></summary>
                <div className="order-journey__lines">
                  {order.lines.map((line, index) => <div className="order-journey__line" key={`${line.item.id}-${line.quantity}-${index}`}><span className="order-journey__quantity">{line.quantity}×</span><span>{line.item.name[locale]}</span><strong>{formatMoney(line.item.price * line.quantity, locale)}</strong></div>)}
                </div>
                <dl className="order-journey__details"><div><dt>{text.customer}</dt><dd>{order.customerName}</dd></div>{order.notes && <div><dt>{text.notes}</dt><dd>{order.notes}</dd></div>}</dl>
                <div className="order-journey__total"><span>{text.total}</span><strong>{formatMoney(order.total, locale)}</strong></div>
              </details>
            )}

            {!notificationsEnabled && !cancelled && !done && currentStage < 2 && (
              <section className="order-journey__notifications">
                <Bell aria-hidden="true" /><div><strong>{text.notificationsTitle}</strong><p>{text.notificationsBody}</p></div>
                {notificationFeedback === 'failed' && <p className="order-journey__notification-error" role="alert">{text.notificationUnavailable}</p>}
                <button type="button" onClick={enableNotifications} disabled={notificationPromptBusy}>{notificationPromptBusy ? <LoaderCircle className="order-journey__spinner" aria-hidden="true" /> : <Bell aria-hidden="true" />}{notificationPromptBusy ? text.enabling : text.enableNotifications}</button>
              </section>
            )}

            {order.status === 'ready' && (
              <section className="order-journey__confirmation" aria-labelledby="order-journey-rating-title">
                <div><h3 id="order-journey-rating-title">{text.rateTitle}</h3><p>{text.rateBody}</p></div>
                <fieldset className="order-journey__rating"><legend>{text.rating}</legend><div>{[1, 2, 3, 4, 5].map((value) => <label key={value} className={rating !== null && value <= rating ? 'is-selected' : ''}><input type="radio" name="order-journey-rating" value={value} checked={rating === value} onChange={() => setRating(value)} aria-label={`${value} / 5`} /><span><Star aria-hidden="true" /></span></label>)}</div></fieldset>
                <label className="order-journey__feedback"><span>{text.feedback}</span><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={1000} placeholder={text.feedbackPlaceholder} rows={3} /><small>{feedback.length}/1000</small></label>
                {confirmationState === 'failed' && <p className="order-journey__confirmation-error" role="alert">{text.confirmationError}</p>}
                <button type="button" className="order-journey__confirm" onClick={() => void confirmReceived()} disabled={confirmationState === 'busy'}>{confirmationState === 'busy' ? <LoaderCircle className="order-journey__spinner" aria-hidden="true" /> : <Send aria-hidden="true" />}{confirmationState === 'busy' ? text.confirming : text.confirmReceived}</button>
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
