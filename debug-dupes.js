require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

async function test() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
  );
  const tokens = JSON.parse(fs.readFileSync('./cache/tokens.json', 'utf8'));
  oauth2Client.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const uploadsPlaylistId = 'UUfdNM3NAhaBOXCafH7krzrA';
  let pageToken = undefined;
  let totalItems = 0;
  let pagesRead = 0;
  const dupeDetails = [];
  const seenIds = new Map(); // videoId -> { index, page }

  do {
    const response = await youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });

    pagesRead++;
    if (pagesRead === 1) console.log('API totalResults:', response.data.pageInfo.totalResults);

    for (const item of response.data.items) {
      totalItems++;
      const videoId = item.contentDetails.videoId;

      if (!videoId || videoId === '') {
        dupeDetails.push({ index: totalItems, page: pagesRead, issue: 'EMPTY videoId', title: item.snippet.title });
      } else if (seenIds.has(videoId)) {
        const orig = seenIds.get(videoId);
        dupeDetails.push({
          index: totalItems,
          page: pagesRead,
          originalIndex: orig.index,
          originalPage: orig.page,
          videoId,
          title: item.snippet.title,
        });
      } else {
        seenIds.set(videoId, { index: totalItems, page: pagesRead });
      }
    }

    pageToken = response.data.nextPageToken;
    if (pagesRead % 20 === 0) console.log(`  ... page ${pagesRead}, ${totalItems} items so far`);
  } while (pageToken);

  console.log('\nPages read:', pagesRead);
  console.log('Total items received:', totalItems);
  console.log('Unique videoIds:', seenIds.size);
  console.log('Dupes/issues found:', dupeDetails.length);

  if (dupeDetails.length > 0) {
    console.log('\nAll dupe details:');
    dupeDetails.forEach(d => console.log(JSON.stringify(d)));
  }
}

test().catch(console.error);
