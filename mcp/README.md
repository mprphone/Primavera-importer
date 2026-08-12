# Servidor MCP — mcp.mpr.pt

Liga o claude.ai (como "Connector" remoto) às tuas aplicações. Tem um Authorization
Server OAuth 2.1 próprio embutido (sem depender de Keycloak/Auth0) — só há um
utilizador (tu), com email/palavra-passe definidos em `.env`.

## O que já está feito

- **Authorization Server** (`lib/oauth-routes.mjs`, `lib/keys.mjs`, `lib/tokens.mjs`,
  `lib/clients-store.mjs`, `lib/grants-store.mjs`): regista clientes dinamicamente (via
  `POST /register`, RFC 7591) e também aceita clientes que aparecem diretamente em
  `/authorize` sem passar por `/register` primeiro (o claude.ai por vezes faz isto) —
  nesse caso o `client_id` usado é registado automaticamente na primeira vez. Exige
  PKCE (S256), emite access tokens (JWT, RS256, 1h) e refresh tokens (90 dias, com
  rotação).
- **Servidor MCP** (`server.mjs`, `mcpServer.mjs`): expõe `/mcp`, protegido por
  Bearer token.
- **Ferramentas do primavera-importer** (`tools/primavera-purchases.mjs`):
  - `primavera_listar_empresas`
  - `primavera_listar_faturas_compras` (filtra por estado/mês/fornecedor)
  - `primavera_obter_detalhe_fatura`
  - `primavera_validar_fatura_manualmente`

  Lêem e escrevem os mesmos dados que a app mostra (via `/api/primavera/store/*` em
  pri.mpr.pt) — nada de dados duplicados.

## Testado localmente

Registo de cliente, login, PKCE, troca de código por token, e chamadas reais a
`primavera_listar_empresas` / `primavera_listar_faturas_compras` contra os dados
verdadeiros do primavera-importer — tudo a funcionar antes de qualquer deployment.

## Configurar

```bash
cd mcp
cp .env.example .env
# edita o .env: MCP_SERVER_URL, MCP_OWNER_EMAIL, MCP_OWNER_PASSWORD
npm install
npm run dev   # testar localmente na porta 4200
```

## Publicar em mcp.mpr.pt (Oracle Cloud, mesmo padrão do pri.mpr.pt)

```bash
sudo cp deploy/mcp.mpr.pt.nginx.conf /etc/nginx/sites-available/mcp.mpr.pt
sudo ln -s /etc/nginx/sites-available/mcp.mpr.pt /etc/nginx/sites-enabled/mcp.mpr.pt
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mcp.mpr.pt

sudo cp deploy/mcp-mpr.service /etc/systemd/system/mcp-mpr.service
sudo systemctl daemon-reload
sudo systemctl enable --now mcp-mpr.service
sudo systemctl status mcp-mpr.service
```

## Adicionar o conector no claude.ai

1. claude.ai → **Definições → Conectores → Adicionar conector personalizado**.
2. URL: `https://mcp.mpr.pt/mcp`
3. O claude.ai descobre sozinho os requisitos OAuth (via
   `/.well-known/oauth-protected-resource`), regista-se como cliente, e abre o
   formulário de login deste servidor — usa o email/palavra-passe do `.env`.
4. Depois de autorizado, podes perguntar coisas como:
   - "Quantas faturas de compras da Jactigas estão por confirmar?"
   - "Mostra-me o detalhe da fatura FAC 26/18 da Jactigas"
   - "Valida manualmente a fatura X da empresa Y, o motivo é [...]"

## Adicionar outra aplicação (ex.: Gestao_SAFT_MPR_v1)

1. Cria `tools/<app>-<dominio>.mjs` com as funções que chamam a API real dessa app.
2. Regista as ferramentas em `mcpServer.mjs` com um prefixo próprio (ex.: `saft_...`)
   para não colidir com as `primavera_...`.
3. Não é preciso mexer no Authorization Server — é o mesmo login para todas as apps.

## Segurança

- `runtime/` (chaves de assinatura, clientes registados, códigos/tokens) nunca é
  commitado — está no `.gitignore` da raiz do repositório.
- Só há um utilizador. Não há gestão de permissões por ferramenta — quem entra
  com o login vê e pode alterar tudo o que as ferramentas expõem.
- `primavera_validar_fatura_manualmente` escreve dados reais (a mesma ação que
  "Validar e passar a verde" na app) — pede sempre confirmação antes de a
  invocares numa conversa, tal como farias na app.
