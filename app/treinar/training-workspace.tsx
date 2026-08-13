"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "../../db/auth";
import type { TrainingReport, TrainingSession } from "../../lib/training";
import MemberHeader from "../member-header";
import { DatabaseTrainer, TrainingQuickSetup, TrainingReportView } from "../training-experience";

const LAST_TRAINING_SESSION_KEY = "rangelab:last-training-session";

export default function TrainingWorkspace({ user }: { user: AuthUser }) {
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function restoreTraining() {
      try {
        let restored = false;
        const savedSessionId = window.sessionStorage.getItem(LAST_TRAINING_SESSION_KEY);
        if (savedSessionId && /^[0-9a-f-]{36}$/i.test(savedSessionId)) {
          const savedResponse = await fetch(`/api/training/session?id=${encodeURIComponent(savedSessionId)}`, { cache: "no-store", signal: controller.signal });
          if (savedResponse.ok) {
            const savedData = await savedResponse.json() as { session?: TrainingSession; report?: TrainingReport };
            if (!controller.signal.aborted && savedData.session) setSession(savedData.session);
            if (!controller.signal.aborted && savedData.report) setReport(savedData.report);
            restored = Boolean(savedData.session || savedData.report);
          }
          if (!restored) window.sessionStorage.removeItem(LAST_TRAINING_SESSION_KEY);
        }
        if (!restored) {
          const activeResponse = await fetch("/api/training/session?active=1", { cache: "no-store", signal: controller.signal });
          const activeData = activeResponse.ok ? await activeResponse.json() as { session: TrainingSession | null } : { session: null };
          if (!controller.signal.aborted && activeData.session) {
            setSession(activeData.session);
            window.sessionStorage.setItem(LAST_TRAINING_SESSION_KEY, activeData.session.id);
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSession(null);
          setReport(null);
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    void restoreTraining();
    return () => controller.abort();
  }, []);

  function rememberTraining(nextSession: TrainingSession) {
    window.sessionStorage.setItem(LAST_TRAINING_SESSION_KEY, nextSession.id);
    setReport(null);
    setSession(nextSession);
  }

  function leaveTraining() {
    window.sessionStorage.removeItem(LAST_TRAINING_SESSION_KEY);
    setSession(null);
    setReport(null);
  }

  if (report) return <TrainingReportView report={report} user={user} onExit={leaveTraining} onStarted={rememberTraining}/>;

  return <main className={`member-shell training-hub-shell spot-mode ${session ? "spot-session-mode" : ""}`}>
    <MemberHeader user={user} active="training"/>
    <section className="training-hub" aria-label="Treinamento">
      {restoring ? <div className="training-restore-state" role="status"><i/><span>Retomando sua última sessão…</span></div> : session ? <DatabaseTrainer key={session.id} session={session} onReport={setReport}/> : <div className="training-lobby">
        <TrainingQuickSetup onStarted={rememberTraining}/>
      </div>}
    </section>
  </main>;
}
