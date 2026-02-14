# YouTube Subscriptions Viewer - Feature Roadmap

## Phase 1: Quick Wins ⚡

### Subs Page Improvements
- [x] **Sticky search + settings** - Pin top bar when scrolling
  - Wrapped SettingsPanel + FilterBar in single `stickyControls` div
  - Fixed overlap bug where FilterBar covered SettingsPanel on scroll
- [x] **Real-time cache timer** - Update "X minutes ago" live without refresh
  - 30-second interval tick, shows "Updated just now" for < 1 minute
- [x] **Settings persist on reload** - Fixed API response unwrapping bug
  - API returns `{ settings: {...} }`, code now correctly reads `data.settings`
- ~~**Improve density settings**~~ - Current settings are fine as-is
- [ ] **Duration filter slider UI** - Add min/max range sliders (filtering logic in Phase 2)

### Playlist Page Improvements
- [x] **Fix padding** - Compact card variant with tighter padding and smaller thumbnails
- [x] **Clickable channel names** - Channels linkable in both player and sidebar
- [ ] **Sticky search bar** - Always visible when scrolling

---

## Phase 2: Medium Complexity 🛠️

### Filtering & Sorting
- [ ] **Fetch video durations** (Subs page) - From YouTube API (1 quota unit / 50 videos)
- [ ] **Duration filter logic** (Subs page) - Filter videos by length range
- [x] **Sort by duration** (Playlist page ONLY) - Cycle through: shortest → longest → original order
  - Cycle button in sidebar header: Order: Added → Shortest first → Longest first
  - View toggle only — doesn't modify actual YouTube playlist order

### Playlist Reordering
- [x] **Move to top / Move to bottom** (Playlist page) - Reorder via YouTube API
  - Hover-reveal buttons on each playlist card
  - Optimistic UI with rollback on failure
  - Cost: 51 quota units per move (1 to find + 50 to update)

### Channel Management
- [ ] **Infrequently watched filter** - Right-click channel names to mark, toggle to hide

---

## Phase 3: Advanced Features 🚀

### API Integration
- [ ] **Watch status indicator** - Red progress bar like YouTube
  - Track locally when videos opened
  - Fetch YouTube watch history (3 quota units per request)
  - Gradual background fetching for historical data
- [ ] **Unwatched filter** - Show only videos not fully watched

---

## Feature Details

### Sticky Elements
**Subs Page:**
- Search bar + settings panel stay visible when scrolling down
- Settings panel becomes fixed position when open

**Playlist Page:**
- Search bar stays at top when scrolling through playlist

### Density Settings
Make the visual differences more obvious:
- **Compact:** Tighter spacing, smaller fonts (8px padding, 0.85rem title)
- **Normal:** Current default
- **Comfortable:** Looser spacing, larger fonts (20px padding, 1.1rem title)

### Sort by Duration (Playlist Only)
**IMPORTANT:** This is a temporary view, NOT a reorder!
- Click 1: Sort shortest first (show indicator: "Shortest ↑")
- Click 2: Sort longest first (show indicator: "Longest ↓")
- Click 3: Back to original order (date added / manual drag order)
- Cycles continuously

### Move to Top / Move to Bottom
**Playlist Page Only:** Reorders YouTube playlist via API (51 quota units per move). Hover-reveal buttons instead of drag-drop for simplicity and lower interaction cost.

### Duration Filter
- Min slider: 0-120 minutes
- Max slider: 0-120+ minutes (∞)
- Works alongside time filters (Today, This Week, etc.)
- Shows "All durations" / "Up to X min" / "X+ min" / "X-Y min"

### Watch Status
- Red progress bar at bottom of thumbnails (like YouTube)
- Dim fully watched videos (opacity: 0.6)
- Track locally when opening videos (10% progress)
- Optionally import YouTube watch history
- Gradual background fetch to avoid quota issues

### Infrequently Watched Channels
- Right-click channel name → Context menu
- Option: "Mark as infrequently watched"
- Toggle button in filter bar to show/hide
- Persists in settings across sessions

---

## Testing Checklist

### Phase 1
- [x] Scroll subs page → search bar stays at top
- [x] Open settings while scrolled → panel stays visible
- ~~Toggle density → see obvious visual differences~~ (skipped — fine as-is)
- [ ] Scroll playlist page → search bar stays at top
- [x] Check long channel names → not cut off (compact variant with ellipsis)
- [x] Click channel names → opens YouTube channel
- [x] Wait 2 minutes → cache timer updates (30s interval)

### Phase 2
- [ ] Load subs page → durations fetched automatically
- [ ] Set duration min to 10 → only videos ≥10min show
- [ ] Set duration max to 20 → only videos ≤20min show
- [ ] Set both → videos in range show
- [x] Playlist sort click 1 → shortest first
- [x] Playlist sort click 2 → longest first
- [x] Playlist sort click 3 → back to original
- [x] Reload page → playlist order unchanged (still original)
- [x] Move to top/bottom buttons → YouTube playlist reordered
- [ ] Right-click channel → context menu appears
- [ ] Mark as infrequent → toast notification
- [ ] Toggle filter → infrequent channels hide

### Phase 3
- [ ] Open video → 10% progress bar appears
- [ ] Reload page → progress bar still there
- [ ] Fully watch video → thumbnail dims
- [ ] Toggle unwatched filter → only unwatched show
- [ ] Wait 5 seconds after load → watch history imports

### Integration
- [ ] Use all filters together (time + duration + search + infrequent + unwatched)
- [ ] Switch to grid layout → all features work
- [ ] Search playlist + sort → works together
- [ ] Search playlist + move to top/bottom → works together
- [ ] Check mobile → sticky headers work
- [ ] Check mobile → move buttons accessible
- [ ] Check mobile → context menu accessible

---

## Quota Impact

| Feature | Cost | Frequency | Daily Impact |
|---------|------|-----------|--------------|
| Existing subscription fetch | ~3 units/page | Per refresh | 3-6 units |
| Video durations (new) | 1 unit/50 videos | Per load | 2-3 units |
| Watch history (new) | 3 units | Once/session | 3 units |
| Watch progress save | 0 units | Local only | 0 units |
| **Total new usage** | | | **5-6 units/session** |

**Daily quota:** 10,000 units
**New features impact:** <0.1% of quota
**Safe margin:** 99.9% remaining

---

## Implementation Notes

### Files to Modify
- `server.js` - New endpoints: `/api/videos/details`, `/api/watch-progress`, `/api/watch-history`, `/api/playlist/reorder`
- `public/index.html` - Subs page (all filtering, sorting, drag-drop, sticky UI, watch tracking)
- `public/playlist.html` - Playlist page (search, sort, drag-drop, clickable channels, sticky header)
- `feed-cache.json` - Add `watchProgress` field

### Reusable Utilities
- `parseDurationToSeconds(isoDuration)` - Convert PT4M13S → seconds
- `escapeHtml(str)` - Sanitize user input
- `showToast(message, type)` - Notifications
- `saveSettings()` / `loadSettings()` - Persist settings

### Edge Cases to Handle
1. Duration fetching failure → Show videos in "All durations"
2. Custom order with active filters → Apply custom order after filters
3. Move buttons with sorted view → move applies to original order
4. Watch progress for thousands of videos → Consider pruning old entries
5. Multiple tabs → Watch progress sync (future WebSocket enhancement)
6. Playlist reorder quota cost → 51 units per move (1 list + 50 update)

---

## Future Enhancements (Out of Scope)
- Sync watch progress across tabs via WebSocket
- Export/import custom order and channel tags
- Keyboard shortcuts for sorting/filtering
- Batch mark as watched
- Channel grouping/categories
- Video notes/bookmarks
