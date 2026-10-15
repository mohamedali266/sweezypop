import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Filter, LoaderCircle, PackageCheck, RefreshCw, Search, ShoppingBag, X } from 'lucide-react';
import type { Locale, Order, OrderStatus } from './types';
import { loadOrderPage, loadOrderTimeline, loadOrderWorkspaceStats, updateRemoteOrderStatus, type OrderScope, type OrderTimelineEvent, type OrderWorkspaceStats } from './remoteData';
import { OrderReceipt } from './PointOfSale';
import './orders.css';

const words = {
  de: {
    title:'Bestellungen', subtitle:'Aktuelle Bestellungen bearbeiten und das Archiv gezielt durchsuchen.', live:'Live', today:'Heute', history:'Verlauf', cancelled:'Storniert',
    search:'Nummer oder Name suchen', status:'Status', source:'Quelle', all:'Alle', menu:'Online-Menü', pos:'Kasse', from:'Von', to:'Bis', filters:'Filter',
    new:'Neu', preparing:'In Zubereitung', done:'Fertig', cancelledStatus:'Storniert', ordersToday:'Bestellungen heute', revenueToday:'Umsatz heute',
    order:'Bestellung', customer:'Name', time:'Zeit', amount:'Betrag', actions:'Aktionen', details:'Details', noOrders:'Keine Bestellungen für diese Auswahl.',
    loading:'Bestellungen werden geladen …', loadFailed:'Bestellungen konnten nicht geladen werden.', updateFailed:'Status konnte nicht gespeichert werden. Bitte aktualisieren.',
    previous:'Zurück', next:'Weiter', page:'Seite', of:'von', results:'Ergebnisse', orderDetails:'Bestelldetails', items:'Artikel', notes:'Anmerkungen', noNotes:'Keine Anmerkungen',
    timeline:'Statusverlauf', created:'Bestellung erstellt', sourceLabel:'Quelle', refresh:'Aktualisieren', print:'Drucken', close:'Schließen',
  },
  en: {
    title:'Orders', subtitle:'Process active orders and search the archive without loading years of history.', live:'Live', today:'Today', history:'History', cancelled:'Cancelled',
    search:'Search number or name', status:'Status', source:'Source', all:'All', menu:'Online menu', pos:'Register', from:'From', to:'To', filters:'Filters',
    new:'New', preparing:'Preparing', done:'Done', cancelledStatus:'Cancelled', ordersToday:'Orders today', revenueToday:'Revenue today',
    order:'Order', customer:'Name', time:'Time', amount:'Amount', actions:'Actions', details:'Details', noOrders:'No orders match this view.',
    loading:'Loading orders …', loadFailed:'Orders could not be loaded.', updateFailed:'Status could not be saved. Please refresh.',
    previous:'Previous', next:'Next', page:'Page', of:'of', results:'results', orderDetails:'Order details', items:'Items', notes:'Notes', noNotes:'No notes',
    timeline:'Status history', created:'Order created', sourceLabel:'Source', refresh:'Refresh', print:'Print', close:'Close',
  },
} as const;

const emptyStats: OrderWorkspaceStats = { newCount:0, preparingCount:0, todayCount:0, todayRevenue:0 };
const statusOrder: OrderStatus[] = ['new','preparing','done','cancelled'];

function money(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE',{style:'currency',currency:'EUR'}).format(value);
}
function dateTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-DE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin'}).format(new Date(value));
}
function statusLabel(status: OrderStatus, locale: Locale) {
  const text=words[locale];
  return {new:text.new,preparing:text.preparing,done:text.done,cancelled:text.cancelledStatus}[status];
}
function toUtcBoundary(value: string, addDay=false) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (addDay) date.setDate(date.getDate()+1);
  return date.toISOString();
}

export function OrdersWorkspace({ locale, siteName, onOrderUpdated }: { locale:Locale; siteName:string; onOrderUpdated:(order:Order)=>void }) {
  const text=words[locale];
  const [scope,setScope]=useState<OrderScope>('live');
  const [query,setQuery]=useState('');
  const [debouncedQuery,setDebouncedQuery]=useState('');
  const [status,setStatus]=useState<OrderStatus | ''>('');
  const [source,setSource]=useState<'menu'|'pos'|''>('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [page,setPage]=useState(1);
  const [pageCount,setPageCount]=useState(1);
  const [total,setTotal]=useState(0);
  const [rows,setRows]=useState<Order[]>([]);
  const [stats,setStats]=useState(emptyStats);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Order|null>(null);
  const [timeline,setTimeline]=useState<OrderTimelineEvent[]>([]);
  const [refreshKey,setRefreshKey]=useState(0);
  const requestSequence=useRef(0);

  useEffect(() => { const id=window.setTimeout(()=>setDebouncedQuery(query.trim()),300); return()=>window.clearTimeout(id); },[query]);
  useEffect(() => { setPage(1); },[scope,debouncedQuery,status,source,from,to]);

  const load=useCallback(async(silent=false)=>{
    const request=++requestSequence.current;
    if(!silent)setLoading(true); setError('');
    try {
      const [result,nextStats]=await Promise.all([
        loadOrderPage({scope,query:debouncedQuery,status,source,from:toUtcBoundary(from),to:toUtcBoundary(to,true),page,pageSize:25}),
        loadOrderWorkspaceStats(),
      ]);
      if(request!==requestSequence.current)return;
      setRows(result.rows); setTotal(result.total); setPageCount(result.pageCount); setStats(nextStats);
      if(page>result.pageCount)setPage(result.pageCount);
      setSelected(current=>current ? result.rows.find(order=>order.id===current.id) || current : null);
    } catch { if(request===requestSequence.current)setError(text.loadFailed); }
    finally { if(!silent&&request===requestSequence.current)setLoading(false); }
  },[scope,debouncedQuery,status,source,from,to,page,text.loadFailed]);

  useEffect(()=>{ void load(); },[load,refreshKey]);
  useEffect(()=>{
    if(scope!=='live')return;
    const id=window.setInterval(()=>void load(true),10000);
    const focus=()=>void load(true); window.addEventListener('focus',focus);
    return()=>{window.clearInterval(id);window.removeEventListener('focus',focus);};
  },[scope,load]);

  const openDetails=async(order:Order)=>{
    setSelected(order); setTimeline([]);
    try { setTimeline(await loadOrderTimeline(order.id)); } catch { setTimeline([]); }
  };
  const changeStatus=async(order:Order,next:OrderStatus)=>{
    setError('');
    try {
      await updateRemoteOrderStatus(order,next);
      const updated={...order,status:next}; onOrderUpdated(updated);
      setSelected(current=>current?.id===order.id?updated:current);
      await load(true);
      if(selected?.id===order.id)setTimeline(await loadOrderTimeline(order.id));
    } catch { setError(text.updateFailed); }
  };
  const tabs: Array<[OrderScope,string,number|undefined]> = [['live',text.live,stats.newCount+stats.preparingCount],['today',text.today,stats.todayCount],['history',text.history,undefined],['cancelled',text.cancelled,undefined]];
  const statCards=useMemo(()=>[
    {label:text.new,value:stats.newCount,icon:<ShoppingBag/>},{label:text.preparing,value:stats.preparingCount,icon:<Clock3/>},
    {label:text.ordersToday,value:stats.todayCount,icon:<PackageCheck/>},{label:text.revenueToday,value:money(stats.todayRevenue,locale),icon:<CircleDollarSign/>},
  ],[locale,stats,text]);

  return <section className="orders-workspace" lang={locale}>
    <header className="orders-header"><div><h2>{text.title}</h2><p>{text.subtitle}</p></div><button className="orders-icon-button" title={text.refresh} onClick={()=>setRefreshKey(v=>v+1)}><RefreshCw size={18}/></button></header>
    <div className="orders-stats">{statCards.map(card=><div key={card.label}><span>{card.icon}</span><small>{card.label}</small><strong>{card.value}</strong></div>)}</div>
    <nav className="orders-tabs" aria-label={text.title}>{tabs.map(([id,label,count])=><button key={id} aria-pressed={scope===id} onClick={()=>setScope(id)}>{label}{count!==undefined&&<span>{count}</span>}</button>)}</nav>
    <div className="orders-toolbar">
      <label className="orders-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={text.search}/></label>
      <details className="orders-filters"><summary><Filter size={17}/>{text.filters}</summary><div>
        <label>{text.status}<select value={status} onChange={e=>setStatus(e.target.value as OrderStatus|'')}><option value="">{text.all}</option>{statusOrder.map(value=><option key={value} value={value}>{statusLabel(value,locale)}</option>)}</select></label>
        <label>{text.source}<select value={source} onChange={e=>setSource(e.target.value as 'menu'|'pos'|'')}><option value="">{text.all}</option><option value="menu">{text.menu}</option><option value="pos">{text.pos}</option></select></label>
        <label>{text.from}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>{text.to}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div></details>
    </div>
    {error&&<p className="orders-error" role="alert">{error}</p>}
    <div className="orders-table" aria-busy={loading}>
      <div className="orders-table-head"><span>{text.order}</span><span>{text.customer}</span><span>{text.time}</span><span>{text.source}</span><span>{text.amount}</span><span>{text.status}</span><span>{text.actions}</span></div>
      {loading?<div className="orders-state"><LoaderCircle className="spin"/>{text.loading}</div>:rows.length?rows.map(order=><article key={order.id} className="orders-row">
        <button className="orders-number" onClick={()=>void openDetails(order)}>#{order.orderNumber||order.id}</button>
        <div data-label={text.customer}><strong>{order.customerName}</strong><small>{order.lines.reduce((n,line)=>n+line.quantity,0)} {text.items}</small></div>
        <time data-label={text.time}>{dateTime(order.createdAt,locale)}</time><span data-label={text.source}>{order.source==='pos'?text.pos:text.menu}</span>
        <strong data-label={text.amount}>{money(order.total,locale)}</strong><span data-label={text.status} className={`order-status status-${order.status}`}>{statusLabel(order.status,locale)}</span>
        <button className="order-details-button" onClick={()=>void openDetails(order)}>{text.details}<ChevronRight size={16}/></button>
      </article>):<div className="orders-state"><CalendarDays/>{text.noOrders}</div>}
    </div>
    <footer className="orders-pagination"><span>{total} {text.results}</span><div><button disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/>{text.previous}</button><span>{text.page} {page} {text.of} {pageCount}</span><button disabled={page>=pageCount||loading} onClick={()=>setPage(p=>p+1)}>{text.next}<ChevronRight size={17}/></button></div></footer>
    {selected&&<><button className="order-drawer-scrim" aria-label={text.close} onClick={()=>setSelected(null)}/><aside className="order-drawer" role="dialog" aria-modal="true" aria-label={text.orderDetails}>
      <header><div><small>{text.orderDetails}</small><h2>#{selected.orderNumber||selected.id}</h2></div><button className="orders-icon-button" aria-label={text.close} onClick={()=>setSelected(null)}><X/></button></header>
      <div className="order-drawer-summary"><div><small>{text.customer}</small><strong>{selected.customerName}</strong></div><div><small>{text.time}</small><strong>{dateTime(selected.createdAt,locale)}</strong></div><div><small>{text.sourceLabel}</small><strong>{selected.source==='pos'?text.pos:text.menu}</strong></div><div><small>{text.amount}</small><strong>{money(selected.total,locale)}</strong></div></div>
      <section><h3>{text.items}</h3><div className="order-detail-lines">{selected.lines.map((line,index)=><div key={`${line.item.id}-${index}`}><span>{line.quantity} × {line.item.name[locale]}</span><strong>{money(line.item.price*line.quantity,locale)}</strong></div>)}</div></section>
      <section><h3>{text.notes}</h3><p className="order-note">{selected.notes||text.noNotes}</p></section>
      <section><h3>{text.timeline}</h3><ol className="order-timeline"><li><span/><div><strong>{text.created}</strong><small>{dateTime(selected.createdAt,locale)}</small></div></li>{timeline.map((event,index)=><li key={`${event.createdAt}-${index}`}><span/><div><strong>{statusLabel(event.nextStatus,locale)}</strong><small>{dateTime(event.createdAt,locale)}</small></div></li>)}</ol></section>
      <div className="order-drawer-actions"><OrderReceipt order={selected} siteName={siteName} locale={locale}/>{selected.status==='new'&&<button onClick={()=>void changeStatus(selected,'preparing')}>{text.preparing}</button>}{selected.status==='preparing'&&<button onClick={()=>void changeStatus(selected,'done')}>{text.done}</button>}{(selected.status==='new'||selected.status==='preparing')&&<button className="danger" onClick={()=>void changeStatus(selected,'cancelled')}>{text.cancelledStatus}</button>}</div>
    </aside></>}
  </section>;
}
