export type UnifiedResultReview = {
  id: string;
  status: "CORRECT" | "REVIEW" | "NOT_PLAYED";
  label: string;
  value?: string;
};

export function UnifiedResultPanel({ score, eyebrow, title, description, reviews, repeatLabel, nextLabel, tone = "neutral", className = "", titleId = "training-result-title", onRepeat, onNext }: {
  score: number;
  eyebrow: string;
  title: string;
  description: string;
  reviews: UnifiedResultReview[];
  repeatLabel: string;
  nextLabel: string;
  tone?: "correct" | "review" | "neutral";
  className?: string;
  titleId?: string;
  onRepeat: () => void;
  onNext: () => void;
}) {
  const resultIcon = tone === "correct" || score >= 75 ? "✓" : "!";
  return <section className={`play-result unified-result-panel ${className}`} data-tone={tone} aria-labelledby={titleId} aria-live="polite">
    <div className="play-result-card">
      <div className="play-score" style={{ "--score": `${Math.max(0, Math.min(100, score)) * 3.6}deg` } as React.CSSProperties}><strong>{score}%</strong><span>RangeLab score</span></div>
      <div className="play-result-summary">
        <div className="play-result-copy">
          <i aria-hidden="true">{resultIcon}</i>
          <div><span>{eyebrow}</span><h2 id={titleId}>{title}</h2><p>{description}</p></div>
        </div>
        <div className="play-street-review" aria-label="Resumo do resultado">
          {reviews.map((review) => <div key={review.id} className={`play-review-${review.status.toLowerCase()}`}><b>{review.value ?? (review.status === "CORRECT" ? "✓" : review.status === "REVIEW" ? "!" : "—")}</b><span>{review.label}</span></div>)}
        </div>
      </div>
    </div>
    <div className="play-result-actions">
      <button type="button" onClick={onRepeat}><span aria-hidden="true">↻</span> {repeatLabel}</button>
      <button type="button" className="play-next-hand" onClick={onNext}>{nextLabel} <span aria-hidden="true">▶▶</span></button>
    </div>
  </section>;
}
