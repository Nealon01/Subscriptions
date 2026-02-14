# YouTube Subscriptions Viewer - Feature Roadmap

## UI Polish

- [ ] **Infrequently watched filter** - Right-click channel names to mark, toggle to hide

---

## Watch Tracking

- [ ] **Watch status indicator** - Red progress bar like YouTube
  - Track locally when videos opened
  - Fetch YouTube watch history (3 quota units per request)
  - Gradual background fetching for historical data
- [ ] **Unwatched filter** - Show only videos not fully watched

---

## Phase 3: Infrastructure & Multi-User

### Docker Support
- [ ] **Dockerfile + docker-compose** - Containerized deployment
  - Node.js app container with SQLite volume mount
  - Environment variable configuration (.env)
  - Health checks and auto-restart
  - Build step for Vite frontend

### Multi-User Authentication
- [ ] **Per-user accounts** - Support multiple users with separate data
  - Each user links their own Google/YouTube account
  - Separate subscription feeds, playlists, and settings per user
  - Shared app instance, isolated data
- [ ] **Auth redesign** - Current OAuth flow assumes single user
  - Session-based auth with user accounts
  - Invite system or open registration toggle
  - Consider passkey/password options for app login (vs. Google OAuth for YouTube access)

### WebSub/PubSubHubbub (Requires Public URL)
- [ ] **Real-time video notifications** - Zero quota, zero lag
  - Subscribe to each channel's Atom feed topic via WebSub
  - YouTube pushes XML notification when new videos publish
  - Eliminates RSS 15-30 min lag entirely
  - Requires publicly accessible callback URL (webhook endpoint)
  - Re-subscribe every ~5 days (lease renewal)
  - Fallback to RSS polling if WebSub fails

---

## Future Ideas
- Sync watch progress across tabs via WebSocket
- Keyboard shortcuts for sorting/filtering
- Batch mark as watched
- Channel grouping/categories
- Video notes/bookmarks

---

## Quota Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| subscriptions.list | 1/page | ~8 pages for ~360 channels |
| RSS feed fetch | **0** | Free, ~15 min lag |
| videos.list (enrichment) | 1/50 videos | Duration + views |
| playlistItems.list (backfill) | 1/page | Only for new channels |
| playlistItems.insert | 50 | Per video queued |
| playlistItems.delete | 50 | Per video removed |
| search.list | 100 | Avoid — too expensive |

**Daily limit:** 10,000 units | **Soft budget:** 8,000 | **Typical refresh:** ~15 units
