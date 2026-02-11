import { useState, useMemo } from "react";

const MOCK_CHANNELS = [
  "3Blue1Brown", "Fireship", "GameMaker's Toolkit", "Technology Connections",
  "Veritasium", "Tom Scott", "Sebastian Lague", "Linus Tech Tips",
  "Ben Eater", "Stuff Made Here", "Two Minute Papers", "Kurzgesagt",
  "SmarterEveryDay", "Mark Rober", "Computerphile", "The Coding Train",
];

function mockVideos() {
  const titles = [
    "The Hidden Mathematics Behind Every Video Game",
    "I Built a Neural Network From Scratch in Assembly",
    "Why Modern UIs Feel Worse Than 2010 UIs",
    "The Most Elegant Algorithm You've Never Heard Of",
    "I Replaced My Entire Server Rack With One Board",
    "How GPS Actually Works (It's Not What You Think)",
    "This Obscure CPU Feature Changes Everything",
    "Building a Game Engine in 48 Hours",
    "The Physics of Impossible Structures",
    "Why Every Tutorial Gets Encryption Wrong",
    "I Automated My Entire Workshop With Raspberry Pis",
    "The Problem With Modern Programming Languages",
    "How One Line of Code Crashed the Internet",
    "The Forgotten History of the Home Computer Revolution",
    "What Happens When You Cool a CPU to -200°C",
    "The Mathematics of Terrain Generation",
    "Why Analog Computers Are Making a Comeback",
    "I Built a Working Computer Inside Minecraft",
    "The Surprising Science of Speaker Design",
    "How Modern Compilers Actually Think",
    "The Real Reason USB-C Is So Complicated",
    "Building an OS From Scratch — Part 7",
    "This Simple Trick Makes FFT 10x Faster",
    "The Engineering Behind Noise-Cancelling Headphones",
    "Why Your Code Is Slower Than You Think",
    "The Most Important Graph Algorithm Explained",
    "I Made a Self-Driving RC Car for $50",
    "How Bluetooth Actually Works Under the Hood",
    "The Art of Writing Unmaintainable Code",
    "Why Old Games Had Better Sound Design",
    "The Geometry Nobody Teaches You",
    "How One Engineer Fixed a 20-Year-Old Bug",
    "I Built a Mechanical Calculator From Wood",
    "The Fascinating World of Error Correction",
    "Why Your Microwave Has a Turntable (The Real Reason)",
    "The Algorithm Behind Every Recommendation System",
  ];

  const now = Date.now();
  return titles.map((title, i) => {
    const hoursAgo = i * 3 + Math.floor(Math.random() * 4);
    const published = new Date(now - hoursAgo * 3600000);
    const ch = MOCK_CHANNELS[Math.floor(Math.random() * MOCK_CHANNELS.length)];
    const views = Math.floor(Math.random() * 2000000) + 5000;
    return {
      videoId: `vid_${i}`,
      title,
      channelName: ch,
      published: published.toISOString(),
      thumbnail: `https://picsum.photos/seed/${i + 40}/640/360`,
      views: views.toString(),
    };
  });
}

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d";
  return Math.floor(seconds / 604800) + "w";
}

function formatViews(n) {
  const num = parseInt(n);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function getDateLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const videoDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (videoDate.getTime() === today.getTime()) return "Today";
  if (videoDate.getTime() === yesterday.getTime()) return "Yesterday";
  const diff = today.getTime() - videoDate.getTime();
  if (diff < 7 * 86400000) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

const videos = mockVideos();

export default function App() {
  const [queued, setQueued] = useState(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [toasts, setToasts] = useState([]);

  const filtered = useMemo(() => {
    let vids = [...videos];
    if (filter !== "all") {
      const now = Date.now();
      const cutoffs = { today: 86400000, week: 604800000, month: 2592000000 };
      vids = vids.filter((v) => now - new Date(v.published).getTime() < cutoffs[filter]);
    }
    if (search) {
      const q = search.toLowerCase();
      vids = vids.filter((v) => v.title.toLowerCase().includes(q) || v.channelName.toLowerCase().includes(q));
    }
    return vids;
  }, [search, filter]);

  const grouped = useMemo(() => {
    const groups = [];
    let currentLabel = "";
    filtered.forEach((v) => {
      const label = getDateLabel(v.published);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, videos: [] });
      }
      groups[groups.length - 1].videos.push(v);
    });
    return groups;
  }, [filtered]);

  function addToast(msg) {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }

  function toggleQueue(vid) {
    setQueued((prev) => {
      const next = new Set(prev);
      if (next.has(vid.videoId)) {
        next.delete(vid.videoId);
        addToast("Removed from queue");
      } else {
        next.add(vid.videoId);
        addToast(`Queued: ${vid.title.substring(0, 40)}…`);
      }
      return next;
    });
  }

  const filters = [
    { key: "all", label: "All" },
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#0a0a0c", color: "#e8e8ec", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Top Bar */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 56, background: "rgba(10,10,12,0.85)", backdropFilter: "blur(16px)", borderBottom: "1px solid #2a2a32",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1rem", fontWeight: 500, letterSpacing: -0.5 }}>
            <span style={{ color: "#e23636" }}>▶</span> subs
          </div>
          <div style={{ fontSize: "0.8rem", color: "#606070", fontFamily: "'JetBrains Mono', monospace" }}>
            {MOCK_CHANNELS.length} channels · {videos.length} videos
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "1px solid rgba(45,204,112,0.25)",
            borderRadius: 8, background: "rgba(45,204,112,0.12)", color: "#2dcc70", fontFamily: "'DM Sans', sans-serif",
            fontSize: "0.82rem", fontWeight: 500, cursor: "pointer",
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            To Watch {queued.size > 0 && <span style={{ fontFamily: "'JetBrains Mono'", fontSize: "0.75rem", opacity: 0.7 }}>({queued.size})</span>}
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderBottom: "1px solid #2a2a32",
        background: "#121215", flexWrap: "wrap",
      }}>
        <input
          type="text"
          placeholder="Search videos or channels…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: "8px 12px", background: "#18181c", border: "1px solid #2a2a32",
            borderRadius: 8, color: "#e8e8ec", fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", outline: "none",
          }}
        />
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "6px 12px", borderRadius: 20, border: "1px solid " + (filter === f.key ? "rgba(226,54,54,0.3)" : "#2a2a32"),
              background: filter === f.key ? "rgba(226,54,54,0.12)" : "#18181c",
              color: filter === f.key ? "#e23636" : "#9090a0", fontSize: "0.8rem", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Main Feed */}
      <main style={{ padding: "20px 24px 40px" }}>
        {grouped.map((group) => (
          <div key={group.label}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem", color: "#606070",
              letterSpacing: 0.5, textTransform: "uppercase",
            }}>
              {group.label}
              <div style={{ flex: 1, height: 1, background: "#2a2a32" }} />
            </div>

            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16,
            }}>
              {group.videos.map((vid) => (
                <VideoCard key={vid.videoId} video={vid} isQueued={queued.has(vid.videoId)} onToggleQueue={() => toggleQueue(vid)} />
              ))}
            </div>
          </div>
        ))}
      </main>

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            padding: "10px 16px", background: "#222228", border: "1px solid rgba(45,204,112,0.4)",
            borderRadius: 8, color: "#e8e8ec", fontSize: "0.82rem",
            animation: "fadeIn 0.25s ease-out",
          }}>
            {t.msg}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function VideoCard({ video, isQueued, onToggleQueue }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#1e1e24" : "#18181c",
        border: `1px solid ${isQueued ? "rgba(45,204,112,0.3)" : hovered ? "#35353f" : "#2a2a32"}`,
        borderRadius: 12, overflow: "hidden", cursor: "pointer",
        transition: "all 0.2s", transform: hovered ? "translateY(-2px)" : "none",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", background: "#222228" }}>
        <img
          src={video.thumbnail}
          alt=""
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            transition: "transform 0.3s", transform: hovered ? "scale(1.03)" : "none",
          }}
        />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleQueue(); }}
          style={{
            position: "absolute", bottom: 8, right: 8, width: 36, height: 36, borderRadius: "50%",
            background: isQueued ? "#2dcc70" : "rgba(0,0,0,0.75)", border: `1px solid ${isQueued ? "#2dcc70" : "rgba(255,255,255,0.15)"}`,
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", opacity: hovered || isQueued ? 1 : 0, transition: "all 0.2s",
            backdropFilter: "blur(8px)", zIndex: 2,
          }}
        >
          {isQueued ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          )}
        </button>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{
          fontSize: "0.88rem", fontWeight: 500, lineHeight: 1.35, color: "#e8e8ec",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          marginBottom: 6,
        }}>
          {video.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.78rem", color: "#9090a0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {video.channelName}
          </span>
          <span style={{ fontSize: "0.72rem", color: "#606070", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
            {timeAgo(video.published)}
          </span>
        </div>
        <div style={{ fontSize: "0.72rem", color: "#606070", marginTop: 2 }}>
          {formatViews(video.views)} views
        </div>
      </div>
    </div>
  );
}
