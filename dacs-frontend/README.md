# DACS Frontend

React + TypeScript + Vite frontend for DACS. The UI is connected to the existing Core API through the existing Gateway; Keycloak authentication remains unchanged.

## Run with Docker Compose

From the repository root:

```bash
docker compose -f infra/docker-compose.dev.yml up -d --build
```

Open `http://localhost:8765/`. Gateway serves the UI and routes `/api/**` to Core using the browser's Gateway session. After sign-in through Keycloak, Gateway returns the current tab to `/`.

## Collect from the filesystem

Docker Compose mounts the host path in `DACS_FILESYSTEM_DIRECTORY` read-only into
the agent. The current development Compose file defaults to `G:/`. If the agent
runs outside Docker, set `AGENTS_FILESYSTEM_ROOT` to the
directory it should scan. Use a dedicated directory containing files that users
of this deployment are allowed to scan.

In **Источники данных**, add a **Файловая система** connection. Enter a directory
relative to the mounted root, such as `reports/2026`, or enter `.` to scan the
entire root. Click **Запустить сбор** to collect metadata recursively. When
scanning the root, the agent skips the Windows system directories
`$RECYCLE.BIN` and `System Volume Information`.

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

### Document templates, dependencies and archive

- **Шаблоны документов** in the sidebar lists templates and provides create, edit, and delete actions. **Персональные данные** links to that screen and shows matches. All supplied conditions in a template are matched using case-insensitive substrings. Retention starts at the file's last modification and can be set in days or calendar years in UTC. Run collection again after creating or changing a content condition.
- The agent detects links in text files, PDFs with extractable text or link annotations, and Office Open XML files. The graph resolves references within the selected collection. Limits are 1 MiB for plain text, 8 MiB for PDF or Office input, and 300 PDF pages. If evidence for a supported file is incomplete, S3 deletion is blocked for that collection.
- **Косвенные связи** lists exact copies, documents with shared project, order or contract identifiers, and documents with shared text fragments. Similarity uses fingerprints from the selected collection and provides suggestions for review. The cascade follows direct references. Run a new collection to add fingerprints to older data.
- S3 archive actions enforce retention against the latest completed collection. A document that links to a protected document is also protected against deletion. Cascade deletes incoming dependents along with the selected document. Each affected file must have an archive entry and appear in the confirmation.
- The archive also accepts filesystem connections. Open a file in the dependency graph and choose **Архивировать**. Core validates it against the completed collection and writes a downloadable copy to `filesystem_archive_data`. The Compose mount for source files is read-only. Outside Compose, set `APP_FILESYSTEM_SOURCE_ROOT` to the same directory used by the agent and `APP_FILESYSTEM_ARCHIVE_ROOT` to a separate writable directory.
- File scores come from `GET /api/collect/runs/{requestId}/aging`. The recommendation list omits files with insufficient scoring data and files whose personal-data detection results require review.

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
