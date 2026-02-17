const express = require("express");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

function sh(cmd) {
  return spawn("bash", ["-lc", cmd], { stdio: ["ignore", "pipe", "pipe"] });
}

function safePkgName(x) {
  return /^[a-z0-9.+-]+$/i.test(x || "");
}

/* ---------------------------
   API: repos
----------------------------*/
app.get("/api/repos", (req, res) => {
  const proc = sh("ls -1 $PREFIX/etc/apt/sources.list.d 2>/dev/null || true");
  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.on("close", () => {
    const repos = out
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((f) => f.replace(".list", ""));

    res.json({ ok: true, repos });
  });
});

/* ---------------------------
   API: featured packages
----------------------------*/
app.get("/api/featured", (req, res) => {
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

    { name: "curl", category: "Tools" },
    { name: "wget", category: "Tools" },
    { name: "zip", category: "Tools" },
    { name: "unzip", category: "Tools" },
    { name: "htop", category: "Tools" },

    { name: "openssh", category: "Network" },
    { name: "rsync", category: "Network" },

    { name: "proot", category: "Linux" },
    { name: "proot-distro", category: "Linux" },
    { name: "termux-services", category: "Linux" },

    { name: "chromium", category: "Browsers" },
    { name: "firefox", category: "Browsers" },

    { name: "xfce4", category: "Desktop" },
    { name: "xfce4-terminal", category: "Desktop" },
    { name: "thunar", category: "Desktop" },
    { name: "termux-x11-nightly", category: "Desktop" },
  ];

  res.json({ ok: true, packages });
});

/* ---------------------------
   API: all packages
----------------------------*/
app.get("/api/all", (req, res) => {
  // This pulls ALL packages from enabled Termux repos
  const proc = sh("apt-cache pkgnames | sort");
  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.on("close", () => {
    const list = out
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => x.length > 1)
      .filter((x) => safePkgName(x))
      .slice(0, 8000); // safety limit

    // Basic category guess (simple)
    const packages = list.map((name) => {
      let category = "Other";
      if (name.includes("python") || name.includes("node") || name.includes("java") || name.includes("jdk")) category = "Dev";
      else if (name.includes("xfce") || name.includes("x11") || name.includes("gtk") || name.includes("thunar")) category = "Desktop";
      else if (name.includes("vim") || name.includes("nano") || name.includes("emacs")) category = "Editors";
      else if (name.includes("ssh") || name.includes("curl") || name.includes("wget")) category = "Network";
      else if (name.includes("audio") || name.includes("pulseaudio")) category = "Media";
      return { name, category };
    });

    res.json({ ok: true, packages });
  });
});

/* ---------------------------
   API: installed
----------------------------*/
app.get("/api/installed", (req, res) => {
  const proc = sh("pkg list-installed");
  let out = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.on("close", () => {
    const installed = new Set();
    out.split("\n").forEach((line) => {
      const m = line.match(/^([a-z0-9.+-]+)/i);
      if (m) installed.add(m[1].trim());
    });
    res.json({ ok: true, installed: Array.from(installed) });
  });
});

/* ---------------------------
   API: install/remove stream
----------------------------*/
app.get("/api/stream", (req, res) => {
  const action = (req.query.action || "").toLowerCase();
  const pkg = (req.query.pkg || "").trim();

  if (!safePkgName(pkg)) return res.status(400).send("Invalid package");
  if (!["install", "remove"].includes(action)) return res.status(400).send("Invalid action");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const start = Date.now();

  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("meta", { action, pkg, start });
  send("stage", { stage: "Starting..." });

  const cmd =
    action === "install"
      ? `yes | pkg install ${pkg}`
      : `yes | pkg uninstall ${pkg}`;

  const proc = sh(cmd);

  const stageTimer = setInterval(() => {
    send("timer", { seconds: Math.floor((Date.now() - start) / 1000) });
  }, 1000);

  proc.stdout.on("data", (d) => {
    const text = d.toString();
    send("log", { text });

    if (text.includes("Need to get") || text.includes("Get:")) send("stage", { stage: "Downloading..." });
    else if (text.includes("Unpacking")) send("stage", { stage: "Installing..." });
    else if (text.includes("Setting up")) send("stage", { stage: "Configuring..." });
  });

  proc.stderr.on("data", (d) => send("log", { text: d.toString() }));

  proc.on("close", (code) => {
    clearInterval(stageTimer);
    const totalSeconds = Math.floor((Date.now() - start) / 1000);
    send("done", { ok: code === 0, code, totalSeconds });
    res.end();
  });
});

/* ---------------------------
   Default offline icon
----------------------------*/
app.get("/logos/default.svg", (req, res) => {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="24" fill="#111827"/>
  <text x="60" y="74" font-size="56" text-anchor="middle" fill="#e5e7eb">⌘</text>
</svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

/* ---------------------------
   UI
----------------------------*/
app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Termux Store</title>
<style>
:root{
  --bg:#0b0f14;--card:#111827;--text:#e5e7eb;--muted:#9ca3af;
  --border:rgba(255,255,255,.08);--green:#22c55e;--red:#ef4444;--blue:#60a5fa;
  --radius:18px;
}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui;background:radial-gradient(1000px 600px at 10% 0%,#0f172a,var(--bg));color:var(--text)}
header{padding:16px;position:sticky;top:0;background:rgba(11,15,20,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);z-index:10}
.wrap{max-width:1100px;margin:0 auto}
.top{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
h1{margin:0;font-size:18px;font-weight:900}
small{color:var(--muted)}
.controls{display:flex;gap:10px;flex-wrap:wrap}
input,select{background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:14px;font-size:14px;outline:none}
main{max-width:1100px;margin:0 auto;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.015));border:1px solid var(--border);border-radius:var(--radius);padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.row{display:flex;gap:12px;align-items:center}
.logo{width:48px;height:48px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden}
.logo img{width:70%;height:70%;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(0,0,0,.35))}
.pkg{margin:0;font-weight:900;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cat{margin:4px 0 0;font-size:12px;color:var(--muted)}
.badge{margin-top:6px;font-size:12px;color:#a7f3d0}
.btnRow{display:flex;gap:8px;margin-top:12px}
button{border:0;padding:10px 12px;border-radius:14px;cursor:pointer;font-weight:800;font-size:13px}
.install{background:rgba(34,197,94,.16);color:#bbf7d0;border:1px solid rgba(34,197,94,.35);flex:1}
.remove{background:rgba(239,68,68,.14);color:#fecaca;border:1px solid rgba(239,68,68,.3);flex:1}
.secondary{background:rgba(96,165,250,.12);color:#bfdbfe;border:1px solid rgba(96,165,250,.25)}
.progress{margin-top:12px;border-radius:16px;border:1px solid var(--border);background:rgba(0,0,0,.22);padding:12px;display:none}
.progressTop{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
.spinner{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:var(--blue);animation:spin .9s linear infinite;display:inline-block;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
pre{margin:0;max-height:160px;overflow:auto;font-size:11px;line-height:1.35;color:#cbd5e1;white-space:pre-wrap;word-break:break-word}
.repoLine{margin-top:6px;color:var(--muted);font-size:12px}
footer{padding:18px;text-align:center;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>Termux Store</h1>
        <small>Robust Store UI for pkg (Install / Remove / Logs)</small>
        <div id="repos" class="repoLine"></div>
      </div>
      <div class="controls">
        <input id="search" placeholder="Search packages..."/>
        <select id="category"><option value="all">All</option></select>
        <button id="loadAll" class="secondary">Load All Packages</button>
      </div>
    </div>
  </div>
</header>

<main>
  <div id="grid" class="grid"></div>
</main>

<footer>
Not affiliated with Termux. Termux is an open-source project by its respective developers.
</footer>

<script>
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const category = document.getElementById("category");
const reposEl = document.getElementById("repos");
const loadAllBtn = document.getElementById("loadAll");

let allPkgs = [];
let installedSet = new Set();
let loadedAll = false;

function iconName(pkg){
  const map = {
    nodejs:"node.js",
    chromium:"googlechrome",
    firefox:"firefox",
    git:"git",
    python:"python",
    neovim:"neovim",
    vim:"vim",
    nano:"gnu",
    xfce4:"xfce",
    "xfce4-terminal":"xfce",
    thunar:"xfce",
    "openjdk-17":"openjdk",
    "openjdk-21":"openjdk",
    openssh:"openssh",
    curl:"curl",
    wget:"gnu",
    htop:"linux",
    "termux-x11-nightly":"xorg"
  };
  return map[pkg] || pkg;
}

function formatTime(sec){
  const m = String(Math.floor(sec/60)).padStart(2,"0");
  const s = String(sec%60).padStart(2,"0");
  return m+":"+s;
}

function buildCard(p){
  const card = document.createElement("div");
  card.className = "card";
  const isInstalled = installedSet.has(p.name);

  card.innerHTML = \`
    <div class="row">
      <div class="logo">
        <img src="https://cdn.simpleicons.org/\${encodeURIComponent(iconName(p.name))}"
             onerror="this.onerror=null; this.src='/logos/default.svg';"
             alt="\${p.name}"/>
      </div>
      <div style="flex:1;min-width:0">
        <p class="pkg">\${p.name}</p>
        <p class="cat">\${p.category}</p>
        \${isInstalled ? '<div class="badge">✅ Installed</div>' : ''}
      </div>
    </div>

    <div class="btnRow">
      \${isInstalled ? '<button class="remove">Remove</button>' : '<button class="install">Install</button>'}
    </div>

    <div class="progress">
      <div class="progressTop">
        <div><span class="spinner"></span><b class="stage">Starting...</b></div>
        <div class="time">00:00</div>
      </div>
      <pre class="log"></pre>
    </div>
  \`;

  const installBtn = card.querySelector(".install");
  const removeBtn = card.querySelector(".remove");
  const progress = card.querySelector(".progress");
  const stage = card.querySelector(".stage");
  const time = card.querySelector(".time");
  const log = card.querySelector(".log");

  function run(action){
    progress.style.display = "block";
    stage.textContent = "Starting...";
    time.textContent = "00:00";
    log.textContent = "";

    if (installBtn) installBtn.disabled = true;
    if (removeBtn) removeBtn.disabled = true;

    const es = new EventSource(\`/api/stream?action=\${action}&pkg=\${encodeURIComponent(p.name)}\`);

    es.addEventListener("timer", e=>{
      const d = JSON.parse(e.data);
      time.textContent = formatTime(d.seconds);
    });

    es.addEventListener("stage", e=>{
      const d = JSON.parse(e.data);
      stage.textContent = d.stage;
    });

    es.addEventListener("log", e=>{
      const d = JSON.parse(e.data);
      log.textContent += d.text;
      log.scrollTop = log.scrollHeight;
    });

    es.addEventListener("done", async e=>{
      const d = JSON.parse(e.data);
      es.close();

      stage.textContent = d.ok ? "Done ✅" : "Failed ❌";
      time.textContent = formatTime(d.totalSeconds);

      await refreshInstalled();
      render();
    });
  }

  if (installBtn) installBtn.onclick = ()=>run("install");
  if (removeBtn) removeBtn.onclick = ()=>{
    if(confirm("Remove "+p.name+" ?")) run("remove");
  };

  return card;
}

function render(){
  const q = search.value.trim().toLowerCase();
  const cat = category.value;
  grid.innerHTML = "";

  const filtered = allPkgs.filter(p=>{
    const okQ = !q || p.name.toLowerCase().includes(q);
    const okC = cat==="all" || p.category===cat;
    return okQ && okC;
  });

  filtered.slice(0, 400).forEach(p=>grid.appendChild(buildCard(p)));
}

async function refreshInstalled(){
  const r = await fetch("/api/installed");
  const j = await r.json();
  installedSet = new Set(j.installed || []);
}

async function loadRepos(){
  const r = await fetch("/api/repos");
  const j = await r.json();
  const repos = j.repos || [];
  reposEl.textContent = repos.length ? ("Enabled repos: " + repos.join(", ")) : "Enabled repos: (not detected)";
}

function updateCategories(){
  category.innerHTML = '<option value="all">All</option>';
  const cats = Array.from(new Set(allPkgs.map(p=>p.category))).sort();
  cats.forEach(c=>{
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    category.appendChild(o);
  });
}

async function init(){
  await loadRepos();

  const r = await fetch("/api/featured");
  const j = await r.json();
  allPkgs = j.packages || [];

  updateCategories();
  await refreshInstalled();
  render();
}

loadAllBtn.onclick = async ()=>{
  if(loadedAll) return;
  loadAllBtn.textContent = "Loading...";
  loadAllBtn.disabled = true;

  const r = await fetch("/api/all");
  const j = await r.json();
  const full = j.packages || [];

  // Merge featured + full, unique
  const map = new Map();
  allPkgs.forEach(p=>map.set(p.name, p));
  full.forEach(p=>map.set(p.name, p));

  allPkgs = Array.from(map.values()).sort((a,b)=>a.name.localeCompare(b.name));
  loadedAll = true;

  updateCategories();
  await refreshInstalled();
  render();

  loadAllBtn.textContent = "All Loaded ✅";
};

search.oninput = render;
category.onchange = render;

init();
</script>
</body>
</html>`);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("Termux Store running at http://localhost:" + PORT);
});
