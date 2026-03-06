# Lembretes NOC - v1.2

Aplicacao de lembretes para operacao NOC com frontend web, backend Node/SQLite, autenticacao JWT e centro de notificacoes em tempo real.

## Principais capacidades
- Cadastro e login de usuarios (`/api/v1/auth/register`, `/api/v1/auth/login`)
- Login admin (seed configuravel via `.env`, padrao `admin/admin`)
- Lembretes, pacotes, logs e scheduler remoto
- Notificacoes administrativas em tempo real via WebSocket (`/api/v1/ws`)
- Sino com contador de nao lidas + dropdown com ultimas 10
- Pagina completa de notificacoes com filtro e paginacao
- Painel admin para listar usuarios e enviar notificacoes para multiplos destinatarios

## Arquitetura
- `gateway` (Nginx): serve frontend e encaminha `/api` para API
- `api` (Express + SQLite): auth, CRUD, scheduler, notificacoes admin e WS
- `SQLite`: persistencia em volume Docker (`noc_data`)

## Requisitos
- Docker + Docker Compose (recomendado)
- Node.js 18+ (opcional para execucao sem Docker)

## Subir com Docker (recomendado)
1. Ajuste variaveis:
```bash
cp .env.example .env
```
2. Edite `.env` com foco em:
- `JWT_SECRET` (obrigatorio usar segredo forte)
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `APP_ORIGIN`
3. Suba:
```bash
docker compose up -d --build
```
4. Acesse:
- App: `http://127.0.0.1:8080`
- API health: `http://127.0.0.1:8080/api/v1/health`

## Fluxo de acesso
- Usuario comum: `#/register` para criar conta, depois login em `#/login`
- Admin: login com credenciais definidas no `.env`
- Se ver tela antiga, use aba anonima ou hard refresh (`Ctrl+F5`)

## Execucao local (sem Docker)
1. Instale dependencias:
```bash
npm install
```
2. API:
```bash
npm run api
```
3. Frontend (outro terminal):
```bash
npm start
```
4. Acesse:
- Frontend: `http://127.0.0.1:8765`
- API: `http://127.0.0.1:3000/health`

## Testes
```bash
npm test
```

## Endpoints principais (v1)
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/notifications`
- `WS /api/v1/ws?token=<accessToken>`

## Estrutura principal
- `index.html`: shell da aplicacao
- `js/app.js`: orquestracao UI e fluxos
- `js/api.js`: cliente HTTP + auth + WS
- `api/src/*`: backend + SQLite + scheduler + WS
- `docker-compose.yml`: topologia de runtime
- `gateway/nginx.conf`: reverse proxy + hosting estatico
- `docs/audit/`: relatorios de auditoria
