import { headers } from "next/headers";
import Link from "next/link";
import MemberHeader from "../member-header";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const { getSessionUser } = await import("../../db/auth");
  const requestHeaders = await headers();
  const user = await getSessionUser(new Request("http://localhost/suporte", { headers: requestHeaders }));

  return <main className="member-shell">
    <MemberHeader user={user} active="support" />
    <section className="member-content support-content">
      <div className="member-heading"><span>CENTRAL DE AJUDA</span><h1>Como podemos ajudar?</h1><p>Encontre respostas rápidas sobre sua conta, acesso e treinamentos.</p></div>

      <div className="support-shortcuts">
        <a href="#conta"><i aria-hidden="true">U</i><div><b>Conta e acesso</b><span>Login, senha e dados pessoais</span></div><em>↓</em></a>
        <a href="#treinos"><i aria-hidden="true">♠</i><div><b>Treinamentos</b><span>Estudos, spots e resultados</span></div><em>↓</em></a>
        <a href="#privacidade"><i aria-hidden="true">◇</i><div><b>Privacidade</b><span>Sessões e segurança</span></div><em>↓</em></a>
      </div>

      <div className="support-layout">
        <section className="faq-card" aria-labelledby="faq-title">
          <div className="faq-heading"><span>PERGUNTAS FREQUENTES</span><h2 id="faq-title">Respostas diretas</h2></div>
          <div id="conta" className="faq-group"><h3>Conta e acesso</h3>
            <details><summary>Como altero meu nome ou e-mail?</summary><p>Acesse <Link href="/conta">Minha conta</Link>. O nome pode ser atualizado diretamente; para trocar o e-mail, confirme sua senha atual.</p></details>
            <details><summary>Esqueci minha senha. O que fazer?</summary><p>Use a página de <Link href="/recuperar-senha">recuperação de senha</Link> para gerar um link seguro.</p></details>
            <details><summary>Como troco minha senha?</summary><p>Na área <Link href="/conta">Minha conta</Link>, informe sua senha atual e escolha uma nova. As sessões antigas serão encerradas.</p></details>
          </div>
          <div id="treinos" className="faq-group"><h3>Treinamentos</h3>
            <details><summary>Por que algumas configurações não aparecem?</summary><p>O RangeLab mostra apenas combinações que possuem estudos HRC compatíveis importados no banco.</p></details>
            <details><summary>De onde vêm as respostas dos spots?</summary><p>As frequências, ações e EVs são lidos dos estudos persistidos. O treino não inventa a estratégia correta.</p></details>
          </div>
          <div id="privacidade" className="faq-group"><h3>Privacidade e segurança</h3>
            <details><summary>O que acontece quando troco a senha?</summary><p>Todas as sessões ativas são encerradas. Você precisará entrar novamente com a nova senha.</p></details>
          </div>
        </section>

        <aside className="support-contact">
          <span>AINDA PRECISA DE AJUDA?</span><h2>Fale com o suporte</h2><p>Envie sua dúvida com o máximo de contexto possível. Evite incluir senhas ou dados sensíveis.</p>
          <a href="mailto:suporte@rangelab.com?subject=Ajuda%20com%20o%20RangeLab">Enviar e-mail <span>→</span></a>
          <small>Nunca envie sua senha ou dados de pagamento.</small>
        </aside>
      </div>
    </section>
  </main>;
}
