#!/usr/bin/env node
//
// bulk-add.js — Add YouTube videos from a list of URLs to your "To Watch" playlist.
//
// Usage:
//   1. First, run the main app (npm start) and sign in once to create a session.
//   2. Paste your YouTube URLs into tabs.txt (one per line).
//   3. Run: node bulk-add.js
//
// The script will authenticate via OAuth (opens a browser), then add each video
// to the top of your "To Watch" playlist in reverse order so the first URL in
// the file ends up at the top of the playlist.
//

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const http = require('http');
const open = import('open'); // dynamic import for ESM module
const path = require('path');

const INPUT_FILE = process.argv[2] || 'tabs.txt';
const PLAYLIST_NAME = 'To Watch';
const DELAY_MS = 350; // delay between API calls to stay well within rate limits

// ---------------------------------------------------------------------------
// Extract video IDs from URLs
// ---------------------------------------------------------------------------
function extractVideoIds(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n  ❌ File not found: ${filePath}`);
    console.error(`  Create it with one YouTube URL per line.\n`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const ids = [];
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,           // youtube.com/watch?v=ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,       // youtu.be/ID
    /\/shorts\/([a-zA-Z0-9_-]{11})/,        // youtube.com/shorts/ID
    /\/embed\/([a-zA-Z0-9_-]{11})/,         // youtube.com/embed/ID
    /\/live\/([a-zA-Z0-9_-]{11})/,          // youtube.com/live/ID
  ];

  for (const line of lines) {
    let found = false;
    for (const pat of patterns) {
      const match = line.match(pat);
      if (match) {
        ids.push(match[1]);
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(`  ⚠ Skipping unrecognized URL: ${line}`);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// OAuth2 — one-shot local flow
// ---------------------------------------------------------------------------
async function authenticate() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000/auth/callback'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube'],
    prompt: 'consent',
  });

  // Start a temporary local server to catch the callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/auth/callback')) {
        const url = new URL(req.url, 'http://localhost:3000');
        const code = url.searchParams.get('code');

        if (!code) {
          res.end('No code received. Please try again.');
          server.close();
          reject(new Error('No auth code'));
          return;
        }

        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);
          res.end('✅ Authenticated! You can close this tab and go back to your terminal.');
          server.close();
          resolve(oauth2Client);
        } catch (err) {
          res.end('Authentication failed: ' + err.message);
          server.close();
          reject(err);
        }
      }
    });

    server.listen(3000, async () => {
      console.log('\n  🔐 Opening browser for Google sign-in...\n');

      // Try to open the browser
      try {
        const openMod = await open;
        await openMod.default(authUrl);
      } catch {
        console.log(`  If your browser didn't open, go to:\n\n  ${authUrl}\n`);
      }
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 120000);
  });
}

// ---------------------------------------------------------------------------
// Find or create the "To Watch" playlist
// ---------------------------------------------------------------------------
async function ensurePlaylist(youtube) {
  const resp = await youtube.playlists.list({
    part: 'snippet',
    mine: true,
    maxResults: 50,
  });

  let playlist = resp.data.items.find(p => p.snippet.title === PLAYLIST_NAME);

  if (!playlist) {
    console.log(`  📋 Creating "${PLAYLIST_NAME}" playlist...`);
    const created = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: PLAYLIST_NAME,
          description: 'Videos queued from my custom subscriptions feed',
        },
        status: { privacyStatus: 'private' },
      },
    });
    playlist = created.data;
  }

  return playlist.id;
}

// ---------------------------------------------------------------------------
// Add videos to playlist
// ---------------------------------------------------------------------------
async function addVideos(youtube, playlistId, videoIds) {
  // We want the first URL in the file to end up at the TOP of the playlist.
  // Since we insert at position 0 each time, we need to add them in REVERSE
  // order: the last item gets pushed down as each subsequent one is inserted
  // at position 0, so the first item ends up on top.
  const reversed = [...videoIds].reverse();

  let added = 0;
  let skipped = 0;
  const total = reversed.length;

  for (let i = 0; i < reversed.length; i++) {
    const videoId = reversed[i];
    const displayIndex = total - i; // show the "real" order number
    try {
      await youtube.playlistItems.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            playlistId,
            position: 0,
            resourceId: {
              kind: 'youtube#video',
              videoId,
            },
          },
        },
      });
      added++;
      process.stdout.write(`\r  ▶ Adding ${displayIndex}/${total}: ${videoId} ✓`);

      // Small delay to respect rate limits
      if (i < reversed.length - 1) {
        await sleep(DELAY_MS);
      }
    } catch (err) {
      const reason = err?.errors?.[0]?.reason || err.message;
      if (reason === 'videoAlreadyInPlaylist') {
        skipped++;
        process.stdout.write(`\r  ▶ Adding ${displayIndex}/${total}: ${videoId} (already in playlist)`);
      } else {
        console.error(`\n  ❌ Failed to add ${videoId}: ${reason}`);
      }
    }
  }

  console.log('\n');
  return { added, skipped };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n  🎬 YouTube Bulk Add to Playlist');
  console.log('  ─────────────────────────────────\n');

  // 1. Parse video IDs
  const videoIds = extractVideoIds(INPUT_FILE);
  console.log(`  📄 Found ${videoIds.length} video(s) in ${INPUT_FILE}`);

  if (videoIds.length === 0) {
    console.log('  Nothing to add.\n');
    process.exit(0);
  }

  // 2. Authenticate
  const auth = await authenticate();
  const youtube = google.youtube({ version: 'v3', auth });

  // 3. Ensure playlist exists
  const playlistId = await ensurePlaylist(youtube);
  console.log(`  📋 Playlist ID: ${playlistId}`);
  console.log(`  🔗 https://www.youtube.com/playlist?list=${playlistId}\n`);

  // 4. Add videos
  console.log(`  Adding ${videoIds.length} videos (first in file → top of playlist)...\n`);
  const { added, skipped } = await addVideos(youtube, playlistId, videoIds);

  // 5. Summary
  console.log(`  ✅ Done! ${added} added, ${skipped} already in playlist.`);
  console.log(`  🔗 https://www.youtube.com/playlist?list=${playlistId}\n`);

  // Quota usage estimate
  const quotaUsed = added * 50 + 3; // 50 per insert + small overhead
  console.log(`  📊 Estimated API quota used: ~${quotaUsed} / 10,000 units\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n  ❌ Error:', err.message, '\n');
  process.exit(1);
});
