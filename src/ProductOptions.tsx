import { Check, ChevronRight, Minus, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Locale, MenuItem, ProductOptionGroup, ProductSelection } from './types';
import { activeOptionGroups, configuredPrice, validateSelections } from './optionLogic';
import './product-options.css';

const money = (value: number, locale: Locale) => new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-DE', { style:'currency', currency:'EUR' }).format(value);
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function ProductOptionsDialog({ item, locale, onClose, onConfirm }: { item: MenuItem; locale: Locale; onClose: () => void; onConfirm: (selections: ProductSelection[]) => void }) {
  const groups = useMemo(() => activeOptionGroups(item), [item]);
  const [selections,setSelections] = useState<ProductSelection[]>(() => groups.flatMap(group => {
    const available = group.options.filter(option => option.available);
    return group.required && available.length === 1 ? [{ groupId:group.id, optionIds:[available[0].id] }] : [];
  }));
  const result = validateSelections(item,selections);
  const choose = (group: ProductOptionGroup, optionId: string) => setSelections(current => {
    const selected = current.find(value => value.groupId === group.id)?.optionIds || [];
    const optionIds = group.mode === 'single' ? [optionId] : selected.includes(optionId) ? selected.filter(id => id !== optionId) : selected.length < group.max ? [...selected,optionId] : selected;
    return [...current.filter(value => value.groupId !== group.id), ...(optionIds.length ? [{ groupId:group.id,optionIds }] : [])];
  });
  return <div className="product-options-overlay" role="presentation" onClick={onClose}>
    <section className="product-options-dialog" role="dialog" aria-modal="true" aria-label={item.name[locale]} onClick={event => event.stopPropagation()}>
      <header><div><span>{locale === 'de' ? 'Artikel anpassen' : 'Customize item'}</span><h2>{item.name[locale]}</h2><p>{locale === 'de' ? 'Wähle die gewünschten Optionen.' : 'Choose exactly how you want it.'}</p></div><button type="button" onClick={onClose} aria-label={locale === 'de' ? 'Schließen' : 'Close'}><X /></button></header>
      <div className="product-options-groups">{groups.map((group,index) => {
        const picked = selections.find(value => value.groupId === group.id)?.optionIds || [];
        const minimum = group.required ? Math.max(1,group.min) : group.min;
        return <fieldset key={group.id}><legend><span>{index+1}</span><div><strong>{group.name[locale]}</strong><small>{group.mode === 'single' ? (locale === 'de' ? 'Eine Option wählen' : 'Choose one') : `${locale === 'de' ? 'Bis zu' : 'Up to'} ${group.max}`}</small></div>{minimum > 0 && <b>{locale === 'de' ? 'Pflicht' : 'Required'}</b>}</legend><div className="product-option-list">{group.options.filter(option => option.available).map(option => {
          const active = picked.includes(option.id);
          return <button type="button" className={active ? 'active' : ''} aria-pressed={active} key={option.id} onClick={() => choose(group,option.id)}><span>{active ? <Check /> : <ChevronRight />}</span><strong>{option.name[locale]}</strong><em>{option.priceDelta ? `+ ${money(option.priceDelta,locale)}` : (locale === 'de' ? 'inklusive' : 'included')}</em></button>;
        })}</div></fieldset>;
      })}</div>
      <footer><div><span>{locale === 'de' ? 'Artikelpreis' : 'Item total'}</span><strong>{money(configuredPrice(item,selections),locale)}</strong></div><button type="button" disabled={!result.valid} onClick={() => onConfirm(result.selections)}><Plus />{locale === 'de' ? 'Zur Bestellung' : 'Add to order'}</button></footer>
    </section>
  </div>;
}

export function OptionGroupsEditor({ locale, groups, onChange }: { locale: Locale; groups: ProductOptionGroup[]; onChange: (groups: ProductOptionGroup[]) => void }) {
  const patchGroup = (id:string, patch:Partial<ProductOptionGroup>) => onChange(groups.map(group => group.id === id ? {...group,...patch} : group));
  const addGroup = () => onChange([...groups,{ id:uid('group'),name:{en:'',de:''},mode:'single',required:true,min:1,max:1,options:[] }]);
  const addOption = (groupId:string) => onChange(groups.map(group => group.id === groupId ? {...group,options:[...group.options,{id:uid('option'),name:{en:'',de:''},priceDelta:0,available:true}]} : group));
  return <section className="option-editor">
    <div className="option-editor-heading"><div><span>{locale === 'de' ? 'GRÖSSEN, SORTEN & EXTRAS' : 'SIZES, FLAVORS & EXTRAS'}</span><h3>{locale === 'de' ? 'Produktoptionen' : 'Product options'}</h3><p>{locale === 'de' ? 'Nur hinzufügen, wenn dieser Artikel angepasst werden kann.' : 'Only add groups this item actually needs.'}</p></div><button type="button" onClick={addGroup}><Plus />{locale === 'de' ? 'Gruppe' : 'Group'}</button></div>
    {!groups.length && <div className="option-editor-empty"><Check /><div><strong>{locale === 'de' ? 'Einfacher Artikel' : 'Simple item'}</strong><span>{locale === 'de' ? 'Wird ohne zusätzliche Auswahl direkt bestellt.' : 'Customers can add it directly without extra steps.'}</span></div></div>}
    <div className="option-editor-groups">{groups.map((group,index) => <article key={group.id}>
      <header><span>{index+1}</span><div className="option-editor-names"><input value={group.name.en} onChange={event => patchGroup(group.id,{name:{...group.name,en:event.target.value}})} placeholder="Group name (EN), e.g. Size"/><input value={group.name.de} onChange={event => patchGroup(group.id,{name:{...group.name,de:event.target.value}})} placeholder="Gruppenname (DE), z. B. Größe"/></div><button type="button" className="danger" onClick={() => onChange(groups.filter(value => value.id !== group.id))} aria-label="Delete group"><Trash2 /></button></header>
      <div className="option-editor-rules"><label>{locale === 'de' ? 'Auswahlart' : 'Selection'}<select value={group.mode} onChange={event => patchGroup(group.id,{mode:event.target.value as 'single'|'multiple',max:event.target.value === 'single' ? 1 : Math.max(1,group.max)})}><option value="single">{locale === 'de' ? 'Eine Auswahl' : 'Single choice'}</option><option value="multiple">{locale === 'de' ? 'Mehrfachauswahl' : 'Multiple choice'}</option></select></label><label className="option-check"><input type="checkbox" checked={group.required} onChange={event => patchGroup(group.id,{required:event.target.checked,min:event.target.checked ? Math.max(1,group.min) : 0})}/>{locale === 'de' ? 'Pflichtfeld' : 'Required'}</label>{group.mode === 'multiple' && <><label>{locale === 'de' ? 'Minimum' : 'Minimum'}<input type="number" min="0" max={group.max} value={group.min} onChange={event => patchGroup(group.id,{min:Math.max(0,Number(event.target.value))})}/></label><label>{locale === 'de' ? 'Maximum' : 'Maximum'}<input type="number" min="1" max="20" value={group.max} onChange={event => patchGroup(group.id,{max:Math.max(1,Number(event.target.value))})}/></label></>}</div>
      <div className="option-editor-options">{group.options.map(option => <div key={option.id}><input value={option.name.en} onChange={event => patchGroup(group.id,{options:group.options.map(value => value.id === option.id ? {...value,name:{...value.name,en:event.target.value}} : value)})} placeholder="Option (EN)"/><input value={option.name.de} onChange={event => patchGroup(group.id,{options:group.options.map(value => value.id === option.id ? {...value,name:{...value.name,de:event.target.value}} : value)})} placeholder="Option (DE)"/><label><span>+ €</span><input type="number" min="0" step="0.01" value={option.priceDelta} onChange={event => patchGroup(group.id,{options:group.options.map(value => value.id === option.id ? {...value,priceDelta:Math.max(0,Number(event.target.value))} : value)})}/></label><button type="button" className={option.available ? 'available' : ''} onClick={() => patchGroup(group.id,{options:group.options.map(value => value.id === option.id ? {...value,available:!value.available} : value)})}>{option.available ? <Check/> : <Minus/>}</button><button type="button" className="danger" onClick={() => patchGroup(group.id,{options:group.options.filter(value => value.id !== option.id)})}><Trash2/></button></div>)}</div>
      <button type="button" className="add-option" onClick={() => addOption(group.id)}><Plus />{locale === 'de' ? 'Option hinzufügen' : 'Add option'}</button>
    </article>)}</div>
  </section>;
}
