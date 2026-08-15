export type UnifiedActionOption = {
  id: string;
  label: string;
  tone: string;
  hint?: string | null;
  disabled?: boolean;
};

export function UnifiedActionPanel({ eyebrow, title, context, actions, active = true, busy = false, className = "", titleId, onAction }: {
  eyebrow: string;
  title: string;
  context: string;
  actions: UnifiedActionOption[];
  active?: boolean;
  busy?: boolean;
  className?: string;
  titleId?: string;
  onAction: (id: string) => void;
}) {
  return <section className={`play-action-panel ${active ? "play-action-panel--hero" : ""} ${className}`} aria-live="polite">
    <div className="play-action-copy">
      <span>{eyebrow}</span>
      <strong id={titleId}>{title}</strong>
      <small>{context}</small>
    </div>
    <div
      className={`play-action-buttons actions-${actions.length} ${active ? "is-active" : "is-waiting"}`}
      data-action-count={actions.length}
      aria-label={active ? "Escolha sua ação" : undefined}
    >
      {active ? actions.map((action) => <button type="button" key={action.id} disabled={busy || action.disabled} className={`play-action-button play-action-button--${action.tone}`} onClick={() => onAction(action.id)}>
        <b>{action.label}</b>
        {action.hint && <small>{action.hint}</small>}
      </button>) : <div className="play-action-pulse" aria-hidden="true"><i/><i/><i/></div>}
    </div>
  </section>;
}
