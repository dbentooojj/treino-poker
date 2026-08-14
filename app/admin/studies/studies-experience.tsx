"use client";

import { useEffect, useState } from "react";
import AppHeader from "../../../components/ui/AppHeader";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Modal } from "../../../components/ui/Modal";
import { EmptyState, PageContainer, PageHeader, StatusMessage } from "../../../components/ui/Primitives";
import type { AuthUser } from "../../../db/auth";
import type { AdminStudy, StudiesAdminData, StudyInventory } from "../../../db/studies";
import type { HrcImportSummary } from "../../../lib/hrc-import";
import { actionLabel, trainingTypeLabels, type TrainingType } from "../../../lib/training";
import { sequenceActionLabel } from "../../../components/training/trainingPresentation";

const modelLabels: Record<AdminStudy["equityModel"], string> = {
  CHIP_EV: "ChipEV",
  ICM: "ICM",
};

const anteLabels: Record<AdminStudy["anteType"], string> = {
  NONE: "Sem ante",
  ANTE: "Ante",
  BB_ANTE: "BBA",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(timestamp));
}

export default function AdminStudiesExperience({ user, data }: { user: AuthUser; data: StudiesAdminData }) {
  const [importOpen, setImportOpen] = useState(false);
  const [adminData, setAdminData] = useState(data);
  const [importing, setImporting] = useState(false);
  const [updatingStudyId, setUpdatingStudyId] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const [importReport, setImportReport] = useState<HrcImportSummary | null>(null);
  const [inventoryStudy, setInventoryStudy] = useState<AdminStudy | null>(null);
  const [inventory, setInventory] = useState<StudyInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryFilters, setInventoryFilters] = useState<{ trainingType: TrainingType | ""; heroPosition: string; search: string; page: number }>({ trainingType: "", heroPosition: "", search: "", page: 1 });
  const [deletingStudy, setDeletingStudy] = useState<AdminStudy | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!inventoryStudy) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(inventoryFilters.page), pageSize: "20" });
    if (inventoryFilters.trainingType) params.set("trainingType", inventoryFilters.trainingType);
    if (inventoryFilters.heroPosition) params.set("heroPosition", inventoryFilters.heroPosition);
    if (inventoryFilters.search.trim()) params.set("search", inventoryFilters.search.trim());
    fetch(`/api/studies/${inventoryStudy.id}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { inventory?: StudyInventory; error?: string };
        if (!response.ok || !result.inventory) throw new Error(result.error || "Não foi possível carregar o inventário.");
        setInventory(result.inventory);
        setInventoryError("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInventoryError(error instanceof Error ? error.message : "Não foi possível carregar o inventário.");
      })
      .finally(() => { if (!controller.signal.aborted) setInventoryLoading(false); });
    return () => controller.abort();
  }, [inventoryStudy, inventoryFilters]);

  async function importStudy(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    setImportError("");
    setImportReport(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/studies/import", {
        method: "POST",
        body: formData,
      });
      const result = await response.json() as { data?: StudiesAdminData; summary?: HrcImportSummary; error?: string };
      if (!response.ok || !result.data || !result.summary) throw new Error(result.error || "Não foi possível salvar o estudo.");
      setAdminData(result.data);
      setImportReport(result.summary);
      setImportOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Não foi possível importar o estudo.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  async function updatePublication(study: AdminStudy) {
    if (updatingStudyId) return;
    setUpdatingStudyId(study.id);
    setImportError("");
    try {
      const response = await fetch(`/api/studies/${study.id}/publication`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !study.isPublished }),
      });
      const result = await response.json() as { data?: StudiesAdminData; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "Não foi possível alterar a publicação.");
      setAdminData(result.data);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Não foi possível alterar a publicação.");
    } finally {
      setUpdatingStudyId(null);
    }
  }

  function openInventory(study: AdminStudy) {
    setInventory(null);
    setInventoryError("");
    setInventoryLoading(true);
    setInventoryFilters({ trainingType: "", heroPosition: "", search: "", page: 1 });
    setInventoryStudy(study);
  }

  function updateInventoryFilters(update: (current: typeof inventoryFilters) => typeof inventoryFilters) {
    setInventoryLoading(true);
    setInventoryFilters(update);
  }

  async function confirmDelete() {
    if (!deletingStudy || deleting || deleteConfirmation !== deletingStudy.name) return;
    setDeleting(true);
    setImportError("");
    try {
      const response = await fetch(`/api/studies/${deletingStudy.id}`, { method: "DELETE" });
      const result = await response.json() as { data?: StudiesAdminData; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "Não foi possível excluir o estudo.");
      setAdminData(result.data);
      setDeletingStudy(null);
      setDeleteConfirmation("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Não foi possível excluir o estudo.");
      setDeletingStudy(null);
    } finally {
      setDeleting(false);
    }
  }

  return <main className="member-shell admin-shell">
    <AppHeader user={user} active="admin"/>
    <PageContainer>
      <PageHeader eyebrow="Administração" title="Estudos HRC" description="Gerencie os estudos utilizados nos treinamentos." action={<Button type="button" onClick={() => { setImportError(""); setImportOpen(true); }}><Icon name="upload"/>Importar estudo</Button>}/>

      {importReport && <StatusMessage className="admin-import-notice-system" tone="success"><div>
        <b>Importação concluída — {importReport.name}</b>
        <small>{modelLabels[importReport.equityModel]} · {importReport.playersCount}-max · {importReport.stackBb === null ? "stacks variados" : `${formatNumber(importReport.stackBb)} BB`} · {formatAnte(importReport)}</small>
        <small>{importReport.sourceNodeCount} source nodes · {importReport.preflopNodeCount} pré-flop · {importReport.nodeCount} treináveis</small>
        <small>{importReport.storedHandClassCount} classes de mão armazenadas · {importReport.eligibleTrainingHandClassCount} elegíveis para treino</small>
        <small>{importReport.counts.OPEN_FOLD} RFI · {importReport.counts.VS_OPEN} vs Open · {importReport.counts.VS_3_BET} vs 3-bet · {importReport.counts.VS_4_BET} vs 4-bet · {importReport.counts.PUSH_FOLD} Push/Fold · {importReport.counts.CALL_VS_SHOVE} vs Shove</small>
        {importReport.ignoredCount > 0 && <small>{importReport.ignoredCount} ignorados: {Object.entries(importReport.ignoredNodes).filter(([, count]) => count > 0).map(([reason, count]) => `${reason} ${count}`).join(" · ")}</small>}
      </div><Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setImportReport(null)} aria-label="Fechar aviso"><Icon name="close"/></Button></StatusMessage>}
      {importError && !importOpen && <StatusMessage className="admin-page-status" tone="error">{importError}</StatusMessage>}

      <div className="admin-summary" aria-label="Resumo dos estudos">
        <article><span>ESTUDOS</span><strong>{adminData.summary.studies}</strong><small>Total cadastrado</small></article>
        <article><span>PUBLICADOS</span><strong>{adminData.summary.published}</strong><small>Disponíveis para treino</small></article>
        <article><span>SPOTS</span><strong>{adminData.summary.spots}</strong><small>Nodes cadastrados</small></article>
      </div>

      <section className="studies-panel" aria-labelledby="studies-list-title">
        <div className="studies-panel-heading"><div><h2 id="studies-list-title">Estudos importados</h2><p>Pacotes HRC armazenados; publique somente após revisar.</p></div><span>{adminData.summary.studies} {adminData.summary.studies === 1 ? "estudo" : "estudos"}</span></div>
        {adminData.studies.length > 0 ? <div className="studies-table-scroll"><table className="studies-table">
          <thead><tr><th>Nome</th><th>Modelo</th><th>Mesa</th><th>Stack</th><th>Ante</th><th>Spots</th><th>Status</th><th>Importado em</th><th>Ações</th></tr></thead>
          <tbody>{adminData.studies.map((study) => <tr key={study.id}>
            <td data-label="Nome"><b>{study.name}</b><small>HRC · Pré-flop</small></td>
            <td data-label="Modelo">{modelLabels[study.equityModel]}</td>
            <td data-label="Mesa">{study.playersCount}-max</td>
            <td data-label="Stack">{study.stackBb === null ? "—" : `${formatNumber(study.stackBb)} BB`}</td>
            <td data-label="Ante">{study.anteType === "NONE" ? anteLabels.NONE : `${anteLabels[study.anteType]} ${formatNumber(study.anteBb)} BB`}</td>
            <td data-label="Spots">{study.spotCount}</td>
            <td data-label="Status"><span className={`study-status ${study.isPublished ? "active" : "inactive"}`}><i />{study.status === "PUBLISHED" ? "Publicado" : study.status === "ARCHIVED" ? "Arquivado" : "Importado"}</span></td>
            <td data-label="Importado em">{formatDate(study.importedAt)}</td>
            <td data-label="Ações"><div className="study-actions" aria-label={`Ações para ${study.name}`}><Button type="button" variant="ghost" size="sm" onClick={() => openInventory(study)}>Visualizar</Button><Button type="button" variant="outline" size="sm" loading={updatingStudyId === study.id} onClick={() => updatePublication(study)}>{study.isPublished ? "Despublicar" : "Publicar"}</Button><Button type="button" variant="danger" size="sm" disabled={study.isPublished || study.status === "PUBLISHED"} title={study.isPublished || study.status === "PUBLISHED" ? "Despublique o estudo antes de excluir." : undefined} onClick={() => { setDeleteConfirmation(""); setDeletingStudy(study); }}>Excluir</Button></div></td>
          </tr>)}</tbody>
        </table></div> : <div className="studies-empty">
          <EmptyState icon="upload" title="Nenhum estudo HRC importado ainda." description="Importe seu primeiro estudo e publique-o após a revisão para disponibilizar seus spots." actions={<Button type="button" variant="secondary" onClick={() => { setImportError(""); setImportOpen(true); }}><Icon name="upload"/>Importar estudo</Button>}/>
        </div>}
      </section>
    </PageContainer>

    {importOpen && <Modal titleId="import-title" descriptionId="import-description" onClose={() => setImportOpen(false)} className="admin-modal-system">
      <section className="admin-modal-content">
        <div className="admin-modal-icon" aria-hidden="true">⇧</div>
        <span>IMPORTAÇÃO HRC</span>
        <h2 id="import-title">Importar estudo</h2>
        <p id="import-description">Selecione o ZIP gerado em <b>Export Strategies → Complete Export</b>. O estudo, seus nodes e todas as estratégias compatíveis serão salvos.</p>
        {importError && <StatusMessage tone="error">{importError}</StatusMessage>}
        <label className={`admin-modal-confirm ${importing ? "loading" : ""}`}>
          {importing ? "Processando e salvando…" : "Selecionar arquivo .zip"}
          <input type="file" accept=".zip,application/zip" disabled={importing} onChange={importStudy}/>
        </label>
      </section>
    </Modal>}

    {inventoryStudy && <Modal titleId="inventory-title" descriptionId="inventory-description" onClose={() => setInventoryStudy(null)} className="study-inventory-modal">
      <section className="study-inventory-content">
        <header>
          <span>INVENTÁRIO DO ESTUDO</span>
          <h2 id="inventory-title">{inventory?.study.displayName || inventoryStudy.name}</h2>
          <p id="inventory-description">Spots reais importados do Complete Export, sem carregar as estratégias individuais.</p>
        </header>
        {inventoryError && <StatusMessage tone="error">{inventoryError}</StatusMessage>}
        {inventory && <>
          <dl className="study-inventory-header">
            <div><dt>Modelo</dt><dd>{modelLabels[inventory.study.equityModel]}</dd></div>
            <div><dt>Mesa</dt><dd>{inventory.study.playersCount}-max</dd></div>
            <div><dt>Stack</dt><dd>{inventory.study.stackBb === null ? "Variado" : `${formatNumber(inventory.study.stackBb)} BB`}</dd></div>
            <div><dt>Blinds</dt><dd>{formatNumber(inventory.study.smallBlind)} / {formatNumber(inventory.study.bigBlind)}</dd></div>
            <div><dt>Ante/BBA</dt><dd>{inventory.study.anteType === "NONE" ? "Sem ante" : `${anteLabels[inventory.study.anteType]} ${formatNumber(inventory.study.ante)}`}</dd></div>
            <div><dt>Importado</dt><dd>{formatDate(inventory.study.importedAt)}</dd></div>
            <div><dt>Status</dt><dd>{inventory.study.isPublished ? "Publicado" : inventory.study.status === "ARCHIVED" ? "Arquivado" : "Importado"}</dd></div>
            <div><dt>Versão</dt><dd>v{inventory.study.validationVersion ?? "—"} · {inventory.study.importerVersion ?? "legado"}</dd></div>
            <div><dt>Source nodes</dt><dd>{inventory.study.sourceNodeCount}</dd></div>
            <div><dt>Training nodes</dt><dd>{inventory.study.trainingNodeCount}</dd></div>
            <div><dt>Classes de mão armazenadas</dt><dd>{inventory.study.storedHandClassCount}</dd></div>
            <div><dt>Classes elegíveis para treino</dt><dd>{inventory.study.eligibleTrainingHandClassCount}</dd></div>
          </dl>
          <div className="study-inventory-groups">
            <section><h3>Por tipo</h3><div>{inventory.countsByType.map((row) => <span key={row.trainingType}><b>{trainingTypeLabels[row.trainingType]}</b>{row.count}</span>)}</div></section>
            <section><h3>Por posição do Hero</h3><div>{inventory.countsByPosition.map((row) => <span key={row.heroPosition}><b>{row.heroPosition}</b>{row.count}</span>)}</div></section>
          </div>
          <div className="study-inventory-filters">
            <label>Tipo<select value={inventoryFilters.trainingType} onChange={(event) => updateInventoryFilters((current) => ({ ...current, trainingType: event.target.value as TrainingType | "", page: 1 }))}><option value="">Todos</option>{inventory.filters.trainingTypes.map((type) => <option value={type} key={type}>{trainingTypeLabels[type]}</option>)}</select></label>
            <label>Hero<select value={inventoryFilters.heroPosition} onChange={(event) => updateInventoryFilters((current) => ({ ...current, heroPosition: event.target.value, page: 1 }))}><option value="">Todas</option>{inventory.filters.heroPositions.map((position) => <option value={position} key={position}>{position}</option>)}</select></label>
            <label>Busca<input value={inventoryFilters.search} maxLength={80} placeholder="Posição ou sequência" onChange={(event) => updateInventoryFilters((current) => ({ ...current, search: event.target.value, page: 1 }))}/></label>
          </div>
          <div className="study-inventory-spots" aria-busy={inventoryLoading || undefined}>
            {inventory.spots.map((spot) => <article key={spot.id}>
              <header><div><b>{spot.signature}</b><small>{spot.storedHandClassCount} classes armazenadas · {spot.eligibleTrainingHandClassCount} elegíveis para treino · {spot.actionCount} ações {spot.hasMixedStrategies ? "· possui estratégias mistas" : ""}</small></div><span>{trainingTypeLabels[spot.trainingType]}</span></header>
              <p><strong>Ações:</strong> {spot.availableActions.map((action) => actionLabel(action, spot)).join(" / ")}</p>
              {spot.actionSequence.length > 0 && <details><summary>Sequência anterior ({spot.actionSequence.length})</summary><ol>{spot.actionSequence.map((action, index) => <li key={`${action.position ?? "action"}-${index}`}>{action.position ?? `Ação ${index + 1}`}: {sequenceActionLabel(action, index, spot.actionSequence)}</li>)}</ol></details>}
            </article>)}
            {!inventoryLoading && inventory.spots.length === 0 && <p className="study-inventory-empty">Nenhum spot corresponde aos filtros.</p>}
          </div>
          <footer className="study-inventory-pagination"><span>{inventory.pagination.total} spots · página {inventory.pagination.page} de {inventory.pagination.pages}</span><div><Button type="button" size="sm" variant="ghost" disabled={inventoryLoading || inventory.pagination.page <= 1} onClick={() => updateInventoryFilters((current) => ({ ...current, page: current.page - 1 }))}>Anterior</Button><Button type="button" size="sm" variant="ghost" disabled={inventoryLoading || inventory.pagination.page >= inventory.pagination.pages} onClick={() => updateInventoryFilters((current) => ({ ...current, page: current.page + 1 }))}>Próxima</Button></div></footer>
        </>}
        {inventoryLoading && !inventory && <div className="study-inventory-loading" role="status">Carregando inventário…</div>}
      </section>
    </Modal>}

    {deletingStudy && <Modal titleId="delete-study-title" descriptionId="delete-study-description" onClose={() => { if (!deleting) setDeletingStudy(null); }} className="admin-modal-system">
      <section className="admin-modal-content study-delete-content">
        <span>EXCLUSÃO PERMANENTE</span>
        <h2 id="delete-study-title">Excluir {deletingStudy.name}?</h2>
        <p id="delete-study-description">Os nodes, a árvore fonte e as estratégias importadas serão removidos. Esta ação só é permitida sem publicação e sem histórico de treinamento.</p>
        <label>Digite o nome do estudo para confirmar<input autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)}/></label>
        <div><Button type="button" variant="ghost" disabled={deleting} onClick={() => setDeletingStudy(null)}>Cancelar</Button><Button type="button" variant="danger" loading={deleting} disabled={deleteConfirmation !== deletingStudy.name} onClick={confirmDelete}>Excluir estudo</Button></div>
      </section>
    </Modal>}
  </main>;
}

function formatAnte(report: HrcImportSummary) {
  if (report.anteType === "NONE") return "sem ante";
  return `${anteLabels[report.anteType]} ${formatNumber(report.anteBb)} BB`;
}
