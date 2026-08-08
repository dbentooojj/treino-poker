"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthUser } from "../../../db/auth";
import type { AdminStudy, StudiesAdminData } from "../../../db/studies";
import { parseHrcPack } from "../../../lib/hrc-import";

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
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");

  useEffect(() => {
    if (!importOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setImportOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [importOpen]);

  async function importStudy(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    setImportError("");
    setImportNotice("");
    try {
      const pack = await parseHrcPack(file);
      const response = await fetch("/api/studies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pack),
      });
      const result = await response.json() as { data?: StudiesAdminData; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || "Não foi possível salvar o estudo.");
      setAdminData(result.data);
      setImportNotice(`${pack.name} foi salvo no banco de dados e já está disponível para treino.`);
      setImportOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Não foi possível importar o estudo.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  return <main className="admin-shell">
    <header className="admin-topbar">
      <Link className="brand" href="/" aria-label="Voltar para o RangeLab">
        <span className="brand-mark">R</span><span>Range<span>Lab</span></span>
      </Link>
      <nav className="admin-nav" aria-label="Navegação administrativa">
        <Link className="active" href="/admin/studies">Estudos HRC</Link>
      </nav>
      <div className="admin-user">
        <span className="user-chip"><i>{user.name.charAt(0).toUpperCase()}</i><b>{user.name}</b><small>ADM</small></span>
        <Link href="/">Voltar ao site</Link>
      </div>
    </header>

    <section className="admin-content">
      <div className="admin-heading">
        <div><span>ADMINISTRAÇÃO</span><h1>Estudos HRC</h1><p>Gerencie os estudos utilizados nos treinamentos.</p></div>
        <button className="admin-import-button" onClick={() => { setImportError(""); setImportOpen(true); }}><span>＋</span> Importar estudo</button>
      </div>

      {importNotice && <div className="admin-import-notice" role="status"><span>✓</span>{importNotice}<button onClick={() => setImportNotice("")} aria-label="Fechar aviso">×</button></div>}

      <div className="admin-summary" aria-label="Resumo dos estudos">
        <article><span>ESTUDOS</span><strong>{adminData.summary.studies}</strong><small>Total cadastrado</small></article>
        <article><span>ATIVOS</span><strong>{adminData.summary.active}</strong><small>Disponíveis para treino</small></article>
        <article><span>SPOTS</span><strong>{adminData.summary.spots}</strong><small>Nodes cadastrados</small></article>
      </div>

      <section className="studies-panel" aria-labelledby="studies-list-title">
        <div className="studies-panel-heading"><div><h2 id="studies-list-title">Estudos importados</h2><p>Pacotes HRC disponíveis na plataforma.</p></div><span>{adminData.summary.studies} {adminData.summary.studies === 1 ? "estudo" : "estudos"}</span></div>
        {adminData.studies.length > 0 ? <div className="studies-table-scroll"><table className="studies-table">
          <thead><tr><th>Nome</th><th>Modelo</th><th>Mesa</th><th>Stack</th><th>Ante</th><th>Spots</th><th>Status</th><th>Importado em</th><th>Ações</th></tr></thead>
          <tbody>{adminData.studies.map((study) => <tr key={study.id}>
            <td><b>{study.name}</b><small>HRC · Pré-flop</small></td>
            <td>{modelLabels[study.equityModel]}</td>
            <td>{study.playersCount}-max</td>
            <td>{study.stackBb === null ? "—" : `${formatNumber(study.stackBb)} BB`}</td>
            <td>{study.anteType === "NONE" ? anteLabels.NONE : `${anteLabels[study.anteType]} ${formatNumber(study.anteBb)} BB`}</td>
            <td>{study.spotCount}</td>
            <td><span className={`study-status ${study.status === "ACTIVE" ? "active" : "inactive"}`}><i />{study.status === "ACTIVE" ? "Ativo" : "Inativo"}</span></td>
            <td>{formatDate(study.importedAt)}</td>
            <td><div className="study-actions" aria-label={`Ações para ${study.name}`}><button disabled title="Disponível na próxima etapa">Visualizar</button><button disabled title="Disponível na próxima etapa">{study.status === "ACTIVE" ? "Desativar" : "Ativar"}</button><button className="danger" disabled title="Disponível na próxima etapa">Excluir</button></div></td>
          </tr>)}</tbody>
        </table></div> : <div className="studies-empty">
          <div className="studies-empty-icon" aria-hidden="true"><span>HRC</span><i>＋</i></div>
          <h2>Nenhum estudo HRC importado ainda.</h2>
          <p>Importe seu primeiro estudo para disponibilizar spots nos treinamentos.</p>
          <button className="admin-import-button secondary" onClick={() => { setImportError(""); setImportOpen(true); }}>Importar estudo</button>
        </div>}
      </section>
    </section>

    {importOpen && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportOpen(false); }}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="admin-modal-close" onClick={() => setImportOpen(false)} aria-label="Fechar">×</button>
        <div className="admin-modal-icon" aria-hidden="true">⇧</div>
        <span>IMPORTAÇÃO HRC</span>
        <h2 id="import-title">Importar estudo</h2>
        <p>Selecione o ZIP gerado em <b>Export Strategies → Complete Export</b>. O estudo, seus nodes e todas as estratégias compatíveis serão salvos.</p>
        {importError && <div className="admin-import-error" role="alert">{importError}</div>}
        <label className={`admin-modal-confirm ${importing ? "loading" : ""}`}>
          {importing ? "Processando e salvando…" : "Selecionar arquivo .zip"}
          <input type="file" accept=".zip,application/zip" disabled={importing} onChange={importStudy}/>
        </label>
      </section>
    </div>}
  </main>;
}
