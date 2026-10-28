import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Eye, EyeOff, LoaderCircle, MessageSquareText, Save, Star } from 'lucide-react';
import {
  loadPublicReviews,
  loadReviewManagement,
  saveFooterContent,
  saveReviewsSectionVisibility,
  saveReviewVisibility,
} from './remoteData';
import type { CustomerReview, Locale, ManagedReview, ThemeSettings } from './types';
import './reviews.css';

const copy = {
  en: {
    eyebrow: 'Guest feedback', title: 'What our guests say', verified: 'Verified order',
    managerTitle: 'Reviews & footer', managerCopy: 'Approve customer feedback and control what appears on the public menu.',
    sectionVisibility: 'Show reviews on the menu', sectionVisibilityCopy: 'Hide the complete section without deleting any feedback.',
    loading: 'Loading feedback', empty: 'No customer feedback has been submitted yet.', show: 'Show', hide: 'Hide',
    footerTitle: 'Copyright footer', footerCopy: 'Only administrators can change this public copyright notice.',
    english: 'English copyright', german: 'German copyright', save: 'Save footer', saved: 'Saved', failed: 'The change could not be saved.',
  },
  de: {
    eyebrow: 'Gästefeedback', title: 'Das sagen unsere Gäste', verified: 'Verifizierte Bestellung',
    managerTitle: 'Bewertungen & Footer', managerCopy: 'Kundenfeedback freigeben und die öffentliche Anzeige im Menü steuern.',
    sectionVisibility: 'Bewertungen im Menü anzeigen', sectionVisibilityCopy: 'Den gesamten Bereich ausblenden, ohne Feedback zu löschen.',
    loading: 'Feedback wird geladen', empty: 'Noch kein Kundenfeedback vorhanden.', show: 'Anzeigen', hide: 'Ausblenden',
    footerTitle: 'Copyright-Footer', footerCopy: 'Nur Administratoren können diesen öffentlichen Copyright-Hinweis ändern.',
    english: 'Copyright auf Englisch', german: 'Copyright auf Deutsch', save: 'Footer speichern', saved: 'Gespeichert', failed: 'Die Änderung konnte nicht gespeichert werden.',
  },
} satisfies Record<Locale, Record<string, string>>;

function Stars({ rating }: { rating: number }) {
  return <span className="review-stars" aria-label={`${rating} / 5`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} aria-hidden="true" className={value <= rating ? 'filled' : ''} />)}</span>;
}

function ReviewCard({ review, verifiedLabel, duplicate = false }: { review: CustomerReview; verifiedLabel: string; duplicate?: boolean }) {
  const initial = review.displayName.trim().slice(0, 1).toUpperCase() || 'G';
  return (
    <article className="guest-review-card" aria-hidden={duplicate || undefined}>
      <span className="guest-review-avatar" aria-hidden="true">{initial}</span>
      <div className="guest-review-heading"><strong>{review.displayName}</strong><small>{verifiedLabel}</small></div>
      <p>{review.feedback}</p>
      <footer><Stars rating={review.rating} /><MessageSquareText aria-hidden="true" /></footer>
    </article>
  );
}

export function ReviewsShowcase({ locale, visible }: { locale: Locale; visible: boolean }) {
  const text = copy[locale];
  const [reviews, setReviews] = useState<CustomerReview[]>([]);

  useEffect(() => {
    let active = true;
    if (!visible) { setReviews([]); return () => { active = false; }; }
    void loadPublicReviews().then((next) => { if (active) setReviews(next); }).catch(() => { if (active) setReviews([]); });
    return () => { active = false; };
  }, [visible]);

  const loop = useMemo(() => [...reviews, ...reviews], [reviews]);
  if (!visible || reviews.length === 0) return null;

  return (
    <section className="guest-reviews" aria-labelledby="guest-reviews-title">
      <header><span>{text.eyebrow}</span><h2 id="guest-reviews-title">{text.title}</h2></header>
      <div className="guest-reviews-viewport">
        <div className="guest-reviews-track" style={{ '--review-count': reviews.length } as CSSProperties}>
          {loop.map((review, index) => <ReviewCard key={`${review.id}-${index}`} review={review} verifiedLabel={text.verified} duplicate={index >= reviews.length} />)}
        </div>
      </div>
    </section>
  );
}

export function MenuFooter({ locale, copyright }: { locale: Locale; copyright: ThemeSettings['footerCopyright'] }) {
  return <footer className="menu-footer"><p>{copyright[locale]}</p></footer>;
}

export function ReviewsManager({
  locale, isAdmin, theme, onThemeChange,
}: {
  locale: Locale;
  isAdmin: boolean;
  theme: ThemeSettings;
  onThemeChange: (theme: ThemeSettings) => void;
}) {
  const text = copy[locale];
  const [reviews, setReviews] = useState<ManagedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [sectionBusy, setSectionBusy] = useState(false);
  const [footer, setFooter] = useState(theme.footerCopyright);
  const [footerState, setFooterState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadReviewManagement()
      .then((result) => {
        if (!active) return;
        setReviews(result.reviews);
        setFooter(result.footerCopyright);
        onThemeChange({ ...theme, reviewsVisible: result.reviewsVisible, footerCopyright: result.footerCopyright });
      })
      .catch(() => { if (active) setError(text.failed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Load once when the workspace opens; subsequent changes are applied optimistically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = async () => {
    const next = !theme.reviewsVisible;
    setSectionBusy(true); setError('');
    try { await saveReviewsSectionVisibility(next); onThemeChange({ ...theme, reviewsVisible: next }); }
    catch { setError(text.failed); }
    finally { setSectionBusy(false); }
  };

  const toggleReview = async (review: ManagedReview) => {
    setBusyId(review.id); setError('');
    try {
      await saveReviewVisibility(review.id, !review.visible);
      setReviews((current) => current.map((entry) => entry.id === review.id ? { ...entry, visible: !entry.visible } : entry));
    } catch { setError(text.failed); }
    finally { setBusyId(''); }
  };

  const saveFooter = async () => {
    setFooterState('busy'); setError('');
    try {
      await saveFooterContent(footer);
      onThemeChange({ ...theme, footerCopyright: footer });
      setFooterState('saved');
      window.setTimeout(() => setFooterState('idle'), 1600);
    } catch { setError(text.failed); setFooterState('idle'); }
  };

  return (
    <section className="dashboard-card focus-card reviews-manager">
      <div className="section-head"><div><h2>{text.managerTitle}</h2><p className="muted">{text.managerCopy}</p></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="reviews-visibility-row">
        <div><strong>{text.sectionVisibility}</strong><p>{text.sectionVisibilityCopy}</p></div>
        <button type="button" className={`visibility-switch ${theme.reviewsVisible ? 'active' : ''}`} onClick={() => void toggleSection()} disabled={sectionBusy} aria-pressed={theme.reviewsVisible}>
          {sectionBusy ? <LoaderCircle className="spin" /> : theme.reviewsVisible ? <Eye /> : <EyeOff />}
          {theme.reviewsVisible ? text.show : text.hide}
        </button>
      </div>

      {loading ? <div className="reviews-manager-state"><LoaderCircle className="spin" /> {text.loading}</div> : reviews.length === 0 ? <div className="reviews-manager-state">{text.empty}</div> : (
        <div className="reviews-manager-list">
          {reviews.map((review) => (
            <article key={review.id} className={review.visible ? 'published' : ''}>
              <div className="managed-review-meta"><span>{review.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{review.displayName}</strong><small>#{review.orderNumber}</small></div><Stars rating={review.rating} /></div>
              <p>{review.feedback || '—'}</p>
              <button type="button" onClick={() => void toggleReview(review)} disabled={busyId === review.id}>
                {busyId === review.id ? <LoaderCircle className="spin" /> : review.visible ? <EyeOff /> : <Eye />}
                {review.visible ? text.hide : text.show}
              </button>
            </article>
          ))}
        </div>
      )}

      {isAdmin && (
        <section className="footer-settings">
          <div><h3>{text.footerTitle}</h3><p className="muted">{text.footerCopy}</p></div>
          <div className="footer-settings-grid">
            <label>{text.english}<input value={footer.en} maxLength={300} onChange={(event) => setFooter({ ...footer, en: event.target.value })} /></label>
            <label>{text.german}<input value={footer.de} maxLength={300} onChange={(event) => setFooter({ ...footer, de: event.target.value })} /></label>
          </div>
          <button type="button" className="small-action" onClick={() => void saveFooter()} disabled={footerState === 'busy' || !footer.en.trim() || !footer.de.trim()}>
            {footerState === 'busy' ? <LoaderCircle className="spin" /> : <Save />}{footerState === 'saved' ? text.saved : text.save}
          </button>
        </section>
      )}
    </section>
  );
}
