import { Check, Edit3, Link2, Minus, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Category, Locale, MenuItem, SharedOptionGroup } from './types';
import './shared-option-groups.css';

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const emptyGroup = (sortOrder: number): SharedOptionGroup => ({
  id: uid('group'), name:{ en:'',de:'' }, mode:'single', required:false, min:0, max:1,
  options:[], linkedCategoryIds:[], linkedItemIds:[], active:true, sortOrder,
});

export function SharedOptionGroupsManager({ locale, groups, onChange, categories, items }: {
  locale: Locale; groups: SharedOptionGroup[]; onChange: (groups: SharedOptionGroup[]) => Promise<void>; categories: Category[]; items: MenuItem[];
}) {
  const [editing,setEditing] = useState<SharedOptionGroup | null>(null);
  const [query,setQuery] = useState('');
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const initialDraft = useRef('');
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const visibleItems = useMemo(() => items.filter(item => `${item.name.en} ${item.name.de}`.toLowerCase().includes(query.toLowerCase())),[items,query]);
  const editorOpen = Boolean(editing);
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  useEffect(() => {
    if (!editorOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [editorOpen]);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block:'nearest' });
  }, [error]);
  const text = locale === 'de' ? {
    title:'Optionsgruppen', intro:'Wiederverwendbare Sorten, Toppings und Extras zentral erstellen und gezielt verknüpfen.', create:'Gruppe erstellen', empty:'Noch keine Optionsgruppen.',
    name:'Gruppenname', choice:'Auswahlart', single:'Eine Auswahl', multiple:'Mehrfachauswahl', required:'Pflichtauswahl', min:'Minimum', max:'Maximum', options:'Optionen', addOption:'Option hinzufügen',
    links:'Verknüpfungen', categories:'Ganze Kategorien', products:'Einzelne Artikel', search:'Artikel suchen', save:'Gruppe speichern', active:'Aktiv', delete:'Löschen', edit:'Bearbeiten',
  } : {
    title:'Option groups', intro:'Create reusable flavors, toppings and extras once, then link them exactly where needed.', create:'Create group', empty:'No option groups yet.',
    name:'Group name', choice:'Selection type', single:'Single choice', multiple:'Multiple choice', required:'Required selection', min:'Minimum', max:'Maximum', options:'Options', addOption:'Add option',
    links:'Connections', categories:'Whole categories', products:'Individual items', search:'Search items', save:'Save group', active:'Active', delete:'Delete', edit:'Edit',
  };

  const beginEditing = (group: SharedOptionGroup) => {
    const draft = structuredClone(group);
    initialDraft.current = JSON.stringify(draft);
    setEditing(draft);
    setQuery('');
    setError('');
  };
  const closeEditor = () => {
    if (!editing || saving) return;
    const changed = JSON.stringify(editing) !== initialDraft.current;
    if (changed && !window.confirm(locale === 'de' ? 'Nicht gespeicherte Änderungen verwerfen?' : 'Discard unsaved changes?')) return;
    setEditing(null);
    setError('');
  };
  const commit = async (nextGroups: SharedOptionGroup[], closeAfterSave = false) => {
    if (saving) return false;
    setSaving(true);
    setError('');
    try {
      await onChange(nextGroups);
      if (closeAfterSave) setEditing(null);
      return true;
    } catch {
      setError(locale === 'de' ? 'Speichern fehlgeschlagen. Die Änderungen wurden nicht verworfen. Bitte Verbindung prüfen und erneut versuchen.' : 'Save failed. Your changes are still here. Check the connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    if (!editing) return;
    const minimum = editing.required ? Math.max(1,editing.min) : editing.min;
    const availableCount = editing.options.filter(option => option.available).length;
    const invalid = !editing.name.en.trim() || !editing.name.de.trim() || !editing.options.length || editing.options.some(option => !option.name.en.trim() || !option.name.de.trim() || option.priceDelta < 0 || !Number.isFinite(option.priceDelta)) || minimum > editing.max || availableCount < Math.max(1,minimum) || (!editing.linkedCategoryIds.length && !editing.linkedItemIds.length);
    if (invalid) { setError(locale === 'de' ? 'Namen, Optionen, Auswahlgrenzen und mindestens eine Verknüpfung vollständig ausfüllen.' : 'Complete names, options, limits and at least one connection.'); return; }
    const normalized = { ...editing, min:minimum, max:editing.mode === 'single' ? 1 : editing.max };
    const nextGroups = groups.some(group => group.id === normalized.id) ? groups.map(group => group.id === normalized.id ? normalized : group) : [...groups,normalized];
    await commit(nextGroups, true);
  };
  const patch = (value: Partial<SharedOptionGroup>) => setEditing(current => current ? { ...current,...value } : current);

  return <section className="dashboard-card focus-card shared-groups-page">
    <div className="shared-groups-hero"><div><span>{locale === 'de' ? 'MENÜKONFIGURATION' : 'MENU CONFIGURATION'}</span><h2>{text.title}</h2><p>{text.intro}</p></div><button type="button" className="small-action" onClick={() => beginEditing(emptyGroup(groups.length + 1))}><Plus size={17}/>{text.create}</button></div>
    {!editing && error && <p className="form-error group-page-error" role="alert">{error}</p>}
    {!groups.length ? <div className="shared-groups-empty"><Link2/><strong>{text.empty}</strong></div> : <div className="shared-groups-grid">{groups.slice().sort((a,b) => a.sortOrder-b.sortOrder).map(group => <article key={group.id} className={!group.active ? 'inactive' : ''}>
      <header><div><span>{group.mode === 'single' ? text.single : text.multiple}</span><h3>{group.name[locale] || group.name.en}</h3></div><button type="button" disabled={saving} className={group.active ? 'status-on' : ''} onClick={() => void commit(groups.map(current => current.id === group.id ? { ...current,active:!current.active } : current))}>{group.active ? <Check/> : <Minus/>}{group.active ? text.active : 'Off'}</button></header>
      <div className="shared-group-options">{group.options.slice(0,4).map(option => <span className={!option.available ? 'unavailable' : ''} key={option.id}>{option.name[locale] || option.name.en}{option.priceDelta ? ` +€${option.priceDelta.toFixed(2)}` : ''}{!option.available ? ` · ${locale === 'de' ? 'Aus' : 'Off'}` : ''}</span>)}{group.options.length > 4 && <span>+{group.options.length-4}</span>}</div>
      <p><Link2 size={15}/>{group.linkedCategoryIds.length} {text.categories.toLowerCase()} · {group.linkedItemIds.length} {text.products.toLowerCase()}</p>
      <footer><button type="button" disabled={saving} onClick={() => beginEditing(group)}><Edit3/>{text.edit}</button><button type="button" disabled={saving} className="danger" onClick={() => { if (window.confirm(locale === 'de' ? 'Diese Optionsgruppe wirklich löschen?' : 'Delete this option group?')) void commit(groups.filter(current => current.id !== group.id)); }}><Trash2/>{text.delete}</button></footer>
    </article>)}</div>}

    {editing && portalTarget && createPortal(<div className="group-editor-overlay"><form className="group-editor-drawer" role="dialog" aria-modal="true" aria-labelledby="group-editor-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><span>{locale === 'de' ? 'OPTIONEN-BIBLIOTHEK' : 'OPTIONS LIBRARY'}</span><h2 id="group-editor-title">{editing.name[locale] || text.create}</h2><p>{editing.options.length} {locale === 'de' ? 'Optionen' : 'options'} · {editing.linkedCategoryIds.length + editing.linkedItemIds.length} {locale === 'de' ? 'Verknüpfungen' : 'connections'}</p></div><button type="button" disabled={saving} onClick={closeEditor} aria-label="Close"><X/></button></header>
      <div className="group-editor-body">
        {error && <p ref={errorRef} className="form-error group-save-error" role="alert">{error}</p>}
        <section><h3>{text.name}</h3><div className="group-form-grid"><label>English<input value={editing.name.en} onChange={event => patch({ name:{ ...editing.name,en:event.target.value } })}/></label><label>Deutsch<input value={editing.name.de} onChange={event => patch({ name:{ ...editing.name,de:event.target.value } })}/></label></div></section>
        <section><h3>{text.choice}</h3><div className="group-rules"><label><select value={editing.mode} onChange={event => patch({ mode:event.target.value as 'single'|'multiple',max:event.target.value === 'single' ? 1 : Math.max(1,editing.max) })}><option value="single">{text.single}</option><option value="multiple">{text.multiple}</option></select></label><label className="toggle-line"><input type="checkbox" checked={editing.required} onChange={event => patch({ required:event.target.checked,min:event.target.checked ? Math.max(1,editing.min) : 0 })}/>{text.required}</label>{editing.mode === 'multiple' && <><label>{text.min}<input type="number" min="0" value={editing.min} onChange={event => patch({ min:Math.max(0,Number(event.target.value)) })}/></label><label>{text.max}<input type="number" min="1" max="20" value={editing.max} onChange={event => patch({ max:Math.max(1,Number(event.target.value)) })}/></label></>}</div></section>
        <section><div className="group-section-head"><h3>{text.options}</h3><button type="button" onClick={() => patch({ options:[...editing.options,{ id:uid('option'),name:{en:'',de:''},priceDelta:0,available:true }] })}><Plus/>{text.addOption}</button></div><div className="group-option-rows">{editing.options.map(option => <div key={option.id}><input value={option.name.en} onChange={event => patch({ options:editing.options.map(current => current.id === option.id ? { ...current,name:{ ...current.name,en:event.target.value } } : current) })} placeholder="Option (EN)"/><input value={option.name.de} onChange={event => patch({ options:editing.options.map(current => current.id === option.id ? { ...current,name:{ ...current.name,de:event.target.value } } : current) })} placeholder="Option (DE)"/><label><span>+ €</span><input type="number" min="0" step="0.01" value={option.priceDelta} onChange={event => patch({ options:editing.options.map(current => current.id === option.id ? { ...current,priceDelta:Math.max(0,Number(event.target.value)) } : current) })}/></label><button type="button" className={`option-availability ${option.available ? 'status-on' : ''}`} onClick={() => patch({ options:editing.options.map(current => current.id === option.id ? { ...current,available:!current.available } : current) })}>{option.available ? <Check/> : <Minus/>}<span>{option.available ? (locale === 'de' ? 'Verfügbar' : 'Available') : (locale === 'de' ? 'Deaktiviert' : 'Disabled')}</span></button><button type="button" className="danger" onClick={() => patch({ options:editing.options.filter(current => current.id !== option.id) })}><Trash2/></button></div>)}</div></section>
        <section className="group-links-section">
          <div className="group-editor-section-title"><div><span><Link2/></span><div><h3>{text.links}</h3><p>{locale === 'de' ? 'Auf ganze Kategorien oder gezielt auf einzelne Artikel anwenden.' : 'Apply this group to whole categories or specific products.'}</p></div></div></div>
          <div className="group-link-columns">
            <div className="group-link-panel">
              <header><div><h4>{text.categories}</h4><p>{locale === 'de' ? 'Alle Artikel der gewählten Kategorie' : 'Every item in a selected category'}</p></div><b>{editing.linkedCategoryIds.length}</b></header>
              <div className="link-chip-grid">{categories.map(category => {
                const selected = editing.linkedCategoryIds.includes(category.id);
                return <button type="button" aria-pressed={selected} key={category.id} className={selected ? 'selected' : ''} onClick={() => patch({ linkedCategoryIds:selected ? editing.linkedCategoryIds.filter(id => id !== category.id) : [...editing.linkedCategoryIds,category.id] })}><span className="selection-mark">{selected && <Check/>}</span><span>{category.name[locale] || category.name.en}</span></button>;
              })}</div>
            </div>
            <div className="group-link-panel">
              <header><div><h4>{text.products}</h4><p>{locale === 'de' ? 'Zusätzliche einzelne Artikel auswählen' : 'Select additional individual items'}</p></div><b>{editing.linkedItemIds.length}</b></header>
              <label className="group-search"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text.search}/></label>
              <div className="linked-items-list">{visibleItems.map(item => {
                const selected = editing.linkedItemIds.includes(item.id);
                return <button type="button" aria-pressed={selected} key={item.id} className={selected ? 'selected' : ''} onClick={() => patch({ linkedItemIds:selected ? editing.linkedItemIds.filter(id => id !== item.id) : [...editing.linkedItemIds,item.id] })}><span className="selection-mark">{selected && <Check/>}</span><span className="linked-item-copy"><strong>{item.name[locale] || item.name.en}</strong><small>{categories.find(category => category.id === item.categoryId)?.name[locale] || categories.find(category => category.id === item.categoryId)?.name.en}</small></span></button>;
              })}</div>
            </div>
          </div>
        </section>
      </div>
      <footer><button type="button" disabled={saving} className="small-action neutral" onClick={closeEditor}>{locale === 'de' ? 'Abbrechen' : 'Cancel'}</button><button type="submit" disabled={saving} className="small-action"><Save/>{saving ? (locale === 'de' ? 'Wird gespeichert …' : 'Saving …') : text.save}</button></footer>
    </form></div>, portalTarget)}
  </section>;
}
