import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChefHat, ListChecks, LoaderCircle, Search, UtensilsCrossed, X } from 'lucide-react';
import { loadStaffGuides } from './remoteData';
import type { Locale, StaffGuide } from './types';
import './staff-guide-library.css';

interface StaffGuideLibraryProps {
  locale: Locale;
}

const copy = {
  de: {
    eyebrow: 'Küchenleitfaden', title: 'Zubereitungsleitfäden', subtitle: 'Zutaten und Abläufe für einen schnellen, gleichbleibenden Service.',
    search: 'Produkt oder Zutat suchen', guides: 'Leitfäden', ingredients: 'Zutaten', steps: 'Arbeitsschritte',
    open: 'Leitfaden öffnen', emptyTitle: 'Kein Leitfaden gefunden', emptyBody: 'Versuche einen anderen Suchbegriff.',
    noGuides: 'Die Küchenleitfäden werden gerade vorbereitet.', close: 'Schließen', preparation: 'Zubereitung', retry: 'Erneut laden',
    linked: 'Menüartikel',
  },
  en: {
    eyebrow: 'Staff guide', title: 'Preparation guides', subtitle: 'Ingredients and workflows for fast, consistent service.',
    search: 'Search product or ingredient', guides: 'guides', ingredients: 'Ingredients', steps: 'Preparation steps',
    open: 'Open guide', emptyTitle: 'No guide found', emptyBody: 'Try a different search term.',
    noGuides: 'Kitchen guides are being prepared.', close: 'Close', preparation: 'Preparation', retry: 'Try again',
    linked: 'Menu item',
  },
} as const;

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useContainedDialog(dialogRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
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
      if (event.key === 'Escape') { event.preventDefault(); closeHandler.current(); return; }
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

export function StaffGuideLibrary({ locale }: StaffGuideLibraryProps) {
  const text = copy[locale];
  const [guides, setGuides] = useState<StaffGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StaffGuide | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setGuides(await loadStaffGuides()); }
    catch { setError(locale === 'de' ? 'Die Küchenleitfäden konnten nicht geladen werden.' : 'Kitchen guides could not be loaded.'); }
    finally { setLoading(false); }
  }, [locale]);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale === 'de' ? 'de-DE' : 'en-GB');
    if (!needle) return guides;
    return guides.filter(guide => `${guide.name.en} ${guide.name.de} ${guide.ingredients.en.join(' ')} ${guide.ingredients.de.join(' ')}`.toLocaleLowerCase().includes(needle));
  }, [guides, locale, query]);

  return <section className="sgl" lang={locale}>
    <header className="sgl__head">
      <div><span className="sgl__eyebrow"><ChefHat />{text.eyebrow}</span><h2>{text.title}</h2><p>{text.subtitle}</p></div>
      <span className="sgl__count"><strong>{String(guides.length).padStart(2, '0')}</strong>{text.guides}</span>
    </header>
    <label className="sgl__search"><Search /><span className="sgl__sr-only">{text.search}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text.search} /></label>
    {loading ? <div className="sgl__state"><LoaderCircle className="sgl__spin" /></div> : error ? <div className="sgl__error-state" role="alert"><CircleAlertIcon /><strong>{error}</strong><button type="button" onClick={() => void load()}>{text.retry}</button></div> : filtered.length ? <div className="sgl__grid">
      {filtered.map((guide, index) => <button className="sgl-card" type="button" key={guide.id} onClick={() => setSelected(guide)} style={{ '--sgl-index': index } as React.CSSProperties}>
        <span className="sgl-card__number">{String(index + 1).padStart(2, '0')}</span>
        <span className="sgl-card__icon"><BookOpen /></span>
        <span className="sgl-card__copy"><small>{guide.menuItemId ? text.linked : locale === 'de' ? guide.name.en : guide.name.de}</small><strong>{guide.name[locale]}</strong></span>
        <span className="sgl-card__metrics"><span><UtensilsCrossed /><b>{guide.ingredients[locale].length}</b>{text.ingredients}</span><span><ListChecks /><b>{guide.steps[locale].length}</b>{text.steps}</span></span>
        <span className="sgl-card__open">{text.open}<span aria-hidden="true">↗</span></span>
      </button>)}
    </div> : <div className="sgl__empty"><span><BookOpen /></span><h3>{guides.length ? text.emptyTitle : text.noGuides}</h3>{guides.length > 0 && <p>{text.emptyBody}</p>}</div>}
    {selected && <GuideDialog guide={selected} locale={locale} onClose={() => setSelected(null)} />}
  </section>;
}

function GuideDialog({ guide, locale, onClose }: { guide: StaffGuide; locale: Locale; onClose: () => void }) {
  const text = copy[locale];
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `staff-guide-${guide.id}`;
  useContainedDialog(dialogRef, onClose);

  return <div className="sgl-modal" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="sgl-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><div><span><ChefHat />{text.preparation}</span><small>{locale === 'de' ? guide.name.en : guide.name.de}</small><h2 id={titleId}>{guide.name[locale]}</h2></div><button data-autofocus type="button" onClick={onClose} aria-label={text.close}><X /></button></header>
      <div className="sgl-dialog__content">
        <section className="sgl-ingredients"><header><span><UtensilsCrossed /></span><div><h3>{text.ingredients}</h3><small>{guide.ingredients[locale].length}</small></div></header><ul>{guide.ingredients[locale].map((ingredient, index) => <li key={`${ingredient}-${index}`}><Check /><span>{ingredient}</span></li>)}</ul></section>
        <section className="sgl-steps"><header><span><ListChecks /></span><div><h3>{text.steps}</h3><small>{guide.steps[locale].length}</small></div></header><ol>{guide.steps[locale].map((step, index) => <li key={`${step}-${index}`}><strong>{String(index + 1).padStart(2, '0')}</strong><p>{step}</p></li>)}</ol></section>
      </div>
    </section>
  </div>;
}

function CircleAlertIcon() {
  return <span className="sgl__error-icon" aria-hidden="true">!</span>;
}

