# YouTube Subscriptions Viewer

## What This App Does

A self-hosted personal YouTube subscriptions feed that shows **every** video from every subscribed channel, sorted by date. No algorithm filtering, no interface changes you didn't ask for.

### Core Features

- **Unfiltered chronological feed** — Every video from every subscription, newest first
- **"To Watch" queue** — Add videos to a real YouTube playlist with one click (inserted at position 0 / top)
- **Playlist viewer** — Embedded YouTube player with auto-advance, progress tracking, and auto-removal at 90% completion
- **Real-time sync** — WebSocket broadcasts keep the feed page and playlist viewer in sync
- **Search & filter** — Filter by channel name, video title, time range (today/week/month), and duration range
- **Flexible layouts** — Grid (2-6 columns) or list view, with compact/normal/comfortable density modes
- **Dark theme** — Purpose-built dark interface

### Authentication

- Google OAuth2 for YouTube Data API v3 access
- Scopes needed: `youtube.readonly` (subscriptions, videos) and `youtube` (playlist management)

## Hard Constraints

### YouTube API Quota

The YouTube Data API has a daily quota of **10,000 units** (resets at midnight Pacific). This is the single most important constraint in this project.

| Operation | Cost | Notes |
|-----------|------|-------|
| subscriptions.list | 1/page | ~3 pages typical |
| playlistItems.list | 1/page | 50 results/page |
| playlistItems.insert | 50 | Per video queued |
| playlistItems.delete | 50 | Per video removed |
| videos.list | 1/request | Up to 50 IDs per batch |
| search.list | 100 | Avoid — too expensive |

**Budget target: 8,000 units/day** (20% reserve). All refresh pipelines must track quota and stop when the budget is reached.

### Data Integrity Rules

- **Channel before video**: Always upsert the channel record before inserting its videos (foreign key integrity)
- **No logic duplication**: Test scripts must call production functions — never re-implement API fetching or DB insertion logic separately
- **Secrets in .env only**: Google client ID, client secret, and tokens must never be hardcoded

## Feature Roadmap

See [TODO.md](TODO.md) for the full roadmap organized in phases:

- **Phase 1**: Sticky UI elements, density improvements, real-time cache timer
- **Phase 2**: Video durations from API, duration filtering, drag-to-rearrange playlist, channel management
- **Phase 3**: Watch status tracking (progress bars), YouTube history import, unwatched filter

## Quality Standards

- **Modular structure**: Separate concerns into distinct files/modules — not monolithic
- **Test coverage**: Critical paths must be tested (quota logic, data pipeline, DB queries)
- **Input validation**: Sanitize all user-displayed content, use prepared statements for SQL
- **Responsive UI**: Works on desktop and mobile
- **Accessible**: Semantic HTML, keyboard navigation, proper contrast

## Tech Stack

- **Runtime**: Node.js
- **Backend**: Express.js
- **Database**: SQLite (via better-sqlite3) with WAL mode
- **Real-time**: WebSocket (ws)
- **API**: YouTube Data API v3 (via googleapis)
- **Auth**: Google OAuth2

## Available Agents & Tools

This project has specialized agents installed via [claude-code-templates](https://github.com/davila7/claude-code-templates):

| Agent | Purpose |
|-------|---------|
| `backend-architect` | API design, schema, scaling decisions |
| `frontend-developer` | UI components, state management, accessibility |
| `ui-ux-designer` | Research-backed design critique |
| `code-reviewer` | Quality gates: security, performance, maintainability |
| `test-engineer` | Test strategy, automation, CI/CD |
| `quota-auditor` | YouTube API quota impact review (custom) |
