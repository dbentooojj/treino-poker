export type UnifiedResultReview = {
  id: string;
  status: "BEST" | "CORRECT" | "INACCURACY" | "WRONG" | "REVIEW" | "NOT_PLAYED";
  label: string;
  value?: string;
};

const REVIEW_ICONS: Record<UnifiedResultReview["status"], string> = {
  BEST: "✓✓",
  CORRECT: "✓",
  INACCURACY: "!",
  WRONG: "×",
  REVIEW: "!",
  NOT_PLAYED: "—",
};

export function UnifiedResultPanel({ score, metricValue, metricLabel = "RangeLab score", metricProgress, resultIcon, badge, details, footer, eyebrow, title, description, reviews, repeatLabel, nextLabel, nextCompactLabel, nextCountdown = null, nextAutoAdvanceActive = false, nextDisabled = false, nextAriaLabel, tone = "neutral", className = "", titleId = "training-result-title", onInteraction, onRepeat, onNext }: {
  score: number;
  metricValue?: string;
  metricLabel?: string;
  metricProgress?: number;
  resultIcon?: string;
  badge?: string;
  details?: React.ReactNode;
  footer?: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  reviews: UnifiedResultReview[];
  repeatLabel: string;
  nextLabel: string;
  nextCompactLabel?: string;
  nextCountdown?: number | null;
  nextAutoAdvanceActive?: boolean;
  nextDisabled?: boolean;
  nextAriaLabel?: string;
  tone?: "best" | "correct" | "inaccuracy" | "wrong" | "review" | "neutral";
  className?: string;
  titleId?: string;
  onInteraction?: () => void;
  onRepeat: () => void;
  onNext: () => void;
}) {
  const progress = Math.max(0, Math.min(100, metricProgress ?? score));
  const icon = resultIcon ?? (tone === "best" ? "✓✓" : tone === "correct" || score >= 75 ? "✓" : tone === "wrong" ? "×" : "!");
  function registerInteraction(event: React.SyntheticEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (typeof target.closest === "function" && target.closest("button, a, input, select, textarea, summary, [role='button'], [role='tab']")) onInteraction?.();
  }
  return <section className={`play-result unified-result-panel ${className}`} data-tone={tone} aria-labelledby={titleId} aria-live="polite" onPointerDownCapture={registerInteraction} onFocusCapture={registerInteraction} onKeyDownCapture={registerInteraction}>
    <div className="play-result-card">
      <div className="play-score" style={{ "--score": `${progress * 3.6}deg` } as React.CSSProperties}><strong>{metricValue ?? `${score}%`}</strong><span>{metricLabel}</span></div>
      <div className="play-result-summary">
        <div className="play-result-copy">
          <i aria-hidden="true">{icon}</i>
          <div><div className="play-result-meta"><span>{eyebrow}</span>{badge && <em>{badge}</em>}</div><h2 id={titleId}>{title}</h2><p>{description}</p></div>
        </div>
        {(details || reviews.length > 0) && <div className="play-result-detail-row">
          {details}
          {reviews.length > 0 && <div className="play-street-review" aria-label="Resumo do resultado">
            {reviews.map((review) => <div key={review.id} className={`play-review-${review.status.toLowerCase()}`}><span>{review.label}</span><b>{review.value ?? REVIEW_ICONS[review.status]}</b></div>)}
          </div>}
        </div>}
        {footer && <div className="play-result-footer">{footer}</div>}
      </div>
    </div>
    <div className="play-result-actions">
      <button type="button" onClick={onRepeat}><span aria-hidden="true">↻</span> {repeatLabel}</button>
      <button type="button" className={`play-next-hand ${nextAutoAdvanceActive ? "is-auto-advancing" : ""}`} disabled={nextDisabled} aria-label={nextAriaLabel} onClick={onNext}>
        <span className="play-next-hand__label"><span className="play-next-hand__label-full">{nextLabel}</span>{nextCompactLabel && <span className="play-next-hand__label-compact" aria-hidden="true">{nextCompactLabel}</span>}{nextCountdown !== null && <span className="play-next-hand__countdown" aria-hidden="true"> · {nextCountdown}</span>}</span>
        <span className="play-next-hand__arrow" aria-hidden="true">▶▶</span>
        {nextAutoAdvanceActive && <span className="play-next-hand__progress" aria-hidden="true"><i/></span>}
      </button>
    </div>
  </section>;
}
