export default function Loading() {
  return <main className="system-page" aria-busy="true" aria-label="Carregando página">
    <div className="system-header-skeleton"><span/><i/><i/><i/></div>
    <section className="system-loading-shell" role="status">
      <div className="system-loading-heading"><span/><b/><i/></div>
      <div className="system-loading-grid"><i/><i/><i/></div>
      <span className="sr-only">Carregando conteúdo…</span>
    </section>
  </main>;
}
