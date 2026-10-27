import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown as MoveDown,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Edit3,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { createStaffGuide, deleteStaffGuide, loadStaffGuides, updateStaffGuide } from './remoteData';
import type { Locale, MenuItem, StaffGuide, StaffGuideInput } from './types';
import './staff-guide-management.css';

interface StaffGuideManagementProps {
  locale: Locale;
  items: MenuItem[];
}

const emptyInput = (): StaffGuideInput => ({
  menuItemId: undefined,
  name: { en: '', de: '' },
  ingredients: { en: [], de: [] },
  steps: { en: [], de: [] },
});

const copy = {
  de: {
    eyebrow: 'Küchenwissen', title: 'Zubereitungsleitfäden', subtitle: 'Ein verlässlicher Ort für Zutaten und klare Arbeitsabläufe.',
    create: 'Leitfaden erstellen', search: 'Leitfäden durchsuchen', emptyTitle: 'Noch keine Leitfäden',
    emptyBody: 'Erstelle den ersten Leitfaden, damit dein Team jedes Produkt gleichbleibend zubereitet.', linked: 'Mit Menü verknüpft',
    custom: 'Eigener Leitfaden', ingredients: 'Zutaten', steps: 'Schritte', edit: 'Bearbeiten', remove: 'Löschen',
    formCreate: 'Neuer Leitfaden', formEdit: 'Leitfaden bearbeiten', formHint: 'Wähle einen Menüartikel oder erfasse einen eigenen Namen.',
    selectItem: 'Menüartikel', selectPlaceholder: 'Menüartikel auswählen (optional)', customName: 'Name', english: 'Englisch', german: 'Deutsch',
    addIngredient: 'Zutat hinzufügen', ingredientPlaceholder: 'z. B. 120 ml Milch', addStep: 'Schritt hinzufügen',
    stepPlaceholder: 'Beschreibe einen klaren Arbeitsschritt …', save: 'Leitfaden speichern', saving: 'Wird gespeichert …', cancel: 'Abbrechen',
    close: 'Schließen', validation: 'Bitte ergänze Namen, mindestens eine Zutat und einen Schritt in beiden Sprachen.',
    deleteTitle: 'Leitfaden löschen?', deleteBody: 'Diese Aktion entfernt den Leitfaden für das gesamte Team.', keep: 'Behalten', confirmDelete: 'Leitfaden löschen',
    saveFailed: 'Der Leitfaden konnte nicht gespeichert werden.', deleteFailed: 'Der Leitfaden konnte nicht gelöscht werden.', loadFailed: 'Die Leitfäden konnten nicht geladen werden.', retry: 'Erneut laden', allReady: 'Vollständig',
    languageComplete: 'Vollständig', languageIncomplete: 'Unvollständig', missingName: 'Name fehlt', missingIngredients: 'Mindestens eine Zutat fehlt', missingSteps: 'Mindestens ein Arbeitsschritt fehlt',
  },
  en: {
    eyebrow: 'Kitchen knowledge', title: 'Preparation guides', subtitle: 'One dependable place for ingredients and clear preparation workflows.',
    create: 'Create guide', search: 'Search guides', emptyTitle: 'No guides yet',
    emptyBody: 'Create the first guide so the team can prepare every product consistently.', linked: 'Linked to menu',
    custom: 'Custom guide', ingredients: 'Ingredients', steps: 'Steps', edit: 'Edit', remove: 'Delete',
    formCreate: 'New preparation guide', formEdit: 'Edit preparation guide', formHint: 'Choose a menu item or enter a custom guide name.',
    selectItem: 'Menu item', selectPlaceholder: 'Select a menu item (optional)', customName: 'Name', english: 'English', german: 'German',
    addIngredient: 'Add ingredient', ingredientPlaceholder: 'e.g. 120 ml milk', addStep: 'Add step',
    stepPlaceholder: 'Describe one clear preparation step …', save: 'Save guide', saving: 'Saving …', cancel: 'Cancel',
    close: 'Close', validation: 'Add a name, at least one ingredient and one step in both languages.',
    deleteTitle: 'Delete this guide?', deleteBody: 'This will remove the guide for the entire team.', keep: 'Keep guide', confirmDelete: 'Delete guide',
    saveFailed: 'The guide could not be saved.', deleteFailed: 'The guide could not be deleted.', loadFailed: 'The guides could not be loaded.', retry: 'Try again', allReady: 'Complete',
    languageComplete: 'Complete', languageIncomplete: 'Incomplete', missingName: 'Name is missing', missingIngredients: 'Add at least one ingredient', missingSteps: 'Add at least one preparation step',
  },
} as const;

function cloneGuide(guide: StaffGuide): StaffGuideInput {
  return {
    menuItemId: guide.menuItemId,
    name: { ...guide.name },
    ingredients: { en: [...guide.ingredients.en], de: [...guide.ingredients.de] },
    steps: { en: [...guide.steps.en], de: [...guide.steps.de] },
  };
}

function isValid(input: StaffGuideInput) {
  return (['en', 'de'] as Locale[]).every(language =>
    input.name[language].trim() && input.ingredients[language].length > 0 && input.steps[language].length > 0,
  );
}

function languageCompletion(input: StaffGuideInput, language: Locale) {
  return {
    name: Boolean(input.name[language].trim()),
    ingredients: input.ingredients[language].length > 0,
    steps: input.steps[language].length > 0,
  };
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useContainedDialog(dialogRef: React.RefObject<HTMLElement | null>, onClose: () => void, canClose = true) {
  const closeHandler = useRef(onClose);
  const canCloseRef = useRef(canClose);
  closeHandler.current = onClose;
  canCloseRef.current = canClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const inerted: Array<{ element: HTMLElement; hadInert: boolean }> = [];
    document.body.style.overflow = 'hidden';

    let pathNode: HTMLElement | null = dialog.parentElement;
    while (pathNode && pathNode !== document.body) {
      const parent: HTMLElement | null = pathNode.parentElement;
      if (!parent) break;
      Array.from(parent.children).forEach(sibling => {
        if (sibling !== pathNode && sibling instanceof HTMLElement) {
          inerted.push({ element: sibling, hadInert: sibling.hasAttribute('inert') });
          sibling.setAttribute('inert', '');
        }
      });
      pathNode = parent;
    }

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
    const frame = window.requestAnimationFrame(() => (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? dialog).focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canCloseRef.current) {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const available = focusables();
      if (!available.length) { event.preventDefault(); dialog.focus(); return; }
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown, true);
      inerted.forEach(({ element, hadInert }) => { if (!hadInert) element.removeAttribute('inert'); });
      previousFocus?.focus();
    };
  }, [dialogRef]);
}

export function StaffGuideManagement({ locale, items }: StaffGuideManagementProps) {
  const text = copy[locale];
  const [guides, setGuides] = useState<StaffGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StaffGuide | null | 'new'>(null);
  const [deleting, setDeleting] = useState<StaffGuide | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const menuItems = items;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try { setGuides(await loadStaffGuides()); }
    catch { setLoadError(text.loadFailed); }
    finally { setLoading(false); }
  }, [text.loadFailed]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale === 'de' ? 'de-DE' : 'en-GB');
    if (!needle) return guides;
    return guides.filter(guide => `${guide.name.en} ${guide.name.de}`.toLocaleLowerCase().includes(needle));
  }, [guides, locale, query]);

  async function removeGuide() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteStaffGuide(deleting);
      setGuides(current => current.filter(guide => guide.id !== deleting.id));
      setDeleting(null);
    } catch {
      setActionError(text.deleteFailed);
    } finally {
      setBusy(false);
    }
  }

  return <section className="sgm" lang={locale}>
    <header className="sgm__hero">
      <div>
        <span className="sgm__eyebrow"><Sparkles aria-hidden="true" />{text.eyebrow}</span>
        <h2>{text.title}</h2>
        <p>{text.subtitle}</p>
      </div>
      <button className="sgm__create" type="button" onClick={() => { setActionError(''); setEditing('new'); }}>
        <Plus aria-hidden="true" />{text.create}
      </button>
    </header>

    <div className="sgm__toolbar">
      <label className="sgm__search"><Search aria-hidden="true" /><span className="sgm__sr-only">{text.search}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text.search} /></label>
      <div className="sgm__summary" aria-label={`${guides.length} ${text.title}`}>
        <span><BookOpen aria-hidden="true" /><strong>{guides.length}</strong>{text.title}</span>
        <span><Check aria-hidden="true" /><strong>{guides.filter(guide => guide.menuItemId).length}</strong>{text.linked}</span>
      </div>
    </div>

    {loading ? <div className="sgm__state"><LoaderCircle className="sgm__spin" aria-hidden="true" /></div> : loadError ?
      <div className="sgm__error-state" role="alert"><CircleAlert aria-hidden="true" /><strong>{loadError}</strong><button type="button" onClick={() => void load()}>{text.retry}</button></div> : filtered.length ?
      <div className="sgm__grid">
        {filtered.map(guide => {
          const item = menuItems.find(candidate => candidate.id === guide.menuItemId);
          return <article className="sgm-card" key={guide.id}>
            <div className={`sgm-card__media ${item?.imageUrl ? 'has-image' : ''}`}>
              {item?.imageUrl ? <img src={item.imageUrl} alt="" /> : <BookOpen aria-hidden="true" />}
              <span>{guide.menuItemId ? text.linked : text.custom}</span>
            </div>
            <div className="sgm-card__body">
              <div><small>{locale === 'de' ? guide.name.en : guide.name.de}</small><h3>{guide.name[locale]}</h3></div>
              <div className="sgm-card__counts">
                <span><UtensilsCrossed aria-hidden="true" /><strong>{guide.ingredients[locale].length}</strong>{text.ingredients}</span>
                <span><ListChecks aria-hidden="true" /><strong>{guide.steps[locale].length}</strong>{text.steps}</span>
              </div>
              <footer>
                <span className="sgm-card__ready"><Check aria-hidden="true" />{text.allReady}</span>
                <div>
                  <button type="button" onClick={() => { setActionError(''); setEditing(guide); }} aria-label={`${text.edit}: ${guide.name[locale]}`} title={text.edit}><Edit3 /></button>
                  <button className="sgm-card__delete" type="button" onClick={() => { setActionError(''); setDeleting(guide); }} aria-label={`${text.remove}: ${guide.name[locale]}`} title={text.remove}><Trash2 /></button>
                </div>
              </footer>
            </div>
          </article>;
        })}
      </div> : <div className="sgm__empty">
        <span><BookOpen aria-hidden="true" /></span><h3>{text.emptyTitle}</h3><p>{text.emptyBody}</p>
        <button type="button" onClick={() => setEditing('new')}><Plus />{text.create}</button>
      </div>}

    {editing && <GuideEditor
      key={editing === 'new' ? 'new' : editing.id}
      locale={locale}
      guide={editing === 'new' ? null : editing}
      menuItems={menuItems}
      busy={busy}
      error={actionError}
      onClose={() => !busy && setEditing(null)}
      onSave={async input => {
        setBusy(true);
        setActionError('');
        try {
          if (editing === 'new') {
            const created = await createStaffGuide(input);
            setGuides(current => [created, ...current]);
          } else {
            const updated = await updateStaffGuide(editing, input);
            setGuides(current => current.map(guide => guide.id === updated.id ? updated : guide));
          }
          setEditing(null);
        } catch {
          setActionError(text.saveFailed);
        } finally {
          setBusy(false);
        }
      }}
    />}

    {deleting && <ConfirmDelete locale={locale} guide={deleting} busy={busy} error={actionError} onClose={() => !busy && setDeleting(null)} onConfirm={() => void removeGuide()} />}
  </section>;
}

function GuideEditor({ locale, guide, menuItems, busy, error, onClose, onSave }: {
  locale: Locale;
  guide: StaffGuide | null;
  menuItems: MenuItem[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: StaffGuideInput) => Promise<void>;
}) {
  const text = copy[locale];
  const [draft, setDraft] = useState<StaffGuideInput>(() => guide ? cloneGuide(guide) : emptyInput());
  const [language, setLanguage] = useState<Locale>(locale);
  const [ingredient, setIngredient] = useState('');
  const [step, setStep] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `staff-guide-editor-${guide?.id ?? 'new'}`;
  useContainedDialog(dialogRef, onClose, !busy);
  const completion = { de: languageCompletion(draft, 'de'), en: languageCompletion(draft, 'en') };
  const complete = (target: Locale) => Object.values(completion[target]).every(Boolean);

  function selectMenuItem(id: string) {
    const item = menuItems.find(candidate => candidate.id === id);
    setDraft(current => ({ ...current, menuItemId: id || undefined, name: item ? { ...item.name } : current.name }));
  }

  function addTo(field: 'ingredients' | 'steps', value: string, clear: () => void) {
    const clean = value.trim();
    if (!clean) return;
    setDraft(current => ({ ...current, [field]: { ...current[field], [language]: [...current[field][language], clean] } }));
    clear();
  }

  function removeFrom(field: 'ingredients' | 'steps', index: number) {
    setDraft(current => ({ ...current, [field]: { ...current[field], [language]: current[field][language].filter((_, itemIndex) => itemIndex !== index) } }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps[language].length) return;
    setDraft(current => {
      const reordered = [...current.steps[language]];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return { ...current, steps: { ...current.steps, [language]: reordered } };
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValid(draft)) {
      setShowValidation(true);
      setLanguage(complete('de') ? 'en' : 'de');
      return;
    }
    void onSave({ ...draft, name: { en: draft.name.en.trim(), de: draft.name.de.trim() } });
  }

  return <div className="sgm-modal" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section ref={dialogRef} className="sgm-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header>
        <div><span>{guide ? text.formEdit : text.formCreate}</span><h2 id={titleId}>{guide?.name[locale] || text.create}</h2><p>{text.formHint}</p></div>
        <button data-autofocus type="button" onClick={onClose} disabled={busy} aria-label={text.close}><X /></button>
      </header>
      <form onSubmit={submit}>
        <div className="sgm-editor__details">
          <label className="sgm-field sgm-field--select"><span>{text.selectItem}</span><div><select value={draft.menuItemId ?? ''} onChange={event => selectMenuItem(event.target.value)}><option value="">{text.selectPlaceholder}</option>{menuItems.map(item => <option value={item.id} key={item.id}>{item.name[locale]}</option>)}</select><ChevronDown aria-hidden="true" /></div></label>
          <div className="sgm-editor__language" role="group" aria-label="Language">
            {(['de', 'en'] as Locale[]).map(target => <button type="button" key={target} className={`${language === target ? 'active' : ''} ${complete(target) ? 'complete' : 'incomplete'}`} onClick={() => setLanguage(target)} aria-label={`${target === 'de' ? text.german : text.english}: ${complete(target) ? text.languageComplete : text.languageIncomplete}`}>
              {target.toUpperCase()} {complete(target) ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<span>{target === 'de' ? text.german : text.english}</span>
            </button>)}
          </div>
          <label className={`sgm-field ${showValidation && !completion[language].name ? 'sgm-field--invalid' : ''}`}><span>{text.customName} · {language.toUpperCase()}</span><input aria-invalid={showValidation && !completion[language].name} value={draft.name[language]} maxLength={160} onChange={event => setDraft(current => ({ ...current, name: { ...current.name, [language]: event.target.value } }))} />{showValidation && !completion[language].name && <small>{text.missingName}</small>}</label>
        </div>

        <div className="sgm-editor__workspace">
          <section className={`sgm-builder sgm-builder--ingredients ${showValidation && !completion[language].ingredients ? 'sgm-builder--invalid' : ''}`}>
            <header><span><UtensilsCrossed aria-hidden="true" /></span><div><h3>{text.ingredients}</h3><small>{draft.ingredients[language].length}</small></div></header>
            {showValidation && !completion[language].ingredients && <p className="sgm-builder__error"><CircleAlert />{text.missingIngredients}</p>}
            <div className="sgm-builder__add"><input value={ingredient} onChange={event => setIngredient(event.target.value)} placeholder={text.ingredientPlaceholder} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTo('ingredients', ingredient, () => setIngredient('')); } }} /><button type="button" onClick={() => addTo('ingredients', ingredient, () => setIngredient(''))} aria-label={text.addIngredient}><Plus /></button></div>
            <div className="sgm-builder__chips">{draft.ingredients[language].map((value, index) => <span key={`${value}-${index}`}>{value}<button type="button" onClick={() => removeFrom('ingredients', index)} aria-label={`${text.remove}: ${value}`}><X /></button></span>)}</div>
          </section>
          <section className={`sgm-builder sgm-builder--steps ${showValidation && !completion[language].steps ? 'sgm-builder--invalid' : ''}`}>
            <header><span><ListChecks aria-hidden="true" /></span><div><h3>{text.steps}</h3><small>{draft.steps[language].length}</small></div></header>
            {showValidation && !completion[language].steps && <p className="sgm-builder__error"><CircleAlert />{text.missingSteps}</p>}
            <ol>{draft.steps[language].map((value, index) => <li key={`${value}-${index}`}><strong>{String(index + 1).padStart(2, '0')}</strong><p>{value}</p><span className="sgm-builder__step-actions"><button type="button" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={`${text.steps}: ${index + 1} ↑`}><ChevronUp /></button><button type="button" disabled={index === draft.steps[language].length - 1} onClick={() => moveStep(index, 1)} aria-label={`${text.steps}: ${index + 1} ↓`}><MoveDown /></button><button type="button" onClick={() => removeFrom('steps', index)} aria-label={`${text.remove}: ${value}`}><Trash2 /></button></span></li>)}</ol>
            <div className="sgm-builder__step-add"><textarea value={step} rows={3} onChange={event => setStep(event.target.value)} placeholder={text.stepPlaceholder} /><button type="button" onClick={() => addTo('steps', step, () => setStep(''))}><Plus />{text.addStep}</button></div>
          </section>
        </div>
        {showValidation && <div className="sgm-editor__validation" role="alert"><CircleAlert />{text.validation}</div>}
        {error && <div className="sgm-editor__validation" role="alert"><CircleAlert />{error}</div>}
        <footer><button type="button" className="sgm-button sgm-button--secondary" onClick={onClose} disabled={busy}>{text.cancel}</button><button type="submit" className="sgm-button sgm-button--primary" disabled={busy}>{busy ? <LoaderCircle className="sgm__spin" /> : <Check />}{busy ? text.saving : text.save}</button></footer>
      </form>
    </section>
  </div>;
}

function ConfirmDelete({ locale, guide, busy, error, onClose, onConfirm }: { locale: Locale; guide: StaffGuide; busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const text = copy[locale];
  const dialogRef = useRef<HTMLElement>(null);
  useContainedDialog(dialogRef, onClose, !busy);
  return <div className="sgm-modal" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}><section ref={dialogRef} className="sgm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sgm-delete-title" tabIndex={-1}>
    <span className="sgm-confirm__icon"><Trash2 /></span><h2 id="sgm-delete-title">{text.deleteTitle}</h2><p><strong>{guide.name[locale]}</strong><br />{text.deleteBody}</p>
    {error && <div className="sgm__alert"><CircleAlert />{error}</div>}
    <div><button data-autofocus className="sgm-button sgm-button--secondary" type="button" onClick={onClose} disabled={busy}>{text.keep}</button><button className="sgm-button sgm-button--danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="sgm__spin" /> : <Trash2 />}{text.confirmDelete}</button></div>
  </section></div>;
}

