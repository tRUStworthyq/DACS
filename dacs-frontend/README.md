# DACS Frontend

React + TypeScript + Vite frontend for DACS. The UI is connected to the existing Core API through the existing Gateway; Keycloak authentication remains unchanged.

## Run with Docker Compose

From the repository root:

```bash
docker compose -f infra/docker-compose.dev.yml up -d --build
```

Open `http://localhost:8765/`. Gateway serves the UI and routes `/api/**` to Core using the browser's Gateway session. After sign-in through Keycloak, Gateway returns the current tab to `/`.

## Run with Vite

Requirements: Node.js 20+ and npm. Start the backend stack first. Gateway should be available at `http://localhost:8765`.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Local proxy and authentication

No CORS or Java backend changes are required for local development. Vite proxies browser requests to Gateway at `http://localhost:8765`:

- `/api/**` → Gateway / Core API
- `/oauth2/**` → Gateway OAuth2 authorization endpoints
- `/login/oauth2/**` → Gateway OAuth2 callback
- `/logout` → Gateway logout route

The browser sends requests to the Vite origin. The API client includes credentials and does not follow an OAuth redirect inside an API fetch. To sign in, open `/login` and click **Войти через Keycloak**. Gateway starts the existing OAuth2 flow. After sign-in, Gateway opens its home page at `http://localhost:8765/`.

## Connected Core endpoints

### Sources and implementations

- `GET /api/sources?page=0` — source type catalogue (`Page<SourceResponse>`).
- `GET /api/impls?page=0` — all implementation configurations (`Page<ImplResponse>`).
- `GET /api/impls/by-source/{sourceId}?page=0` — implementations filtered by source type.
- `GET /api/impls/{id}` — one implementation (details dialog).
- `POST /api/impls` — create an implementation with `{ name, config, state, sourceId }`.
- `PUT /api/impls/{id}` — update `{ name, config, state }`. The source type is immutable through this request and is therefore not offered in the edit form.
- `DELETE /api/impls/{id}` — delete an implementation (HTTP 204).
- `POST /api/collect/{id}/run` — request collection (HTTP 202).

`config` is sent as a JSON string, matching the current DTO. The create/edit forms validate JSON syntax locally. Connector-specific fields are not guessed.

The launch endpoint returns a `requestId` and opens the status view for that run. The run picker uses `GET /api/collect/{implId}/runs?offset=0&limit=25`, scoped to the selected connection and user. The UI polls run status while it is queued or running.

### Reports, tree and archive

- File scores come from `GET /api/collect/runs/{requestId}/aging`.
- Personal-data reports use `GET /api/collect/runs/{requestId}/pii/summary` and `/pii/files`.
- The S3 tree uses the stored metadata endpoints under `/api/impls/{id}/s3/buckets`, one folder level and page at a time.
- Archive actions use `/api/impls/{id}/s3/archive`. Creating a copy and deleting both the source and archive copy require explicit confirmation in the UI.

### Chats and messages

- `GET /api/chats?limit=20&cursor=...` — cursor-paginated chats.
- `POST /api/chats` — create a chat and its first user message using `{ content }`.
- `GET /api/chats/{chatId}` — get chat details.
- `DELETE /api/chats/{chatId}` — delete a chat and its messages (HTTP 204).
- `GET /api/chats/{chatId}/messages?limit=40&cursor=...` — cursor-paginated history.
- `POST /api/chats/{chatId}/messages` — send a message using `{ content, requestId? }`. The optional ID attaches a completed run.
- `PATCH /api/chats/{chatId}/messages/{messageId}` — edit a user message using `{ content }`.
- `DELETE /api/chats/{chatId}/messages/{messageId}` — soft-delete a message (HTTP 204).

The UI uses `POST /api/chats/stream` for the first message and `POST /api/chats/{chatId}/messages/stream` for subsequent messages. Both accept `{ content, requestId? }`. A completed run may be attached to either request. The SSE response carries `phase`, `delta`, `done`, and `error` events. A `done` event includes the chat ID after the user message and agent reply are persisted. The existing non-streaming endpoints are available for other clients. Editing a message soft-deletes later messages in the conversation.

## Build

```bash
npm run build
npm run preview
```

## Configuration

Local development uses the Vite proxy and does not use `VITE_API_BASE_URL`. For a separately deployed frontend, set `VITE_API_BASE_URL` to the Gateway origin and configure its CORS/session-cookie policy for that deployment.

## Registration

The `/register` page opens the existing Gateway OAuth2 entry point in the current tab. When self-registration is enabled in Keycloak realm `DACS`, the Keycloak login page displays its built-in Register link. The frontend does not create a local password or store credentials.

To enable registration in an existing local Keycloak realm, run from the DACS repository root:

```bash
bash infra/keycloak/enable-registration.sh
```

The archive also includes `README-KEYCLOAK-REGISTRATION.md` with the full local setup instructions. The Keycloak realm import file sets `registrationAllowed: true` for future fresh imports.

`VITE_GATEWAY_ORIGIN` defaults to `http://localhost:8765` in Vite development. The Compose build uses a same-origin login URL.
