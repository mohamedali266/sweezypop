import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, Printer, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import type { CartLine, Category, Locale, MenuItem, Order, ThemeSettings } from './types';
import { createRemoteOrder } from './remoteData';
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
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('all');
  const [cart,setCart] = useState<CartLine[]>([]);
  const [name,setName] = useState('');
  const [notes,setNotes] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState<Order | null>(null);
  const [basketOpen,setBasketOpen] = useState(false);
  const text = copy[locale];
  const attempt = useRef<{ fingerprint:string; key:string } | null>(null);
  const lock = useRef(false);
  const available = items.filter(i => canOrder(i,items));
  const visible = available.filter(i => (category==='all' || category===i.categoryId) && i.name[locale].toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))).sort((a,b) => a.sortOrder-b.sortOrder);
  const total = cart.reduce((sum,line) => sum + Math.round(line.item.price*100)*line.quantity,0)/100;
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
      setSaved(order); onCreated(order); setCart([]); setName(''); setNotes(''); attempt.current=null;
    } catch { setError(text.submitFailed); }
    finally { lock.current=false; setBusy(false); }
  };
  return <section className="pos" lang={locale} aria-label={text.pos}>
    <div className="pos-catalog">
      <header className="pos-heading"><div><h2>{text.pos}</h2><span>{available.length} {text.available}</span></div><ShoppingBag size={24} /></header>
      <label className="pos-search"><Search size={18} /><input aria-label={text.search} placeholder={text.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav className="pos-categories" aria-label={text.categories}><button aria-pressed={category==='all'} onClick={() => setCategory('all')}>{text.all}</button>{categories.map(c => <button key={c.id} aria-pressed={category===c.id} onClick={() => setCategory(c.id)}>{c.name[locale]}</button>)}</nav>
      <div className="pos-products">{visible.map(item => <button className="pos-product" key={item.id} disabled={busy} onClick={() => add(item)}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="pos-no-image"><ShoppingBag size={26} /></span>}
        <strong>{item.name[locale]}</strong><span>{formatEuro(item.price, locale)}<Plus size={17} /></span>
      </button>)}</div>
      {!visible.length && <p className="pos-empty">{text.noResults}</p>}
    </div>
    <aside className={`pos-basket ${basketOpen ? 'open' : ''}`} aria-label={text.currentOrder}>
      <header><h2>{text.currentOrder}</h2><span>{cart.reduce((sum,l) => sum+l.quantity,0)} {text.selectedItems}</span><button className="pos-basket-close" aria-label={text.closeOrder} onClick={() => setBasketOpen(false)}><X size={19} /></button></header>
      {saved && <div className="pos-confirmation" role="status"><Check size={22} /><div><strong>{text.receiptTitle} {saved.orderNumber} {text.saved}</strong><p>{formatEuro(saved.total, locale)}</p><OrderReceipt order={saved} siteName={theme.siteName} locale={locale} /></div></div>}
      {!cart.length && !saved && <div className="pos-empty"><ShoppingBag size={32} /><p>{text.noneSelected}</p></div>}
      <fieldset disabled={busy} className="pos-fields"><div className="pos-lines">{cart.map(line => <div className="pos-line" key={line.item.id}>
        <div><strong>{line.item.name[locale]}</strong><span>{formatEuro(line.item.price*line.quantity, locale)}</span></div>
        <div className="pos-quantity"><button aria-label={`${line.item.name[locale]}: ${text.less}`} onClick={() => quantity(line.item.id,-1)}><Minus size={16} /></button><output>{line.quantity}</output><button aria-label={`${line.item.name[locale]}: ${text.more}`} onClick={() => quantity(line.item.id,1)}><Plus size={16} /></button><button aria-label={`${line.item.name[locale]}: ${text.remove}`} onClick={() => setCart(cart.filter(l => l.item.id!==line.item.id))}><Trash2 size={16} /></button></div>
      </div>)}</div>
      <label>{text.name}<input maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label>{text.notes} <small>({text.optional})</small><textarea maxLength={2000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </fieldset>
      <div className="pos-total"><span>{text.total}</span><strong>{formatEuro(total, locale)}</strong></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="pos-submit" disabled={busy || !cart.length} onClick={() => void submit()}><Check size={19} />{busy ? text.saving : text.confirm}</button>
    </aside>
    <button className="pos-basket-toggle" aria-label={text.openOrder} onClick={() => setBasketOpen(true)}><ShoppingBag size={20} /><span>{cart.reduce((sum,l) => sum+l.quantity,0)} {text.selectedItems}</span><strong>{formatEuro(total, locale)}</strong></button>
    {basketOpen && <button className="pos-basket-scrim" aria-label={text.closeOrder} onClick={() => setBasketOpen(false)} />}
  </section>;
}
