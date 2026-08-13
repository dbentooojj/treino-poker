"use client";

import { useState } from "react";
import AppHeader from "../../../components/ui/AppHeader";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Modal } from "../../../components/ui/Modal";
import { EmptyState, PageContainer, PageHeader, StatusMessage } from "../../../components/ui/Primitives";
import type { AuthUser } from "../../../db/auth";
import type { AdminStudy, StudiesAdminData } from "../../../db/studies";
import type { HrcImportSummary } from "../../../lib/hrc-import";

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

  return <main className="member-shell admin-shell">
    <AppHeader user={user} active="admin"/>
    <PageContainer>
      <PageHeader eyebrow="Administração" title="Estudos HRC" description="Gerencie os estudos utilizados nos treinamentos." action={<Button type="button" onClick={() => { setImportError(""); setImportOpen(true); }}><Icon name="upload"/>Importar estudo</Button>}/>

      {importReport && <StatusMessage className="admin-import-notice-system" tone="success"><div>
        <b>Importação concluída — {importReport.name}</b>
        <small>{modelLabels[importReport.equityModel]} · {importReport.playersCount}-max · {importReport.stackBb === null ? "stacks variados" : `${formatNumber(importReport.stackBb)} BB`} · {formatAnte(importReport)}</small>
        <small>{importReport.counts.PUSH_FOLD} Push/Fold · {importReport.counts.CALL_VS_SHOVE} Call vs Shove · {importReport.counts.OPEN_FOLD} Open/Fold · {importReport.counts.VS_OPEN} Vs Open</small>
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
            <td data-label="Ações"><div className="study-actions" aria-label={`Ações para ${study.name}`}><Button type="button" variant="ghost" size="sm" disabled title="Disponível na próxima etapa">Visualizar</Button><Button type="button" variant="outline" size="sm" loading={updatingStudyId === study.id} onClick={() => updatePublication(study)}>{study.isPublished ? "Despublicar" : "Publicar"}</Button><Button type="button" variant="danger" size="sm" disabled title="Disponível na próxima etapa">Excluir</Button></div></td>
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
  </main>;
}

function formatAnte(report: HrcImportSummary) {
  if (report.anteType === "NONE") return "sem ante";
  return `${anteLabels[report.anteType]} ${formatNumber(report.anteBb)} BB`;
}
