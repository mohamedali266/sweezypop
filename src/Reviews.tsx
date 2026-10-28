import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BadgeCheck, Copyright, Eye, EyeOff, Languages, LoaderCircle, MessageSquareText, Pause, Play, Save, Star } from 'lucide-react';
import {
  loadPublicReviews, loadReviewManagement, saveFooterContent,
  saveReviewsSectionVisibility, saveReviewVisibility,
} from './remoteData';
import type { CustomerReview, Locale, ManagedReview, ThemeSettings } from './types';
import './reviews.css';

const copy = {
  en: {
    eyebrow: 'Guest feedback', title: 'What our guests say', verified: 'Verified order',
    pauseReviews: 'Pause reviews', playReviews: 'Resume reviews',
    managerTitle: 'Customer reviews', managerCopy: 'Moderate verified feedback before it appears on the public menu.',
    sectionVisibility: 'Public reviews section', sectionVisibilityCopy: 'Control the complete reviews section without deleting any feedback.',
    sectionShown: 'Visible on menu', sectionHidden: 'Hidden from menu', loading: 'Loading feedback',
    empty: 'No customer feedback has been submitted yet.', show: 'Show review', hide: 'Hide review',
    published: 'Published', hidden: 'Hidden', total: 'Total reviews', visible: 'Visible', awaiting: 'Hidden',
    order: 'Order', noComment: 'No written feedback was provided.', failed: 'The change could not be saved.',
    footerTitle: 'Copyright footer', footerCopy: 'Edit the copyright notice shown at the bottom of the public menu.',
    footerLoading: 'Loading footer settings', footerFailed: 'The footer settings could not be loaded or saved.',
    footerAdmin: 'Administrator access only', footerAdminCopy: 'Changes are published to both menu languages after saving.',
    english: 'English', german: 'German', englishHint: 'Public footer in English', germanHint: 'Public footer in German',
    save: 'Save footer', saved: 'Changes saved', saving: 'Saving', unsaved: 'Unsaved changes', characters: 'characters',
  },
  de: {
    eyebrow: 'Gästefeedback', title: 'Das sagen unsere Gäste', verified: 'Verifizierte Bestellung',
    pauseReviews: 'Bewertungen anhalten', playReviews: 'Bewertungen fortsetzen',
    managerTitle: 'Kundenbewertungen', managerCopy: 'Verifiziertes Feedback prüfen, bevor es im öffentlichen Menü erscheint.',
    sectionVisibility: 'Öffentlicher Bewertungsbereich', sectionVisibilityCopy: 'Den gesamten Bereich steuern, ohne Feedback zu löschen.',
    sectionShown: 'Im Menü sichtbar', sectionHidden: 'Im Menü ausgeblendet', loading: 'Feedback wird geladen',
    empty: 'Noch kein Kundenfeedback vorhanden.', show: 'Bewertung anzeigen', hide: 'Bewertung ausblenden',
    published: 'Veröffentlicht', hidden: 'Ausgeblendet', total: 'Bewertungen', visible: 'Sichtbar', awaiting: 'Ausgeblendet',
    order: 'Bestellung', noComment: 'Es wurde kein schriftliches Feedback abgegeben.', failed: 'Die Änderung konnte nicht gespeichert werden.',
    footerTitle: 'Copyright-Footer', footerCopy: 'Copyright-Hinweis am Ende des öffentlichen Menüs bearbeiten.',
    footerLoading: 'Footer-Einstellungen werden geladen', footerFailed: 'Die Footer-Einstellungen konnten nicht geladen oder gespeichert werden.',
    footerAdmin: 'Nur für Administratoren', footerAdminCopy: 'Änderungen werden nach dem Speichern in beiden Menüsprachen veröffentlicht.',
    english: 'Englisch', german: 'Deutsch', englishHint: 'Öffentlicher Footer auf Englisch', germanHint: 'Öffentlicher Footer auf Deutsch',
    save: 'Footer speichern', saved: 'Änderungen gespeichert', saving: 'Wird gespeichert', unsaved: 'Nicht gespeicherte Änderungen', characters: 'Zeichen',
  },
} satisfies Record<Locale, Record<string, string>>;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="review-stars" aria-label={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((value) => <Star key={value} aria-hidden="true" className={value <= rating ? 'filled' : ''} />)}
    </span>
  );
}

function formatReviewDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function ReviewCard({ review, verifiedLabel, duplicate = false }: { review: CustomerReview; verifiedLabel: string; duplicate?: boolean }) {
  const initial = review.displayName.trim().slice(0, 1).toUpperCase() || 'G';
  return (
    <article className="guest-review-card" aria-hidden={duplicate || undefined} tabIndex={duplicate ? -1 : 0}>
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
  const [paused, setPaused] = useState(false);

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
      <header>
        <div><span>{text.eyebrow}</span><h2 id="guest-reviews-title">{text.title}</h2></div>
        <button type="button" className="reviews-motion-control" onClick={() => setPaused((current) => !current)} aria-pressed={paused} aria-label={paused ? text.playReviews : text.pauseReviews}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? text.playReviews : text.pauseReviews}
        </button>
      </header>
      <div className="guest-reviews-viewport">
        <div className={`guest-reviews-track ${paused ? 'paused' : ''}`} style={{ '--review-count': reviews.length } as CSSProperties}>
          {loop.map((review, index) => <ReviewCard key={`${review.id}-${index}`} review={review} verifiedLabel={text.verified} duplicate={index >= reviews.length} />)}
        </div>
      </div>
    </section>
  );
}

export function MenuFooter({ locale, copyright }: { locale: Locale; copyright: ThemeSettings['footerCopyright'] }) {
  return <footer className="menu-footer"><p>{copyright[locale]}</p></footer>;
}

export function ReviewsManager({ locale, theme, onThemeChange }: {
  locale: Locale; theme: ThemeSettings; onThemeChange: (theme: ThemeSettings) => void;
}) {
  const text = copy[locale];
  const [reviews, setReviews] = useState<ManagedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [sectionBusy, setSectionBusy] = useState(false);
  const [error, setError] = useState('');
  const latestThemeRef = useRef(theme);
  latestThemeRef.current = theme;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadReviewManagement()
      .then((result) => {
        if (!active) return;
        setReviews(result.reviews);
        onThemeChange({ ...latestThemeRef.current, reviewsVisible: result.reviewsVisible, footerCopyright: result.footerCopyright });
      })
      .catch(() => { if (active) setError(text.failed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Load once when the workspace opens; subsequent changes are applied optimistically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCount = reviews.filter((review) => review.visible).length;
  const toggleSection = async () => {
    const next = !theme.reviewsVisible;
    setSectionBusy(true); setError('');
    try { await saveReviewsSectionVisibility(next); onThemeChange({ ...latestThemeRef.current, reviewsVisible: next }); }
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

  return (
    <section className="dashboard-card focus-card reviews-manager">
      <header className="reviews-manager-heading">
        <div><h2>{text.managerTitle}</h2><p>{text.managerCopy}</p></div>
        {!loading && <span className="reviews-total"><strong>{reviews.length}</strong>{text.total}</span>}
      </header>
      {error && <p className="form-error reviews-alert" role="alert">{error}</p>}
      <div className="reviews-visibility-row">
        <div className="reviews-visibility-copy">
          <span className={`reviews-state-dot ${theme.reviewsVisible ? 'active' : ''}`} aria-hidden="true" />
          <div><strong>{text.sectionVisibility}</strong><p>{text.sectionVisibilityCopy}</p></div>
        </div>
        <button type="button" className={`visibility-switch ${theme.reviewsVisible ? 'active' : ''}`} onClick={() => void toggleSection()} disabled={sectionBusy} aria-pressed={theme.reviewsVisible}>
          {sectionBusy ? <LoaderCircle className="spin" /> : theme.reviewsVisible ? <Eye /> : <EyeOff />}
          {theme.reviewsVisible ? text.sectionShown : text.sectionHidden}
        </button>
      </div>
      {!loading && reviews.length > 0 && (
        <div className="reviews-summary" aria-label={text.total}>
          <div><span>{text.visible}</span><strong>{visibleCount}</strong></div>
          <div><span>{text.awaiting}</span><strong>{reviews.length - visibleCount}</strong></div>
        </div>
      )}
      {loading ? (
        <div className="reviews-manager-state"><LoaderCircle className="spin" /> {text.loading}</div>
      ) : reviews.length === 0 ? (
        <div className="reviews-manager-state"><MessageSquareText aria-hidden="true" /><span>{text.empty}</span></div>
      ) : (
        <div className="reviews-manager-list">
          {reviews.map((review) => (
            <article key={review.id} className={review.visible ? 'published' : ''}>
              <header className="managed-review-header">
                <span className="managed-review-avatar" aria-hidden="true">{review.displayName.slice(0, 1).toUpperCase()}</span>
                <div className="managed-review-identity"><strong>{review.displayName}</strong><small>{text.order} #{review.orderNumber}</small></div>
                <span className={`managed-review-status ${review.visible ? 'published' : ''}`}>
                  {review.visible ? <BadgeCheck aria-hidden="true" /> : <EyeOff aria-hidden="true" />}{review.visible ? text.published : text.hidden}
                </span>
              </header>
              <div className="managed-review-rating"><Stars rating={review.rating} /><time dateTime={review.submittedAt}>{formatReviewDate(review.submittedAt, locale)}</time></div>
              <p className={review.feedback ? '' : 'empty-feedback'}>{review.feedback || text.noComment}</p>
              <footer>
                <button type="button" onClick={() => void toggleReview(review)} disabled={busyId === review.id} aria-label={`${review.visible ? text.hide : text.show}: ${review.displayName}`}>
                  {busyId === review.id ? <LoaderCircle className="spin" /> : review.visible ? <EyeOff /> : <Eye />}{review.visible ? text.hide : text.show}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function FooterManager({ locale, theme, onThemeChange }: {
  locale: Locale; theme: ThemeSettings; onThemeChange: (theme: ThemeSettings) => void;
}) {
  const text = copy[locale];
  const [footer, setFooter] = useState(theme.footerCopyright);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState('');
  const latestThemeRef = useRef(theme);
  const savedTimerRef = useRef<number | null>(null);
  latestThemeRef.current = theme;
  const dirty = footer.en !== theme.footerCopyright.en || footer.de !== theme.footerCopyright.de;

  useEffect(() => {
    let active = true;
    void loadReviewManagement()
      .then((result) => {
        if (!active) return;
        setFooter(result.footerCopyright);
        onThemeChange({ ...latestThemeRef.current, reviewsVisible: result.reviewsVisible, footerCopyright: result.footerCopyright });
      })
      .catch(() => { if (active) setError(text.footerFailed); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
    // Load once when the footer destination opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFooter = (language: Locale, value: string) => {
    setFooter((current) => ({ ...current, [language]: value }));
    setSaveState('idle');
  };
  const saveFooter = async () => {
    setSaveState('busy'); setError('');
    try {
      await saveFooterContent(footer);
      onThemeChange({ ...latestThemeRef.current, footerCopyright: footer });
      setSaveState('saved');
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => {
        setSaveState('idle');
        savedTimerRef.current = null;
      }, 1800);
    } catch { setError(text.footerFailed); setSaveState('idle'); }
  };

  return (
    <section className="dashboard-card focus-card footer-manager">
      <header className="footer-manager-heading">
        <span className="footer-manager-icon" aria-hidden="true"><Copyright /></span>
        <div><h2>{text.footerTitle}</h2><p>{text.footerCopy}</p></div>
      </header>
      <div className="footer-admin-note"><BadgeCheck aria-hidden="true" /><div><strong>{text.footerAdmin}</strong><p>{text.footerAdminCopy}</p></div></div>
      {error && <p className="form-error reviews-alert" role="alert">{error}</p>}
      {loading ? (
        <div className="footer-manager-loading"><LoaderCircle className="spin" /> {text.footerLoading}</div>
      ) : (
        <div className="footer-editor-grid">
          {(['en', 'de'] as const).map((language) => (
            <label key={language} className="footer-editor-field">
              <span className="footer-editor-label">
                <span><Languages aria-hidden="true" /><strong>{language === 'en' ? text.english : text.german}</strong></span>
                <small>{footer[language].length}/300 {text.characters}</small>
              </span>
              <span className="footer-editor-hint">{language === 'en' ? text.englishHint : text.germanHint}</span>
              <textarea value={footer[language]} maxLength={300} rows={4} onChange={(event) => updateFooter(language, event.target.value)} />
            </label>
          ))}
        </div>
      )}
      {!loading && (
        <footer className="footer-manager-actions">
          <span className={`footer-save-status ${saveState === 'saved' ? 'saved' : ''}`} aria-live="polite">{saveState === 'saved' ? text.saved : dirty ? text.unsaved : ''}</span>
          <button type="button" className="small-action" onClick={() => void saveFooter()} disabled={saveState === 'busy' || !dirty || !footer.en.trim() || !footer.de.trim()}>
            {saveState === 'busy' ? <LoaderCircle className="spin" /> : <Save />}{saveState === 'busy' ? text.saving : text.save}
          </button>
        </footer>
      )}
    </section>
  );
}
