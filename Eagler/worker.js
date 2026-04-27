export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const GITHUB_USER = "chessgrandest-prog";
    const GITHUB_REPO = "fun";
    const GITHUB_BRANCH = "main";
    const GITHUB_DIR = "Eagler";
    const RESOURCE_PACKS_DIR = "Eagler/Resource Packs";   // Change if your folder name is different

    async function fetchRepoTree() {
      const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/git/trees/${GITHUB_BRANCH}?recursive=1`;
      const resp = await fetch(apiUrl, {
        headers: { "User-Agent": "Cloudflare-Worker" },
      });
      if (!resp.ok) throw new Error("GitHub API error");
      const data = await resp.json();
      return data.tree;
    }

    // --- Launcher Page ---
    if (path === "/" || path === "/index.html") {
      try {
        const tree = await fetchRepoTree();
        const htmlFiles = tree
          .filter(item => item.path.startsWith(GITHUB_DIR) && item.path.endsWith(".html"))
          .map(item => item.path);

        // Build image map and grab logo/favicon
        const imageMap = {};
        let logoUrl = null;
        let faviconUrl = null;

        const imageTree = tree.filter(
          item =>
            item.path.startsWith(`${GITHUB_DIR}/images`) &&
            /\.(png|jpg|jpeg|gif|webp)$/i.test(item.path)
        );

        for (const item of imageTree) {
          const base = item.path.split("/").pop().replace(/\.[^.]+$/, "");
          const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${item.path}`;
          imageMap[base] = rawUrl;

          // Match specific images (case-insensitive base name)
          const lowerName = item.path.split("/").pop().toLowerCase();
          if (lowerName === "logo.png") logoUrl = rawUrl;
          else if (lowerName === "google docs.png") faviconUrl = rawUrl;
        }

        return new Response(generateLauncherHtml(htmlFiles, imageMap, logoUrl, faviconUrl), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      } catch (e) {
        return new Response(generateLauncherHtml([], {}, null, null), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      }
    }

    // --- Resource Packs Page ---
    if (path === "/packs" || path === "/packs/") {
      try {
        const tree = await fetchRepoTree();
        const packs = [];

        const zipFiles = tree.filter(
          item => item.path.startsWith(RESOURCE_PACKS_DIR) && item.path.endsWith(".zip")
        );

        for (const zip of zipFiles) {
          const baseName = zip.path.split("/").pop().replace(/\.zip$/i, "");
          const dirPath = zip.path.substring(0, zip.path.lastIndexOf("/"));

          // Look for a matching .png thumbnail in the same folder
          const thumbItem = tree.find(
            item =>
              item.path.startsWith(dirPath + "/") &&
              item.path.endsWith(".png") &&
              item.path.split("/").pop().replace(/\.png$/i, "") === baseName
          );

          const thumbnailUrl = thumbItem
            ? `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${thumbItem.path}`
            : null;

          const zipUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${zip.path}`;

          packs.push({
            name: baseName.replace(/_/g, " "),
            zipUrl,
            thumbnailUrl: thumbnailUrl || "",
          });
        }

        return new Response(generatePacksHtml(packs), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      } catch (e) {
        return new Response(generatePacksHtml([]), {
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      }
    }

    // --- Game Proxy ---
    if (path.startsWith("/play/")) {
      const filePath = path.slice("/play/".length);
      const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
      const resp = await fetch(rawUrl, {
        headers: { "User-Agent": "Cloudflare-Worker" },
      });

      if (!resp.ok) return new Response("File not found", { status: 404 });

      const ext = filePath.split(".").pop()?.toLowerCase();
      const mimeMap = {
        html: "text/html;charset=UTF-8",
        js: "application/javascript",
        wasm: "application/wasm",
        css: "text/css",
        png: "image/png",
        jpg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
      };

      const newHeaders = new Headers(resp.headers);
      newHeaders.set("Content-Type", mimeMap[ext] || "application/octet-stream");
      newHeaders.set(
        "Content-Security-Policy",
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; font-src * data:;"
      );
      newHeaders.delete("X-Frame-Options");
      newHeaders.delete("Content-Security-Policy-Report-Only");

      if (ext === "html") {
        let text = await resp.text();
        text = text.replace(/<meta\s+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");
        return new Response(text, { headers: newHeaders });
      }

      return new Response(resp.body, { headers: newHeaders });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ================== HTML Generators ==================

function generateLauncherHtml(fileList, imageMap, logoUrl, faviconUrl) {
  const gamesJson = JSON.stringify(fileList);
  const imageMapJson = JSON.stringify(imageMap);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Google Docs</title>
<link rel="icon" type="image/png" href="${faviconUrl || ''}">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>
  :root {
    --neon-g: #39ff14;
    --neon-b: #bc13fe;   /* purple accent */
    --neon-p: #bc13fe;
    --bg: #030303;
    --card-bg: rgba(12, 12, 12, 0.9);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; cursor: crosshair; }

  body {
    background-color: var(--bg);
    color: #fff;
    font-family: 'Press Start 2P', cursive;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .crt-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), 
                linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(188, 19, 254, 0.03));
    background-size: 100% 3px, 2px 100%;
    z-index: 100;
    pointer-events: none;
  }

  .scanline {
    width: 100%; height: 100px;
    z-index: 101;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, rgba(57, 255, 20, 0.05) 50%, rgba(0, 0, 0, 0) 100%);
    opacity: 0.1;
    position: absolute;
    bottom: 100%;
    animation: scanline 8s linear infinite;
  }

  @keyframes scanline { 0% { bottom: 100%; } 100% { bottom: -100px; } }

  .header {
    background: #000;
    padding: 30px 20px 40px;
    border-bottom: 4px solid var(--neon-g);
    box-shadow: 0 0 20px rgba(57, 255, 20, 0.4);
    text-align: center;
    position: relative;
    z-index: 10;
  }

  .logo {
    position: absolute;
    top: 15px;
    left: 20px;
    width: 150px;
    height: auto;
    image-rendering: pixelated;
    transition: transform 0.2s;
    z-index: 11;
  }

  .logo:hover {
    transform: scale(1.1);
    filter: drop-shadow(0 0 5px var(--neon-b));
  }

  .title {
    font-size: 2.2rem;
    color: var(--neon-g);
    text-shadow: 3px 3px 0 #000, 0 0 15px var(--neon-g);
    margin-bottom: 30px;
    letter-spacing: -2px;
    margin-left: 30px;
  }

  .filter-bar, .nav-bar {
    display: flex;
    justify-content: center;
    gap: 15px;
    flex-wrap: wrap;
    max-width: 900px;
    margin: 0 auto;
  }

  .btn {
    background: #000;
    border: 2px solid #333;
    color: #555;
    padding: 14px 20px;
    font-family: inherit;
    font-size: 0.65rem;
    transition: 0.1s;
    box-shadow: 4px 4px 0 #000;
    text-decoration: none;
    display: inline-block;
    cursor: pointer;
  }

  .btn:hover { border-color: #fff; color: #fff; transform: translate(-2px, -2px); box-shadow: 6px 6px 0 #000; }
  
  .btn.active {
    background: var(--neon-g);
    color: #000;
    border-color: #fff;
    box-shadow: 0 0 15px var(--neon-g);
    transform: translate(2px, 2px);
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 40px 20px;
    scrollbar-width: none;
    background: radial-gradient(circle at center, #111 0%, #000 100%);
  }

  .game-grid, .packs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 30px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .slab {
    background: var(--card-bg);
    border: 3px solid #222;
    padding: 20px;
    position: relative;
    transition: 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .slab::before {
    content: "";
    position: absolute; top: 0; left: 0; width: 4px; height: 100%;
    background: var(--neon-b);
  }

  .slab:hover {
    border-color: var(--neon-b);
    background: #000;
    box-shadow: 10px 10px 0 var(--neon-b);
    transform: translate(-10px, -10px);
  }

  .thumb {
    width: 100%;
    height: 140px;
    object-fit: cover;
    border: 2px solid #333;
    image-rendering: pixelated;
    background: #111;
    transition: border-color 0.2s;
  }

  .slab:hover .thumb {
    border-color: var(--neon-b);
  }

  .slab h3 { font-size: 0.8rem; letter-spacing: 1px; color: #fff; text-shadow: 2px 2px 0 #000; }

  .badge-container { display: flex; gap: 10px; }

  .tag {
    font-size: 0.5rem;
    padding: 6px 10px;
    background: #111;
    border: 1px solid #444;
  }

  .tag.legit { color: var(--neon-g); border-color: var(--neon-g); }
  .tag.hacks { color: #ff3e3e; border-color: #ff3e3e; }
  .tag.ver { color: var(--neon-p); border-color: var(--neon-p); }

  .play-hint {
    margin-top: auto;
    font-size: 0.55rem;
    color: var(--neon-b);
    opacity: 0;
    transition: 0.3s;
  }
  .slab:hover .play-hint { opacity: 1; }

  .download-btn {
    margin-top: auto;
    background: var(--neon-b);
    color: #000;
    border-color: var(--neon-b);
    font-size: 0.6rem;
    text-align: center;
  }
  .download-btn:hover {
    background: #000;
    color: var(--neon-b);
    border-color: var(--neon-b);
  }

  .back-btn {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 12;
  }

  .footer {
    padding: 20px;
    font-size: 0.5rem;
    color: #444;
    text-align: center;
    border-top: 1px solid #222;
    background: #000;
  }
</style>
</head>
<body>

<div class="crt-overlay"></div>
<div class="scanline"></div>

<header class="header">
  ${logoUrl ? `<a href="/"><img src="${logoUrl}" alt="Logo" class="logo"></a>` : ''}
  <h1 class="title">NEON EAGLER</h1>
  <div class="nav-bar">
    <a class="btn" href="/packs">RESOURCE PACKS</a>
  </div>
  <div class="filter-bar" style="margin-top: 15px;">
    <button class="btn" data-type="type" data-val="Legit">LEGIT</button>
    <button class="btn" data-type="type" data-val="Hacks">HACKS</button>
    <button class="btn" data-type="version" data-val="1.8.8">V1.8.8</button>
    <button class="btn" data-type="version" data-val="1.12">V1.12</button>
  </div>
</header>

<main class="content">
  <div id="grid" class="game-grid"></div>
</main>

<footer class="footer">
  TERMINAL STATUS: ONLINE // USER: ADMIN // ENCRYPTION: ACTIVE
</footer>

<script>
  const GAMES = ${gamesJson};
  const IMAGES = ${imageMapJson};
  let filters = { type: new Set(), version: new Set() };

  function parse(path) {
    const s = path.split('/');
    return { type: s[1], version: s[2], name: (s[3]||"").replace(".html",""), path: path };
  }

  function render() {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    const filtered = GAMES.filter(p => {
      const info = parse(p);
      const t = filters.type.size === 0 || filters.type.has(info.type);
      const v = filters.version.size === 0 || filters.version.has(info.version);
      return t && v;
    });

    filtered.forEach(p => {
      const info = parse(p);
      const imgUrl = IMAGES[info.name] || null;

      const div = document.createElement('div');
      div.className = 'slab';
      div.innerHTML = \`
        \${imgUrl ? \`<img src="\${imgUrl}" alt="\${info.name}" class="thumb" loading="lazy" onerror="this.style.display='none'">\` : ''}
        <h3>\${info.name}</h3>
        <div class="badge-container">
          <span class="tag \${info.type.toLowerCase()}">\${info.type.toUpperCase()}</span>
          <span class="tag ver">v\${info.version}</span>
        </div>
        <div class="play-hint">> INITIALIZE_GAME</div>
      \`;
      div.onclick = () => window.location.href = '/play/' + info.path;
      grid.appendChild(div);
    });
  }

  document.querySelectorAll('.btn:not(a)').forEach(b => {
    b.onclick = () => {
      const { type, val } = b.dataset;
      filters[type].has(val) ? filters[type].delete(val) : filters[type].add(val);
      b.classList.toggle('active');
      render();
    };
  });

  render();
</script>
</body>
</html>`;
}

function generatePacksHtml(packs) {
  const cards = packs
    .map(
      p => `
    <div class="slab">
      ${
        p.thumbnailUrl
          ? `<img src="${p.thumbnailUrl}" alt="${p.name}" class="thumb" loading="lazy" onerror="this.style.display='none'">`
          : ""
      }
      <h3>${p.name}</h3>
      <a class="btn download-btn" href="${p.zipUrl}" download>DOWNLOAD</a>
    </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Resource Packs</title>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>
  :root {
    --neon-g: #39ff14;
    --neon-b: #bc13fe;
    --bg: #030303;
    --card-bg: rgba(12, 12, 12, 0.9);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; cursor: crosshair; }

  body {
    background-color: var(--bg);
    color: #fff;
    font-family: 'Press Start 2P', cursive;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .crt-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), 
                linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(188, 19, 254, 0.03));
    background-size: 100% 3px, 2px 100%;
    z-index: 100;
    pointer-events: none;
  }

  .scanline {
    width: 100%; height: 100px;
    z-index: 101;
    background: linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, rgba(57, 255, 20, 0.05) 50%, rgba(0, 0, 0, 0) 100%);
    opacity: 0.1;
    position: absolute;
    bottom: 100%;
    animation: scanline 8s linear infinite;
  }

  @keyframes scanline { 0% { bottom: 100%; } 100% { bottom: -100px; } }

  .header {
    background: #000;
    padding: 25px 20px 25px;
    border-bottom: 4px solid var(--neon-g);
    box-shadow: 0 0 20px rgba(57, 255, 20, 0.4);
    text-align: center;
    position: relative;
    z-index: 10;
  }

  .back-btn {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 12;
  }

  .title {
    font-size: 1.8rem;
    color: var(--neon-g);
    text-shadow: 3px 3px 0 #000, 0 0 15px var(--neon-g);
    letter-spacing: -1px;
  }

  .btn {
    background: #000;
    border: 2px solid #333;
    color: #555;
    padding: 12px 18px;
    font-family: inherit;
    font-size: 0.6rem;
    transition: 0.1s;
    box-shadow: 4px 4px 0 #000;
    text-decoration: none;
    display: inline-block;
    cursor: pointer;
  }

  .btn:hover { border-color: #fff; color: #fff; transform: translate(-2px, -2px); box-shadow: 6px 6px 0 #000; }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 40px 20px;
    scrollbar-width: none;
    background: radial-gradient(circle at center, #111 0%, #000 100%);
  }

  .packs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 30px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .slab {
    background: var(--card-bg);
    border: 3px solid #222;
    padding: 20px;
    position: relative;
    transition: 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .slab::before {
    content: "";
    position: absolute; top: 0; left: 0; width: 4px; height: 100%;
    background: var(--neon-b);
  }

  .slab:hover {
    border-color: var(--neon-b);
    background: #000;
    box-shadow: 10px 10px 0 var(--neon-b);
    transform: translate(-10px, -10px);
  }

  .thumb {
    width: 100%;
    height: 140px;
    object-fit: cover;
    border: 2px solid #333;
    image-rendering: pixelated;
    background: #111;
    transition: border-color 0.2s;
  }

  .slab:hover .thumb {
    border-color: var(--neon-b);
  }

  .slab h3 { font-size: 0.8rem; letter-spacing: 1px; color: #fff; text-shadow: 2px 2px 0 #000; }

  .download-btn {
    margin-top: auto;
    background: var(--neon-b);
    color: #000;
    border-color: var(--neon-b);
    font-size: 0.6rem;
    text-align: center;
  }
  .download-btn:hover {
    background: #000;
    color: var(--neon-b);
    border-color: var(--neon-b);
  }

  .empty-message {
    text-align: center;
    font-size: 0.8rem;
    color: #555;
    margin-top: 80px;
  }

  .footer {
    padding: 20px;
    font-size: 0.5rem;
    color: #444;
    text-align: center;
    border-top: 1px solid #222;
    background: #000;
  }
</style>
</head>
<body>
<div class="crt-overlay"></div>
<div class="scanline"></div>

<header class="header">
  <a class="btn back-btn" href="/">← BACK</a>
  <h1 class="title">RESOURCE PACKS</h1>
</header>

<main class="content">
  <div class="packs-grid">
    ${cards || '<div class="empty-message">NO RESOURCE PACKS FOUND</div>'}
  </div>
</main>

<footer class="footer">
  TERMINAL STATUS: ONLINE // DOWNLOAD PROTOCOL: ACTIVE
</footer>
</body>
</html>`;
}