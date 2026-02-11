# YouTube Subs Viewer

A self-hosted personal YouTube subscriptions feed that shows **every** video from every channel you subscribe to, sorted by release date. No algorithm filtering, no interface changes you didn't ask for.

## Features

- **Unfiltered feed** — Every video from every subscription, no YouTube algorithm deciding what you "care about"
- **Sorted by date** — Newest first, always
- **"To Watch" queue** — One-click to add videos to a real YouTube playlist (appears at position 0 / top). Keep the playlist open in another tab and work through your queue
- **Search & filter** — Filter by channel name, video title, or time range (today / this week / this month)
- **Fast loading** — Uses YouTube RSS feeds instead of the Data API for video fetching, so it won't blow through your API quota
- **Self-hosted** — Runs locally or on your own server. Your interface, your rules

## How It Works

1. **OAuth2** authenticates you with Google to access your subscription list and manage playlists
2. **YouTube Data API** fetches your subscription list (cheap: ~3 quota units per page)
3. **YouTube RSS feeds** fetch recent videos for each channel (free, no quota, ~15 most recent per channel)
4. **YouTube Data API** manages the "To Watch" playlist (inserting at position 0 so new additions appear at the top)

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **YouTube Data API v3**:
   - Go to **APIs & Services → Library**
   - Search for "YouTube Data API v3"
   - Click **Enable**

### 2. Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - User Type: **External** (or Internal if using Google Workspace)
   - Add your email as a test user
   - Add scopes: `youtube.readonly` and `youtube`
4. For the OAuth client:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/auth/callback`
5. Copy the **Client ID** and **Client Secret**

### 3. Configure and Run

```bash
# Clone / copy the project
cd youtube-subs

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env and fill in your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

# Run
npm start
```

Open `http://localhost:3000` in your browser and click **Sign in with Google**.

### 4. (Optional) Run on Your Home Server

If you want to run this on your Unraid box or another server:

1. Update `REDIRECT_URI` in `.env` to match your server's address (e.g., `http://192.168.1.x:3000/auth/callback`)
2. Add the same URI to your Google Cloud OAuth authorized redirect URIs
3. Consider using a reverse proxy (Nginx/Caddy) with HTTPS if exposing outside your LAN
4. Run with `node server.js` or use PM2/Docker for persistence

## API Quota

The YouTube Data API has a daily quota of **10,000 units**. Here's how this app uses it:

| Action | Cost | When |
|--------|------|------|
| List subscriptions | ~3 units/page | On load / refresh |
| Fetch videos (RSS) | **0 units** | On load / refresh |
| Create playlist | 50 units | First run only |
| Add to playlist | 50 units | Per video queued |
| Remove from playlist | 50 units | Per video removed |

With 200 subscriptions and moderate queue usage, you'll use roughly **100-300 units per session**. You could refresh dozens of times a day without issues.

## Limitations

- **RSS feeds return ~15 most recent videos per channel.** If a channel uploads more than 15 videos between your visits, you might miss some. For most channels this is a non-issue.
- **No video duration shown.** YouTube's RSS feeds don't include duration. Adding this would require additional API calls (1 unit per 50 videos via `videos.list`). This could be added as an optional enhancement.
- **Session is in-memory.** If you restart the server, you'll need to re-authenticate. For persistence, swap the session store for a file or database.

## Possible Enhancements

- **Caching** — Cache RSS results in a SQLite DB and refresh on a schedule (cron) instead of on every page load
- **Video duration** — Fetch via `videos.list` API (batches of 50) after RSS load
- **Mark as watched** — Track which videos you've already opened
- **Channel grouping** — Tag channels into categories (gaming, tech, cooking, etc.)
- **Docker container** — Dockerize for easy deployment on Unraid
- **Keyboard shortcuts** — `q` to queue, `j/k` to navigate, `Enter` to open
