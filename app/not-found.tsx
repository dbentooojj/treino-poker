import AppHeader from "../components/ui/AppHeader";
import { ButtonLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, PageContainer, Panel } from "../components/ui/Primitives";

export default function NotFound() {
  return <main className="member-shell system-page">
    <AppHeader user={null}/>
    <PageContainer width="compact">
      <Panel>
        <EmptyState icon="info" title="Esta página não existe." description="O endereço pode ter mudado ou não fazer parte do RangeLab." actions={<ButtonLink href="/" variant="primary"><Icon name="home"/>Voltar ao início</ButtonLink>}/>
      </Panel>
    </PageContainer>
  </main>;
}
