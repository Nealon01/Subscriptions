const Database = require('better-sqlite3');
const db = new Database('./cache/videos.db', { readonly: true });

// Schema
console.log('=== Schema ===');
const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach(t => console.log(t.sql + ';\n'));

const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all();
indexes.forEach(i => console.log(i.sql + ';'));

// Summary
const channelCount = db.prepare('SELECT COUNT(*) as c FROM channels').get();
const videoCount = db.prepare('SELECT COUNT(*) as c FROM videos').get();
console.log('\n=== Summary ===');
console.log('Channels:', channelCount.c);
console.log('Videos:', videoCount.c);

// Per-channel breakdown
console.log('\n=== Per-Channel Video Counts ===');
const channels = db.prepare(
  'SELECT c.channel_name, c.channel_id, c.backfill_complete, c.last_checked, COUNT(v.video_id) as video_count ' +
  'FROM channels c LEFT JOIN videos v ON c.channel_id = v.channel_id ' +
  'GROUP BY c.channel_id ORDER BY video_count DESC'
).all();
channels.forEach(ch => {
  const bf = ch.backfill_complete ? 'COMPLETE' : 'PARTIAL';
  console.log('  ' + String(ch.video_count).padStart(5) + '  ' + bf.padEnd(8) + '  ' + ch.channel_name);
});

// Sample channel record (all fields)
console.log('\n=== Sample Channel Record (all fields) ===');
const sampleChannel = db.prepare('SELECT * FROM channels LIMIT 1').get();
console.log(JSON.stringify(sampleChannel, null, 2));

// 3 sample video records (all fields) — newest, middle, oldest
console.log('\n=== Sample Video Records (all fields) ===');
console.log('--- Newest ---');
const newest = db.prepare('SELECT * FROM videos ORDER BY published DESC LIMIT 1').get();
console.log(JSON.stringify(newest, null, 2));

console.log('--- Middle ---');
const mid = db.prepare('SELECT * FROM videos ORDER BY published DESC LIMIT 1 OFFSET ?').get(Math.floor(videoCount.c / 2));
console.log(JSON.stringify(mid, null, 2));

console.log('--- Oldest ---');
const oldest = db.prepare('SELECT * FROM videos ORDER BY published ASC LIMIT 1').get();
console.log(JSON.stringify(oldest, null, 2));

// Field coverage
console.log('\n=== Field Coverage ===');
const fields = ['duration', 'views', 'thumbnail', 'description'];
fields.forEach(f => {
  const filled = db.prepare(`SELECT COUNT(*) as c FROM videos WHERE ${f} IS NOT NULL AND ${f} != ''`).get();
  console.log('  ' + f.padEnd(12) + ': ' + filled.c + ' / ' + videoCount.c);
});

db.close();
