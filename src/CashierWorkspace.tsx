import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, BellRing, Check, Clock3, LogOut, PackageCheck, Play, ReceiptText, RefreshCw, ShoppingBag, WalletCards, X } from 'lucide-react';
import { OrderReceipt, PointOfSale } from './PointOfSale';
import {
  closeCashierShift,
  createCashTransfer,
  loadCashierWorkspace,
  loadCashierOpeningBalance,
  loadCurrentCashierShift,
  openCashierShift,
  subscribeToStaffOrders,
  updateCashierOrderStatus,
} from './remoteData';
import type { CashierShift, CashierSummary, Category, Locale, MenuItem, Order, StaffBoardOrder, ThemeSettings } from './types';
import './cashier-workspace.css';
import './cashier-opening-balance.css';

type WorkspaceTab = 'pos' | 'orders' | 'summary';

const copy = {
  de: {
    workspace:'Kassenbereich', pos:'Kasse', orders:'Abholung', summary:'Tagesübersicht', logout:'Abmelden',
    openingTitle:'Kasse öffnen', openingCopy:'Öffne deine Schicht, bevor du Bestellungen annimmst.',
    openingBalance:'Übertrag aus der letzten Schicht', openRegister:'Schicht öffnen', opening:'Wird geöffnet …',
    live:'Live verbunden', reconnecting:'Verbindung wird hergestellt', offline:'Offline', shift:'Schicht',
    enableSound:'Hinweise aktivieren', soundCopy:'Ton und Desktop-Hinweise für abholbereite Bestellungen aktivieren.',
    activeOrders:'Aktive Bestellungen', ready:'Abholbereit', preparing:'In Zubereitung', received:'Neu',
    menu:'Online-Menü', sourcePos:'Kasse', details:'Bestelldetails', customer:'Name', notes:'Anmerkungen',
    collected:'Als abgeholt markieren', cancel:'Stornieren', close:'Schließen', noOrders:'Keine aktiven Bestellungen.',
    completed:'Abgeschlossen heute', revenue:'Barumsatz heute', cancelled:'Storniert heute', drawer:'Kassenbestand',
    openingShort:'Anfangsbestand', sales:'Umsatz in der Schicht', transferred:'Übergeben', expected:'Erwarteter Bargeldbestand',
    transferTitle:'Bargeld übergeben', transferCopy:'Jede Übergabe wird dauerhaft mit Name, Datum und Uhrzeit protokolliert.',
    amount:'Betrag', transfer:'Übergabe speichern', transferHistory:'Übergaben dieser Schicht', none:'Noch keine Übergaben.',
    closeShift:'Schicht schließen', closeConfirm:'Schicht jetzt schließen?', closeWarning:'Verbleibendes Bargeld wird als Anfangsbestand der nächsten Schicht übernommen.',
    error:'Aktion konnte nicht abgeschlossen werden. Bitte Verbindung prüfen und erneut versuchen.',
    transferRequired:'Vor dem Schließen muss mindestens eine Bargeldübergabe gespeichert werden.',
  },
  en: {
    workspace:'Cashier workspace', pos:'Point of sale', orders:'Pickup orders', summary:'Daily summary', logout:'Sign out',
    openingTitle:'Open register', openingCopy:'Open your shift before accepting orders.',
    openingBalance:'Balance carried from the previous shift', openRegister:'Open shift', opening:'Opening …',
    live:'Live connected', reconnecting:'Reconnecting', offline:'Offline', shift:'Shift',
    enableSound:'Enable alerts', soundCopy:'Enable sound and desktop alerts for orders ready for pickup.',
    activeOrders:'Active orders', ready:'Ready', preparing:'Preparing', received:'New',
    menu:'Online menu', sourcePos:'POS', details:'Order details', customer:'Name', notes:'Notes',
    collected:'Mark as collected', cancel:'Cancel order', close:'Close', noOrders:'No active orders.',
    completed:'Completed today', revenue:'Cash sales today', cancelled:'Cancelled today', drawer:'Cash drawer',
    openingShort:'Opening balance', sales:'Shift sales', transferred:'Transferred', expected:'Expected drawer cash',
    transferTitle:'Transfer cash', transferCopy:'Every transfer is permanently recorded with employee name, date and time.',
    amount:'Amount', transfer:'Save transfer', transferHistory:'Transfers this shift', none:'No transfers yet.',
    closeShift:'Close shift', closeConfirm:'Close the shift now?', closeWarning:'Remaining cash will carry into the next shift opening balance.',
    error:'The action could not be completed. Check the connection and try again.',
    transferRequired:'Save at least one cash transfer before closing the shift.',
  },
} as const;

function money(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE', { style:'currency', currency:'EUR' }).format(value);
}

function time(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-DE', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
}

export function CashierWorkspace(props: {
  locale:Locale; siteName:string; logoUrl?:string; appIconUrl?:string; cashierName:string; restaurantId:string;
  items:MenuItem[]; categories:Category[]; theme:ThemeSettings;
  onToggleLocale:()=>void; onLogout:()=>void;
}) {
  const { locale, siteName, logoUrl, appIconUrl, cashierName, restaurantId, items, categories, theme, onToggleLocale, onLogout } = props;
  const text = copy[locale];
  const [shift,setShift]=useState<CashierShift|null>(null);
  const [openingBalance,setOpeningBalance]=useState(0);
  const [summary,setSummary]=useState<CashierSummary|null>(null);
  const [orders,setOrders]=useState<StaffBoardOrder[]>([]);
  const [tab,setTab]=useState<WorkspaceTab>('pos');
  const [selected,setSelected]=useState<StaffBoardOrder|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [connection,setConnection]=useState<'live'|'reconnecting'|'offline'>('reconnecting');
  const [soundEnabled,setSoundEnabled]=useState(false);
  const [transferAmount,setTransferAmount]=useState('');
  const [showClose,setShowClose]=useState(false);
  const [now,setNow]=useState(Date.now());
  const knownReady=useRef(new Set<string>());
  const initialLoaded=useRef(false);
  const alertAudio=useRef<HTMLAudioElement|null>(null);
  const refreshing=useRef(false);

  const playAlert=useCallback(() => {
    if (!soundEnabled || !alertAudio.current) return;
    alertAudio.current.currentTime=0;
    void alertAudio.current.play().catch(()=>setSoundEnabled(false));
  },[soundEnabled]);

  const refresh=useCallback(async (initial=false) => {
    if (refreshing.current) return;
    refreshing.current=true;
    try {
      const next=await loadCashierWorkspace();
      const freshReady=next.orders.filter(order=>order.status==='ready'&&!knownReady.current.has(order.id));
      setShift(next.summary.shift);
      setSummary(next.summary);
      setOrders(next.orders);
      knownReady.current=new Set(next.orders.filter(order=>order.status==='ready').map(order=>order.id));
      if (!initial && initialLoaded.current && freshReady.length) {
        playAlert();
        if ('Notification' in window && Notification.permission==='granted' && document.hidden && 'serviceWorker' in navigator) {
          const first=freshReady[0];
          void navigator.serviceWorker.ready.then(registration=>registration.showNotification(
            locale==='de'?`Bestellung #${first.orderNumber} ist fertig`:`Order #${first.orderNumber} is ready`,
            { body:first.customerName, icon:appIconUrl||'/brand/sweezypop-app-icon-v2-192.png', badge:'/brand/sweezypop-app-icon-v2-192.png', tag:`cashier-ready-${first.id}` },
          ));
        }
      }
      initialLoaded.current=true;
      setConnection(navigator.onLine?'live':'offline');
      setError('');
    } catch {
      setConnection(navigator.onLine?'reconnecting':'offline');
      setError(text.error);
    } finally { refreshing.current=false; }
  },[appIconUrl,locale,playAlert,text.error]);

  useEffect(()=>{
    let active=true;
    void loadCurrentCashierShift().then(async current=>{
      if (!active) return;
      setShift(current);
      if (current) void refresh(true);
      else setOpeningBalance(await loadCashierOpeningBalance());
    }).catch(()=>active&&setError(text.error)).finally(()=>active&&setLoading(false));
    return()=>{active=false;alertAudio.current?.pause();};
  },[refresh,text.error]);

  useEffect(()=>{
    if (!shift) return;
    const unsubscribe=subscribeToStaffOrders(restaurantId,()=>void refresh(),setConnection);
    const fallback=window.setInterval(()=>void refresh(),10000);
    const focus=()=>void refresh();
    window.addEventListener('focus',focus);
    return()=>{unsubscribe();window.clearInterval(fallback);window.removeEventListener('focus',focus);};
  },[refresh,restaurantId,shift]);

  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);

  const openRegister=async()=>{
    setBusy(true);setError('');
    try { const opened=await openCashierShift();setShift(opened);await refresh(true); }
    catch { setError(text.error); } finally { setBusy(false);setLoading(false); }
  };

  const enableAlerts=async()=>{
    try {
      const audio=new Audio('/staff-notification-v2.mp3');audio.preload='auto';audio.volume=0.95;
      await audio.play();audio.pause();audio.currentTime=0;alertAudio.current=audio;setSoundEnabled(true);
      if ('Notification' in window && Notification.permission==='default') await Notification.requestPermission();
    } catch { setSoundEnabled(false);setError(text.error); }
  };

  const changeStatus=async(order:StaffBoardOrder,status:Order['status'])=>{
    setBusy(true);setError('');
    try { await updateCashierOrderStatus(order,status);setSelected(null);await refresh(); }
    catch { setError(text.error); } finally { setBusy(false); }
  };

  const saveTransfer=async()=>{
    const amount=Number(transferAmount.replace(',','.'));
    if (!Number.isFinite(amount)||amount<=0) return;
    setBusy(true);setError('');
    try { await createCashTransfer(Math.round(amount*100)/100);setTransferAmount('');await refresh(); }
    catch { setError(text.error); } finally { setBusy(false); }
  };

  const closeRegister=async()=>{
    setBusy(true);setError('');
    try { await closeCashierShift();setShift(null);setSummary(null);setOrders([]);setShowClose(false);initialLoaded.current=false;knownReady.current.clear(); }
    catch { setError((summary?.shift?.expectedCash||0)>0&&(summary?.shift?.transfersTotal||0)===0?text.transferRequired:text.error); }
    finally { setBusy(false); }
  };

  const elapsed=shift?Math.max(0,Math.floor((now-new Date(shift.startedAt).getTime())/60000)):0;
  const readyCount=orders.filter(order=>order.status==='ready').length;
  const statusLabel=(status:Order['status'])=>status==='ready'?text.ready:status==='preparing'?text.preparing:text.received;
  const sourceLabel=(source:Order['source'])=>source==='pos'?text.sourcePos:text.menu;
  const ordered=useMemo(()=>[...orders].sort((a,b)=>(a.status==='ready'?0:a.status==='preparing'?1:2)-(b.status==='ready'?0:b.status==='preparing'?1:2)||new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()),[orders]);

  if (loading) return <main className="cashier-opening"><RefreshCw className="cashier-spin"/><p>{text.opening}</p></main>;
  if (!shift) return <main className="cashier-opening" lang={locale}>
    <section>
      <div className="cashier-brand">{logoUrl?<img src={logoUrl} alt=""/>:<span>{siteName.slice(0,1)}</span>}<div><strong>{siteName}</strong><small>{cashierName}</small></div></div>
      <span className="cashier-opening-icon"><WalletCards/></span><h1>{text.openingTitle}</h1><p>{text.openingCopy}</p>
      <div className="cashier-opening-balance"><span>{text.openingBalance}</span><strong>{money(openingBalance,locale)}</strong></div>
      {error&&<p className="cashier-error" role="alert">{error}</p>}
      <button className="cashier-primary" onClick={()=>void openRegister()} disabled={busy}><Play/>{busy?text.opening:text.openRegister}</button>
      <div className="cashier-opening-actions"><button onClick={onToggleLocale}>{locale==='de'?'EN':'DE'}</button><button onClick={onLogout}><LogOut/>{text.logout}</button></div>
    </section>
  </main>;

  return <main className="cashier-workspace" lang={locale}>
    <header className="cashier-topbar">
      <div className="cashier-brand">{logoUrl?<img src={logoUrl} alt=""/>:<span>{siteName.slice(0,1)}</span>}<div><strong>{siteName}</strong><small>{text.workspace} · {cashierName}</small></div></div>
      <div className="cashier-live"><i className={connection}/>{connection==='live'?text.live:connection==='offline'?text.offline:text.reconnecting}</div>
      <div className="cashier-shift-time"><Clock3/> {text.shift} {Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</div>
      <button className="cashier-language" onClick={onToggleLocale}>{locale==='de'?'EN':'DE'}</button>
      <button className="cashier-icon-button" onClick={onLogout} aria-label={text.logout}><LogOut/></button>
    </header>
    <nav className="cashier-tabs">
      <button className={tab==='pos'?'active':''} onClick={()=>setTab('pos')}><ShoppingBag/>{text.pos}</button>
      <button className={tab==='orders'?'active':''} onClick={()=>setTab('orders')}><PackageCheck/>{text.orders}{readyCount>0&&<b>{readyCount}</b>}</button>
      <button className={tab==='summary'?'active':''} onClick={()=>setTab('summary')}><ReceiptText/>{text.summary}</button>
    </nav>
    {!soundEnabled&&<aside className="cashier-alert-prompt"><BellRing/><div><strong>{text.enableSound}</strong><span>{text.soundCopy}</span></div><button onClick={()=>void enableAlerts()}>{text.enableSound}</button></aside>}
    {error&&<p className="cashier-error workspace-error" role="alert">{error}</p>}

    {tab==='pos'&&<div className="cashier-pos"><PointOfSale items={items} categories={categories} theme={theme} locale={locale} onCreated={()=>void refresh()}/></div>}

    {tab==='orders'&&<section className="cashier-orders">
      <header><div><span>{text.orders}</span><h1>{text.activeOrders}</h1></div><button className="cashier-icon-button" onClick={()=>void refresh()}><RefreshCw/></button></header>
      <div className="cashier-order-list">{ordered.map(order=><button key={order.id} className={`cashier-order-row ${order.status}`} onClick={()=>setSelected(order)}>
        <span className="cashier-order-number">#{order.orderNumber}</span><span><strong>{order.customerName}</strong><small>{sourceLabel(order.source)} · {time(order.createdAt,locale)}</small></span>
        <span className={`cashier-status ${order.status}`}>{statusLabel(order.status)}</span><strong>{money(order.total,locale)}</strong>
      </button>)}</div>{!orders.length&&<div className="cashier-empty"><PackageCheck/><p>{text.noOrders}</p></div>}
    </section>}

    {tab==='summary'&&summary&&<section className="cashier-summary">
      <div className="cashier-metrics">
        <article><PackageCheck/><span>{text.completed}</span><strong>{summary.completedToday}</strong></article>
        <article><Banknote/><span>{text.revenue}</span><strong>{money(summary.revenueToday,locale)}</strong></article>
        <article><ShoppingBag/><span>{text.activeOrders}</span><strong>{summary.activeOrders}</strong></article>
        <article><X/><span>{text.cancelled}</span><strong>{summary.cancelledToday}</strong></article>
      </div>
      <div className="cashier-finance-grid">
        <article className="cashier-drawer-card"><header><div><span>{text.drawer}</span><h2>{text.expected}</h2></div><WalletCards/></header><strong>{money(summary.shift?.expectedCash||0,locale)}</strong>
          <dl><div><dt>{text.openingShort}</dt><dd>{money(summary.shift?.openingBalance||0,locale)}</dd></div><div><dt>{text.sales}</dt><dd>{money(summary.shift?.salesTotal||0,locale)}</dd></div><div><dt>{text.transferred}</dt><dd>- {money(summary.shift?.transfersTotal||0,locale)}</dd></div></dl>
        </article>
        <article className="cashier-transfer-card"><span>{text.transferTitle}</span><h2>{text.transferTitle}</h2><p>{text.transferCopy}</p><label>{text.amount}<div><input inputMode="decimal" value={transferAmount} onChange={event=>setTransferAmount(event.target.value)} placeholder="0,00"/><b>€</b></div></label><button className="cashier-primary" disabled={busy||!transferAmount} onClick={()=>void saveTransfer()}><Banknote/>{text.transfer}</button></article>
      </div>
      <section className="cashier-transfer-history"><h2>{text.transferHistory}</h2>{summary.transfers.length?summary.transfers.map(transfer=><article key={transfer.id}><span><strong>{transfer.employeeName}</strong><small>{new Date(transfer.createdAt).toLocaleString(locale==='de'?'de-DE':'en-DE')}</small></span><b>{money(transfer.amount,locale)}</b></article>):<p>{text.none}</p>}</section>
      <button className="cashier-close-shift" onClick={()=>setShowClose(true)}>{text.closeShift}</button>
    </section>}

    {selected&&<div className="cashier-modal-scrim" onClick={()=>setSelected(null)}><section className="cashier-order-dialog" role="dialog" aria-modal="true" onClick={event=>event.stopPropagation()}>
      <header><div><span>{sourceLabel(selected.source)}</span><h2>#{selected.orderNumber}</h2></div><button onClick={()=>setSelected(null)}><X/></button></header>
      <div className="cashier-dialog-meta"><span>{text.customer}<strong>{selected.customerName}</strong></span><span>{statusLabel(selected.status)}<strong>{time(selected.createdAt,locale)}</strong></span></div>
      <div className="cashier-dialog-lines">{selected.lines.map(line=><div key={line.item.id}><span><b>{line.quantity}×</b>{line.item.name[locale]}</span><strong>{money(line.item.price*line.quantity,locale)}</strong></div>)}</div>
      {selected.notes&&<p className="cashier-notes"><b>{text.notes}</b>{selected.notes}</p>}
      <div className="cashier-dialog-total"><span>Total</span><strong>{money(selected.total,locale)}</strong></div>
      <footer><OrderReceipt order={selected} siteName={siteName} locale={locale}/>{selected.status==='ready'&&<button className="cashier-primary" disabled={busy} onClick={()=>void changeStatus(selected,'done')}><Check/>{text.collected}</button>}{selected.status==='new'&&<button className="cashier-danger" disabled={busy} onClick={()=>void changeStatus(selected,'cancelled')}><X/>{text.cancel}</button>}</footer>
    </section></div>}

    {showClose&&<div className="cashier-modal-scrim" onClick={()=>setShowClose(false)}><section className="cashier-confirm" role="dialog" aria-modal="true" onClick={event=>event.stopPropagation()}><span><WalletCards/></span><h2>{text.closeConfirm}</h2><strong>{money(summary?.shift?.expectedCash||0,locale)}</strong><p>{text.closeWarning}</p><div><button onClick={()=>setShowClose(false)}>{text.close}</button><button className="cashier-danger" disabled={busy} onClick={()=>void closeRegister()}>{text.closeShift}</button></div></section></div>}
  </main>;
}
