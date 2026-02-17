const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------------
   Helpers
----------------------------*/

function runCmdStreaming(cmd, args = []) {
  // Returns: { proc, id }
  const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  return proc;
}

function nowMs() {
  return Date.now();
}

/* ---------------------------
   API: list packages
----------------------------*/

app.get("/api/packages", (req, res) => {
  // Simple curated list (fast, stable)
  // You can expand this list anytime.
  const packages = [
    { name: "git", category: "Dev" },
    { name: "python", category: "Dev" },
    { name: "nodejs", category: "Dev" },
    { name: "openjdk-21", category: "Dev" },
    { name: "clang", category: "Dev" },
    { name: "make", category: "Dev" },
    { name: "cmake", category: "Dev" },
    { name: "vim", category: "Editors" },
    { name: "neovim", category: "Editors" },
    { name: "nano", category: "Editors" },
    { name: "htop", category: "Tools" },
    { name: "curl", category: "Tools" },
    { name: "wget", category: "Tools" },
    { name: "zip", category: "Tools" },
    { name: "unzip", category: "Tools" },
    { name: "proot", category: "Linux" },
    { name: "proot-distro", category: "Linux" },
    { name: "termux-services", category: "Linux" },
    { name: "openssh", category: "Network" },
    { name: "rsync", category: "Network" },
    { name: "chromium", category: "Browsers" },
    { name: "firefox", category: "Browsers" },
    { name: "xfce4", category: "Desktop" },
    { name: "xfce4-terminal", category: "Desktop" },
    { name: "thunar", category: "Desktop" },
    { name: "termux-x11-nightly", category: "Desktop" },
  ];

  res.json({
    ok: true,
    packages,
  });
});

/* ---------------------------
   API: installed packages
----------------------------*/

app.get("/api/installed", (req, res) => {
  const proc = spawn("bash", ["-lc", "pkg list-installed"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.on("close", () => {
    // pkg list-installed output format:
    // package/stable,now version arch [installed]
    const installed = new Set();
    out.split("\n").forEach((line) => {
      const m = line.match(/^([a-z0-9.+-]+)/i);
      if (m) installed.add(m[1].trim());
    });

    res.json({ ok: true, installed: Array.from(installed) });
  });
});

/* ---------------------------
   API: install / remove (stream)
----------------------------*/

app.get("/api/stream", (req, res) => {
  // SSE (Server Sent Events)
  // client passes ?action=install&pkg=python
  const action = (req.query.action || "").toLowerCase();
  const pkg = (req.query.pkg || "").trim();

  if (!pkg || !/^[a-z0-9.+-]+$/i.test(pkg)) {
    return res.status(400).send("Invalid package name");
  }

  if (!["install", "remove"].includes(action)) {
    return res.status(400).send("Invalid action");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const start = nowMs();

  // stage events
  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("meta", { action, pkg, start });

  const args =
    action === "install"
      ? ["-lc", `yes | pkg install ${pkg}`]
      : ["-lc", `yes | pkg uninstall ${pkg}`];

  const proc = spawn("bash", args, { stdio: ["ignore", "pipe", "pipe"] });

  // Fake stages (works reliably)
  let stage = "Starting...";
  send("stage", { stage });

  const stageTimer = setInterval(() => {
    const t = Math.floor((nowMs() - start) / 1000);
    send("timer", { seconds: t });
  }, 1000);

  proc.stdout.on("data", (d) => {
    const text = d.toString();
    send("log", { text });

    // Detect stages
    if (text.includes("Need to get") || text.includes("Get:")) {
      stage = "Downloading...";
      send("stage", { stage });
    } else if (text.includes("Unpacking")) {
      stage = "Installing...";
      send("stage", { stage });
    } else if (text.includes("Setting up")) {
      stage = "Configuring...";
      send("stage", { stage });
    }
  });

  proc.stderr.on("data", (d) => {
    send("log", { text: d.toString() });
  });

  proc.on("close", (code) => {
    clearInterval(stageTimer);
    const totalSeconds = Math.floor((nowMs() - start) / 1000);

    if (code === 0) {
      send("done", { ok: true, code, totalSeconds });
    } else {
      send("done", { ok: false, code, totalSeconds });
    }
    res.end();
  });
});

/* ---------------------------
   UI Route
----------------------------*/

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Termux Store</title>
  <style>
    :root{
      --bg:#0b0f14;
      --card:#111827;
      --card2:#0f172a;
      --text:#e5e7eb;
      --muted:#9ca3af;
      --border:rgba(255,255,255,.08);
      --accent:#22c55e;
      --danger:#ef4444;
      --warn:#f59e0b;
      --blue:#60a5fa;
      --radius:18px;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Arial;
      background: radial-gradient(1200px 600px at 10% 0%, #0f172a, var(--bg));
      color:var(--text);
    }
    header{
      padding:18px 16px 10px;
      position:sticky;
      top:0;
      background:rgba(11,15,20,.92);
      backdrop-filter: blur(10px);
      border-bottom:1px solid var(--border);
      z-index:10;
    }
    .topbar{
      display:flex;
      gap:12px;
      align-items:center;
      justify-content:space-between;
      max-width:1100px;
      margin:0 auto;
    }
    .brand{
      display:flex;
      flex-direction:column;
      line-height:1.1;
    }
    .brand h1{
      font-size:18px;
      margin:0;
      font-weight:800;
      letter-spacing:.2px;
    }
    .brand p{
      margin:2px 0 0;
      font-size:12px;
      color:var(--muted);
    }
    .controls{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    input, select{
      background:rgba(255,255,255,.04);
      border:1px solid var(--border);
      color:var(--text);
      padding:10px 12px;
      border-radius:14px;
      outline:none;
      font-size:14px;
    }
    input{width:220px; max-width:70vw;}
    main{
      max-width:1100px;
      margin:0 auto;
      padding:16px;
    }
    .grid{
      display:grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap:14px;
    }
    .card{
      background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
      border:1px solid var(--border);
      border-radius: var(--radius);
      padding:14px;
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
      overflow:hidden;
      position:relative;
    }
    .row{
      display:flex;
      gap:12px;
      align-items:center;
    }
    .logo{
      width:48px;
      height:48px;
      border-radius:16px;
      background:rgba(255,255,255,.06);
      border:1px solid var(--border);
      display:flex;
      align-items:center;
      justify-content:center;
      overflow:hidden;
      flex:0 0 auto;
    }
    .logo img{
      width:70%;
      height:70%;
      object-fit:contain;
      filter: drop-shadow(0 8px 14px rgba(0,0,0,.35));
    }
    .meta{
      flex:1;
      min-width:0;
    }
    .pkg{
      font-weight:800;
      font-size:15px;
      margin:0;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .cat{
      margin:4px 0 0;
      font-size:12px;
      color:var(--muted);
    }
    .btnRow{
      display:flex;
      gap:8px;
      margin-top:12px;
    }
    button{
      border:0;
      padding:10px 12px;
      border-radius:14px;
      cursor:pointer;
      font-weight:700;
      font-size:13px;
      transition: transform .06s ease, opacity .15s ease;
    }
    button:active{ transform: scale(.98); }
    .install{
      background:rgba(34,197,94,.16);
      color:#bbf7d0;
      border:1px solid rgba(34,197,94,.35);
      flex:1;
    }
    .remove{
      background:rgba(239,68,68,.14);
      color:#fecaca;
      border:1px solid rgba(239,68,68,.3);
      flex:1;
    }
    .installedBadge{
      display:inline-flex;
      align-items:center;
      gap:6px;
      font-size:12px;
      color:#a7f3d0;
      margin-top:6px;
    }
    .progressBox{
      margin-top:12px;
      border-radius:16px;
      border:1px solid var(--border);
      background:rgba(0,0,0,.22);
      padding:12px;
      display:none;
    }
    .progressTop{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      margin-bottom:8px;
    }
    .stage{
      font-weight:800;
      font-size:13px;
    }
    .timer{
      font-size:12px;
      color:var(--muted);
    }
    .spinner{
      width:16px;
      height:16px;
      border-radius:50%;
      border:2px solid rgba(255,255,255,.18);
      border-top-color: var(--blue);
      animation: spin .9s linear infinite;
      display:inline-block;
      margin-right:8px;
    }
    @keyframes spin{ to{ transform: rotate(360deg); } }
    pre{
      margin:0;
      max-height:160px;
      overflow:auto;
      font-size:11px;
      line-height:1.35;
      color:#cbd5e1;
      white-space:pre-wrap;
      word-break:break-word;
    }
    footer{
      padding:18px 16px 28px;
      text-align:center;
      color:var(--muted);
      font-size:12px;
    }
    .hint{
      color:var(--muted);
      font-size:12px;
      margin:10px 0 14px;
    }
  </style>
</head>
<body>
<header>
  <div class="topbar">
    <div class="brand">
      <h1>Termux Store</h1>
      <p>Community UI for pkg • Install / Remove • Live logs</p>
    </div>

    <div class="controls">
      <input id="search" placeholder="Search packages..." />
      <select id="category">
        <option value="all">All</option>
      </select>
    </div>
  </div>
</header>

<main>
  <div class="hint">
    Tip: Real brand icons load online. If offline, a default icon will show.
  </div>
  <div id="grid" class="grid"></div>
</main>

<footer>
  Not affiliated with Termux. Termux is an open-source project by its respective developers.
</footer>

<script>
  const grid = document.getElementById("grid");
  const search = document.getElementById("search");
  const category = document.getElementById("category");

  let allPkgs = [];
  let installedSet = new Set();

  function iconName(pkg){
    // SimpleIcons mapping
    const map = {
      nodejs: "node.js",
      chromium: "googlechrome",
      openjdk: "openjdk",
      "openjdk-17": "openjdk",
      "openjdk-21": "openjdk",
      xfce4: "xfce",
      "xfce4-terminal": "xfce",
      termux: "android",
      "termux-x11-nightly": "xorg",
      neovim: "neovim",
      vim: "vim",
      nano: "gnu",
      python: "python",
      git: "git",
      curl: "curl",
      wget: "gnu",
      openssh: "openssh",
      firefox: "firefox",
      htop: "linux",
      proot: "linux",
      "proot-distro": "linux",
    };
    return map[pkg] || pkg;
  }

  function formatTime(sec){
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function buildCard(p){
    const card = document.createElement("div");
    card.className = "card";

    const isInstalled = installedSet.has(p.name);

    card.innerHTML = \`
      <div class="row">
        <div class="logo">
          <img
            src="https://cdn.simpleicons.org/\${encodeURIComponent(iconName(p.name))}"
            onerror="this.onerror=null; this.src='/logos/default.svg';"
            alt="\${p.name}"
          />
        </div>
        <div class="meta">
          <p class="pkg">\${p.name}</p>
          <p class="cat">\${p.category}</p>
          \${isInstalled ? '<div class="installedBadge">✅ Installed</div>' : ''}
        </div>
      </div>

      <div class="btnRow">
        \${isInstalled
          ? '<button class="remove">Remove</button>'
          : '<button class="install">Install</button>'}
      </div>

      <div class="progressBox">
        <div class="progressTop">
          <div class="stage"><span class="spinner"></span><span class="stageText">Starting...</span></div>
          <div class="timer">00:00</div>
        </div>
        <pre class="log"></pre>
      </div>
    \`;

    const installBtn = card.querySelector(".install");
    const removeBtn = card.querySelector(".remove");
    const progressBox = card.querySelector(".progressBox");
    const stageText = card.querySelector(".stageText");
    const timerEl = card.querySelector(".timer");
    const logEl = card.querySelector(".log");

    function run(action){
      progressBox.style.display = "block";
      logEl.textContent = "";
      stageText.textContent = "Starting...";
      timerEl.textContent = "00:00";

      // disable buttons
      if (installBtn) installBtn.disabled = true;
      if (removeBtn) removeBtn.disabled = true;

      const url = \`/api/stream?action=\${action}&pkg=\${encodeURIComponent(p.name)}\`;
      const es = new EventSource(url);

      es.addEventListener("timer", (e)=>{
        const data = JSON.parse(e.data);
        timerEl.textContent = formatTime(data.seconds);
      });

      es.addEventListener("stage", (e)=>{
        const data = JSON.parse(e.data);
        stageText.textContent = data.stage;
      });

      es.addEventListener("log", (e)=>{
        const data = JSON.parse(e.data);
        logEl.textContent += data.text;
        logEl.scrollTop = logEl.scrollHeight;
      });

      es.addEventListener("done", async (e)=>{
        const data = JSON.parse(e.data);
        es.close();

        stageText.textContent = data.ok ? "Done ✅" : "Failed ❌";
        timerEl.textContent = formatTime(data.totalSeconds);

        await refreshInstalled();
        render();
      });
    }

    if (installBtn){
      installBtn.addEventListener("click", ()=>{
        run("install");
      });
    }

    if (removeBtn){
      removeBtn.addEventListener("click", ()=>{
        if (!confirm("Remove " + p.name + " ?")) return;
        run("remove");
      });
    }

    return card;
  }

  function render(){
    const q = search.value.trim().toLowerCase();
    const cat = category.value;

    grid.innerHTML = "";

    const filtered = allPkgs.filter(p=>{
      const matchQ = !q || p.name.toLowerCase().includes(q);
      const matchCat = (cat === "all") || (p.category === cat);
      return matchQ && matchCat;
    });

    filtered.forEach(p=>{
      grid.appendChild(buildCard(p));
    });
  }

  async function refreshInstalled(){
    const r = await fetch("/api/installed");
    const j = await r.json();
    installedSet = new Set(j.installed || []);
  }

  async function init(){
    const r = await fetch("/api/packages");
    const j = await r.json();
    allPkgs = j.packages || [];

    // categories
    const cats = Array.from(new Set(allPkgs.map(p=>p.category))).sort();
    cats.forEach(c=>{
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      category.appendChild(o);
    });

    await refreshInstalled();
    render();
  }

  search.addEventListener("input", render);
  category.addEventListener("change", render);

  init();
</script>
</body>
</html>`);
});

/* ---------------------------
   Ensure default icon exists
----------------------------*/

app.get("/logos/default.svg", (req, res) => {
  const defaultSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="24" fill="#111827"/>
  <text x="60" y="74" font-size="56" text-anchor="middle" fill="#e5e7eb">⌘</text>
</svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(defaultSvg);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("Termux Store running on http://localhost:" + PORT);
});
