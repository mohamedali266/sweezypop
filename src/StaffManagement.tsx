import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, RefreshCw, Save, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { loadStaffDirectory, updateStaffMember } from './remoteData';
import type { Locale, StaffDirectoryEntry } from './types';
import './staff-management.css';

const copy = {
  de: {
    title:'Team & Schichten', subtitle:'Mitarbeiterstatus, Stationen und Schichtverlauf verwalten.', refresh:'Aktualisieren',
    active:'Aktiv', inactive:'Inaktiv', onShift:'Im Dienst', offShift:'Nicht im Dienst', name:'Name', email:'Anmeldung',
    station:'Station', save:'Speichern', saving:'Speichert …', recent:'Letzte Schichten', noShifts:'Noch keine Schichten',
    started:'Beginn', ended:'Ende', open:'Läuft', handled:'Bestellungen', loadFailed:'Teamdaten konnten nicht geladen werden.',
    saveFailed:'Änderung konnte nicht gespeichert werden.', saved:'Änderungen gespeichert.', ownerNotice:'Neue Mitarbeiterkonten werden ausschließlich von einem Administrator erstellt.',
  },
  en: {
    title:'Staff & shifts', subtitle:'Manage staff availability, stations, and shift history.', refresh:'Refresh',
    active:'Active', inactive:'Inactive', onShift:'On shift', offShift:'Off shift', name:'Name', email:'Login',
    station:'Station', save:'Save', saving:'Saving …', recent:'Recent shifts', noShifts:'No shifts yet',
    started:'Started', ended:'Ended', open:'Open', handled:'Orders', loadFailed:'Staff data could not be loaded.',
    saveFailed:'The change could not be saved.', saved:'Changes saved.', ownerNotice:'New staff accounts can only be created by an administrator.',
  },
} as const;

function dateTime(value: string | undefined, locale: Locale) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Berlin',
  }).format(new Date(value));
}

export function StaffManagement({ locale, isAdmin }: { locale:Locale; isAdmin:boolean }) {
  const text=copy[locale];
  const [staff,setStaff]=useState<StaffDirectoryEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    setLoading(true); setError('');
    try { setStaff(await loadStaffDirectory()); }
    catch { setError(text.loadFailed); }
    finally { setLoading(false); }
  },[text.loadFailed]);
  useEffect(()=>{ void load(); },[load]);

  const patch=(id:string,change:Partial<StaffDirectoryEntry>)=>setStaff(current=>current.map(member=>member.id===id?{...member,...change}:member));
  const save=async(member:StaffDirectoryEntry)=>{
    setBusyId(member.id); setError(''); setMessage('');
    try { await updateStaffMember(member.id,member.name,member.active,member.station); setMessage(text.saved); }
    catch { setError(text.saveFailed); }
    finally { setBusyId(''); }
  };

  return <section className="staff-management" lang={locale}>
    <header className="staff-management-head">
      <div><span>{isAdmin ? 'Admin' : 'Owner'}</span><h2>{text.title}</h2><p>{text.subtitle}</p></div>
      <button type="button" onClick={()=>void load()} disabled={loading} title={text.refresh}><RefreshCw className={loading?'spin':''}/>{text.refresh}</button>
    </header>
    {!isAdmin&&<div className="staff-policy-note"><ShieldCheck/><span>{text.ownerNotice}</span></div>}
    {error&&<p className="staff-management-message error" role="alert">{error}</p>}
    {message&&<p className="staff-management-message success" role="status"><Check/>{message}</p>}
    {loading ? <div className="staff-management-empty"><RefreshCw className="spin"/></div> : staff.length ? <div className="staff-management-grid">
      {staff.map(member=><article className="staff-member" key={member.id}>
        <header>
          <span className={member.active?'active':'inactive'}>{member.active?<UserRoundCheck/>:<UserRoundX/>}</span>
          <div><strong>{member.name}</strong><small>{member.email}</small></div>
          <span className={`shift-state ${member.currentShift?'on':''}`}>{member.currentShift?text.onShift:text.offShift}</span>
        </header>
        <div className="staff-member-fields">
          <label>{text.name}<input value={member.name} maxLength={120} onChange={event=>patch(member.id,{name:event.target.value})}/></label>
          <label>{text.station}<input value={member.station} maxLength={60} onChange={event=>patch(member.id,{station:event.target.value})}/></label>
          <label className="staff-active-toggle"><input type="checkbox" checked={member.active} onChange={event=>patch(member.id,{active:event.target.checked})}/><span>{member.active?text.active:text.inactive}</span></label>
          <button className="staff-member-save" type="button" disabled={busyId===member.id||!member.name.trim()||!member.station.trim()} onClick={()=>void save(member)}>
            {busyId===member.id?<RefreshCw className="spin"/>:<Save/>}{busyId===member.id?text.saving:text.save}
          </button>
        </div>
        {member.currentShift&&<div className="staff-current-shift"><Clock3/><div><small>{text.started}</small><strong>{dateTime(member.currentShift.startedAt,locale)}</strong></div><div><small>{text.handled}</small><strong>{member.currentShift.ordersHandled}</strong></div></div>}
        <details className="staff-shift-history"><summary>{text.recent}<span>{member.recentShifts.length}</span></summary>
          {member.recentShifts.length?<div>{member.recentShifts.map(shift=><div className="staff-shift-row" key={shift.id}>
            <span><small>{text.started}</small>{dateTime(shift.startedAt,locale)}</span>
            <span><small>{text.ended}</small>{shift.status==='open'?text.open:dateTime(shift.endedAt,locale)}</span>
            <strong>{shift.ordersHandled} {text.handled}</strong>
          </div>)}</div>:<p>{text.noShifts}</p>}
        </details>
      </article>)}
    </div>:<div className="staff-management-empty"><UserRoundX/><strong>{text.noShifts}</strong></div>}
  </section>;
}
