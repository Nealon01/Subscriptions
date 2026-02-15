/**
 * Convert ISO 8601 duration to human-readable string.
 * PT4M13S -> "4:13", PT1H2M3S -> "1:02:03"
 */
export function formatDuration(isoDuration) {
  if (!isoDuration) return '';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';

  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Convert a date string to a relative time string.
 * "just now", "5m", "3h", "2d", "1w"
 */
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd';
  if (seconds < 2592000) return Math.floor(seconds / 604800) + 'w';
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo';
  return (seconds / 31536000).toFixed(1).replace(/\.0$/, '') + 'y';
}

/**
 * Format a view count into a compact string.
 * 1234 -> "1.2K", 1234567 -> "1.2M"
 */
export function formatViews(n) {
  if (n === null || n === undefined) return '';
  const num = parseInt(n);
  if (isNaN(num)) return '';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Get a date label for grouping videos.
 * "Today", "Yesterday", "Monday", "January 15"
 */
export function getDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const videoDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (videoDate.getTime() === today.getTime()) return 'Today';
  if (videoDate.getTime() === yesterday.getTime()) return 'Yesterday';

  const diff = today.getTime() - videoDate.getTime();
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString('en-US', { weekday: 'long' });
  }

  const options = { month: 'long', day: 'numeric' };
  if (now.getFullYear() !== d.getFullYear()) {
    options.year = 'numeric';
  }
  return d.toLocaleDateString('en-US', options);
}

/**
 * Escape HTML special characters. Note: In React, JSX auto-escapes text.
 * Only use this when inserting raw HTML via dangerouslySetInnerHTML.
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Parse an ISO 8601 duration to total minutes (for duration filtering).
 * PT4M13S -> 4.22, PT1H2M3S -> 62.05
 * Returns null if the duration is empty or unparseable.
 */
export function parseDurationToMinutes(isoDuration) {
  if (!isoDuration) return null;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;

  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);

  return hours * 60 + minutes + seconds / 60;
}
