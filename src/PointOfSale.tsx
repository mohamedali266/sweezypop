import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, Printer, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import type { CartLine, Category, MenuItem, Order, ThemeSettings } from './types';
import { createRemoteOrder } from './remoteData';
import { canOrder, euro } from './orderLogic';
import './pos.css';

function receiptDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE',{ dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin' }).format(date)
    : 'Zeit nicht verfügbar';
}

export function OrderReceipt({ order, siteName }: { order: Order; siteName: string }) {
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState('80');
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previous?.focus(); };
  }, [open]);
  return <>
    <button type="button" className="receipt-button" title="Bestellbeleg drucken" onClick={() => setOpen(true)}><Printer size={18} /> Beleg</button>
    {open && createPortal(<div className="receipt-overlay" role="dialog" aria-modal="true" aria-label="Druckvorschau">
      <div className="receipt-dialog">
        <header><h2>Bestellbeleg</h2><button ref={closeRef} onClick={() => setOpen(false)} aria-label="Schließen"><X size={20} /></button></header>
        <div className="receipt-actions"><label>Papierformat <select value={paper} onChange={e => setPaper(e.target.value)}><option value="80">80 mm</option><option value="58">58 mm</option><option value="a4">A4</option></select></label><button onClick={() => window.print()}><Printer size={18} /> Drucken</button></div>
        <article className={`printed-receipt paper-${paper}`} lang="de">
          <h2>{siteName}</h2><p>Bestellbeleg · Keine Steuerrechnung</p>
          <h1>Nr. {order.orderNumber || order.id}</h1>
          <p>{receiptDate(order.createdAt)}</p>
          <p>{order.source === 'pos' ? 'Kasse' : 'Online-Bestellung'} · {order.customerName}</p>
          {order.status === 'cancelled' && <strong>STORNIERT</strong>}
          <table><thead><tr><th>Artikel</th><th>Gesamt</th></tr></thead><tbody>{order.lines.map((line,index) => <tr key={index}><td>{line.quantity} × {line.item.name.de}<small>{euro.format(line.item.price)} / Stk.</small></td><td>{euro.format(line.item.price*line.quantity)}</td></tr>)}</tbody></table>
          <div className="receipt-total"><strong>Gesamtbetrag</strong><strong>{euro.format(order.total)}</strong></div>
          {order.notes && <p className="receipt-note"><strong>Anmerkungen</strong><br />{order.notes}</p>}
          <p>Zahlung nicht durch diesen Beleg bestätigt.</p><p>Vielen Dank für Ihre Bestellung!</p>
        </article>
      </div>
    </div>,document.body)}
  </>;
}

export function PointOfSale({ items, categories, theme, onCreated }: { items: MenuItem[]; categories: Category[]; theme: ThemeSettings; onCreated: (order: Order) => void }) {
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('all');
  const [cart,setCart] = useState<CartLine[]>([]);
  const [name,setName] = useState('');
  const [notes,setNotes] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState<Order | null>(null);
  const [basketOpen,setBasketOpen] = useState(false);
  const attempt = useRef<{ fingerprint:string; key:string } | null>(null);
  const lock = useRef(false);
  const available = items.filter(i => canOrder(i,items));
  const visible = available.filter(i => (category==='all' || category===i.categoryId) && i.name.de.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))).sort((a,b) => a.sortOrder-b.sortOrder);
  const total = cart.reduce((sum,line) => sum + Math.round(line.item.price*100)*line.quantity,0)/100;
  const add = (item:MenuItem) => {
    if (busy) return;
    setSaved(null);
    setCart(current => current.some(l => l.item.id===item.id) ? current.map(l => l.item.id===item.id ? {...l,quantity:Math.min(99,l.quantity+1)} : l) : [...current,{item,quantity:1}]);
  };
  const quantity = (id:string,delta:number) => setCart(current => current.map(l => l.item.id===id ? {...l,quantity:Math.min(99,l.quantity+delta)} : l).filter(l => l.quantity>0));
  const submit = async () => {
    if (lock.current || !cart.length) return;
    if (!name.trim()) { setError('Bitte einen Namen eingeben.'); return; }
    const fingerprint = JSON.stringify({name:name.trim(),notes:notes.trim(),lines:cart.map(l => [l.item.id,l.quantity])});
    if (attempt.current?.fingerprint!==fingerprint) attempt.current={fingerprint,key:crypto.randomUUID()};
    lock.current=true; setBusy(true); setError('');
    try {
      const order = await createRemoteOrder({name,notes,lines:cart,requestKey:attempt.current.key,source:'pos'});
      setSaved(order); onCreated(order); setCart([]); setName(''); setNotes(''); attempt.current=null;
    } catch { setError('Bestellung nicht bestätigt. Verbindung und Artikelverfügbarkeit prüfen, danach erneut versuchen.'); }
    finally { lock.current=false; setBusy(false); }
  };
  return <section className="pos" lang="de" aria-label="Kasse">
    <div className="pos-catalog">
      <header className="pos-heading"><div><h2>Kasse</h2><span>{available.length} verfügbare Artikel</span></div><ShoppingBag size={24} /></header>
      <label className="pos-search"><Search size={18} /><input aria-label="Artikel suchen" placeholder="Artikel suchen …" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav className="pos-categories" aria-label="Kategorien"><button aria-pressed={category==='all'} onClick={() => setCategory('all')}>Alle</button>{categories.map(c => <button key={c.id} aria-pressed={category===c.id} onClick={() => setCategory(c.id)}>{c.name.de}</button>)}</nav>
      <div className="pos-products">{visible.map(item => <button className="pos-product" key={item.id} disabled={busy} onClick={() => add(item)}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="pos-no-image"><ShoppingBag size={26} /></span>}
        <strong>{item.name.de}</strong><span>{euro.format(item.price)}<Plus size={17} /></span>
      </button>)}</div>
      {!visible.length && <p className="pos-empty">Keine verfügbaren Artikel gefunden.</p>}
    </div>
    <aside className={`pos-basket ${basketOpen ? 'open' : ''}`} aria-label="Aktuelle Bestellung">
      <header><h2>Aktuelle Bestellung</h2><span>{cart.reduce((sum,l) => sum+l.quantity,0)} Artikel</span><button className="pos-basket-close" aria-label="Bestellung schließen" onClick={() => setBasketOpen(false)}><X size={19} /></button></header>
      {saved && <div className="pos-confirmation" role="status"><Check size={22} /><div><strong>Bestellung {saved.orderNumber} gespeichert</strong><p>{euro.format(saved.total)}</p><OrderReceipt order={saved} siteName={theme.siteName} /></div></div>}
      {!cart.length && !saved && <div className="pos-empty"><ShoppingBag size={32} /><p>Keine Artikel ausgewählt</p></div>}
      <fieldset disabled={busy} className="pos-fields"><div className="pos-lines">{cart.map(line => <div className="pos-line" key={line.item.id}>
        <div><strong>{line.item.name.de}</strong><span>{euro.format(line.item.price*line.quantity)}</span></div>
        <div className="pos-quantity"><button aria-label={`${line.item.name.de}: weniger`} onClick={() => quantity(line.item.id,-1)}><Minus size={16} /></button><output>{line.quantity}</output><button aria-label={`${line.item.name.de}: mehr`} onClick={() => quantity(line.item.id,1)}><Plus size={16} /></button><button aria-label={`${line.item.name.de}: entfernen`} onClick={() => setCart(cart.filter(l => l.item.id!==line.item.id))}><Trash2 size={16} /></button></div>
      </div>)}</div>
      <label>Name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label>Anmerkungen <small>(optional)</small><textarea maxLength={2000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </fieldset>
      <div className="pos-total"><span>Gesamt</span><strong>{euro.format(total)}</strong></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="pos-submit" disabled={busy || !cart.length} onClick={() => void submit()}><Check size={19} />{busy ? 'Wird gespeichert …' : 'Bestellung bestätigen'}</button>
    </aside>
    <button className="pos-basket-toggle" aria-label="Aktuelle Bestellung öffnen" onClick={() => setBasketOpen(true)}><ShoppingBag size={20} /><span>{cart.reduce((sum,l) => sum+l.quantity,0)} Artikel</span><strong>{euro.format(total)}</strong></button>
    {basketOpen && <button className="pos-basket-scrim" aria-label="Bestellung schließen" onClick={() => setBasketOpen(false)} />}
  </section>;
}
