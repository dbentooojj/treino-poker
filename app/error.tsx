"use client";

import { useEffect } from "react";
import AppHeader from "../components/ui/AppHeader";
import { Button, ButtonLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, PageContainer, Panel } from "../components/ui/Primitives";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="member-shell system-page">
    <AppHeader user={null}/>
    <PageContainer width="compact">
      <Panel>
        <EmptyState icon="alert" title="Não foi possível carregar esta página." description="O problema pode ser temporário. Tente novamente sem perder o contexto atual." actions={<><Button type="button" onClick={retry}><Icon name="refresh"/>Tentar novamente</Button><ButtonLink href="/" variant="ghost">Voltar ao início</ButtonLink></>}/>
      </Panel>
    </PageContainer>
  </main>;
}
