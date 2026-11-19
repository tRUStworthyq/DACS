# DACS Frontend

React + TypeScript + Vite frontend for DACS. The UI is connected to the existing Core API through the existing Gateway; Keycloak authentication remains unchanged.

## Run locally

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

The browser sends requests to the Vite origin. The API client includes credentials and does not follow an OAuth redirect inside an API fetch. To sign in, open `/login` and click **Войти через Keycloak**. Gateway starts the existing OAuth2 flow. After successful login, return to the DACS tab and retry the request if the screen was already open.

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

The run endpoint publishes an event to the configured Kafka topic and returns `202 Accepted`. This confirms request acceptance by Core, not completion of collection. The current `agents` repository contains only the application bootstrap and does not yet contain a Kafka consumer, so an end-to-end collection run is not currently demonstrated by this frontend integration.

### Chats and messages

- `GET /api/chats?limit=20&cursor=...` — cursor-paginated chats.
- `POST /api/chats` — create a chat and its first user message using `{ content }`.
- `GET /api/chats/{chatId}` — get chat details.
- `DELETE /api/chats/{chatId}` — delete a chat and its messages (HTTP 204).
- `GET /api/chats/{chatId}/messages?limit=40&cursor=...` — cursor-paginated history.
- `POST /api/chats/{chatId}/messages` — store a user message using `{ content }`.
- `PATCH /api/chats/{chatId}/messages/{messageId}` — edit a user message using `{ content }`.
- `DELETE /api/chats/{chatId}/messages/{messageId}` — soft-delete a message (HTTP 204).

The current chat endpoints store and return messages; they do not themselves generate AI responses. `POST /api/chats` creates the chat with the default title `New chat` and immediately saves the provided first message. Per current Core logic, editing a message soft-deletes all later messages in that conversation; the UI asks for confirmation before doing this.

## Sections without current Core endpoints

Policies, dependency graph, recommendations and archive are still shown as unavailable. No corresponding controllers/endpoints were found in the current Core repository. Storage-volume, freshness and recommendation metrics are not fabricated.

## Build

```bash
npm run build
npm run preview
```

## Configuration

Local development uses the Vite proxy and does not use `VITE_API_BASE_URL`. For a separately deployed frontend, set `VITE_API_BASE_URL` to the Gateway origin and configure its CORS/session-cookie policy for that deployment.

## Registration

The `/register` page opens the existing Gateway OAuth2 entry point in a new tab. When self-registration is enabled in Keycloak realm `DACS`, the Keycloak login page displays its built-in Register link. The frontend does not create a local password or store credentials.

To enable registration in an existing local Keycloak realm, run from the DACS repository root:

```bash
bash infra/keycloak/enable-registration.sh
```

The archive also includes `README-KEYCLOAK-REGISTRATION.md` with the full local setup instructions. The Keycloak realm import file sets `registrationAllowed: true` for future fresh imports.

`VITE_GATEWAY_ORIGIN` defaults to `http://localhost:8765` and is used for the external login/register tab. Override it for a different Gateway host.
