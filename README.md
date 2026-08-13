# RangeLab

Aplicação Next.js para importar soluções HRC e treinar decisões pré-flop. A execução principal é formada por Caddy, aplicação Node.js e PostgreSQL em containers Docker.

## Arquitetura

```text
Internet / localhost
        ↓
      Caddy
        ↓  rede frontend
   Next.js (Node)
        ↓  rede backend interna
    PostgreSQL
```

O PostgreSQL não publica porta no `docker-compose.yml`. Somente Caddy expõe 80/443. A aplicação participa das duas redes; o banco participa apenas da rede interna.

O fluxo HRC permanece:

```text
ZIP → memória → SHA-256 + parser HRC → transação PostgreSQL
                                      ├─ training_sets
                                      ├─ training_nodes
                                      └─ training_hands
```

O ZIP não é preservado. O banco recebe os dados normalizados, o hash e metadados relevantes. A importação termina na área administrativa, com `status=IMPORTED` e `is_published=false`; ela não cria uma sessão nem inicia um exercício.

## Configuração

Copie `.env.example` para `.env`. Em produção, substitua `POSTGRES_PASSWORD`, configure a origem pública HTTPS, o domínio do Caddy e o provedor de e-mail antes de liberar tráfego:

```powershell
Copy-Item .env.example .env
```

Variáveis:

| Variável | Uso |
|---|---|
| `POSTGRES_DB` | Nome do banco criado pelo container |
| `POSTGRES_USER` | Usuário do PostgreSQL |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL; troque o valor de exemplo |
| `DATABASE_URL` | Conexão usada ao executar Next/migrations diretamente no host |
| `DATABASE_POOL_SIZE` | Máximo de conexões da aplicação por instância |
| `APP_BASE_URL` | Origem pública confiável; HTTPS obrigatório em produção |
| `SITE_ADDRESS` | Domínio público do Caddy em produção |
| `ALLOW_INSECURE_LOCAL_HTTP` | Somente teste Docker local: permite HTTP para `localhost` ou IP privado; não habilita HTTP público |
| `HTTP_PORT` / `HTTPS_PORT` | Portas publicadas pelo Caddy |
| `RESEND_API_KEY` / `EMAIL_FROM` | Confirmação de cadastro e recuperação de senha por e-mail; obrigatórias em produção |

Dentro do Compose, `DATABASE_URL` é montada a partir de `POSTGRES_*` e aponta para o hostname interno `postgres`. Nenhuma credencial fica no código-fonte.

Para testar a imagem de produção localmente por HTTP, use `APP_BASE_URL=http://localhost` (ou um IP privado), `SITE_ADDRESS=:80` e `ALLOW_INSECURE_LOCAL_HTTP=true`. Em uma implantação pública, remova esse opt-in e configure HTTPS/443 e o provedor de e-mail.

## Inicialização com Docker

```bash
docker compose up -d --build
docker compose ps -a
```

A ordem é automática:

1. `postgres` fica saudável;
2. `migrate` aplica as migrations e encerra com código 0;
3. `app` inicia e passa no healthcheck;
4. `caddy` começa a encaminhar as requisições.

Acesse a origem configurada em `APP_BASE_URL`. O endpoint `GET /api/health` valida o banco e recusa configuração de produção sem HTTPS ou sem o provedor de recuperação.

Parar e subir novamente não apaga dados:

```bash
docker compose down
docker compose up -d
```

Não use `docker compose down -v` se quiser preservar `postgres_data`.

### Provisionamento do administrador inicial

Cadastros feitos pela aplicação sempre recebem o papel `user`. Na stack Docker, execute o serviço operacional one-shot, que possui acesso apenas à rede interna do banco:

```powershell
$env:ADMIN_NAME="Operador"
$env:ADMIN_EMAIL="operador@example.com"
$env:ADMIN_PASSWORD="uma senha forte!"
docker compose --profile ops run --rm -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD admin-create
```

Ao executar diretamente no host com um `DATABASE_URL` seguro, o comando equivalente é:

```powershell
$env:ADMIN_NAME="Operador"
$env:ADMIN_EMAIL="operador@example.com"
$env:ADMIN_PASSWORD="uma senha forte!"
npm run admin:create
```

O comando usa `DATABASE_URL`, aceita somente o primeiro administrador e falha se um admin já existir.

## Desenvolvimento no host

O arquivo principal não expõe o banco. Para executar `npm run dev` no host, use o override que limita PostgreSQL ao loopback:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres migrate
npm install
npm run dev
```

Neste modo, `DATABASE_URL` de `.env` deve usar `localhost`. O bind `127.0.0.1` não expõe PostgreSQL na rede externa.

## Migrations

O schema é mantido em `db/schema.ts`, e migrations versionadas ficam em `drizzle/`.

```bash
npm run db:generate  # gera uma migration após alterar o schema
npm run db:migrate   # aplica migrations usando DATABASE_URL
npm run start        # inicia um build Next.js existente
```

Não há criação ou alteração de tabela em runtime. O serviço `migrate` é a única etapa de schema do Compose, evitando que o app consulte colunas ainda não aplicadas.

O upgrade que introduz os backfills de treino deve ser aplicado em janela de manutenção: faça backup, pare `caddy` e `app`, execute `docker compose run --rm migrate`, valide o resultado e só então suba os serviços novamente. Isso evita escritas concorrentes enquanto os contadores e filas históricas são reconciliados.

## Schema PostgreSQL

| Tabela | Finalidade e relações principais |
|---|---|
| `users` | Contas com papel `admin`/`user` |
| `sessions` | Sessões autenticadas; FK para `users` com cascade |
| `password_reset_tokens` | Tokens de redefinição; FK para `users` |
| `auth_rate_limits` | Limites de tentativas de autenticação |
| `training_sets` | Solução HRC; `content_hash` único, estado de publicação, ordenação e JSONB metadata |
| `training_nodes` | Spots; FK `training_set_id`, chave única `(training_set_id,node_key)` e campos JSONB |
| `training_hands` | Classes de mão do node; FK `training_node_id`, unique `(training_node_id,hand_class)` e JSONB |
| `training_sessions` | Progresso; FKs para `users` e para o `training_set` efetivamente utilizado |

Identificadores de entidades usam UUID. Datas usam `timestamp with time zone`. Estratégias, EVs, ações e metadados usam `jsonb`. Índices cobrem publicação, filtros de treino, relações e histórico do usuário.

## Publicação e isolamento

Somente conjuntos que satisfaçam simultaneamente `status=PUBLISHED` e `is_published=true` aparecem nas opções dos alunos. A administração oferece publicar/despublicar depois da importação.

Ao iniciar um treino, a consulta primeiro fixa um único conjunto publicado pela prioridade (`display_order`, importação e id), escolhe um node desse conjunto e carrega mãos exclusivamente por `training_node_id`. Uma mão nunca é buscada globalmente apenas por `hand_class`.

## Verificações

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run build
docker compose --profile test run --rm --build integration
```

A integração cria bancos temporários isolados no próprio PostgreSQL e os remove ao terminar. Além da instalação limpa, ela prova o upgrade `0000 → 0004`, preserva resumos históricos sem inventar respostas e valida os limites de fila. Também cobre importação real de ZIP, SHA-256/duplicidade, FKs, rollback total, publicação e isolamento set → node → hand.

## Migração de D1

Não há migração de dados antigos: o PostgreSQL começa limpo e os ZIPs úteis devem ser reimportados. Foram removidos bindings D1, `env.DB`, tipos Workers, Wrangler, Vinext, Vite/Cloudflare, configuração Sites e migrations SQLite. O parser HRC foi preservado sem reescrita.
