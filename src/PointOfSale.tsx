import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Check, Eraser, Maximize2, Minimize2, Minus, Plus, Printer, RefreshCw, Search, ShoppingBag, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import type { CartLine, Category, Locale, MenuItem, Order, ThemeSettings } from './types';
import { createRemoteOrder, deletePosDraft, loadPosDrafts, savePosDraft, type PosDraft } from './remoteData';
import { canOrder } from './orderLogic';
import './pos.css';

const copy = {
  de: {
    receiptButton: 'Beleg', receiptButtonTitle: 'Bestellbeleg drucken', printPreview: 'Druckvorschau', receiptTitle: 'Bestellbeleg',
    close: 'Schließen', paperSize: 'Papierformat', print: 'Drucken', notTaxInvoice: 'Keine Steuerrechnung', number: 'Nr.',
    timeUnavailable: 'Zeit nicht verfügbar', register: 'Kasse', onlineOrder: 'Online-Bestellung', cancelled: 'STORNIERT',
    item: 'Artikel', total: 'Gesamt', each: 'Stk.', totalAmount: 'Gesamtbetrag', notes: 'Anmerkungen',
    paymentNotice: 'Zahlung nicht durch diesen Beleg bestätigt.', thanks: 'Vielen Dank für Ihre Bestellung!',
    pos: 'Kasse', available: 'verfügbare Artikel', search: 'Artikel suchen', searchPlaceholder: 'Artikel suchen …',
    categories: 'Kategorien', all: 'Alle', noResults: 'Keine verfügbaren Artikel gefunden.', currentOrder: 'Aktuelle Bestellung',
    selectedItems: 'Artikel', closeOrder: 'Bestellung schließen', saved: 'gespeichert', noneSelected: 'Keine Artikel ausgewählt',
    less: 'weniger', more: 'mehr', remove: 'entfernen', name: 'Name', optional: 'optional', confirm: 'Bestellung bestätigen',
    saving: 'Wird gespeichert …', openOrder: 'Aktuelle Bestellung öffnen', nameRequired: 'Bitte einen Namen eingeben.',
    submitFailed: 'Bestellung nicht bestätigt. Verbindung und Artikelverfügbarkeit prüfen, danach erneut versuchen.',
    focusMode:'Vollbild', exitFocus:'Vollbild verlassen', online:'Online', offline:'Offline', newOrder:'Neue Bestellung', clear:'Leeren',
    hold:'Parken', heldOrders:'Geparkte Bestellungen', noDrafts:'Keine geparkten Bestellungen', resume:'Öffnen', draftSaved:'Bestellung wurde geparkt.',
    unavailableRemoved:'Nicht verfügbare Artikel wurden entfernt.', confirmClear:'Aktuelle Bestellung wirklich leeren?', keep:'Behalten', clearOrder:'Bestellung leeren',
    successTitle:'Bestellung bestätigt', successText:'Die Bestellung wurde sicher gespeichert.', printReceipt:'Beleg drucken', startNext:'Nächste Bestellung', shortcutHelp:'F2 Neue Bestellung · / Suche · Strg+Enter Bestätigen',
  },
  en: {
    receiptButton: 'Receipt', receiptButtonTitle: 'Print order receipt', printPreview: 'Print preview', receiptTitle: 'Order receipt',
    close: 'Close', paperSize: 'Paper size', print: 'Print', notTaxInvoice: 'Not a tax invoice', number: 'No.',
    timeUnavailable: 'Time unavailable', register: 'Point of sale', onlineOrder: 'Online order', cancelled: 'CANCELLED',
    item: 'Item', total: 'Total', each: 'each', totalAmount: 'Total amount', notes: 'Notes',
    paymentNotice: 'Payment is not confirmed by this receipt.', thanks: 'Thank you for your order!',
    pos: 'Point of sale', available: 'available items', search: 'Search items', searchPlaceholder: 'Search items …',
    categories: 'Categories', all: 'All', noResults: 'No available items found.', currentOrder: 'Current order',
    selectedItems: 'items', closeOrder: 'Close order', saved: 'saved', noneSelected: 'No items selected',
    less: 'decrease', more: 'increase', remove: 'remove', name: 'Name', optional: 'optional', confirm: 'Confirm order',
    saving: 'Saving …', openOrder: 'Open current order', nameRequired: 'Please enter a name.',
    submitFailed: 'Order was not confirmed. Check the connection and item availability, then try again.',
    focusMode:'Full screen', exitFocus:'Exit full screen', online:'Online', offline:'Offline', newOrder:'New order', clear:'Clear',
    hold:'Hold', heldOrders:'Held orders', noDrafts:'No held orders', resume:'Resume', draftSaved:'Order held safely.',
    unavailableRemoved:'Unavailable items were removed.', confirmClear:'Clear the current order?', keep:'Keep order', clearOrder:'Clear order',
    successTitle:'Order confirmed', successText:'The order was saved securely.', printReceipt:'Print receipt', startNext:'Next order', shortcutHelp:'F2 New order · / Search · Ctrl+Enter Confirm',
  },
} as const;

function formatEuro(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function receiptDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-DE',{ dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin' }).format(date)
    : copy[locale].timeUnavailable;
}

export function OrderReceipt({ order, siteName, locale }: { order: Order; siteName: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState('80');
  const closeRef = useRef<HTMLButtonElement>(null);
  const text = copy[locale];
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previous?.focus(); };
  }, [open]);
  return <>
    <button type="button" className="receipt-button" title={text.receiptButtonTitle} onClick={() => setOpen(true)}><Printer size={18} /> {text.receiptButton}</button>
    {open && createPortal(<div className="receipt-overlay" role="dialog" aria-modal="true" aria-label={text.printPreview}>
      <div className="receipt-dialog">
        <header><h2>{text.receiptTitle}</h2><button ref={closeRef} onClick={() => setOpen(false)} aria-label={text.close}><X size={20} /></button></header>
        <div className="receipt-actions"><label>{text.paperSize} <select value={paper} onChange={e => setPaper(e.target.value)}><option value="80">80 mm</option><option value="58">58 mm</option><option value="a4">A4</option></select></label><button onClick={() => window.print()}><Printer size={18} /> {text.print}</button></div>
        <article className={`printed-receipt paper-${paper}`} lang={locale}>
          <h2>{siteName}</h2><p>{text.receiptTitle} · {text.notTaxInvoice}</p>
          <h1>{text.number} {order.orderNumber || order.id}</h1>
          <p>{receiptDate(order.createdAt, locale)}</p>
          <p>{order.source === 'pos' ? text.register : text.onlineOrder} · {order.customerName}</p>
          {order.status === 'cancelled' && <strong>{text.cancelled}</strong>}
          <table><thead><tr><th>{text.item}</th><th>{text.total}</th></tr></thead><tbody>{order.lines.map((line,index) => <tr key={index}><td>{line.quantity} × {line.item.name[locale]}<small>{formatEuro(line.item.price, locale)} / {text.each}</small></td><td>{formatEuro(line.item.price*line.quantity, locale)}</td></tr>)}</tbody></table>
          <div className="receipt-total"><strong>{text.totalAmount}</strong><strong>{formatEuro(order.total, locale)}</strong></div>
          {order.notes && <p className="receipt-note"><strong>{text.notes}</strong><br />{order.notes}</p>}
          <p>{text.paymentNotice}</p><p>{text.thanks}</p>
        </article>
      </div>
    </div>,document.body)}
  </>;
}

export function PointOfSale({ items, categories, theme, locale, onCreated }: { items: MenuItem[]; categories: Category[]; theme: ThemeSettings; locale: Locale; onCreated: (order: Order) => void }) {
  const devFocusPreview=import.meta.env.DEV&&new URLSearchParams(window.location.search).get('focus')==='1';
  const rootRef=useRef<HTMLElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('all');
  const [cart,setCart] = useState<CartLine[]>([]);
  const [name,setName] = useState('');
  const [notes,setNotes] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState<Order | null>(null);
  const [basketOpen,setBasketOpen] = useState(false);
  const [focusMode,setFocusMode]=useState(devFocusPreview);
  const [online,setOnline]=useState(typeof navigator==='undefined'||navigator.onLine);
  const [clock,setClock]=useState(new Date());
  const [drafts,setDrafts]=useState<PosDraft[]>([]);
  const [draftsOpen,setDraftsOpen]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);
  const [notice,setNotice]=useState('');
  const text = copy[locale];
  const attempt = useRef<{ fingerprint:string; key:string } | null>(null);
  const lock = useRef(false);
  const available = items.filter(i => canOrder(i,items));
  const visible = available.filter(i => (category==='all' || category===i.categoryId) && i.name[locale].toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))).sort((a,b) => a.sortOrder-b.sortOrder);
  const total = cart.reduce((sum,line) => sum + Math.round(line.item.price*100)*line.quantity,0)/100;
  const itemCount=cart.reduce((sum,line)=>sum+line.quantity,0);
  const add = (item:MenuItem) => {
    if (busy) return;
    setSaved(null);
    setCart(current => current.some(l => l.item.id===item.id) ? current.map(l => l.item.id===item.id ? {...l,quantity:Math.min(99,l.quantity+1)} : l) : [...current,{item,quantity:1}]);
  };
  const quantity = (id:string,delta:number) => setCart(current => current.map(l => l.item.id===id ? {...l,quantity:Math.min(99,l.quantity+delta)} : l).filter(l => l.quantity>0));
  const submit = async () => {
    if (lock.current || !cart.length) return;
    if (!name.trim()) { setError(text.nameRequired); return; }
    const fingerprint = JSON.stringify({name:name.trim(),notes:notes.trim(),lines:cart.map(l => [l.item.id,l.quantity])});
    if (attempt.current?.fingerprint!==fingerprint) attempt.current={fingerprint,key:crypto.randomUUID()};
    lock.current=true; setBusy(true); setError('');
    try {
      const order = await createRemoteOrder({name,notes,lines:cart,requestKey:attempt.current.key,source:'pos'});
      setSaved(order); onCreated(order); setCart([]); setName(''); setNotes(''); setBasketOpen(false); attempt.current=null;
    } catch { setError(text.submitFailed); }
    finally { lock.current=false; setBusy(false); }
  };

  const resetOrder=()=>{setCart([]);setName('');setNotes('');setError('');setSaved(null);setNotice('');attempt.current=null;};
  const refreshDrafts=async()=>{try{setDrafts(await loadPosDrafts());}catch{setError(text.submitFailed);}};
  const holdOrder=async()=>{
    if(!cart.length)return;
    setBusy(true);setError('');
    try{await savePosDraft({customerName:name.trim(),notes:notes.trim(),lines:cart.map(line=>({id:line.item.id,quantity:line.quantity}))});resetOrder();setNotice(text.draftSaved);await refreshDrafts();}
    catch{setError(text.submitFailed);}finally{setBusy(false);}
  };
  const resumeDraft=async(draft:PosDraft)=>{
    const next=draft.lines.flatMap(line=>{const item=available.find(candidate=>candidate.id===line.id);return item?[{item,quantity:line.quantity}]:[];});
    setCart(next);setName(draft.customerName);setNotes(draft.notes);setSaved(null);setDraftsOpen(false);setBasketOpen(true);
    if(next.length!==draft.lines.length)setNotice(text.unavailableRemoved);
    try{await deletePosDraft(draft.id);await refreshDrafts();}catch{setError(text.submitFailed);}
  };
  const toggleFocus=async()=>{
    if(focusMode){if(document.fullscreenElement)await document.exitFullscreen().catch(()=>undefined);setFocusMode(false);return;}
    setFocusMode(true);
    if(rootRef.current?.requestFullscreen)await rootRef.current.requestFullscreen().catch(()=>undefined);
  };

  useEffect(()=>{let active=true;loadPosDrafts().then(value=>{if(active)setDrafts(value);}).catch(()=>{if(active)setError(text.submitFailed);});return()=>{active=false;};},[text.submitFailed]);
  useEffect(()=>{const tick=window.setInterval(()=>setClock(new Date()),1000);const on=()=>setOnline(true);const off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.clearInterval(tick);window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
  useEffect(()=>{const changed=()=>{if(!document.fullscreenElement)setFocusMode(false);};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(cart.length){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[cart.length]);
  useEffect(()=>{const keys=(event:KeyboardEvent)=>{
    const editing=(event.target as HTMLElement)?.matches('input,textarea,select');
    if(event.key==='/'&&!editing){event.preventDefault();searchRef.current?.focus();}
    if(event.key==='F2'){event.preventDefault();if(cart.length)setConfirmClear(true);else resetOrder();}
    if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();void submit();}
  };document.addEventListener('keydown',keys);return()=>document.removeEventListener('keydown',keys);});

  return <section ref={rootRef} className={`pos ${focusMode?'pos-focus-mode':''}`} lang={locale} aria-label={text.pos} style={{'--pos-bg':theme.background,'--pos-surface':theme.surface,'--pos-text':theme.text,'--pos-muted':theme.mutedText,'--pos-border':theme.border} as CSSProperties}>
    <header className="pos-command-bar">
      <div className="pos-command-identity"><strong>{theme.siteName}</strong><span className={online?'online':'offline'}>{online?<Wifi size={15}/>:<WifiOff size={15}/>} {online?text.online:text.offline}</span><time>{clock.toLocaleTimeString(locale==='de'?'de-DE':'en-DE',{hour:'2-digit',minute:'2-digit'})}</time></div>
      <div className="pos-command-actions"><button className="primary new-order" onClick={()=>cart.length?setConfirmClear(true):resetOrder()}><RefreshCw size={17}/><span>{text.newOrder}</span></button><button className="hold-order" aria-label={text.hold} title={text.hold} disabled={!cart.length||busy} onClick={()=>void holdOrder()}><Archive size={17}/><span>{text.hold}</span></button><button className="draft-orders" aria-label={text.heldOrders} title={text.heldOrders} onClick={()=>setDraftsOpen(true)}><Archive size={17}/><span>{text.heldOrders}</span><b className="command-count">{drafts.length}</b></button><button className="icon-only" aria-label={focusMode?text.exitFocus:text.focusMode} title={focusMode?text.exitFocus:text.focusMode} onClick={()=>void toggleFocus()}>{focusMode?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button></div>
    </header>
    <div className="pos-catalog">
      <header className="pos-heading"><div><h2>{text.pos}</h2><span>{available.length} {text.available}</span></div><ShoppingBag size={24} /></header>
      {notice&&<p className="pos-notice" role="status">{notice}</p>}
      <label className="pos-search"><Search size={18} /><input ref={searchRef} aria-label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav className="pos-categories" aria-label={text.categories}><button aria-pressed={category==='all'} onClick={() => setCategory('all')}>{text.all}</button>{categories.map(c => <button key={c.id} aria-pressed={category===c.id} onClick={() => setCategory(c.id)}>{c.name[locale]}</button>)}</nav>
      <div className="pos-products">{visible.map(item => <button className="pos-product" key={item.id} disabled={busy} onClick={() => add(item)}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="pos-no-image"><ShoppingBag size={26} /></span>}
        <strong>{item.name[locale]}</strong><span>{formatEuro(item.price, locale)}<Plus size={17} /></span>
      </button>)}</div>
      {!visible.length && <p className="pos-empty">{text.noResults}</p>}
    </div>
    <aside className={`pos-basket ${basketOpen ? 'open' : ''}`} aria-label={text.currentOrder}>
      <header><h2>{text.currentOrder}</h2><span>{cart.reduce((sum,l) => sum+l.quantity,0)} {text.selectedItems}</span><button className="pos-basket-close" aria-label={text.closeOrder} onClick={() => setBasketOpen(false)}><X size={19} /></button></header>
      {!cart.length && !saved && <div className="pos-empty"><ShoppingBag size={32} /><p>{text.noneSelected}</p></div>}
      <fieldset disabled={busy} className="pos-fields"><div className="pos-lines">{cart.map(line => <div className="pos-line" key={line.item.id}>
        <div><strong>{line.item.name[locale]}</strong><span>{formatEuro(line.item.price*line.quantity, locale)}</span></div>
        <div className="pos-quantity"><button aria-label={`${line.item.name[locale]}: ${text.less}`} onClick={() => quantity(line.item.id,-1)}><Minus size={16} /></button><output>{line.quantity}</output><button aria-label={`${line.item.name[locale]}: ${text.more}`} onClick={() => quantity(line.item.id,1)}><Plus size={16} /></button><button aria-label={`${line.item.name[locale]}: ${text.remove}`} onClick={() => setCart(cart.filter(l => l.item.id!==line.item.id))}><Trash2 size={16} /></button></div>
      </div>)}</div>
      <label>{text.name}<input maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label>{text.notes} <small>({text.optional})</small><textarea maxLength={2000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </fieldset>
      <div className="pos-basket-secondary"><button disabled={!cart.length||busy} onClick={()=>void holdOrder()}><Archive size={17}/>{text.hold}</button><button disabled={!cart.length||busy} onClick={()=>setConfirmClear(true)}><Eraser size={17}/>{text.clear}</button></div>
      <div className="pos-total"><span>{text.total}</span><strong>{formatEuro(total, locale)}</strong></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="pos-submit" disabled={busy || !cart.length} onClick={() => void submit()}><Check size={19} />{busy ? text.saving : text.confirm}</button>
    </aside>
    <button className="pos-basket-toggle" aria-label={text.openOrder} onClick={() => setBasketOpen(true)}><ShoppingBag size={20} /><span>{itemCount} {text.selectedItems}</span><strong>{formatEuro(total, locale)}</strong></button>
    {basketOpen && <button className="pos-basket-scrim" aria-label={text.closeOrder} onClick={() => setBasketOpen(false)} />}
    {draftsOpen&&createPortal(<div className="pos-modal-scrim" role="dialog" aria-modal="true" aria-label={text.heldOrders}><section className="pos-drafts"><header><h2>{text.heldOrders}</h2><button aria-label={text.close} onClick={()=>setDraftsOpen(false)}><X/></button></header>{drafts.length?<div>{drafts.map(draft=><article key={draft.id}><div><strong>{draft.customerName||`#${draft.id.slice(0,8)}`}</strong><small>{receiptDate(draft.updatedAt,locale)} · {draft.lines.reduce((sum,line)=>sum+line.quantity,0)} {text.selectedItems}</small></div><button onClick={()=>void resumeDraft(draft)}>{text.resume}</button></article>)}</div>:<p className="pos-empty">{text.noDrafts}</p>}</section></div>,document.body)}
    {confirmClear&&createPortal(<div className="pos-modal-scrim" role="dialog" aria-modal="true" aria-label={text.confirmClear}><section className="pos-confirm-dialog"><h2>{text.confirmClear}</h2><div><button onClick={()=>setConfirmClear(false)}>{text.keep}</button><button className="danger" onClick={()=>{resetOrder();setConfirmClear(false);}}>{text.clearOrder}</button></div></section></div>,document.body)}
    {saved&&createPortal(<div className="pos-modal-scrim" role="dialog" aria-modal="true" aria-label={text.successTitle}><section className="pos-success"><span><Check size={34}/></span><h2>{text.successTitle}</h2><p>{text.successText}</p><strong>#{saved.orderNumber||saved.id}</strong><b>{formatEuro(saved.total,locale)}</b><div><OrderReceipt order={saved} siteName={theme.siteName} locale={locale}/><button onClick={resetOrder}><RefreshCw size={18}/>{text.startNext}</button></div></section></div>,document.body)}
  </section>;
}
