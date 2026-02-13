# YouTube Subscriptions Viewer — Rebuild Design

## Goal

Rebuild the app with a clean, modular architecture. Same features, better foundation. Motivated by the caching incident (duplicated API logic between test and production code wasted 8,000 quota units) and the frontend being three monolithic HTML files with no framework or tests.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | React + Vite | Modern component model, mature testing ecosystem, good long-term investment |
| Styling | CSS Modules | Scoped per-component, ports naturally from existing CSS, no runtime overhead |
| Routing | React Router (two routes) | `/` for feed, `/playlist` for player. Same mental model as current dual-page setup |
| Backend | Express (modularized) | Express is fine for this complexity. The problem was one 772-line file, not Express itself |
| Database | SQLite via better-sqlite3 | Already proven. Add sessions and quota tables |
| Testing | Vitest + React Testing Library | Fast, unified test runner for both backend and frontend |
| State management | React hooks + context | App state is simple enough — no Redux needed |
| Session persistence | SQLite-backed sessions | Survives server restarts, no new dependencies |

## Project Structure

```
youtube-subs-viewer/
  server/
    index.js                    Express app setup, server start
    routes/
      auth.js                   OAuth login/callback/status
      feed.js                   GET /api/feed, POST /api/feed/refresh
      playlist.js               ensure, add, remove, list items
      settings.js               GET/POST /api/settings
      quota.js                  GET /api/quota
    services/
      youtube.js                All YouTube Data API interactions (single source of truth)
      database.js               All SQLite queries, prepared statements
      session.js                SQLite-backed session store + middleware
      quota.js                  Budget tracking, canSpend, reset logic (persisted to SQLite)
      websocket.js              WS server setup, broadcast helper
    middleware/
      auth.js                   requireAuth middleware
  src/
    App.jsx
    pages/
      Feed.jsx                  Main subscription feed
      Playlist.jsx              Embedded player + sidebar
    components/
      TopBar.jsx
      FilterBar.jsx
      SettingsPanel.jsx
      VideoCard.jsx
      VideoGrid.jsx
      DateSeparator.jsx
      PlayerView.jsx
      PlaylistSidebar.jsx
      PlaylistItem.jsx
      Toast.jsx
    services/
      api.js                    All fetch calls to backend
      websocket.js              WS connection + message handling
    hooks/
      useWebSocket.js
      useSettings.js
      useFeed.js
      usePlaylist.js
    utils/
      format.js                 timeAgo, formatDuration, formatViews, escapeHtml
  tests/
    fixtures/
      real-responses.json       Captured real API responses (source of truth for mocks)
    helpers/
      mock-youtube.js           Mock YouTube client built from real fixtures
      mock-database.js          In-memory SQLite test database
    server/
      youtube.test.js           API service logic, quota enforcement, batching
      database.test.js          FK integrity, upsert, sort order, sessions
      quota.test.js             Budget tracking, reset, persistence
      routes/
        feed.test.js            Integration tests with supertest
        playlist.test.js        Integration tests with supertest
    src/
      components/
        VideoCard.test.jsx
        FilterBar.test.jsx
        SettingsPanel.test.jsx
      hooks/
        useFeed.test.js
      utils/
        format.test.js
  docs/
    plans/
  vite.config.js
  package.json
  .env.example
```

## Backend Services

### `server/services/database.js`

Owns all SQLite interactions. Consumers never write raw SQL.

Tables:
- `channels` — channel_id (PK), channel_name, uploads_playlist_id, last_checked, backfill_complete, next_page_token, total_results
- `videos` — video_id (PK), channel_id (FK → channels), title, channel_name, published, thumbnail, description, duration, views
- `sessions` — sid (PK), tokens_json, settings_json, created_at, last_used
- `quota_usage` — date (PK), units_used

Exports: `upsertChannel()`, `insertVideos()`, `getAllVideos()`, `getAllChannels()`, `getSession()`, `saveSession()`, `destroySession()`, `getQuotaUsage()`, `saveQuotaUsage()`

### `server/services/youtube.js`

Single source of truth for all YouTube Data API calls. Every function takes a `youtube` client as a parameter (dependency injection) for testability.

Exports: `fetchAllSubscriptions(youtube)`, `fetchChannelVideos(youtube, channel, db, quota)`, `enrichVideos(youtube, videos, quota)`, `backfillChannel(youtube, channel, db, quota)`

Key behaviors:
- Checks `quota.canSpend()` before every API call
- Incremental refresh: stops fetching when a known videoId is encountered
- Batches `videos.list` calls in groups of 50
- Always upserts channel before inserting its videos (FK integrity)

### `server/services/quota.js`

Persists quota tracking to SQLite (survives restarts).

Exports: `trackQuota(operation, units)`, `canSpend(units)`, `getStatus()`, `reset()`

Budget: 8,000 units/day (20% reserve of 10,000 hard limit). Resets at midnight Pacific.

### `server/services/session.js`

SQLite-backed session store replacing in-memory `Map()`.

Exports: `sessionMiddleware`, `createSession(tokens)`, `destroySession(sid)`, `getSession(sid)`

### `server/services/websocket.js`

Exports: `setupWebSocket(server)`, `broadcast(type, data)`

## Frontend Architecture

### State Management

Custom hooks + React context, no Redux:

- `useFeed()` — fetches from `/api/feed`, holds `allVideos` and `channels`, exposes `refresh()` and `getFilteredVideos(searchQuery, timeRange, durationFilter)`
- `usePlaylist()` — manages `playlistItems`, `queuedVideoIds`, exposes `addToQueue()`, `removeFromQueue()`
- `useSettings()` — loads/saves settings to backend, persists on change
- `useWebSocket()` — single WS connection via context, handles reconnection, dispatches messages

### Routing

React Router:
- `/` → `<Feed />`
- `/playlist` → `<Playlist />`

Both wrapped in `<AppProvider>` providing WebSocket context and auth state.

### Components

Presentational where possible. Pages wire hooks to components. Key components:

- `VideoCard` — thumbnail, title, channel, metadata, queue indicator. Click handlers via props.
- `VideoGrid` — renders list of VideoCards, supports list/grid layout modes
- `FilterBar` — search input, time range chips
- `SettingsPanel` — thumbnail size slider, videos-per-row slider, density buttons, duration filter sliders
- `PlayerView` — YouTube iframe embed with auto-advance and 90% completion tracking
- `PlaylistSidebar` — scrollable playlist with search, remove buttons

### Filtering

All videos loaded client-side, filtered in browser (same as current — keeps instant search feel). `useFeed` hook exposes filtering function that combines search query + time range + duration range.

## Testing Strategy

### Mock API Validation (one-time setup)

Before writing any tests:
1. Run a validation script that makes one real call to each API method (`subscriptions.list`, `playlistItems.list`, `videos.list`) — costs ~5-6 quota units
2. Save full response shapes to `tests/fixtures/real-responses.json`
3. Build mock YouTube client from these actual responses
4. Add a structural validation test that compares mock output against fixtures (field names, nesting, types)

If Google changes their API shape, this test fails and we know the mock is stale.

### Backend Tests (~15 tests)

**`database.test.js`** — Real in-memory SQLite (not mocked):
- Channel must exist before video insert (FK integrity)
- `upsertChannel()` creates and updates correctly
- `insertVideos()` handles duplicates (INSERT OR IGNORE)
- `getAllVideos()` returns correct sort order (published DESC)
- Session CRUD (create, retrieve, expire)

**`youtube.test.js`** — Mock YouTube client (zero quota):
- Full refresh with 200 channels: pipeline stops when budget is hit, total cost matches expectations
- Incremental refresh: stops at known videoId instead of fetching all pages
- `enrichVideos()` batches in groups of 50 (120 videos = exactly 3 API calls)
- Backfill resumes from saved `next_page_token`
- Budget hard stop mid-refresh: set budget to 15 calls, verify it stops at 15 and saves progress
- Quota tracking accuracy: total tracked units == actual mock API calls made

**`quota.test.js`**:
- Tracks cumulative usage correctly
- `canSpend()` enforces 8,000-unit budget
- Resets at date boundary
- Persists across restart (reads from SQLite)

**`routes/feed.test.js` + `routes/playlist.test.js`** — Supertest integration:
- Auth middleware blocks unauthenticated requests
- Correct response shapes
- Error handling

### Frontend Tests (~12 tests)

**Component tests:**
- `VideoCard` — renders with props, click handlers fire, queued state shows indicator
- `FilterBar` — search input filters, time chips toggle active state
- `SettingsPanel` — slider changes update values, density buttons toggle

**Hook tests:**
- `useFeed` — filtering logic (time range + search + duration combined)

**Utility tests:**
- `formatDuration` — PT4M13S → "4:13", PT1H2M3S → "1:02:03", edge cases
- `timeAgo` — just now, minutes, hours, days, weeks
- `formatViews` — 1234 → "1.2K", 1234567 → "1.2M"

### Future (not part of initial rebuild)

- Playwright E2E tests for full user flows (sign in → refresh → queue → playlist viewer)
- Add after UI stabilizes in Phase 2

## Migration Path

1. Scaffold new project structure (Vite + Express)
2. Capture real API response fixtures
3. Port backend services with tests (database first, then youtube, then routes)
4. Port frontend page by page (Feed first, then Playlist)
5. Verify feature parity against current app
6. Switch over
