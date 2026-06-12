var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
__name(hashPassword, "hashPassword");
function base64urlEncode(source) {
  let encoded = btoa(String.fromCharCode.apply(null, new Uint8Array(source))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return encoded;
}
__name(base64urlEncode, "base64urlEncode");
function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(base64urlDecode, "base64urlDecode");
async function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encoder = new TextEncoder();
  const headB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  const payB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(headB64 + "." + payB64)
  );
  const sigB64 = base64urlEncode(signature);
  return headB64 + "." + payB64 + "." + sigB64;
}
__name(signToken, "signToken");
async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = parts[0];
  const payload = parts[1];
  const signature = parts[2];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signature),
    encoder.encode(header + "." + payload)
  );
  if (!isValid) return null;
  return JSON.parse(new TextDecoder().decode(base64urlDecode(payload)));
}
__name(verifyToken, "verifyToken");
function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [name, ...rest] = cookie.split("=");
    acc[name.trim()] = rest.join("=").trim();
    return acc;
  }, {});
}
__name(parseCookies, "parseCookies");
async function authenticate(request, env) {
  const cookies = parseCookies(request);
  const token = cookies["token"];
  if (!token) return null;
  const secret = env.JWT_SECRET || "super-secret-arcade-key-2026";
  return await verifyToken(token, secret);
}
__name(authenticate, "authenticate");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      try {
        if (request.method === "POST" && path === "/api/register") {
          const body = await request.json();
          if (!body.username || !body.password) {
            return new Response(JSON.stringify({ error: "Username and password required" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const hashedPassword = await hashPassword(body.password);
          try {
            const res = await env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(body.username, hashedPassword).run();
            const userId = res.meta.last_row_id;
            await env.DB.prepare("INSERT INTO user_data (user_id) VALUES (?)").bind(userId).run();
            return new Response(JSON.stringify({ success: true, message: "User registered successfully" }), { headers: { "Content-Type": "application/json" } });
          } catch (e) {
            if (e.message.includes("UNIQUE")) {
              return new Response(JSON.stringify({ error: "Username already exists" }), { status: 400, headers: { "Content-Type": "application/json" } });
            }
            throw e;
          }
        }
        if (request.method === "POST" && path === "/api/login") {
          const body = await request.json();
          const user2 = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(body.username).first();
          if (!user2) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const validPassword = await hashPassword(body.password) === user2.password_hash;
          if (!validPassword) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const secret = env.JWT_SECRET || "super-secret-arcade-key-2026";
          const token = await signToken({ id: user2.id, username: user2.username }, secret);
          return new Response(JSON.stringify({
            success: true,
            user: { id: user2.id, username: user2.username, profile_picture_url: user2.profile_picture_url }
          }), {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `token=${token}; HttpOnly; Max-Age=2592000; Path=/`
            }
          });
        }
        if (request.method === "POST" && path === "/api/logout") {
          return new Response(JSON.stringify({ success: true }), {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "token=; HttpOnly; Max-Age=0; Path=/"
            }
          });
        }
        const user = await authenticate(request, env);
        if (!user && path !== "/api/login" && path !== "/api/register" && path !== "/api/logout") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        if (request.method === "GET" && path === "/api/me") {
          const dbUser = await env.DB.prepare("SELECT id, username, profile_picture_url FROM users WHERE id = ?").bind(user.id).first();
          if (!dbUser) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
          return new Response(JSON.stringify({ user: dbUser }), { headers: { "Content-Type": "application/json" } });
        }
        if (request.method === "POST" && path === "/api/profile/picture") {
          const formData = await request.formData();
          const file = formData.get("avatar");
          if (!file) return new Response(JSON.stringify({ error: "No file uploaded" }), { status: 400, headers: { "Content-Type": "application/json" } });
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
          const ext = file.name ? file.name.substring(file.name.lastIndexOf(".")) : "";
          const key = user.id + "-" + uniqueSuffix + ext;
          await env.PROFILE_PICTURES.put(key, file.stream(), {
            httpMetadata: { contentType: file.type || "application/octet-stream" }
          });
          const fileUrl = "/uploads/" + key;
          await env.DB.prepare("UPDATE users SET profile_picture_url = ? WHERE id = ?").bind(fileUrl, user.id).run();
          return new Response(JSON.stringify({ success: true, url: fileUrl }), { headers: { "Content-Type": "application/json" } });
        }
        if (request.method === "POST" && path === "/api/sync/push") {
          const body = await request.json();
          await env.DB.prepare("UPDATE user_data SET local_storage_json = ?, indexed_db_json = ?, last_synced = CURRENT_TIMESTAMP WHERE user_id = ?").bind(body.localStorageJson || "{}", body.indexedDbJson || "{}", user.id).run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (request.method === "GET" && path === "/api/sync/pull") {
          const row = await env.DB.prepare("SELECT local_storage_json, indexed_db_json, last_synced FROM user_data WHERE user_id = ?").bind(user.id).first();
          if (!row) return new Response(JSON.stringify({ error: "Failed to fetch sync data" }), { status: 500, headers: { "Content-Type": "application/json" } });
          return new Response(JSON.stringify({
            success: true,
            localStorageJson: row.local_storage_json,
            indexedDbJson: row.indexed_db_json,
            lastSynced: row.last_synced
          }), { headers: { "Content-Type": "application/json" } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: "Server error: " + err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    if (request.method === "GET" && path.startsWith("/uploads/")) {
      const key = path.substring(9);
      const object = await env.PROFILE_PICTURES.get(key);
      if (!object) {
        return new Response("Not Found", { status: 404 });
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      return new Response(object.body, { headers });
    }
    let targetUrlStr = null;
    const referer = request.headers.get("referer");
    if (referer && referer.includes("/proxy/http") && !path.startsWith("/proxy/") && !["/", "/ghost-ui", "/play.html", "/script.js", "/styles.css", "/games.json"].includes(path)) {
      const originMatch = referer.match(/\/proxy\/(https?:\/\/[^\/]+)/);
      if (originMatch) {
        targetUrlStr = originMatch[1] + path + url.search;
      }
    }
    if (path.startsWith("/proxy/") || targetUrlStr) {
      const targetUrl = targetUrlStr || request.url.substring(request.url.indexOf("/proxy/") + 7);
      if (!targetUrl) return new Response("Missing url parameter", { status: 400 });
      try {
        const res = await fetch(targetUrl, {
          headers: { "User-Agent": "GhostArcadeWorker/1.0" }
        });
        const newHeaders = new Headers(res.headers);
        newHeaders.delete("x-frame-options");
        newHeaders.delete("content-security-policy");
        newHeaders.set("access-control-allow-origin", "*");
        const contentType = res.headers.get("content-type") || "";
        if (targetUrl.toLowerCase().endsWith(".html") || contentType.includes("text/html")) {
          newHeaders.set("content-type", "text/html;charset=UTF-8");
          newHeaders.set("cross-origin-embedder-policy", "require-corp");
          newHeaders.set("cross-origin-opener-policy", "same-origin");
          let html = await res.text();
          if (!/<base\b/i.test(html)) {
            const basePath = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
            const baseTag = '<base href="/proxy/' + basePath + '">';
            if (html.includes("<head>")) {
              html = html.replace("<head>", "<head>" + baseTag);
            } else if (html.includes("<HEAD>")) {
              html = html.replace("<HEAD>", "<HEAD>" + baseTag);
            } else if (html.includes("<html>") || html.includes("<HTML>")) {
              html = html.replace(/<html>/i, "<html><head>" + baseTag + "</head>");
            } else {
              html = "<head>" + baseTag + "</head>" + html;
            }
          }
          try {
            const targetOrigin = new URL(targetUrl).origin;
            html = html.replace(/(src|href|action)=["']\/(?!\/)(?!proxy\/)([^"']*)["']/gi, '$1="/proxy/' + targetOrigin + '/$2"');
          } catch (e) {
          }
          const sdkPatterns = [
            { regex: /ytgame\.js/i, global: "ytgame" },
            { regex: /game_api\/v1/i, global: "ytgame" }
          ];
          for (const sdk of sdkPatterns) {
            if (sdk.regex.test(html)) {
              const shimScript = '<script>(function(){function makeShim(){var handler={get:function(_,p){if(p==="then"||p===Symbol.toPrimitive)return undefined;if(p==="valueOf")return function(){return 0;};if(p==="toString")return function(){return "";};return makeShim();},apply:function(){return Promise.resolve(makeShim());},construct:function(){return makeShim();}};return new Proxy(function(){},handler);}window["' + sdk.global + '"]=makeShim();})();<\/script>';
              html = html.replace(new RegExp("<script[^>]*(?:" + sdk.regex.source + ")[^>]*><\/script>", "gi"), shimScript);
            }
          }
          return new Response(html, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders
          });
        } else if (targetUrl.includes("terraria-wasm1") && (targetUrl.toLowerCase().endsWith(".js") || contentType.includes("javascript"))) {
          newHeaders.set("content-type", "application/javascript;charset=UTF-8");
          newHeaders.set("cross-origin-embedder-policy", "require-corp");
          newHeaders.set("cross-origin-opener-policy", "same-origin");
          let js = await res.text();
          const repoBase = "/proxy/https://raw.githubusercontent.com/chessgrandest-prog/terraria-wasm1/main/";
          if (targetUrl.endsWith("/sw.js") || targetUrl.endsWith("/sw.js?")) {
            js = js.replace(/"\/([^"]+)"/g, function(match, p1) {
              if (p1.startsWith("/") || p1.startsWith("http")) return match;
              return '"' + repoBase + p1 + '"';
            });
            js = js.replace('"/"', '"' + repoBase + '"');
          } else {
            js = js.replace(/"\/sw\.js"/g, '"' + repoBase + 'sw.js"');
            js = js.replace(/"\/_framework\/dotnet\.js"/g, '"' + repoBase + '_framework/dotnet.js"');
            js = js.replace(/scope:"\/"/g, 'scope:"' + repoBase + '"');
          }
          return new Response(js, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders
          });
        }
        const lowerUrl = targetUrl.toLowerCase();
        if (lowerUrl.endsWith(".css")) {
          newHeaders.set("content-type", "text/css;charset=UTF-8");
        } else if (lowerUrl.endsWith(".js") || lowerUrl.endsWith(".mjs")) {
          newHeaders.set("content-type", "application/javascript;charset=UTF-8");
        } else if (lowerUrl.endsWith(".wasm")) {
          newHeaders.set("content-type", "application/wasm");
        } else if (lowerUrl.endsWith(".json")) {
          newHeaders.set("content-type", "application/json;charset=UTF-8");
        } else if (lowerUrl.endsWith(".png")) {
          newHeaders.set("content-type", "image/png");
        } else if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) {
          newHeaders.set("content-type", "image/jpeg");
        } else if (lowerUrl.endsWith(".ico")) {
          newHeaders.set("content-type", "image/x-icon");
        } else if (lowerUrl.endsWith(".ttf")) {
          newHeaders.set("content-type", "font/ttf");
        } else if (lowerUrl.endsWith(".woff") || lowerUrl.endsWith(".woff2")) {
          newHeaders.set("content-type", lowerUrl.endsWith(".woff2") ? "font/woff2" : "font/woff");
        }
        newHeaders.set("cross-origin-embedder-policy", "require-corp");
        newHeaders.set("cross-origin-opener-policy", "same-origin");
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: newHeaders
        });
      } catch (err) {
        return new Response("Proxy error: " + err.message, { status: 500 });
      }
    }
    if (path === "/games.json") {
      try {
        const githubUrl = "https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/games.json";
        const res = await fetch(githubUrl, {
          headers: { "User-Agent": "GhostArcadeWorker/1.0" },
          // Cache the response for 60 seconds so it's fast but still updates
          cf: { cacheTtl: 60 }
        });
        return new Response(res.body, {
          status: res.status,
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to load games list" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    if (path === "/") {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Drive - Google Drive</title>
    <link rel="icon" href="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png">
    <style id="decoyStyles">
        /* Styles will be replaced dynamically */
    </style>
</head>
<body>

    <div id="decoyApp">
        <!-- Rendered dynamically based on decoyPreset setting -->
    </div>

    <script>
        (function() {
            'use strict';

            const STORAGE_SETTINGS = 'ghostArcade_settings';
            const DEFAULT_SETTINGS = {
                decoyPreset: 'google-drive',
                tabTitle: 'Google Drive',
                tabFavicon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
                panicRedirect: 'https://www.google.com',
                autoGhost: false
            };

            let settings = DEFAULT_SETTINGS;
            try {
                const data = localStorage.getItem(STORAGE_SETTINGS);
                if (data) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
            } catch(e) {}

            const decoyApp = document.getElementById('decoyApp');
            const decoyStyles = document.getElementById('decoyStyles');

            // Apply Decoy Preset
            const preset = settings.decoyPreset || 'google-drive';
            document.title = settings.tabTitle;
            
            // Set Favicon
            let link = document.querySelector("link[rel*='icon']");
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = settings.tabFavicon;

            // \u2500\u2500\u2500 Decoy Presets Templates \u2500\u2500\u2500
            const DECOYS = {
                'google-drive': {
                    html: \`
                        <div class="header">
                            <div class="logo">
                                <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Drive Logo">
                                <span>Drive</span>
                            </div>
                            <div class="search-bar">Search in Drive</div>
                        </div>
                        <div class="content">
                            <div class="sidebar">
                                <div class="nav-item active">My Drive</div>
                                <div class="nav-item">Computers</div>
                                <div class="nav-item">Shared with me</div>
                                <div class="nav-item">Recent</div>
                                <div class="nav-item">Starred</div>
                                <div class="nav-item">Trash</div>
                            </div>
                            <div class="main-area">
                                <h2>My Drive</h2>
                                <div class="table-header">
                                    <div class="col-name">Name</div>
                                    <div class="col-owner">Owner</div>
                                    <div class="col-date">Last modified</div>
                                    <div class="col-size">File size</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C1} English Literature</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Oct 12, 2025</div>
                                    <div class="col-size">-</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C1} Math Homework</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Nov 3, 2025</div>
                                    <div class="col-size">-</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C4} Project Notes.docx</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Yesterday</div>
                                    <div class="col-size">14 KB</div>
                                </div>
                            </div>
                        </div>
                    \`,
                    css: \`
                        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8f9fa; color: #202124; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
                        .header { display: flex; align-items: center; padding: 8px 16px; background-color: #fff; border-bottom: 1px solid #e0e0e0; }
                        .logo { display: flex; align-items: center; gap: 8px; font-size: 22px; color: #5f6368; margin-right: 48px; }
                        .logo img { width: 40px; height: 40px; }
                        .search-bar { flex: 1; max-width: 720px; background-color: #f1f3f4; border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; color: #5f6368; }
                        .content { display: flex; flex: 1; }
                        .sidebar { width: 256px; padding: 16px; }
                        .nav-item { display: flex; align-items: center; padding: 10px 24px; border-radius: 0 24px 24px 0; color: #3c4043; font-weight: 500; margin-bottom: 4px; }
                        .nav-item.active { background-color: #e8f0fe; color: #1a73e8; }
                        .main-area { flex: 1; background-color: #fff; border-radius: 16px; margin: 16px; padding: 24px; box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15); }
                        .table-header { display: flex; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; margin-bottom: 16px; color: #5f6368; font-weight: 500; font-size: 14px; }
                        .row { display: flex; padding: 12px 0; border-bottom: 1px solid #f1f3f4; color: #3c4043; font-size: 13px; }
                        .col-name { flex: 2; display: flex; align-items: center; gap: 12px; }
                        .col-owner { flex: 1; }
                        .col-date { flex: 1; }
                        .col-size { flex: 1; text-align: right; }
                    \`
                },
                'custom-image': {
                    html: \`<div class="custom-decoy-container"></div>\`,
                    css: \`
                        body { margin: 0; padding: 0; background: #000; overflow: hidden; }
                        .custom-decoy-container { 
                            width: 100vw; height: 100vh; 
                            background-image: url('\${settings.customDecoyImage || ""}'); 
                            background-size: cover; 
                            background-position: center; 
                            background-repeat: no-repeat;
                        }
                    \`
                }
            };

            // Render current Decoy Preset html and CSS
            const decoyDetails = DECOYS[preset] || DECOYS['google-drive'];
            decoyApp.innerHTML = decoyDetails.html;
            decoyStyles.innerHTML = decoyDetails.css;

            // \u2500\u2500\u2500 Keybind stealth trigger \u2500\u2500\u2500
            document.addEventListener('keydown', function(e) {
                // Trigger transition on Right Shift key (location === 2)
                if (e.key === 'Shift' && e.location === 2) {
                    e.preventDefault();

                    const targetUrl = new URL('/ghost-ui', window.location.origin);
                    if (settings.autoGhost || params.get('ghost') === '1') {
                        targetUrl.searchParams.set('ghost', '1');
                    }

                    const win = window.open('about:blank', '_blank');
                    if (!win) {
                        alert('\u26A0\uFE0F Popups blocked. Please allow popups to open the cloaked workspace!');
                        return;
                    }

                    // Open tab under the user's custom settings title and icon
                    win.document.open();
                    win.document.write(
                        '<!DOCTYPE html>' +
                        '<html><head>' +
                        '<title>' + esc(settings.tabTitle) + '</title>' +
                        '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
                        '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none;background:#000;}</style>' +
                        '</head><body>' +
                        '<iframe src="' + targetUrl.href + '" allow="fullscreen"></iframe>' +
                        '</body></html>'
                    );
                    win.document.close();

                    // Redirect decoy tab to Real panic redirection target
                    window.location.replace(settings.panicRedirect);
                }
            });

            // \u2500\u2500\u2500 Query Params helper \u2500\u2500\u2500
            const params = new URLSearchParams(window.location.search);
            
            // Auto ghost loader support
            if (settings.autoGhost && params.get('ghost') !== '1') {
                activateGhostModeFromRoot();
            }

            function activateGhostModeFromRoot() {
                const targetUrl = new URL('/ghost-ui', window.location.origin);
                targetUrl.searchParams.set('ghost', '1');

                const win = window.open('about:blank', '_blank');
                if (!win) return;

                win.document.open();
                win.document.write(
                    '<!DOCTYPE html>' +
                    '<html><head>' +
                    '<title>' + esc(settings.tabTitle) + '</title>' +
                    '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
                    '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none;background:#000;}</style>' +
                    '</head><body>' +
                    '<iframe src="' + targetUrl.href + '" allow="fullscreen"></iframe>' +
                    '</body></html>'
                );
                win.document.close();
                window.location.replace(settings.panicRedirect);
            }

            function esc(str) {
                if (!str) return '';
                return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }

        })();
    <\/script>
</body>
</html>
`, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/index.html") {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Drive - Google Drive</title>
    <link rel="icon" href="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png">
    <style id="decoyStyles">
        /* Styles will be replaced dynamically */
    </style>
</head>
<body>

    <div id="decoyApp">
        <!-- Rendered dynamically based on decoyPreset setting -->
    </div>

    <script>
        (function() {
            'use strict';

            const STORAGE_SETTINGS = 'ghostArcade_settings';
            const DEFAULT_SETTINGS = {
                decoyPreset: 'google-drive',
                tabTitle: 'Google Drive',
                tabFavicon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
                panicRedirect: 'https://www.google.com',
                autoGhost: false
            };

            let settings = DEFAULT_SETTINGS;
            try {
                const data = localStorage.getItem(STORAGE_SETTINGS);
                if (data) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
            } catch(e) {}

            const decoyApp = document.getElementById('decoyApp');
            const decoyStyles = document.getElementById('decoyStyles');

            // Apply Decoy Preset
            const preset = settings.decoyPreset || 'google-drive';
            document.title = settings.tabTitle;
            
            // Set Favicon
            let link = document.querySelector("link[rel*='icon']");
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = settings.tabFavicon;

            // \u2500\u2500\u2500 Decoy Presets Templates \u2500\u2500\u2500
            const DECOYS = {
                'google-drive': {
                    html: \`
                        <div class="header">
                            <div class="logo">
                                <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Drive Logo">
                                <span>Drive</span>
                            </div>
                            <div class="search-bar">Search in Drive</div>
                        </div>
                        <div class="content">
                            <div class="sidebar">
                                <div class="nav-item active">My Drive</div>
                                <div class="nav-item">Computers</div>
                                <div class="nav-item">Shared with me</div>
                                <div class="nav-item">Recent</div>
                                <div class="nav-item">Starred</div>
                                <div class="nav-item">Trash</div>
                            </div>
                            <div class="main-area">
                                <h2>My Drive</h2>
                                <div class="table-header">
                                    <div class="col-name">Name</div>
                                    <div class="col-owner">Owner</div>
                                    <div class="col-date">Last modified</div>
                                    <div class="col-size">File size</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C1} English Literature</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Oct 12, 2025</div>
                                    <div class="col-size">-</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C1} Math Homework</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Nov 3, 2025</div>
                                    <div class="col-size">-</div>
                                </div>
                                <div class="row">
                                    <div class="col-name">\u{1F4C4} Project Notes.docx</div>
                                    <div class="col-owner">me</div>
                                    <div class="col-date">Yesterday</div>
                                    <div class="col-size">14 KB</div>
                                </div>
                            </div>
                        </div>
                    \`,
                    css: \`
                        body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8f9fa; color: #202124; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
                        .header { display: flex; align-items: center; padding: 8px 16px; background-color: #fff; border-bottom: 1px solid #e0e0e0; }
                        .logo { display: flex; align-items: center; gap: 8px; font-size: 22px; color: #5f6368; margin-right: 48px; }
                        .logo img { width: 40px; height: 40px; }
                        .search-bar { flex: 1; max-width: 720px; background-color: #f1f3f4; border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; color: #5f6368; }
                        .content { display: flex; flex: 1; }
                        .sidebar { width: 256px; padding: 16px; }
                        .nav-item { display: flex; align-items: center; padding: 10px 24px; border-radius: 0 24px 24px 0; color: #3c4043; font-weight: 500; margin-bottom: 4px; }
                        .nav-item.active { background-color: #e8f0fe; color: #1a73e8; }
                        .main-area { flex: 1; background-color: #fff; border-radius: 16px; margin: 16px; padding: 24px; box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15); }
                        .table-header { display: flex; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; margin-bottom: 16px; color: #5f6368; font-weight: 500; font-size: 14px; }
                        .row { display: flex; padding: 12px 0; border-bottom: 1px solid #f1f3f4; color: #3c4043; font-size: 13px; }
                        .col-name { flex: 2; display: flex; align-items: center; gap: 12px; }
                        .col-owner { flex: 1; }
                        .col-date { flex: 1; }
                        .col-size { flex: 1; text-align: right; }
                    \`
                },
                'custom-image': {
                    html: \`<div class="custom-decoy-container"></div>\`,
                    css: \`
                        body { margin: 0; padding: 0; background: #000; overflow: hidden; }
                        .custom-decoy-container { 
                            width: 100vw; height: 100vh; 
                            background-image: url('\${settings.customDecoyImage || ""}'); 
                            background-size: cover; 
                            background-position: center; 
                            background-repeat: no-repeat;
                        }
                    \`
                }
            };

            // Render current Decoy Preset html and CSS
            const decoyDetails = DECOYS[preset] || DECOYS['google-drive'];
            decoyApp.innerHTML = decoyDetails.html;
            decoyStyles.innerHTML = decoyDetails.css;

            // \u2500\u2500\u2500 Keybind stealth trigger \u2500\u2500\u2500
            document.addEventListener('keydown', function(e) {
                // Trigger transition on Right Shift key (location === 2)
                if (e.key === 'Shift' && e.location === 2) {
                    e.preventDefault();

                    const targetUrl = new URL('/ghost-ui', window.location.origin);
                    if (settings.autoGhost || params.get('ghost') === '1') {
                        targetUrl.searchParams.set('ghost', '1');
                    }

                    const win = window.open('about:blank', '_blank');
                    if (!win) {
                        alert('\u26A0\uFE0F Popups blocked. Please allow popups to open the cloaked workspace!');
                        return;
                    }

                    // Open tab under the user's custom settings title and icon
                    win.document.open();
                    win.document.write(
                        '<!DOCTYPE html>' +
                        '<html><head>' +
                        '<title>' + esc(settings.tabTitle) + '</title>' +
                        '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
                        '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none;background:#000;}</style>' +
                        '</head><body>' +
                        '<iframe src="' + targetUrl.href + '" allow="fullscreen"></iframe>' +
                        '</body></html>'
                    );
                    win.document.close();

                    // Redirect decoy tab to Real panic redirection target
                    window.location.replace(settings.panicRedirect);
                }
            });

            // \u2500\u2500\u2500 Query Params helper \u2500\u2500\u2500
            const params = new URLSearchParams(window.location.search);
            
            // Auto ghost loader support
            if (settings.autoGhost && params.get('ghost') !== '1') {
                activateGhostModeFromRoot();
            }

            function activateGhostModeFromRoot() {
                const targetUrl = new URL('/ghost-ui', window.location.origin);
                targetUrl.searchParams.set('ghost', '1');

                const win = window.open('about:blank', '_blank');
                if (!win) return;

                win.document.open();
                win.document.write(
                    '<!DOCTYPE html>' +
                    '<html><head>' +
                    '<title>' + esc(settings.tabTitle) + '</title>' +
                    '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
                    '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none;background:#000;}</style>' +
                    '</head><body>' +
                    '<iframe src="' + targetUrl.href + '" allow="fullscreen"></iframe>' +
                    '</body></html>'
                );
                win.document.close();
                window.location.replace(settings.panicRedirect);
            }

            function esc(str) {
                if (!str) return '';
                return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }

        })();
    <\/script>
</body>
</html>
`, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/ghost-ui") {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Ghost Arcade \u2014 Play free browser games undetected. Stealth mode, dark theme, instant play.">
    <title>Ghost Arcade</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\u{1F47B}</text></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">
</head>
<body>

    <!-- Custom Cursors -->
    <div id="cursorContainer" hidden>
        <!-- Ring -->
        <div class="custom-cursor-dot" id="cursorDot"></div>
        <div class="custom-cursor-ring" id="cursorRing"></div>
        <!-- Orb -->
        <div class="custom-cursor-orb" id="cursorOrb"></div>
        <!-- Cyber -->
        <div class="custom-cursor-cyber" id="cursorCyber">
            <div class="cyber-line cyber-t"></div>
            <div class="cyber-line cyber-b"></div>
            <div class="cyber-line cyber-l"></div>
            <div class="cyber-line cyber-r"></div>
        </div>
        <!-- Simple -->
        <div class="custom-cursor-simple" id="cursorSimple">
            <div class="simple-v"></div>
            <div class="simple-h"></div>
        </div>
    </div>

    <!-- Ambient Background Effects -->
    <div class="bg-effects" aria-hidden="true">
        <div class="bg-orb bg-orb--cyan"></div>
        <div class="bg-orb bg-orb--purple"></div>
        <div class="bg-orb bg-orb--pink"></div>
        <canvas id="effectsCanvas" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; opacity: 0; transition: opacity 1s ease;"></canvas>
    </div>

    <!-- Ghost Mode Active Indicator -->
    <div class="ghost-indicator" id="ghostIndicator" hidden>
        <span class="ghost-indicator__icon">\u{1F47B}</span>
        <span>Ghost Mode Active</span>
    </div>

    <div class="container">

        <!-- \u2550\u2550\u2550 Header \u2550\u2550\u2550 -->
        <header class="header">
            <div class="header__brand">
                <div class="logo">
                    <span class="logo__ghost" aria-hidden="true">\u{1F47B}</span>
                    <h1 class="logo__text">GHOST <span class="logo__accent">ARCADE</span></h1>
                </div>
                <p class="header__tagline">Vanish into the game.</p>
            </div>

            <div class="header__actions">
                <div class="search-bar">
                    <svg class="search-bar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.3-4.3"/>
                    </svg>
                    <input type="text" class="search-bar__input" id="searchInput" placeholder="Search games..." autocomplete="off" aria-label="Search games">
                </div>

                <button class="view-btn" id="viewToggleBtn" title="Toggle Grid/List View" aria-label="Toggle layout view">
                    <svg id="viewToggleIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                    </svg>
                </button>

                <button class="ghost-btn" id="randomGameBtn" title="Launch a Random Game">
                    <span class="ghost-btn__icon" aria-hidden="true">\u{1F3B2}</span>
                    <span class="ghost-btn__text">Random Game</span>
                </button>

                <button class="ghost-btn" id="settingsBtn" title="Open Settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 16px; height: 16px;">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    <span class="ghost-btn__text">Settings</span>
                </button>

                <button class="ghost-btn" id="ghostModeBtn" title="Activate Ghost Mode \u2014 disguise this tab">
                    <span class="ghost-btn__icon" aria-hidden="true">\u{1F47B}</span>
                    <span class="ghost-btn__text">Ghost Mode</span>
                </button>

                <button class="ghost-btn" id="profileBtn" title="User Profile / Login">
                    <span class="ghost-btn__icon" id="profileIcon" aria-hidden="true">\u{1F464}</span>
                    <span class="ghost-btn__text" id="profileText">Login</span>
                </button>
            </div>
        </header>

        <!-- \u2550\u2550\u2550 Navigation Tabs \u2550\u2550\u2550 -->
        <nav class="tabs" id="tabs" aria-label="Game categories">
            <button class="tab active" data-tab="all" id="tab-all">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                All Games
            </button>
            <button class="tab" data-tab="recent" id="tab-recent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                Recently Played
            </button>
            <button class="tab" data-tab="favorites" id="tab-favorites">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                Favorites
            </button>
        </nav>

        <!-- \u2550\u2550\u2550 Game Grid \u2550\u2550\u2550 -->
        <main>
            <!-- Loading Skeletons (shown while fetching) -->
            <div class="loading-grid" id="loadingGrid">
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
                <div class="skeleton-card"><div class="skeleton-card__image"></div><div class="skeleton-card__info"><div class="skeleton-card__title"></div></div></div>
            </div>

            <div class="game-grid" id="gameGrid"></div>

            <!-- Empty State -->
            <div class="empty-state" id="emptyState" hidden>
                <span class="empty-state__icon">\u{1F47B}</span>
                <h2 class="empty-state__title">No games found</h2>
                <p class="empty-state__text">Try a different search or check back later.</p>
            </div>
        </main>

        <!-- \u2550\u2550\u2550 Footer \u2550\u2550\u2550 -->
        <footer class="footer">
            <p>Ghost Arcade &copy; 2025 &mdash; Play undetected.</p>
        </footer>

    </div>

    <!-- \u2550\u2550\u2550 Settings Modal \u2550\u2550\u2550 -->
    <div class="modal-backdrop" id="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
        <div class="modal-content">
            <!-- Sidebar Navigation -->
            <nav class="modal-sidebar">
                <div class="modal-sidebar-title">Settings</div>
                <button class="modal-tab-btn active" data-settings-tab="appearance">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
                    Appearance
                </button>
                <button class="modal-tab-btn" data-settings-tab="stealth">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Stealth & Cloak
                </button>
                <button class="modal-tab-btn" data-settings-tab="custom-games">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M12 5v14M5 12h14"/></svg>
                    Custom Games
                </button>
                <button class="modal-tab-btn" data-settings-tab="backup">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                    Backup & Reset
                </button>
            </nav>

            <!-- Settings Content -->
            <div class="modal-body">
                <div class="modal-header">
                    <h2 class="modal-title" id="settingsModalTitle">Settings</h2>
                    <button class="modal-close-btn" id="closeSettingsBtn" aria-label="Close settings">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <!-- \u2500\u2500\u2500 Tab: Appearance \u2500\u2500\u2500 -->
                <div class="settings-section active" id="sect-appearance">
                    <!-- Accent Color Picker -->
                    <div class="settings-group">
                        <label class="settings-label">Accent Color</label>
                        <span class="settings-desc">Choose the glow highlight color for the interface.</span>
                        <div class="color-picker-wrapper">
                            <button class="color-swatch active" data-color="#00e5ff" style="background: #00e5ff;" title="Cyan (Default)"></button>
                            <button class="color-swatch" data-color="#ff2d7b" style="background: #ff2d7b;" title="Hot Pink"></button>
                            <button class="color-swatch" data-color="#b04aff" style="background: #b04aff;" title="Deep Purple"></button>
                            <button class="color-swatch" data-color="#10b981" style="background: #10b981;" title="Emerald Green"></button>
                            <button class="color-swatch" data-color="#f59e0b" style="background: #f59e0b;" title="Amber Gold"></button>
                            <div class="custom-color-btn" title="Choose custom color">
                                <span>\u{1F3A8}</span>
                                <input type="color" id="customColorInput" class="custom-color-input">
                            </div>
                        </div>
                    </div>

                    <!-- Card Size Selector -->
                    <div class="settings-group">
                        <label class="settings-label" for="cardSizeSelect">Card Size</label>
                        <span class="settings-desc">Adjust the grid game card sizing.</span>
                        <select id="cardSizeSelect" class="settings-select">
                            <option value="small">Small</option>
                            <option value="medium" selected>Medium (Default)</option>
                            <option value="large">Large</option>
                        </select>
                    </div>

                    <!-- Parallax Tilt Toggle -->
                    <div class="settings-group">
                        <label class="settings-label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="parallaxToggle" checked style="width:16px; height:16px; cursor:pointer;">
                            Enable 3D Parallax Card Tilt
                        </label>
                        <span class="settings-desc">Enables a dynamic 3D perspective effect when hovering over game cards.</span>
                    </div>

                    <!-- Cursor Style -->
                    <div class="settings-group">
                        <label class="settings-label" for="cursorStyleSelect">Cursor Style</label>
                        <select id="cursorStyleSelect" class="settings-select" style="width:100%; padding:8px; margin-top:4px; background:var(--surface); color:white; border:1px solid var(--border); border-radius:4px; outline:none; cursor:pointer;">
                            <option value="none">System Default</option>
                            <option value="ring">Neon Ring</option>
                            <option value="orb">Pulse Orb</option>
                            <option value="cyber">Cyber Crosshair</option>
                            <option value="simple">Simple Crosshair (Minecraft)</option>
                        </select>
                        <span class="settings-desc" style="margin-top:4px; display:block;">Choose a custom cursor to fit the theme.</span>
                    </div>

                    <!-- Cursor Color Picker -->
                    <div class="settings-group" id="cursorColorGroup">
                        <label class="settings-label">Cursor Color</label>
                        <span class="settings-desc">Choose a color for the custom cursor or match the accent color.</span>
                        <div class="color-picker-wrapper">
                            <button class="color-swatch-cursor active" data-cursor-color="match" style="background: linear-gradient(135deg, var(--accent-cyan), var(--accent-pink));" title="Match Accent Color"></button>
                            <button class="color-swatch-cursor" data-cursor-color="#00e5ff" style="background: #00e5ff;" title="Cyan"></button>
                            <button class="color-swatch-cursor" data-cursor-color="#ff2d7b" style="background: #ff2d7b;" title="Hot Pink"></button>
                            <button class="color-swatch-cursor" data-cursor-color="#b04aff" style="background: #b04aff;" title="Deep Purple"></button>
                            <button class="color-swatch-cursor" data-cursor-color="#10b981" style="background: #10b981;" title="Emerald Green"></button>
                            <button class="color-swatch-cursor" data-cursor-color="#f59e0b" style="background: #f59e0b;" title="Amber Gold"></button>
                            <div class="custom-color-btn" title="Choose custom color">
                                <span>\u{1F3A8}</span>
                                <input type="color" id="customCursorColorInput" class="custom-color-input">
                            </div>
                        </div>
                    </div>

                    <!-- Background Effect -->
                    <div class="settings-group">
                        <label class="settings-label" for="bgEffectSelect">Background Effect</label>
                        <select id="bgEffectSelect" class="settings-select" style="width:100%; padding:8px; margin-top:4px; background:var(--surface); color:white; border:1px solid var(--border); border-radius:4px; outline:none; cursor:pointer;">
                            <option value="none">Solid Dark (Max Performance)</option>
                            <option value="orbs">Ambient Orbs</option>
                            <option value="lightning">Lightning Storm</option>
                            <option value="matrix">Matrix Code Rain</option>
                            <option value="starfield">Starfield Particles</option>
                        </select>
                        <span class="settings-desc" style="margin-top:4px; display:block;">Choose an ambient effect for the background.</span>
                    </div>

                    <!-- Lightning Frequency Slider -->
                    <div class="settings-group" id="groupLightningFreq" style="display:none;">
                        <label class="settings-label" for="lightningFreqSlider">Lightning Frequency</label>
                        <span class="settings-desc">Adjust how often lightning strikes occur.</span>
                        <div style="display:flex; align-items:center; gap:12px; margin-top:8px;">
                            <span style="font-size:12px; opacity:0.6;">Slow</span>
                            <input type="range" id="lightningFreqSlider" min="1" max="10" step="1" value="5" style="flex:1; cursor:pointer;">
                            <span style="font-size:12px; opacity:0.6;">Fast</span>
                        </div>
                    </div>

                    <!-- Effect Density Slider -->
                    <div class="settings-group" id="groupBgDensity" style="display:none;">
                        <label class="settings-label" for="bgDensitySlider">Effect Density / Speed</label>
                        <span class="settings-desc">Adjust the intensity of the active background effect.</span>
                        <div style="display:flex; align-items:center; gap:12px; margin-top:8px;">
                            <span style="font-size:12px; opacity:0.6;">Low</span>
                            <input type="range" id="bgDensitySlider" min="1" max="10" step="1" value="5" style="flex:1; cursor:pointer;">
                            <span style="font-size:12px; opacity:0.6;">High</span>
                        </div>
                    </div>
                </div>

                <!-- \u2500\u2500\u2500 Tab: Stealth \u2500\u2500\u2500 -->
                <div class="settings-section" id="sect-stealth">
                    <!-- Decoy Preset -->
                    <div class="settings-group">
                        <label class="settings-label" for="decoyPresetSelect">Decoy Preset</label>
                        <span class="settings-desc">The cover website template loaded by the site origin.</span>
                        <select id="decoyPresetSelect" class="settings-select">
                            <option value="google-drive">Google Drive</option>
                            <option value="custom-image">Custom Screenshot</option>
                        </select>
                    </div>

                    <!-- Custom Decoy Image Upload (hidden if google-drive is selected) -->
                    <div class="settings-group" id="customDecoyImageGroup" style="display: none;">
                        <label class="settings-label" for="customDecoyImageInput">Upload Screenshot</label>
                        <span class="settings-desc">Upload a full-screen screenshot of your school portal.</span>
                        <input type="file" id="customDecoyImageInput" accept="image/*" class="settings-input" style="padding: 4px;">
                        <img id="customDecoyPreview" src="" style="margin-top: 10px; max-width: 100%; border-radius: 4px; display: none; border: 1px solid var(--border-subtle);">
                    </div>

                    <!-- Tab Title -->
                    <div class="settings-group">
                        <label class="settings-label" for="tabTitleInput">Tab Title</label>
                        <span class="settings-desc">The title shown in the browser tab when cloaked.</span>
                        <input type="text" id="tabTitleInput" class="settings-input" placeholder="Google Drive">
                    </div>

                    <!-- Tab Favicon -->
                    <div class="settings-group">
                        <label class="settings-label" for="tabFaviconInput">Tab Favicon (URL)</label>
                        <span class="settings-desc">The favicon shown in the browser tab when cloaked.</span>
                        <input type="text" id="tabFaviconInput" class="settings-input" placeholder="https://ssl.gstatic.com/...">
                    </div>

                    <!-- Panic Key Configuration -->
                    <div class="settings-group">
                        <label class="settings-label">Panic Button Keybind</label>
                        <span class="settings-desc">Press this combination to instantly redirect out of games. Click the input and press a key.</span>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <label style="font-size: 13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="panicCtrlCheckbox" checked style="width:16px; height:16px; cursor:pointer;"> Ctrl +
                            </label>
                            <input type="text" id="panicKeyInput" class="settings-input" value="\`" style="width: 80px; text-align: center; text-transform: uppercase;" readonly>
                        </div>
                    </div>

                    <!-- Panic Redirect URL -->
                    <div class="settings-group">
                        <label class="settings-label" for="panicRedirectInput">Panic Redirect Destination</label>
                        <span class="settings-desc">The website to load when the panic key is pressed.</span>
                        <input type="text" id="panicRedirectInput" class="settings-input" placeholder="https://www.google.com">
                    </div>

                    <!-- Auto Ghost Toggle -->
                    <div class="settings-group">
                        <label class="settings-label" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="autoGhostToggle" style="width:16px; height:16px; cursor:pointer;">
                            Always Launch in Ghost Tab
                        </label>
                        <span class="settings-desc">Automatically launches dashboard in a stealthy about:blank tab.</span>
                    </div>
                </div>

                <!-- \u2500\u2500\u2500 Tab: Custom Games \u2500\u2500\u2500 -->
                <div class="settings-section" id="sect-custom-games">
                    <!-- Upload Form -->
                    <form id="customGameForm" style="display:flex; flex-direction:column; gap:12px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border-subtle);">
                        <div class="settings-group">
                            <label class="settings-label" for="customTitle">Game Title</label>
                            <input type="text" id="customTitle" class="settings-input" required placeholder="My Favorite Game">
                        </div>
                        <div class="settings-group">
                            <label class="settings-label" for="customUrl">Game/Embed URL</label>
                            <input type="url" id="customUrl" class="settings-input" required placeholder="https://example.com/game">
                        </div>
                        <div class="settings-group">
                            <label class="settings-label" for="customImage">Image/Thumbnail URL (Optional)</label>
                            <input type="url" id="customImage" class="settings-input" placeholder="https://example.com/thumbnail.png">
                        </div>
                        <button type="submit" class="settings-btn settings-btn--primary" style="align-self: flex-start;">Add Custom Game</button>
                    </form>

                    <!-- Custom Games List -->
                    <div class="settings-group">
                        <label class="settings-label">Your Custom Games</label>
                        <div id="customGamesList" style="display:flex; flex-direction:column; gap:10px;">
                            <!-- populated by script -->
                        </div>
                    </div>
                </div>

                <!-- \u2500\u2500\u2500 Tab: Backup \u2500\u2500\u2500 -->
                <div class="settings-section" id="sect-backup">
                    <div class="settings-group">
                        <label class="settings-label">Export Data</label>
                        <span class="settings-desc">Download a backup of all settings, favorites, history, and custom games as a JSON file.</span>
                        <button id="exportSettingsBtn" class="settings-btn settings-btn--primary" style="align-self: flex-start; margin-top: 8px;">
                            \u{1F4E5} Export Backup
                        </button>
                    </div>

                    <div class="settings-group" style="margin-top: 12px;">
                        <label class="settings-label">Import Data</label>
                        <span class="settings-desc">Restore settings and content from an exported JSON backup file. Warning: This will overwrite existing settings.</span>
                        <div style="display: flex; gap: 12px; margin-top: 8px;">
                            <input type="file" id="importSettingsFile" accept=".json" style="display: none;">
                            <button id="importSettingsBtn" class="settings-btn" onclick="document.getElementById('importSettingsFile').click()">
                                \u{1F4E4} Choose Backup File
                            </button>
                        </div>
                    </div>

                    <div class="settings-group" style="margin-top: 24px; padding-top: 20px; border-top: 1px dashed rgba(255, 45, 123, 0.25);">
                        <label class="settings-label" style="color: var(--accent-pink);">Reset All Data</label>
                        <span class="settings-desc">Wipe all local storage, including settings, favorites, recent play logs, and custom games. This cannot be undone.</span>
                        <button id="resetAllDataBtn" class="settings-btn settings-btn--danger" style="align-self: flex-start; margin-top: 8px;">
                            \u{1F4A5} Factory Reset All
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- \u2550\u2550\u2550 Profile / Auth Modal \u2550\u2550\u2550 -->
    <div class="modal-backdrop" id="profileModal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">
        <div class="modal-content" style="max-width: 480px; flex-direction: column;">
            <div class="modal-header" style="padding: 24px 24px 0;">
                <h2 class="modal-title" id="profileModalTitle">Account & Cloud Sync</h2>
                <button class="modal-close-btn" id="closeProfileBtn" aria-label="Close profile">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            
            <div class="modal-body" style="padding: 24px;">
                <!-- Login/Register View -->
                <div id="authView" style="display:flex; flex-direction:column; gap:16px;">
                    <div style="display:flex; gap:12px; border-bottom: 1px solid var(--border-subtle); padding-bottom:12px;">
                        <button class="modal-tab-btn active" id="showLoginBtn" style="flex:1; justify-content:center;">Login</button>
                        <button class="modal-tab-btn" id="showRegisterBtn" style="flex:1; justify-content:center;">Register</button>
                    </div>

                    <form id="authForm" style="display:flex; flex-direction:column; gap:12px;">
                        <input type="text" id="authUsername" class="settings-input" placeholder="Username" required autocomplete="username">
                        <input type="password" id="authPassword" class="settings-input" placeholder="Password" required autocomplete="current-password">
                        <button type="submit" class="settings-btn settings-btn--primary" id="authSubmitBtn">Login</button>
                    </form>
                    <div id="authError" style="color:var(--accent-pink); font-size:13px; display:none; text-align:center;"></div>
                </div>

                <!-- Logged In Profile View -->
                <div id="profileView" style="display:none; flex-direction:column; gap:16px;">
                    <div style="display:flex; align-items:center; gap:16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle);">
                        <div style="position:relative; width:80px; height:80px;">
                            <img id="profilePicPreview" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\u{1F464}</text></svg>" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border:2px solid var(--cyan);">
                            <label for="profilePicUpload" style="position:absolute; bottom:0; right:0; background:var(--cyan); color:#000; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px;" title="Upload Avatar">\u270E</label>
                            <input type="file" id="profilePicUpload" accept="image/*" style="display:none;">
                        </div>
                        <div>
                            <h3 id="profileUsernameDisplay" style="margin:0; font-family:'Outfit', sans-serif; font-size:24px; color:var(--text);">User</h3>
                            <button id="logoutBtn" class="settings-btn" style="margin-top:8px; padding:4px 12px; font-size:12px;">Logout</button>
                        </div>
                    </div>

                    <div class="settings-group">
                        <label class="settings-label">Cloud Sync</label>
                        <span class="settings-desc">Your game saves and play time are automatically synced every 5 minutes and when closing a game.</span>
                        <div style="display:flex; gap:12px; margin-top:8px;">
                            <button id="forceSyncPushBtn" class="settings-btn settings-btn--primary">Push Saves to Cloud</button>
                            <button id="forceSyncPullBtn" class="settings-btn">Pull Saves from Cloud</button>
                        </div>
                        <div id="syncStatus" style="font-size:12px; margin-top:8px; color:var(--text-dim);"></div>
                    </div>

                    <div class="settings-group">
                        <label class="settings-label">Total Play Time</label>
                        <div id="playtimeStatsList" style="display:flex; flex-direction:column; gap:8px; max-height:200px; overflow-y:auto; margin-top:8px; background:var(--surface); border:1px solid var(--border-subtle); border-radius:8px; padding:12px;">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Toast Notifications -->
    <div class="toast-container" id="toastContainer"></div>

    <script src="/sync.js"><\/script>
    <script src="script.js"><\/script>
</body>
</html>
`, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/styles.css") {
      return new Response(`/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GHOST ARCADE \u2014 Styles
   Dark theme with glowing cyan/purple accents
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@500;600;700;800;900&display=swap');

/* \u2500\u2500\u2500 Design Tokens \u2500\u2500\u2500 */
:root {
    --bg-deep: #060609;
    --bg-primary: #0a0a12;
    --bg-card: rgba(255, 255, 255, 0.03);
    --bg-card-hover: rgba(255, 255, 255, 0.06);
    --bg-surface: rgba(255, 255, 255, 0.04);

    --border-subtle: rgba(255, 255, 255, 0.06);
    --border-hover: rgba(0, 229, 255, 0.25);

    --text-primary: #f0f0f5;
    --text-secondary: rgba(255, 255, 255, 0.55);
    --text-muted: rgba(255, 255, 255, 0.3);

    --accent-cyan: #00e5ff;
    --accent-purple: #b04aff;
    --accent-pink: #ff2d7b;

    --glow-cyan: rgba(0, 229, 255, 0.35);
    --glow-purple: rgba(176, 74, 255, 0.35);

    --radius-sm: 8px;
    --radius-md: 14px;
    --radius-lg: 20px;
    --radius-full: 100px;

    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --duration: 0.35s;
}

/* \u2500\u2500\u2500 Reset \u2500\u2500\u2500 */
*, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

/* \u2500\u2500\u2500 Scrollbar \u2500\u2500\u2500 */
::-webkit-scrollbar {
    width: 6px;
}
::-webkit-scrollbar-track {
    background: var(--bg-deep);
}
::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
}

::selection {
    background: rgba(0, 229, 255, 0.25);
    color: #fff;
}

[hidden] {
    display: none !important;
}

/* \u2500\u2500\u2500 Base \u2500\u2500\u2500 */
body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-deep);
    color: var(--text-primary);
    min-height: 100vh;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   AMBIENT BACKGROUND
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.bg-effects {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
}

.bg-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
    opacity: 0.12;
    will-change: transform;
}

.bg-orb--cyan {
    width: 500px;
    height: 500px;
    background: var(--accent-cyan);
    top: -15%;
    right: -8%;
    animation: orb-float 22s ease-in-out infinite;
}

.bg-orb--purple {
    width: 600px;
    height: 600px;
    background: var(--accent-purple);
    bottom: -20%;
    left: -12%;
    animation: orb-float 28s ease-in-out infinite reverse;
    animation-delay: -8s;
}

.bg-orb--pink {
    width: 350px;
    height: 350px;
    background: var(--accent-pink);
    top: 40%;
    left: 50%;
    opacity: 0.06;
    animation: orb-float 18s ease-in-out infinite;
    animation-delay: -4s;
}

/* \u2500\u2500\u2500 Noise Overlay \u2500\u2500\u2500 */
.bg-effects::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
    opacity: 0.4;
    pointer-events: none;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   LAYOUT
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.container {
    position: relative;
    z-index: 1;
    max-width: 1320px;
    margin: 0 auto;
    padding: 0 24px;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   HEADER
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32px 0 24px;
    gap: 24px;
    flex-wrap: wrap;
}

.header__brand {
    flex-shrink: 0;
}

.logo {
    display: flex;
    align-items: center;
    gap: 14px;
}

.logo__ghost {
    font-size: 38px;
    animation: ghost-bob 3s ease-in-out infinite;
    filter: drop-shadow(0 0 12px var(--glow-cyan));
}

.logo__text {
    font-family: 'Outfit', sans-serif;
    font-size: 32px;
    font-weight: 900;
    letter-spacing: 3px;
    color: var(--text-primary);
    text-shadow: 0 0 30px rgba(0, 229, 255, 0.15);
}

.logo__accent {
    background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    filter: drop-shadow(0 0 20px var(--glow-cyan));
}

.header__tagline {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
    letter-spacing: 1px;
    text-transform: uppercase;
    font-weight: 500;
}

.header__actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

/* \u2500\u2500\u2500 Search Bar \u2500\u2500\u2500 */
.search-bar {
    position: relative;
    display: flex;
    align-items: center;
}

.search-bar__icon {
    position: absolute;
    left: 14px;
    width: 18px;
    height: 18px;
    color: var(--text-muted);
    pointer-events: none;
    transition: color var(--duration) ease;
}

.search-bar__input {
    width: 260px;
    padding: 11px 16px 11px 42px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 14px;
    outline: none;
    transition: all var(--duration) ease;
    backdrop-filter: blur(12px);
}

.search-bar__input::placeholder {
    color: var(--text-muted);
}

.search-bar__input:focus {
    border-color: var(--border-hover);
    box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.08), 0 0 20px rgba(0, 229, 255, 0.06);
    width: 300px;
}

.search-bar__input:focus ~ .search-bar__icon,
.search-bar:focus-within .search-bar__icon {
    color: var(--accent-cyan);
}

/* \u2500\u2500\u2500 Ghost Mode Button \u2500\u2500\u2500 */
.ghost-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: linear-gradient(135deg, rgba(0, 229, 255, 0.1), rgba(176, 74, 255, 0.1));
    border: 1px solid rgba(0, 229, 255, 0.2);
    border-radius: var(--radius-full);
    color: var(--accent-cyan);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--duration) ease;
    position: relative;
    overflow: hidden;
}

.ghost-btn::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
    opacity: 0;
    z-index: -1;
    transition: opacity var(--duration) ease;
}

.ghost-btn:hover {
    border-color: transparent;
    color: #fff;
    background: linear-gradient(135deg, rgba(0, 229, 255, 0.25), rgba(176, 74, 255, 0.25));
    box-shadow: 0 0 24px rgba(0, 229, 255, 0.2), 0 0 48px rgba(176, 74, 255, 0.1);
    transform: translateY(-1px);
}

.ghost-btn__icon {
    font-size: 18px;
    animation: ghost-bob 3s ease-in-out infinite;
}

.ghost-btn__text {
    letter-spacing: 0.5px;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   NAVIGATION TABS
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.tabs {
    display: flex;
    gap: 6px;
    padding: 6px;
    background: var(--bg-surface);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    width: fit-content;
    margin-bottom: 32px;
    backdrop-filter: blur(12px);
}

.tab {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 18px;
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration) ease;
    white-space: nowrap;
}

.tab svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

.tab:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.04);
}

.tab.active {
    color: var(--accent-cyan);
    background: rgba(0, 229, 255, 0.08);
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.06);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GAME GRID
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.game-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--card-size, 260px), 1fr));
    gap: 20px;
    padding-bottom: 48px;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GAME CARD
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.game-card {
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
    cursor: pointer;
    transition: transform var(--duration) var(--ease-out),
                box-shadow var(--duration) var(--ease-out),
                border-color var(--duration) var(--ease-out);
    animation: card-enter 0.5s var(--ease-out) both;
    position: relative;
}

.game-card:hover {
    transform: translateY(-6px);
    border-color: var(--border-hover);
    box-shadow: 0 12px 40px rgba(0, 229, 255, 0.08),
                0 0 0 1px rgba(0, 229, 255, 0.06);
}

/* \u2500\u2500\u2500 Card Image \u2500\u2500\u2500 */
.card-image-wrap {
    position: relative;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.02);
}

.card-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.6s var(--ease-out);
}

.game-card:hover .card-image {
    transform: scale(1.06);
}

.card-image-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        to top,
        rgba(6, 6, 9, 0.7) 0%,
        transparent 50%
    );
    pointer-events: none;
}

/* \u2500\u2500\u2500 Play Button \u2500\u2500\u2500 */
.card-play-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.8);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(0, 229, 255, 0.85);
    backdrop-filter: blur(8px);
    border: 2px solid rgba(255, 255, 255, 0.2);
    color: #000;
    cursor: pointer;
    opacity: 0;
    transition: all 0.3s var(--ease-spring);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3;
}

.card-play-btn svg {
    width: 22px;
    height: 22px;
    margin-left: 2px;
}

.game-card:hover .card-play-btn {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
}

.card-play-btn:hover {
    background: var(--accent-cyan);
    box-shadow: 0 0 28px var(--glow-cyan);
    transform: translate(-50%, -50%) scale(1.1) !important;
}

/* \u2500\u2500\u2500 Favorite Button \u2500\u2500\u2500 */
.card-fav-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.25s ease;
    opacity: 0;
    z-index: 3;
}

.card-fav-btn svg {
    width: 16px;
    height: 16px;
}

.game-card:hover .card-fav-btn {
    opacity: 1;
}

.card-fav-btn.active {
    opacity: 1;
    color: var(--accent-pink);
    background: rgba(255, 45, 123, 0.15);
    border-color: rgba(255, 45, 123, 0.2);
}

.card-fav-btn:hover {
    color: var(--accent-pink);
    background: rgba(255, 45, 123, 0.2);
    transform: scale(1.15);
}

.card-fav-btn.active:hover {
    background: rgba(255, 45, 123, 0.25);
}

/* \u2500\u2500\u2500 Card Info \u2500\u2500\u2500 */
.card-info {
    padding: 14px 16px 16px;
}

.card-title {
    font-family: 'Outfit', sans-serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   EMPTY STATE
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.empty-state {
    text-align: center;
    padding: 80px 24px;
    animation: fade-in 0.4s ease;
}

.empty-state__icon {
    display: block;
    font-size: 56px;
    margin-bottom: 16px;
    opacity: 0.6;
}

.empty-state__title {
    font-family: 'Outfit', sans-serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 8px;
}

.empty-state__text {
    font-size: 14px;
    color: var(--text-secondary);
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GHOST MODE INDICATOR
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.ghost-indicator {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(0, 229, 255, 0.08);
    border: 1px solid rgba(0, 229, 255, 0.2);
    border-radius: var(--radius-full);
    color: var(--accent-cyan);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    z-index: 1000;
    backdrop-filter: blur(16px);
    animation: indicator-pulse 2.5s ease-in-out infinite;
}

.ghost-indicator__icon {
    font-size: 16px;
    animation: ghost-bob 2s ease-in-out infinite;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   FOOTER
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.footer {
    text-align: center;
    padding: 32px 0 48px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 24px;
}

.footer p {
    font-size: 13px;
    color: var(--text-muted);
    letter-spacing: 0.3px;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   LOADING STATE
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
.loading-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
    padding-bottom: 48px;
}

.skeleton-card {
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
}

.skeleton-card__image {
    aspect-ratio: 16 / 10;
    background: linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.8s ease-in-out infinite;
}

.skeleton-card__info {
    padding: 14px 16px 16px;
}

.skeleton-card__title {
    height: 16px;
    width: 65%;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.8s ease-in-out infinite;
    animation-delay: 0.15s;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   KEYFRAME ANIMATIONS
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
@keyframes orb-float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25%      { transform: translate(40px, -50px) scale(1.08); }
    50%      { transform: translate(-30px, 30px) scale(0.92); }
    75%      { transform: translate(50px, 15px) scale(1.04); }
}

@keyframes ghost-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-6px); }
}

@keyframes card-enter {
    from {
        opacity: 0;
        transform: translateY(20px) scale(0.96);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

@keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@keyframes skeleton-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

@keyframes indicator-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(0, 229, 255, 0.15); }
    50%      { box-shadow: 0 0 0 8px rgba(0, 229, 255, 0); }
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   RESPONSIVE
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
@media (max-width: 768px) {
    .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
        padding: 24px 0 20px;
    }

    .header__actions {
        width: 100%;
    }

    .search-bar {
        flex: 1;
    }

    .search-bar__input {
        width: 100%;
    }

    .search-bar__input:focus {
        width: 100%;
    }

    .logo__text {
        font-size: 24px;
    }

    .logo__ghost {
        font-size: 30px;
    }

    .tabs {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
    }

    .tabs::-webkit-scrollbar {
        display: none;
    }

    .tab {
        padding: 8px 14px;
        font-size: 12px;
    }

    .game-grid {
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 14px;
    }

    .ghost-btn__text {
        display: none;
    }

    .ghost-btn {
        padding: 10px 14px;
    }
}

@media (max-width: 480px) {
    .container {
        padding: 0 16px;
    }

    .game-grid {
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    .card-info {
        padding: 10px 12px 12px;
    }

    .card-title {
        font-size: 13px;
    }

    .card-play-btn {
        width: 44px;
        height: 44px;
    }

    .card-play-btn svg {
        width: 18px;
        height: 18px;
    }
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   SETTINGS MODAL & FRONTEND IMPROVEMENTS
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

/* \u2500\u2500\u2500 Modal Backdrop \u2500\u2500\u2500 */
.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 4, 6, 0.75);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration) ease;
}

.modal-backdrop.active {
    opacity: 1;
    pointer-events: auto;
}

/* \u2500\u2500\u2500 Modal Container \u2500\u2500\u2500 */
.modal-content {
    background: rgba(10, 10, 18, 0.85);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 800px;
    height: 90vh;
    max-height: 600px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 229, 255, 0.05);
    display: flex;
    overflow: hidden;
    transform: scale(0.94) translateY(10px);
    transition: transform var(--duration) var(--ease-spring);
    backdrop-filter: blur(24px);
}

.modal-backdrop.active .modal-content {
    transform: scale(1) translateY(0);
}

/* \u2500\u2500\u2500 Modal Sidebar \u2500\u2500\u2500 */
.modal-sidebar {
    width: 220px;
    background: rgba(255, 255, 255, 0.02);
    border-right: 1px solid var(--border-subtle);
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
}

.modal-sidebar-title {
    font-family: 'Outfit', sans-serif;
    font-size: 14px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--text-muted);
    padding: 0 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 12px;
}

.modal-tab-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    transition: all 0.25s ease;
}

.modal-tab-btn svg {
    width: 16px;
    height: 16px;
}

.modal-tab-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.03);
}

.modal-tab-btn.active {
    color: var(--accent-cyan);
    background: rgba(0, 229, 255, 0.08);
}

/* \u2500\u2500\u2500 Modal Body \u2500\u2500\u2500 */
.modal-body {
    flex: 1;
    padding: 32px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-shrink: 0;
}

.modal-title {
    font-family: 'Outfit', sans-serif;
    font-size: 24px;
    font-weight: 800;
    color: var(--text-primary);
}

.modal-close-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}

.modal-close-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-cyan);
    background: rgba(0, 229, 255, 0.05);
    transform: rotate(90deg);
}

/* \u2500\u2500\u2500 Settings Controls \u2500\u2500\u2500 */
.settings-section {
    display: none;
    flex-direction: column;
    gap: 20px;
}

.settings-section.active {
    display: flex;
}

.settings-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.settings-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
}

.settings-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
}

.settings-input,
.settings-select {
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.settings-input:focus,
.settings-select:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
}

.settings-select option {
    background: var(--bg-primary);
    color: var(--text-primary);
}

/* \u2500\u2500\u2500 Swatches & Color Picker \u2500\u2500\u2500 */
.color-picker-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.color-swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
    transition: transform 0.2s ease, border-color 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.color-swatch:hover {
    transform: scale(1.1);
}

.color-swatch.active {
    border-color: #fff;
    transform: scale(1.05);
}

.custom-color-btn {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px dashed var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    color: var(--text-secondary);
    font-size: 16px;
    overflow: hidden;
}

.custom-color-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
}

/* \u2500\u2500\u2500 Buttons inside Modal \u2500\u2500\u2500 */
.settings-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
}

.settings-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--accent-cyan);
}

.settings-btn--primary {
    background: rgba(0, 229, 255, 0.1);
    border-color: rgba(0, 229, 255, 0.2);
    color: var(--accent-cyan);
}

.settings-btn--primary:hover {
    background: var(--accent-cyan);
    color: #000;
    box-shadow: 0 0 20px var(--glow-cyan);
}

.settings-btn--danger {
    background: rgba(255, 45, 123, 0.1);
    border-color: rgba(255, 45, 123, 0.25);
    color: var(--accent-pink);
}

.settings-btn--danger:hover {
    background: var(--accent-pink);
    color: #fff;
    box-shadow: 0 0 20px rgba(255, 45, 123, 0.4);
}

/* \u2500\u2500\u2500 Keyboard Nav Focus Outline \u2500\u2500\u2500 */
.game-card.kbd-focused {
    outline: none;
    border-color: var(--accent-cyan) !important;
    box-shadow: 0 0 0 3px var(--accent-cyan), 0 0 24px var(--glow-cyan) !important;
    transform: translateY(-6px) scale(1.01);
}

/* \u2500\u2500\u2500 List View Layout Mode \u2500\u2500\u2500 */
.game-grid.game-grid--list {
    grid-template-columns: 1fr !important;
    gap: 12px;
}

.game-grid--list .game-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 72px;
    padding: 10px 16px;
    animation: none; /* disable grid animation stagger */
}

.game-grid--list .game-card:hover {
    transform: translateX(4px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-hover);
}

.game-grid--list .game-card.kbd-focused {
    transform: translateX(6px) !important;
}

.game-grid--list .card-image-wrap {
    width: 80px;
    height: 100%;
    aspect-ratio: auto;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
}

.game-grid--list .card-info {
    flex: 1;
    padding: 0 20px;
    text-align: left;
}

.game-grid--list .card-title {
    font-size: 15px;
    margin: 0;
}

.game-grid--list .card-image-overlay {
    display: none;
}

/* Static Card Action Buttons for List View */
.game-grid--list .game-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 5;
}

.game-grid--list .card-play-btn,
.game-grid--list .card-fav-btn,
.game-grid--list .card-del-btn {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    transform: none !important;
    opacity: 1;
    width: 38px;
    height: 38px;
    flex-shrink: 0;
}

.game-grid--list .card-play-btn {
    background: rgba(0, 229, 255, 0.15);
    border: 1px solid rgba(0, 229, 255, 0.3);
    color: var(--accent-cyan);
}

.game-grid--list .card-play-btn:hover {
    background: var(--accent-cyan);
    color: #000;
}

.game-grid--list .card-fav-btn {
    display: flex;
}

.game-grid--list .card-del-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 45, 123, 0.1);
    border: 1px solid rgba(255, 45, 123, 0.2);
    color: var(--accent-pink);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
}

.game-grid--list .card-del-btn:hover {
    background: var(--accent-pink);
    color: #fff;
    box-shadow: 0 0 12px rgba(255, 45, 123, 0.3);
}

.game-grid--list .card-del-btn svg {
    width: 16px;
    height: 16px;
}

/* \u2500\u2500\u2500 Toast System \u2500\u2500\u2500 */
.toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
}

.toast {
    min-width: 260px;
    padding: 14px 20px;
    background: rgba(10, 10, 18, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    animation: toast-in 0.35s var(--ease-spring) both;
    opacity: 1;
    transform: translateY(0) scale(1);
    transition: opacity 0.4s ease, transform 0.4s ease;
}

.toast--success {
    border-color: rgba(16, 185, 129, 0.4);
    box-shadow: 0 10px 30px rgba(16, 185, 129, 0.1);
}
.toast--success::before {
    content: '\u2713';
    color: #10b981;
}

.toast--error {
    border-color: rgba(255, 45, 123, 0.4);
    box-shadow: 0 10px 30px rgba(255, 45, 123, 0.1);
}
.toast--error::before {
    content: '\u26A0\uFE0F';
}

.toast--info {
    border-color: rgba(0, 229, 255, 0.4);
    box-shadow: 0 10px 30px rgba(0, 229, 255, 0.1);
}
.toast--info::before {
    content: '\u2139\uFE0F';
    color: var(--accent-cyan);
}

@keyframes toast-in {
    from {
        transform: translateY(20px) scale(0.9);
        opacity: 0;
    }
    to {
        transform: translateY(0) scale(1);
        opacity: 1;
    }
}

.toast.toast-out {
    animation: none;
    opacity: 0 !important;
    transform: translateY(-20px) scale(0.9) !important;
}

/* \u2500\u2500\u2500 Dynamic Layout controls \u2500\u2500\u2500 */
.view-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.25s ease;
}

.view-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-cyan);
    background: rgba(0, 229, 255, 0.05);
}

/* \u2500\u2500\u2500 Custom Games Tab List items \u2500\u2500\u2500 */
.custom-game-list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-size: 13px;
}

.custom-game-list-item button {
    background: transparent;
    border: none;
    color: var(--accent-pink);
    cursor: pointer;
    padding: 4px;
    font-size: 14px;
}

.custom-game-list-item button:hover {
    color: #ff4791;
}

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   CUSTOM CURSOR
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
body.custom-cursor-active,
body.custom-cursor-active * {
    cursor: none !important;
}

.custom-cursor-dot {
    position: fixed;
    width: 8px;
    height: 8px;
    background-color: var(--cursor-color, var(--accent-cyan));
    border-radius: 50%;
    pointer-events: none;
    z-index: 10000;
    transform: translate(-50%, -50%);
    transition: width 0.2s, height 0.2s, background-color 0.3s;
    opacity: 0;
}

.custom-cursor-ring {
    position: fixed;
    width: 36px;
    height: 36px;
    border: 2px solid var(--cursor-color, var(--accent-cyan));
    border-radius: 50%;
    pointer-events: none;
    z-index: 9999;
    transform: translate(-50%, -50%);
    transition: width 0.3s var(--ease-spring), height 0.3s var(--ease-spring), border-color 0.3s, background-color 0.3s;
    box-shadow: 0 0 10px var(--cursor-glow, var(--glow-cyan));
    opacity: 0;
}

body.cursor-hovering .custom-cursor-ring {
    width: 50px;
    height: 50px;
    background-color: var(--cursor-glow, var(--glow-cyan));
    border-color: var(--cursor-color, var(--accent-cyan));
}

body.cursor-hovering .custom-cursor-dot {
    width: 4px;
    height: 4px;
}

body.cursor-clicking .custom-cursor-ring {
    width: 28px;
    height: 28px;
    background-color: var(--cursor-glow, var(--glow-cyan));
}

/* Orb */
.custom-cursor-orb {
    position: fixed;
    width: 24px;
    height: 24px;
    background-color: var(--cursor-glow, var(--glow-cyan));
    border-radius: 50%;
    pointer-events: none;
    z-index: 10000;
    transform: translate(-50%, -50%);
    transition: width 0.3s var(--ease-spring), height 0.3s var(--ease-spring), background-color 0.3s;
    box-shadow: 0 0 15px var(--cursor-glow, var(--glow-cyan));
    display: none;
}

body.cursor-hovering .custom-cursor-orb {
    width: 40px;
    height: 40px;
    background-color: var(--cursor-color, var(--accent-cyan));
}

body.cursor-clicking .custom-cursor-orb {
    width: 16px;
    height: 16px;
}

/* Cyber */
.custom-cursor-cyber {
    position: fixed;
    width: 32px;
    height: 32px;
    pointer-events: none;
    z-index: 10000;
    transform: translate(-50%, -50%) rotate(0deg);
    transition: width 0.2s, height 0.2s;
    display: none;
}
.cyber-line {
    position: absolute;
    background-color: var(--cursor-color, var(--accent-cyan));
    transition: all 0.2s;
    box-shadow: 0 0 8px var(--cursor-glow, var(--glow-cyan));
}
.cyber-t, .cyber-b { width: 2px; height: 10px; left: 15px; }
.cyber-l, .cyber-r { width: 10px; height: 2px; top: 15px; }
.cyber-t { top: -2px; }
.cyber-b { bottom: -2px; }
.cyber-l { left: -2px; }
.cyber-r { right: -2px; }

body.cursor-hovering .custom-cursor-cyber {
    width: 24px;
    height: 24px;
}
body.cursor-hovering .cyber-t, body.cursor-hovering .cyber-b { height: 6px; left: 11px; }
body.cursor-hovering .cyber-l, body.cursor-hovering .cyber-r { width: 6px; top: 11px; }

body.cursor-clicking .custom-cursor-cyber {
    transform: translate(-50%, -50%) scale(0.8) !important;
}

/* Simple */
.custom-cursor-simple {
    position: fixed;
    width: 16px;
    height: 16px;
    pointer-events: none;
    z-index: 10000;
    transform: translate(-50%, -50%);
    transition: transform 0.1s;
    display: none;
}
.simple-v, .simple-h {
    position: absolute;
    background-color: var(--cursor-color, #ffffff);
}
.simple-v {
    width: 2px;
    height: 16px;
    left: 7px;
    top: 0;
}
.simple-h {
    width: 16px;
    height: 2px;
    left: 0;
    top: 7px;
}
body.cursor-hovering .custom-cursor-simple {
    transform: translate(-50%, -50%) scale(1.3);
}
body.cursor-clicking .custom-cursor-simple {
    transform: translate(-50%, -50%) scale(0.8);
}

/* \u2500\u2500\u2500 Custom Cursor Swatches \u2500\u2500\u2500 */
.color-swatch-cursor {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
    transition: transform 0.2s ease, border-color 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.color-swatch-cursor:hover {
    transform: scale(1.1);
}

.color-swatch-cursor.active {
    border-color: #fff;
    transform: scale(1.05);
}

`, {
        headers: {
          "content-type": "text/css;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/script.js") {
      return new Response(`/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GHOST ARCADE \u2014 Core Logic
   Includes custom accents, settings, view layout toggle,
   custom game uploads, keyboard navigation, and toast system
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

(function () {
    'use strict';

    // \u2500\u2500\u2500 Constants & Storage Keys \u2500\u2500\u2500
    const STORAGE = {
        favorites: 'ghostArcade_favorites',
        recent: 'ghostArcade_recent',
        settings: 'ghostArcade_settings',
        customGames: 'ghostArcade_custom_games'
    };
    const MAX_RECENT = 20;

    const DEFAULT_SETTINGS = {
        accentColor: '#00e5ff',
        cardSize: 'medium',
        layoutMode: 'grid',
        parallaxEnabled: true,
        decoyPreset: 'google-drive',
        tabTitle: 'Google Drive',
        tabFavicon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
        panicKey: '\`',
        panicCtrl: true,
        panicRedirect: 'https://www.google.com',
        autoGhost: false,
        customDecoyImage: '',
        cursorStyle: 'ring',
        cursorColor: 'match',
        bgEffect: 'orbs',
        lightningFrequency: 5,
        bgDensity: 5
    };

    // \u2500\u2500\u2500 State \u2500\u2500\u2500
    let allGames = [];
    let currentTab = 'all';
    let favorites = loadJSON(STORAGE.favorites, []);
    let recentlyPlayed = loadJSON(STORAGE.recent, []);
    let settings = loadJSON(STORAGE.settings, DEFAULT_SETTINGS);
    let customGames = loadJSON(STORAGE.customGames, []);

    // Merge default settings keys if they don't exist
    settings = { ...DEFAULT_SETTINGS, ...settings };

    // \u2500\u2500\u2500 DOM Refs \u2500\u2500\u2500
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const gameGrid = $('#gameGrid');
    const loadingGrid = $('#loadingGrid');
    const searchInput = $('#searchInput');
    const emptyState = $('#emptyState');
    const ghostModeBtn = $('#ghostModeBtn');
    const ghostIndicator = $('#ghostIndicator');
    const tabButtons = $$('.tab');

    // Toolbar buttons
    const settingsBtn = $('#settingsBtn');
    const randomGameBtn = $('#randomGameBtn');
    const viewToggleBtn = $('#viewToggleBtn');
    const viewToggleIcon = $('#viewToggleIcon');

    // Settings Modal DOM
    const settingsModal = $('#settingsModal');
    const closeSettingsBtn = $('#closeSettingsBtn');
    const modalTabBtns = $$('.modal-tab-btn');
    const settingsSections = $$('.settings-section');

    // Settings Form Inputs
    const cardSizeSelect = $('#cardSizeSelect');
    const parallaxToggle = $('#parallaxToggle');
    const decoyPresetSelect = $('#decoyPresetSelect');
    const tabTitleInput = $('#tabTitleInput');
    const tabFaviconInput = $('#tabFaviconInput');
    const panicCtrlCheckbox = $('#panicCtrlCheckbox');
    const panicKeyInput = $('#panicKeyInput');
    const panicRedirectInput = $('#panicRedirectInput');
    const autoGhostToggle = $('#autoGhostToggle');
    const customDecoyImageGroup = $('#customDecoyImageGroup');
    const customDecoyImageInput = $('#customDecoyImageInput');
    const customDecoyPreview = $('#customDecoyPreview');

    // Cursor & Background Settings Inputs
    const cursorStyleSelect = $('#cursorStyleSelect');
    const bgEffectSelect = $('#bgEffectSelect');
    const customCursorColorInput = $('#customCursorColorInput');
    const lightningFreqSlider = $('#lightningFreqSlider');
    const bgDensitySlider = $('#bgDensitySlider');
    
    const groupLightningFreq = $('#groupLightningFreq');
    const groupBgDensity = $('#groupBgDensity');

    // Custom game upload form
    const customGameForm = $('#customGameForm');
    const customGamesList = $('#customGamesList');

    // Backup & Reset Buttons
    const exportSettingsBtn = $('#exportSettingsBtn');
    const importSettingsFile = $('#importSettingsFile');
    const resetAllDataBtn = $('#resetAllDataBtn');

    // Toast Container
    const toastContainer = $('#toastContainer');

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // INIT
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        applySettings();
        initCustomCursor();
        initLightning();
        setupGhostMode();
        setupPanicKey();
        setupSearch();
        setupTabs();
        setupToolbarActions();
        setupSettingsModal();
        setupCustomGamesPanel();
        setupKeyboardNavigation();
        await loadGames();
        renderGames();
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // GAME LOADING
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    async function loadGames() {
        try {
            const res = await fetch('games.json');
            if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
            allGames = await res.json();
        } catch (err) {
            console.error('Failed to load games:', err);
            allGames = [];
        }

        // Merge custom games and mark them as custom
        const processedCustom = customGames.map(g => ({ ...g, isCustom: true }));
        allGames = allGames.concat(processedCustom);

        // Hide skeleton loader
        if (loadingGrid) loadingGrid.hidden = true;
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // SETTINGS APPLICATION
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function applySettings() {
        // 1. Accent Color
        applyAccentColor(settings.accentColor);

        // 2. Card Size
        const cardSizes = { small: '180px', medium: '260px', large: '320px' };
        document.documentElement.style.setProperty('--card-size', cardSizes[settings.cardSize] || cardSizes.medium);

        // 3. Layout Mode
        if (settings.layoutMode === 'list') {
            gameGrid.classList.add('game-grid--list');
            setViewToggleIconToList(true);
        } else {
            gameGrid.classList.remove('game-grid--list');
            setViewToggleIconToList(false);
        }

        // 4. Tab Masking (Applied globally if active in ghost mode or always enabled)
        const params = new URLSearchParams(window.location.search);
        const isGhost = params.get('ghost') === '1' || settings.autoGhost;
        if (isGhost) {
            document.title = settings.tabTitle;
            setCustomFavicon(settings.tabFavicon);
        }

        // Populating Settings Inputs to match state
        if (cardSizeSelect) cardSizeSelect.value = settings.cardSize;
        if (parallaxToggle) parallaxToggle.checked = settings.parallaxEnabled;
        if (decoyPresetSelect) decoyPresetSelect.value = settings.decoyPreset;
        
        if (customDecoyImageGroup) {
            if (settings.decoyPreset === 'custom-image') {
                customDecoyImageGroup.style.display = 'block';
                if (settings.customDecoyImage && customDecoyPreview) {
                    customDecoyPreview.src = settings.customDecoyImage;
                    customDecoyPreview.style.display = 'block';
                }
            } else {
                customDecoyImageGroup.style.display = 'none';
            }
        }

        if (tabTitleInput) tabTitleInput.value = settings.tabTitle;
        if (tabFaviconInput) tabFaviconInput.value = settings.tabFavicon;
        if (panicCtrlCheckbox) panicCtrlCheckbox.checked = settings.panicCtrl;
        if (panicKeyInput) panicKeyInput.value = settings.panicKey;
        if (panicRedirectInput) panicRedirectInput.value = settings.panicRedirect;
        if (autoGhostToggle) autoGhostToggle.checked = settings.autoGhost;

        if (cursorStyleSelect) cursorStyleSelect.value = settings.cursorStyle || 'none';
        if (bgEffectSelect) bgEffectSelect.value = settings.bgEffect || 'none';
        if (lightningFreqSlider) lightningFreqSlider.value = settings.lightningFrequency || 5;
        if (bgDensitySlider) bgDensitySlider.value = settings.bgDensity || 5;

        applyCursorColor();
        updateCursorState();
        if (typeof updateBgEffectState === 'function') updateBgEffectState();

        // Show/Hide relevant settings
        if (groupLightningFreq && groupBgDensity) {
            groupLightningFreq.style.display = settings.bgEffect === 'lightning' ? 'block' : 'none';
            groupBgDensity.style.display = (settings.bgEffect === 'matrix' || settings.bgEffect === 'starfield') ? 'block' : 'none';
        }

        // Auto-ghost launcher redirection
        if (settings.autoGhost && params.get('ghost') !== '1' && window.location.pathname.includes('/ghost-ui')) {
            activateGhostMode();
        }
    }

    function applyAccentColor(hex) {
        document.documentElement.style.setProperty('--accent-cyan', hex);
        document.documentElement.style.setProperty('--glow-cyan', hexToRgba(hex, 0.35));
        document.documentElement.style.setProperty('--border-hover', hexToRgba(hex, 0.25));

        // Update active swatch state
        $$('.color-swatch').forEach(sw => {
            if (sw.dataset.color.toLowerCase() === hex.toLowerCase()) {
                sw.classList.add('active');
            } else {
                sw.classList.remove('active');
            }
        });
    }

    function hexToRgba(hex, alpha) {
        let c;
        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
            c = hex.substring(1).split('');
            if (c.length === 3) {
                c = [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c = '0x' + c.join('');
            return \`rgba(\${(c >> 16) & 255}, \${(c >> 8) & 255}, \${c & 255}, \${alpha})\`;
        }
        return \`rgba(0, 229, 255, \${alpha})\`;
    }

    function setCustomFavicon(url) {
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = url || 'https://www.google.com/favicon.ico';
    }

    function setViewToggleIconToList(isList) {
        if (!viewToggleIcon) return;
        if (isList) {
            // list icon active, show grid icon
            viewToggleIcon.innerHTML = \`
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
            \`;
        } else {
            // grid icon active, show list icon
            viewToggleIcon.innerHTML = \`
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            \`;
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // RENDERING
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function getProxyUrl(url) {
        if (!url) return '';
        if (url.startsWith('/proxy/')) return url;
        if (window.location.protocol === 'file:') return url;
        return '/proxy/' + url;
    }

    function renderGames() {
        const query = searchInput.value.toLowerCase().trim();
        let games = getGamesForTab();

        // Apply search filter
        if (query) {
            games = games.filter(g => g.title.toLowerCase().includes(query));
        }

        // Empty state
        if (games.length === 0) {
            gameGrid.innerHTML = '';
            emptyState.hidden = false;
            updateEmptyState();
            return;
        }

        emptyState.hidden = true;
        gameGrid.innerHTML = games.map(createCardHTML).join('');
        attachCardListeners();

        // Stagger entrance animation if not in list view
        if (settings.layoutMode !== 'list') {
            gameGrid.querySelectorAll('.game-card').forEach((card, i) => {
                card.style.animationDelay = \`\${i * 0.04}s\`;
            });
        }
    }

    function createCardHTML(game) {
        const isFav = favorites.includes(game.url);
        const favFill = isFav ? 'currentColor' : 'none';
        const favClass = isFav ? ' active' : '';
        const isCustom = game.isCustom || false;

        const imgUrl = game.image || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23101018"><rect width="100" height="100"/><text x="50%" y="55%" font-size="40" text-anchor="middle" dominant-baseline="middle">\u{1F3AE}</text></svg>';

        return \`
        <article class="game-card" data-url="\${esc(game.url)}" data-title="\${esc(game.title)}" data-image="\${esc(imgUrl)}" tabindex="0">
            <div class="card-image-wrap">
                <img class="card-image"
                     src="\${esc(imgUrl)}"
                     alt="\${esc(game.title)}"
                     loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22 fill=%22%23101018%22><rect width=%22100%22 height=%22100%22/><text x=%2250%%22 y=%2255%%22 font-size=%2240%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22>\u{1F3AE}</text></svg>';">
                <div class="card-image-overlay"></div>

                <button class="card-play-btn" aria-label="Play \${esc(game.title)}">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>

                <button class="card-fav-btn\${favClass}" aria-label="\${isFav ? 'Remove from' : 'Add to'} favorites">
                    <svg viewBox="0 0 24 24" fill="\${favFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
            </div>

            <div class="card-info">
                <h3 class="card-title">\${escHTML(game.title)}</h3>
            </div>

            <div class="game-card-actions" style="display:none;">
                <button class="card-play-btn" aria-label="Play \${esc(game.title)}" title="Play game">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="card-fav-btn\${favClass}" aria-label="\${isFav ? 'Remove from' : 'Add to'} favorites" title="Favorite">
                    <svg viewBox="0 0 24 24" fill="\${favFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
                \${isCustom ? \`
                <button class="card-del-btn" aria-label="Delete custom game" title="Delete custom game">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
                \` : ''}
            </div>
        </article>\`;
    }

    function attachCardListeners() {
        gameGrid.querySelectorAll('.game-card').forEach(card => {
            const url = card.dataset.url;
            const title = card.dataset.title;
            const image = card.dataset.image;

            // Play button clicks (supports grid overlay and list view button)
            card.querySelectorAll('.card-play-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    playGame(url, title, image);
                });
            });

            // Favorite button clicks (supports grid overlay and list view button)
            card.querySelectorAll('.card-fav-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleFavorite(url);
                });
            });

            // Delete button clicks for custom games
            const delBtn = card.querySelector('.card-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteCustomGame(url);
                });
            }

            // Whole card click triggers play
            card.addEventListener('click', () => {
                playGame(url, title, image);
            });

            // 3D Parallax Tilt listeners
            card.addEventListener('mousemove', handleCardMouseMove);
            card.addEventListener('mouseleave', handleCardMouseLeave);
        });
    }

    function getGamesForTab() {
        switch (currentTab) {
            case 'recent':
                return recentlyPlayed
                    .map(r => allGames.find(g => g.url === r.url) || r)
                    .filter(Boolean);
            case 'favorites':
                return allGames.filter(g => favorites.includes(g.url));
            default:
                return allGames;
        }
    }

    function updateEmptyState() {
        const icon = $('.empty-state__icon');
        const title = $('.empty-state__title');
        const text = $('.empty-state__text');
        if (!icon) return;

        if (searchInput.value.trim()) {
            icon.textContent = '\u{1F50D}';
            title.textContent = 'No matches';
            text.textContent = 'Try a different search term.';
        } else if (currentTab === 'recent') {
            icon.textContent = '\u{1F550}';
            title.textContent = 'No recent games';
            text.textContent = 'Start playing to see your history here!';
        } else if (currentTab === 'favorites') {
            icon.textContent = '\u{1F49C}';
            title.textContent = 'No favorites yet';
            text.textContent = 'Click the heart on any game to save it here.';
        } else {
            icon.textContent = '\u{1F47B}';
            title.textContent = 'No games found';
            text.textContent = 'Check back later for new games.';
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // TOOLBAR ACTIONS
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupToolbarActions() {
        // Settings Button toggle
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                settingsModal.classList.add('active');
            });
        }

        // View Mode toggle
        if (viewToggleBtn) {
            viewToggleBtn.addEventListener('click', () => {
                settings.layoutMode = settings.layoutMode === 'grid' ? 'list' : 'grid';
                saveJSON(STORAGE.settings, settings);
                applySettings();
                renderGames();
                showToast(\`Switched to \${settings.layoutMode} view mode\`, 'info');
            });
        }

        // Random Game Button
        if (randomGameBtn) {
            randomGameBtn.addEventListener('click', () => {
                const games = allGames;
                if (games.length === 0) {
                    showToast('No games loaded to select randomly.', 'error');
                    return;
                }
                const randIndex = Math.floor(Math.random() * games.length);
                const game = games[randIndex];
                showToast(\`Launching random game: \${game.title} \u{1F3B2}\`, 'success');
                setTimeout(() => {
                    playGame(game.url, game.title, game.image);
                }, 8000); // give them a moment to read the toast
            });
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // SETTINGS MODAL INTERACTION
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupSettingsModal() {
        if (!settingsModal) return;

        // Close modal handlers
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });

        // Close on clicking backdrop
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('active');
            }
        });

        // Modal tab switcher
        modalTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modalTabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const targetTab = btn.dataset.settingsTab;
                settingsSections.forEach(sect => {
                    if (sect.id === \`sect-\${targetTab}\`) {
                        sect.classList.add('active');
                    } else {
                        sect.classList.remove('active');
                    }
                });
            });
        });

        // Color Swatches Selection
        $$('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                settings.accentColor = color;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Accent color updated!', 'success');
            });
        });

        // Custom Color Picker input
        const customColorInput = $('#customColorInput');
        if (customColorInput) {
            customColorInput.addEventListener('input', (e) => {
                const color = e.target.value;
                settings.accentColor = color;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
            customColorInput.addEventListener('change', (e) => {
                showToast('Custom accent color saved!', 'success');
            });
        }

        // Card Size Selection
        if (cardSizeSelect) {
            cardSizeSelect.addEventListener('change', (e) => {
                settings.cardSize = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast(\`Grid card size changed to \${settings.cardSize}\`, 'info');
            });
        }

        // Parallax Tilt toggle
        if (parallaxToggle) {
            parallaxToggle.addEventListener('change', (e) => {
                settings.parallaxEnabled = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(settings.parallaxEnabled ? 'Parallax card tilt enabled' : 'Parallax card tilt disabled', 'info');
            });
        }

        // Decoy Preset selection
        if (decoyPresetSelect) {
            decoyPresetSelect.addEventListener('change', (e) => {
                settings.decoyPreset = e.target.value;
                
                if (settings.decoyPreset === 'custom-image') {
                    settings.tabTitle = 'Portal';
                    settings.tabFavicon = '';
                } else {
                    settings.tabTitle = 'My Drive - Google Drive';
                    settings.tabFavicon = 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png';
                }

                if (tabTitleInput) tabTitleInput.value = settings.tabTitle;
                if (tabFaviconInput) tabFaviconInput.value = settings.tabFavicon;

                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast(\`Decoy preset changed to \${settings.decoyPreset.replace('-', ' ')}\`, 'success');
            });
        }

        if (customDecoyImageInput) {
            customDecoyImageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        // Downscale if too large to fit in localStorage
                        const MAX_WIDTH = 1920;
                        const MAX_HEIGHT = 1080;
                        
                        if (width > height) {
                            if (width > MAX_WIDTH) {
                                height *= MAX_WIDTH / width;
                                width = MAX_WIDTH;
                            }
                        } else {
                            if (height > MAX_HEIGHT) {
                                width *= MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // Compress to 70% quality JPEG
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                        settings.customDecoyImage = dataUrl;
                        saveJSON(STORAGE.settings, settings);
                        applySettings();
                        showToast('Custom screenshot saved!', 'success');
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        // Custom Tab title input
        if (tabTitleInput) {
            tabTitleInput.addEventListener('input', (e) => {
                settings.tabTitle = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
        }

        // Custom Tab favicon input
        if (tabFaviconInput) {
            tabFaviconInput.addEventListener('input', (e) => {
                settings.tabFavicon = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
        }

        // Panic key recorder
        if (panicKeyInput) {
            panicKeyInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                // Avoid using mod keys by themselves
                if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

                settings.panicKey = e.key;
                panicKeyInput.value = e.key;
                saveJSON(STORAGE.settings, settings);
                showToast(\`Panic keybind updated to \${settings.panicCtrl ? 'Ctrl+' : ''}\${e.key.toUpperCase()}\`, 'success');
            });
        }

        if (panicCtrlCheckbox) {
            panicCtrlCheckbox.addEventListener('change', (e) => {
                settings.panicCtrl = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(\`Panic keybind updated to \${settings.panicCtrl ? 'Ctrl+' : ''}\${settings.panicKey.toUpperCase()}\`, 'success');
            });
        }

        // Panic Redirect Destination
        if (panicRedirectInput) {
            panicRedirectInput.addEventListener('input', (e) => {
                settings.panicRedirect = e.target.value;
                saveJSON(STORAGE.settings, settings);
            });
        }

        // Auto Ghost Mode
        if (autoGhostToggle) {
            autoGhostToggle.addEventListener('change', (e) => {
                settings.autoGhost = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(settings.autoGhost ? 'Auto Ghost Mode activated' : 'Auto Ghost Mode disabled', 'info');
                if (settings.autoGhost) {
                    applySettings();
                }
            });
        }

        // Cursor Style Select
        if (cursorStyleSelect) {
            cursorStyleSelect.addEventListener('change', (e) => {
                settings.cursorStyle = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Cursor style updated', 'info');
            });
        }

        // Custom Cursor Swatches
        $$('.color-swatch-cursor').forEach(swatch => {
            swatch.addEventListener('click', () => {
                settings.cursorColor = swatch.dataset.cursorColor;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Cursor color updated!', 'success');
            });
        });

        // Custom Cursor Color Input
        if (customCursorColorInput) {
            customCursorColorInput.addEventListener('input', (e) => {
                settings.cursorColor = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
            customCursorColorInput.addEventListener('change', () => {
                showToast('Custom cursor color saved!', 'success');
            });
        }

        // Background Effect Select
        if (bgEffectSelect) {
            bgEffectSelect.addEventListener('change', (e) => {
                settings.bgEffect = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Background effect updated', 'info');
            });
        }

        // Lightning Frequency Slider
        if (lightningFreqSlider) {
            lightningFreqSlider.addEventListener('input', (e) => {
                settings.lightningFrequency = parseInt(e.target.value);
                saveJSON(STORAGE.settings, settings);
            });
            lightningFreqSlider.addEventListener('change', () => {
                showToast('Lightning frequency updated!', 'success');
            });
        }

        // Density Slider
        if (bgDensitySlider) {
            bgDensitySlider.addEventListener('input', (e) => {
                settings.bgDensity = parseInt(e.target.value);
                saveJSON(STORAGE.settings, settings);
            });
            bgDensitySlider.addEventListener('change', () => {
                showToast('Effect density updated!', 'success');
            });
        }

        // Backup Actions
        if (exportSettingsBtn) {
            exportSettingsBtn.addEventListener('click', exportSettingsData);
        }

        if (importSettingsFile) {
            importSettingsFile.addEventListener('change', importSettingsData);
        }

        if (resetAllDataBtn) {
            resetAllDataBtn.addEventListener('click', factoryResetAll);
        }

        const inspectSavesBtn = $('#inspectSavesBtn');
        if (inspectSavesBtn) {
            inspectSavesBtn.addEventListener('click', inspectSaveData);
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // CUSTOM GAMES PANEL
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupCustomGamesPanel() {
        if (!customGameForm) return;

        customGameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = $('#customTitle').value.trim();
            const url = $('#customUrl').value.trim();
            const image = $('#customImage').value.trim();

            if (!title || !url) {
                showToast('Please fill out Title and URL fields.', 'error');
                return;
            }

            // check if URL already exists
            if (allGames.some(g => g.url === url) || customGames.some(g => g.url === url)) {
                showToast('A game with this URL already exists.', 'error');
                return;
            }

            const newGame = { title, url, image, isCustom: true };
            customGames.push(newGame);
            saveJSON(STORAGE.customGames, customGames);

            // Add to live games catalog
            allGames.push(newGame);

            // Reset Form fields
            customGameForm.reset();

            // Refresh DOM layouts
            renderGames();
            populateCustomGamesSettingsList();
            showToast(\`Custom game "\${title}" added!\`, 'success');
        });

        populateCustomGamesSettingsList();
    }

    function populateCustomGamesSettingsList() {
        if (!customGamesList) return;

        if (customGames.length === 0) {
            customGamesList.innerHTML = \`<div class="settings-desc" style="font-style: italic;">No custom games uploaded yet.</div>\`;
            return;
        }

        customGamesList.innerHTML = customGames.map((game, i) => \`
            <div class="custom-game-list-item">
                <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px;">
                    \${escHTML(game.title)}
                    <span style="display:block; font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;">
                        \${escHTML(game.url)}
                    </span>
                </div>
                <button type="button" data-index="\${i}" class="delete-custom-game-btn" title="Delete game">\u{1F5D1}\uFE0F</button>
            </div>
        \`).join('');

        customGamesList.querySelectorAll('.delete-custom-game-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                if (!isNaN(idx) && customGames[idx]) {
                    const deleted = customGames.splice(idx, 1)[0];
                    saveJSON(STORAGE.customGames, customGames);

                    // Remove from active runtime games
                    allGames = allGames.filter(g => g.url !== deleted.url);

                    renderGames();
                    populateCustomGamesSettingsList();
                    showToast(\`Custom game "\${deleted.title}" deleted\`, 'success');
                }
            });
        });
    }

    function deleteCustomGame(url) {
        const game = customGames.find(g => g.url === url);
        if (!game) return;

        if (confirm(\`Are you sure you want to delete the custom game "\${game.title}"?\`)) {
            customGames = customGames.filter(g => g.url !== url);
            saveJSON(STORAGE.customGames, customGames);

            allGames = allGames.filter(g => g.url !== url);
            renderGames();
            populateCustomGamesSettingsList();
            showToast(\`Custom game deleted\`, 'success');
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // KEYBOARD NAVIGATION
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Check settings modal state
            const isModalOpen = settingsModal && settingsModal.classList.contains('active');

            // Escape closes settings modal
            if (e.key === 'Escape' && isModalOpen) {
                settingsModal.classList.remove('active');
                return;
            }

            // Keyboard navigation in grid: arrows and controls
            const cards = Array.from(gameGrid.querySelectorAll('.game-card'));
            if (cards.length === 0) return;

            const activeEl = document.activeElement;
            const activeIndex = cards.indexOf(activeEl);

            // If user typing in inputs/forms, do not hijack keys
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                return;
            }

            let nextIndex = -1;

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (activeIndex === -1) nextIndex = 0;
                else nextIndex = Math.min(activeIndex + 1, cards.length - 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (activeIndex === -1) nextIndex = 0;
                else nextIndex = Math.max(activeIndex - 1, 0);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (activeIndex === -1) {
                    nextIndex = 0;
                } else if (settings.layoutMode === 'list') {
                    nextIndex = Math.min(activeIndex + 1, cards.length - 1);
                } else {
                    const cols = getGridColumnCount();
                    nextIndex = Math.min(activeIndex + cols, cards.length - 1);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeIndex === -1) {
                    nextIndex = 0;
                } else if (settings.layoutMode === 'list') {
                    nextIndex = Math.max(activeIndex - 1, 0);
                } else {
                    const cols = getGridColumnCount();
                    nextIndex = Math.max(activeIndex - cols, 0);
                }
            } else if (e.key.toLowerCase() === 'f' && activeIndex !== -1) {
                // Favorite focused game
                e.preventDefault();
                const card = cards[activeIndex];
                toggleFavorite(card.dataset.url);
                showToast(\`Favorites updated for "\${card.dataset.title}"\`, 'success');
            }

            if (nextIndex !== -1) {
                cards[nextIndex].focus();
                // Add focused visual outline helper class
                cards.forEach(c => c.classList.remove('kbd-focused'));
                cards[nextIndex].classList.add('kbd-focused');
            }
        });

        // Add visual listener to clear visual focus classes on mouse hover
        gameGrid.addEventListener('focusin', (e) => {
            const card = e.target.closest('.game-card');
            if (card) {
                $$('.game-card').forEach(c => c.classList.remove('kbd-focused'));
                card.classList.add('kbd-focused');
            }
        });

        gameGrid.addEventListener('focusout', (e) => {
            const card = e.target.closest('.game-card');
            if (card) {
                card.classList.remove('kbd-focused');
            }
        });
    }

    function getGridColumnCount() {
        const cards = Array.from(gameGrid.querySelectorAll('.game-card'));
        if (cards.length <= 1) return 1;

        const firstTop = cards[0].offsetTop;
        let cols = 0;
        for (let i = 0; i < cards.length; i++) {
            if (cards[i].offsetTop === firstTop) {
                cols++;
            } else {
                break;
            }
        }
        return cols || 1;
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // 3D PARALLAX CARD TILT
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function handleCardMouseMove(e) {
        if (!settings.parallaxEnabled) return;
        const card = e.currentTarget;
        const rect = card.getBoundingClientRect();
        
        // Mouse coordinate offsets from card center
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        // Angle tilt calculations
        const maxRotation = 14; // degrees
        const rotX = -(y / (rect.height / 2)) * maxRotation;
        const rotY = (x / (rect.width / 2)) * maxRotation;

        card.style.transform = \`perspective(800px) rotateX(\${rotX.toFixed(2)}deg) rotateY(\${rotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)\`;
        card.style.boxShadow = \`0 15px 35px rgba(0, 0, 0, 0.4), 0 0 15px var(--glow-cyan)\`;
    }

    function handleCardMouseLeave(e) {
        const card = e.currentTarget;
        card.style.transform = '';
        card.style.boxShadow = '';
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // TOAST NOTIFICATIONS
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function showToast(message, type = 'info') {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = \`toast toast--\${type}\`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Fade out after 2.5 seconds
        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            }, { once: true });
            // Safety fallback in case transitionend doesn't fire
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 600);
        }, 2500);
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // IMPORT / EXPORT / RESET DATA
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // Helpers for binary data in IndexedDB
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    function base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function serializeValue(val) {
        if (val instanceof Uint8Array) {
            const copy = new Uint8Array(val.length);
            copy.set(val);
            return { __type: 'Uint8Array', data: arrayBufferToBase64(copy.buffer) };
        } else if (val instanceof ArrayBuffer) {
            return { __type: 'ArrayBuffer', data: arrayBufferToBase64(val) };
        } else if (val instanceof Date) {
            return { __type: 'Date', data: val.toISOString() };
        } else if (typeof val === 'object' && val !== null) {
            const newVal = Array.isArray(val) ? [] : {};
            for (let k in val) {
                newVal[k] = serializeValue(val[k]);
            }
            return newVal;
        }
        return val;
    }

    function deserializeValue(val) {
        if (val && typeof val === 'object') {
            if (val.__type === 'Uint8Array') {
                return new Uint8Array(base64ToArrayBuffer(val.data));
            } else if (val.__type === 'ArrayBuffer') {
                return base64ToArrayBuffer(val.data);
            } else if (val.__type === 'Date') {
                return new Date(val.data);
            }
            const newVal = Array.isArray(val) ? [] : {};
            for (let k in val) {
                newVal[k] = deserializeValue(val[k]);
            }
            return newVal;
        }
        return val;
    }

    function exportIDB(dbName) {
        return new Promise((resolve) => {
            const request = indexedDB.open(dbName);
            request.onerror = () => resolve({ error: 'Failed to open' });
            request.onsuccess = async (e) => {
                const db = e.target.result;
                const storeNames = Array.from(db.objectStoreNames);
                const dbData = { __version: db.version, stores: {} };
                
                if (storeNames.length === 0) {
                    db.close();
                    return resolve(dbData);
                }

                for (const storeName of storeNames) {
                    const transaction = db.transaction(storeName, 'readonly');
                    const store = transaction.objectStore(storeName);
                    
                    // IMPORTANT: Start BOTH requests synchronously before awaiting either.
                    // IDB transactions auto-commit when there are no pending requests in
                    // the current microtask. If we await getRecords() first, the transaction
                    // closes before getAllKeys() is called, returning empty keys and losing
                    // all file path information (breaking Emscripten IDBFS saves).
                    const recordsPromise = new Promise(r => {
                        const req = store.getAll();
                        req.onsuccess = () => r(req.result);
                        req.onerror = () => r([]);
                    });
                    const keysPromise = new Promise(r => {
                        const req = store.getAllKeys();
                        req.onsuccess = () => r(req.result);
                        req.onerror = () => r([]);
                    });
                    
                    const [records, keys] = await Promise.all([recordsPromise, keysPromise]);
                    
                    dbData.stores[storeName] = {
                        records: records.map(val => serializeValue(val)),
                        keys: keys.length ? keys : null,
                        keyPath: store.keyPath,
                        autoIncrement: store.autoIncrement
                    };
                }
                
                db.close();
                resolve(dbData);
            };
        });
    }

    function importIDB(dbName, dbData) {
        return new Promise((resolve) => {
            if (!dbData.stores) return resolve();
            const version = dbData.__version || 1;
            
            const request = indexedDB.open(dbName, version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const storeName in dbData.stores) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const info = dbData.stores[storeName];
                        const options = { autoIncrement: info.autoIncrement };
                        if (info.keyPath != null) {
                            options.keyPath = info.keyPath;
                        }
                        db.createObjectStore(storeName, options);
                    }
                }
            };
            request.onsuccess = async (e) => {
                const db = e.target.result;
                const storeNames = Object.keys(dbData.stores).filter(s => db.objectStoreNames.contains(s));
                
                for (const storeName of storeNames) {
                    const storeData = dbData.stores[storeName];
                    const transaction = db.transaction(storeName, 'readwrite');
                    const store = transaction.objectStore(storeName);
                    
                    store.clear();
                    
                    if (storeData.records) {
                        for (let i = 0; i < storeData.records.length; i++) {
                            const val = deserializeValue(storeData.records[i]);
                            try {
                                if (storeData.keys && storeData.keys[i] !== undefined && storeData.keyPath == null) {
                                    store.put(val, storeData.keys[i]);
                                } else {
                                    store.put(val);
                                }
                            } catch(err) {
                                console.error('IDB Put error', err);
                            }
                        }
                    }
                    
                    await new Promise(r => {
                        transaction.oncomplete = () => r();
                        transaction.onerror = () => r();
                    });
                }
                db.close();
                resolve();
            };
            request.onerror = () => resolve();
        });
    }

    async function exportSettingsData() {
        const exportBtn = document.getElementById('exportSettingsBtn');
        if (exportBtn) {
            exportBtn.textContent = '\u23F3 Preparing Backup...';
            exportBtn.disabled = true;
        }

        const data = {
            favorites: favorites,
            recent: recentlyPlayed,
            settings: settings,
            customGames: customGames,
            localStorage: {},
            indexedDB: {}
        };

        const coreKeys = Object.values(STORAGE);

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!coreKeys.includes(key)) {
                data.localStorage[key] = localStorage.getItem(key);
            }
        }

        try {
            if (window.indexedDB && indexedDB.databases) {
                const dbs = await indexedDB.databases();
                console.log('[Ghost Arcade Export] Found IndexedDB databases:', dbs);
                for (const dbInfo of dbs) {
                    if (dbInfo.name) {
                        console.log(\`[Ghost Arcade Export] Exporting DB: "\${dbInfo.name}"\`);
                        const dbExport = await exportIDB(dbInfo.name);
                        data.indexedDB[dbInfo.name] = dbExport;
                        // Log summary
                        for (const [storeName, storeData] of Object.entries(dbExport.stores || {})) {
                            const numRecords = storeData.records ? storeData.records.length : 0;
                            const hasKeys = storeData.keys && storeData.keys.length > 0;
                            console.log(\`  \u2192 Store "\${storeName}": \${numRecords} records, keys captured: \${hasKeys}\`, hasKeys ? storeData.keys.slice(0, 5) : '(none!)');
                        }
                    }
                }
            } else {
                console.warn('[Ghost Arcade Export] indexedDB.databases() not available in this browser.');
            }
        } catch (e) {
            console.warn('Could not export IndexedDB', e);
        }

        const jsonString = JSON.stringify(data, null, 4);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = \`ghost-arcade-backup-\${new Date().toISOString().split('T')[0]}.json\`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        if (exportBtn) {
            exportBtn.textContent = '\u{1F4E5} Export Backup';
            exportBtn.disabled = false;
        }
        showToast('Backup downloaded! Check browser console (F12) for export summary.', 'success');
    }

    function importSettingsData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function (evt) {
            try {
                const parsed = JSON.parse(evt.target.result);
                
                if (parsed.settings || parsed.favorites || parsed.customGames || parsed.localStorage || parsed.indexedDB) {
                    showToast('Restoring data and game saves, please wait...', 'info');

                    if (parsed.settings) localStorage.setItem(STORAGE.settings, JSON.stringify(parsed.settings));
                    if (parsed.favorites) localStorage.setItem(STORAGE.favorites, JSON.stringify(parsed.favorites));
                    if (parsed.recent) localStorage.setItem(STORAGE.recent, JSON.stringify(parsed.recent));
                    if (parsed.customGames) localStorage.setItem(STORAGE.customGames, JSON.stringify(parsed.customGames));

                    if (parsed.localStorage) {
                        for (const [key, value] of Object.entries(parsed.localStorage)) {
                            localStorage.setItem(key, value);
                        }
                    }

                    if (parsed.indexedDB) {
                        for (const [dbName, dbData] of Object.entries(parsed.indexedDB)) {
                            if (dbData.error) continue;
                            await importIDB(dbName, dbData);
                        }
                    }

                    showToast('Settings & Saves restored! Reloading...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } else {
                    showToast('Invalid backup file structure.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Failed to parse backup JSON file.', 'error');
            }
        };
        reader.readAsText(file);
    }

    async function inspectSaveData() {
        const btn = document.getElementById('inspectSavesBtn');
        if (btn) { btn.textContent = '\u23F3 Scanning...'; btn.disabled = true; }

        let report = '=== Ghost Arcade Save Inspector ===\\n\\n';

        // localStorage summary
        const coreKeys = Object.values(STORAGE);
        const gameLocalStorageKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!coreKeys.includes(key)) gameLocalStorageKeys.push(key);
        }
        report += \`localStorage game keys (\${gameLocalStorageKeys.length}):\\n\`;
        gameLocalStorageKeys.forEach(k => report += \`  \u2022 \${k}\\n\`);
        report += '\\n';

        // IndexedDB summary
        if (window.indexedDB && indexedDB.databases) {
            try {
                const dbs = await indexedDB.databases();
                report += \`IndexedDB databases found: \${dbs.length}\\n\`;
                for (const dbInfo of dbs) {
                    if (!dbInfo.name) continue;
                    report += \`\\n\u{1F4E6} DB: "\${dbInfo.name}" (v\${dbInfo.version})\\n\`;
                    const dbExport = await exportIDB(dbInfo.name);
                    if (dbExport.error) {
                        report += \`   \u274C Error: \${dbExport.error}\\n\`;
                        continue;
                    }
                    for (const [storeName, storeData] of Object.entries(dbExport.stores || {})) {
                        const numRecords = storeData.records ? storeData.records.length : 0;
                        const keys = storeData.keys || [];
                        report += \`   Store "\${storeName}": \${numRecords} records\\n\`;
                        if (keys.length > 0) {
                            report += \`   Keys (first 10):\\n\`;
                            keys.slice(0, 10).forEach(k => report += \`     - \${JSON.stringify(k)}\\n\`);
                            if (keys.length > 10) report += \`     ... and \${keys.length - 10} more\\n\`;
                        } else {
                            report += \`   \u26A0\uFE0F NO KEYS found \u2014 save data cannot be restored!\\n\`;
                        }
                    }
                }
            } catch(e) {
                report += \`IndexedDB scan error: \${e}\\n\`;
            }
        } else {
            report += 'IndexedDB.databases() not available in this browser.\\n';
        }

        if (btn) { btn.textContent = '\u{1F50D} Inspect Save Data'; btn.disabled = false; }

        console.log(report);
        alert(report);
    }

    async function factoryResetAll() {
        if (confirm('\u26A0\uFE0F WARNING: This will permanently wipe all your custom settings, favorites lists, game logs, added games, and ALL GAME SAVES. Are you absolutely sure?')) {
            localStorage.clear();

            try {
                if (window.indexedDB && indexedDB.databases) {
                    const dbs = await indexedDB.databases();
                    for (const dbInfo of dbs) {
                        if (dbInfo.name) {
                            indexedDB.deleteDatabase(dbInfo.name);
                        }
                    }
                }
            } catch (e) {}

            showToast('All local data wiped. Resetting page...', 'error');
            setTimeout(() => {
                window.location.reload();
            }, 1200);
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // CORE LOGIC (Tabs, Search, Favorites, Play, Panic)
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupSearch() {
        if (!searchInput) return;
        searchInput.addEventListener('input', () => renderGames());
    }

    function setupTabs() {
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTab = btn.dataset.tab || 'all';
                renderGames();
            });
        });
    }

    function toggleFavorite(url) {
        if (favorites.includes(url)) {
            favorites = favorites.filter(f => f !== url);
        } else {
            favorites.push(url);
        }
        saveJSON(STORAGE.favorites, favorites);
        renderGames();
    }

    function playGame(url, title, image) {
        recentlyPlayed = recentlyPlayed.filter(g => g.url !== url);
        recentlyPlayed.unshift({ url, title, image, lastPlayed: Date.now() });
        if (recentlyPlayed.length > MAX_RECENT) recentlyPlayed.pop();
        saveJSON(STORAGE.recent, recentlyPlayed);
        window.location.href = \`play.html?url=\${encodeURIComponent(url)}&title=\${encodeURIComponent(title)}\`;
    }

    function setupPanicKey() {
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                if (activeEl.id === 'panicKeyInput') return; // let the input capture it
            }
            if (e.key.toLowerCase() === settings.panicKey.toLowerCase()) {
                if (!settings.panicCtrl || e.ctrlKey) {
                    e.preventDefault();
                    window.location.replace(settings.panicRedirect);
                }
            }
        });
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // GHOST MODE / TAB CLOAKING
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function setupGhostMode() {
        const params = new URLSearchParams(window.location.search);

        let isCloaked = params.get('ghost') === '1';
        try {
            if (window.self !== window.top) isCloaked = true;
        } catch (e) {
            isCloaked = true; // Cross-origin access error means it's in an iframe
        }

        if (isCloaked) {
            ghostIndicator.hidden = false;
            if (ghostModeBtn) ghostModeBtn.style.display = 'none';
            return;
        }

        if (ghostModeBtn) {
            ghostModeBtn.addEventListener('click', activateGhostMode);
        }
    }

    function activateGhostMode() {
        const ghostUrl = new URL(window.location.href);
        ghostUrl.searchParams.set('ghost', '1');

        const win = window.open('about:blank', '_blank');
        if (!win) {
            showPopupBlockedMessage();
            return;
        }

        win.document.open();
        win.document.write(
            '<!DOCTYPE html>' +
            '<html><head>' +
            '<title>' + esc(settings.tabTitle) + '</title>' +
            '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
            '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none}</style>' +
            '</head><body>' +
            '<iframe src="' + ghostUrl.href + '" allow="fullscreen"></iframe>' +
            '</body></html>'
        );
        win.document.close();

        // Redirect original tab
        window.close();
        setTimeout(() => {
            window.location.replace(settings.panicRedirect);
        }, 500);
    }

    function showPopupBlockedMessage() {
        showToast('\u26A0\uFE0F Please allow pop-ups for Ghost Mode cloak tab to open!', 'error');
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // UTILITIES
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function esc(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function loadJSON(key, fallback) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : fallback;
        } catch {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage full or blocked
        }
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // CUSTOM CURSOR LOGIC
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    let cursorContainer = null;
    let cursorDot = null, cursorRing = null, cursorOrb = null, cursorCyber = null, cursorSimple = null;
    let cursorRingX = 0, cursorRingY = 0;
    let cursorMouseX = 0, cursorMouseY = 0;
    let cursorHasMoved = false;

    function initCustomCursor() {
        cursorContainer = $('#cursorContainer');
        cursorDot = $('#cursorDot');
        cursorRing = $('#cursorRing');
        cursorOrb = $('#cursorOrb');
        cursorCyber = $('#cursorCyber');
        cursorSimple = $('#cursorSimple');

        if (!cursorContainer) return;
        cursorContainer.hidden = false;

        window.addEventListener('mousemove', (e) => {
            if (settings.cursorStyle === 'none') return;
            cursorMouseX = e.clientX;
            cursorMouseY = e.clientY;

            if (!cursorHasMoved) {
                cursorRingX = cursorMouseX;
                cursorRingY = cursorMouseY;
                cursorHasMoved = true;
                updateCursorVisibility(true);
            }

            if (settings.cursorStyle === 'ring') {
                if (cursorDot) { cursorDot.style.left = \`\${cursorMouseX}px\`; cursorDot.style.top = \`\${cursorMouseY}px\`; }
            } else if (settings.cursorStyle === 'orb') {
                if (cursorOrb) { cursorOrb.style.left = \`\${cursorMouseX}px\`; cursorOrb.style.top = \`\${cursorMouseY}px\`; }
            } else if (settings.cursorStyle === 'cyber') {
                if (cursorCyber) { cursorCyber.style.left = \`\${cursorMouseX}px\`; cursorCyber.style.top = \`\${cursorMouseY}px\`; }
            } else if (settings.cursorStyle === 'simple') {
                if (cursorSimple) { cursorSimple.style.left = \`\${cursorMouseX}px\`; cursorSimple.style.top = \`\${cursorMouseY}px\`; }
            }
        });

        window.addEventListener('mousedown', () => { document.body.classList.add('cursor-clicking'); });
        window.addEventListener('mouseup', () => { document.body.classList.remove('cursor-clicking'); });

        document.addEventListener('mouseover', (e) => {
            if (settings.cursorStyle === 'none') return;
            const target = e.target;
            if (target && (target.closest('button') || target.closest('a') || target.closest('.game-card') || target.closest('input') || target.closest('select') || target.closest('.color-swatch') || target.closest('.color-swatch-cursor') || target.closest('.custom-color-btn'))) {
                document.body.classList.add('cursor-hovering');
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target;
            if (target && (target.closest('button') || target.closest('a') || target.closest('.game-card') || target.closest('input') || target.closest('select') || target.closest('.color-swatch') || target.closest('.color-swatch-cursor') || target.closest('.custom-color-btn'))) {
                document.body.classList.remove('cursor-hovering');
            }
        });

        document.addEventListener('mouseenter', () => { if (settings.cursorStyle !== 'none' && cursorHasMoved) updateCursorVisibility(true); });
        document.addEventListener('mouseleave', () => { updateCursorVisibility(false); });

        cursorTick();
    }

    function updateCursorVisibility(visible) {
        const opacity = visible ? '1' : '0';
        if (cursorDot) cursorDot.style.opacity = (settings.cursorStyle === 'ring') ? opacity : '0';
        if (cursorRing) cursorRing.style.opacity = (settings.cursorStyle === 'ring') ? opacity : '0';
        if (cursorOrb) cursorOrb.style.display = (settings.cursorStyle === 'orb' && visible) ? 'block' : 'none';
        if (cursorCyber) cursorCyber.style.display = (settings.cursorStyle === 'cyber' && visible) ? 'block' : 'none';
        if (cursorSimple) cursorSimple.style.display = (settings.cursorStyle === 'simple' && visible) ? 'block' : 'none';
    }

    function cursorTick() {
        if (settings.cursorStyle === 'ring' && cursorHasMoved && cursorRing) {
            cursorRingX += (cursorMouseX - cursorRingX) * 0.15;
            cursorRingY += (cursorMouseY - cursorRingY) * 0.15;
            cursorRing.style.left = \`\${cursorRingX}px\`;
            cursorRing.style.top = \`\${cursorRingY}px\`;
        } else if (settings.cursorStyle === 'cyber' && cursorHasMoved && cursorCyber && !document.body.classList.contains('cursor-clicking')) {
            const dx = cursorMouseX - cursorRingX;
            const dy = cursorMouseY - cursorRingY;
            cursorRingX += dx * 0.2;
            cursorRingY += dy * 0.2;
            const speed = Math.sqrt(dx*dx + dy*dy);
            const rot = Math.min(speed * 2, 45);
            cursorCyber.style.transform = \`translate(-50%, -50%) rotate(\${rot}deg)\`;
        } else if (settings.cursorStyle === 'cyber') {
            cursorRingX = cursorMouseX;
            cursorRingY = cursorMouseY;
        }
        requestAnimationFrame(cursorTick);
    }

    function updateCursorState() {
        if (settings.cursorStyle !== 'none') {
            document.body.classList.add('custom-cursor-active');
            if (cursorHasMoved) updateCursorVisibility(true);
        } else {
            document.body.classList.remove('custom-cursor-active');
            updateCursorVisibility(false);
        }
        
        // Also ensure background effect updates when settings apply
        if (typeof updateBgEffectState === 'function' && document.readyState === 'complete') updateBgEffectState();
    }

    function applyCursorColor() {
        const hex = settings.cursorColor === 'match' ? settings.accentColor : settings.cursorColor;
        document.documentElement.style.setProperty('--cursor-color', hex);
        document.documentElement.style.setProperty('--cursor-glow', hexToRgba(hex, 0.35));

        $$('.color-swatch-cursor').forEach(sw => {
            if (settings.cursorColor === 'match' && sw.dataset.cursorColor === 'match') sw.classList.add('active');
            else if (sw.dataset.cursorColor.toLowerCase() === settings.cursorColor.toLowerCase()) sw.classList.add('active');
            else sw.classList.remove('active');
        });
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // BACKGROUND EFFECTS MANAGER
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    let effectsCanvas = null;
    let effectsCtx = null;
    let bgAnimationFrame = null;
    let activeBgEffect = 'none';

    function initLightning() {
        effectsCanvas = $('#effectsCanvas');
        if (!effectsCanvas) return;
        effectsCtx = effectsCanvas.getContext('2d');
        window.addEventListener('resize', resizeEffectsCanvas);
        resizeEffectsCanvas();
        updateBgEffectState();
    }

    function resizeEffectsCanvas() {
        if (!effectsCanvas) return;
        effectsCanvas.width = window.innerWidth;
        effectsCanvas.height = window.innerHeight;
        if (activeBgEffect === 'matrix') initMatrix();
    }

    function updateBgEffectState() {
        const effect = settings.bgEffect || 'none';
        
        // Show/hide default orbs based on selection. 'orbs' is handled by CSS, not canvas.
        const bgEffectsContainer = $('.bg-effects');
        if (bgEffectsContainer) {
            const orbs = bgEffectsContainer.querySelectorAll('.bg-orb');
            orbs.forEach(orb => orb.style.display = effect === 'orbs' ? 'block' : 'none');
        }
        
        // Guard: effectsCanvas may not be initialized yet (called from applySettings before initLightning)
        if (!effectsCanvas) return;

        if (effect === activeBgEffect) return;
        stopCurrentBgEffect();
        activeBgEffect = effect;

        if (effect === 'none' || effect === 'orbs') return;

        effectsCanvas.style.opacity = '1';
        if (effect === 'lightning') startLightning();
        else if (effect === 'matrix') startMatrix();
        else if (effect === 'starfield') startStarfield();
    }

    function stopCurrentBgEffect() {
        if (effectsCanvas) effectsCanvas.style.opacity = '0';
        if (bgAnimationFrame) { cancelAnimationFrame(bgAnimationFrame); bgAnimationFrame = null; }
        if (lightningTimeout) { clearTimeout(lightningTimeout); lightningTimeout = null; }
        activeStrikes = [];
    }

    // --- Lightning ---
    let lightningTimeout = null;
    let activeStrikes = [];

    class Strike {
        constructor(w, h) {
            this.startX = Math.random() * w * 0.8 + w * 0.1;
            this.startY = 0;
            this.endX = this.startX + (Math.random() - 0.5) * (w * 0.3);
            this.endY = h * (0.8 + Math.random() * 0.2);
            this.childBolts = [];
            this.mainBolt = this.generateBolt(this.startX, this.startY, this.endX, this.endY, 2);
            this.maxLife = 15 + Math.random() * 20;
            this.life = this.maxLife;
            this.opacity = 1;
        }
        generateBolt(x1, y1, x2, y2, limit) {
            const segments = [];
            segments.push({ x: x1, y: y1 });
            let curX = x1, curY = y1;
            const steps = 15 + Math.random() * 15;
            const stepY = (y2 - y1) / steps;
            for (let i = 1; i < steps; i++) {
                curY += stepY;
                curX += (Math.random() - 0.5) * 40;
                segments.push({ x: curX, y: curY });
                if (limit > 0 && Math.random() < 0.1) {
                    const bx = curX + (Math.random() - 0.5) * 150;
                    const by = curY + Math.random() * (y2 - curY);
                    this.childBolts.push(this.generateBolt(curX, curY, bx, by, limit - 1));
                }
            }
            segments.push({ x: x2, y: y2 });
            return segments;
        }
        draw(ctx, color, glowColor) {
            if (Math.random() < 0.15) this.opacity = 0.1;
            else if (Math.random() < 0.3) this.opacity = 0.8 + Math.random() * 0.2;
            else this.opacity = (this.life / this.maxLife) * 0.8 + 0.2;
            
            ctx.save();
            ctx.globalAlpha = this.opacity;
            const allPaths = [this.mainBolt, ...this.childBolts];
            
            ctx.strokeStyle = color;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 20;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            allPaths.forEach(path => {
                ctx.beginPath();
                ctx.lineWidth = path === this.mainBolt ? 4 : 2;
                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
                ctx.stroke();
            });
            
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            allPaths.forEach(path => {
                ctx.beginPath();
                ctx.lineWidth = path === this.mainBolt ? 1.5 : 0.75;
                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
                ctx.stroke();
            });
            ctx.restore();
        }
        update() { this.life--; return this.life > 0; }
    }

    function startLightning() {
        scheduleNextStrike();
        lightningTick();
    }

    function scheduleNextStrike() {
        if (activeBgEffect !== 'lightning') return;
        let freq = settings.lightningFrequency || 5;
        let t = 11 - freq;
        const nextTime = (t * t * 100) + Math.random() * (t * t * 200);
        lightningTimeout = setTimeout(() => {
            activeStrikes.push(new Strike(effectsCanvas.width, effectsCanvas.height));
            if (Math.random() < 0.4) {
                setTimeout(() => { if (activeBgEffect === 'lightning') activeStrikes.push(new Strike(effectsCanvas.width, effectsCanvas.height)); }, 200 + Math.random() * 300);
            }
            scheduleNextStrike();
        }, nextTime);
    }

    function lightningTick() {
        if (activeBgEffect !== 'lightning') return;
        effectsCtx.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        const glowColor = hexToRgba(color, 0.8);
        
        activeStrikes = activeStrikes.filter(strike => {
            const alive = strike.update();
            if (alive) strike.draw(effectsCtx, color, glowColor);
            return alive;
        });
        
        let drawFlash = false;
        activeStrikes.forEach(strike => {
            if (strike.life === strike.maxLife - 1 || strike.life === strike.maxLife - 3) drawFlash = true;
        });
        
        if (drawFlash) {
            effectsCtx.fillStyle = hexToRgba(color, 0.08);
            effectsCtx.fillRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        }
        bgAnimationFrame = requestAnimationFrame(lightningTick);
    }

    // --- Matrix ---
    let matrixColumns = [];
    let matrixFontSize = 16;
    function initMatrix() {
        if (!effectsCanvas) return;
        const columns = Math.floor(effectsCanvas.width / matrixFontSize) + 1;
        matrixColumns = [];
        for (let i=0; i<columns; i++) {
            matrixColumns[i] = Math.random() * -100; // Start offscreen
        }
    }
    function startMatrix() {
        initMatrix();
        matrixTick();
    }
    function matrixTick() {
        if (activeBgEffect !== 'matrix') return;
        effectsCtx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        effectsCtx.fillRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        effectsCtx.fillStyle = color;
        effectsCtx.font = matrixFontSize + 'px monospace';
        
        const density = settings.bgDensity || 5;
        const dropSpeed = 0.5 + (density * 0.15);

        for (let i = 0; i < matrixColumns.length; i++) {
            const char = String.fromCharCode(0x30A0 + Math.random() * 96);
            const x = i * matrixFontSize;
            const y = matrixColumns[i] * matrixFontSize;
            
            effectsCtx.fillText(char, x, y);
            if (y > effectsCanvas.height && Math.random() > 0.975) matrixColumns[i] = 0;
            matrixColumns[i] += dropSpeed;
        }
        bgAnimationFrame = requestAnimationFrame(matrixTick);
    }

    // --- Starfield ---
    let stars = [];
    function startStarfield() {
        stars = [];
        const density = settings.bgDensity || 5;
        const count = 50 + (density * 25);
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * effectsCanvas.width,
                y: Math.random() * effectsCanvas.height,
                size: Math.random() * 2,
                speed: 0.1 + Math.random() * 0.5,
                opacity: Math.random()
            });
        }
        starfieldTick();
    }
    function starfieldTick() {
        if (activeBgEffect !== 'starfield') return;
        effectsCtx.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        const density = settings.bgDensity || 5;
        const globalSpeed = 0.5 + (density * 0.1);

        stars.forEach(star => {
            star.y -= star.speed * globalSpeed;
            // Parallax
            star.x += (effectsCanvas.width / 2 - cursorMouseX) * 0.0005 * star.speed;
            
            if (star.y < 0) {
                star.y = effectsCanvas.height;
                star.x = Math.random() * effectsCanvas.width;
            }
            if (star.x < 0) star.x = effectsCanvas.width;
            if (star.x > effectsCanvas.width) star.x = 0;
            
            star.opacity += (Math.random() - 0.5) * 0.05;
            if (star.opacity < 0.1) star.opacity = 0.1;
            if (star.opacity > 1) star.opacity = 1;

            effectsCtx.fillStyle = hexToRgba(color, star.opacity);
            effectsCtx.beginPath();
            effectsCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            effectsCtx.fill();
        });
        bgAnimationFrame = requestAnimationFrame(starfieldTick);
    }
    
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    // USER ACCOUNTS & PROFILE
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    function initProfile() {
        const profileBtn = $('#profileBtn');
        const profileModal = $('#profileModal');
        const closeProfileBtn = $('#closeProfileBtn');
        const authForm = $('#authForm');
        const authUsername = $('#authUsername');
        const authPassword = $('#authPassword');
        const authSubmitBtn = $('#authSubmitBtn');
        const showLoginBtn = $('#showLoginBtn');
        const showRegisterBtn = $('#showRegisterBtn');
        const authError = $('#authError');
        
        const authView = $('#authView');
        const profileView = $('#profileView');
        const profilePicPreview = $('#profilePicPreview');
        const profileUsernameDisplay = $('#profileUsernameDisplay');
        const profilePicUpload = $('#profilePicUpload');
        const logoutBtn = $('#logoutBtn');
        const profileText = $('#profileText');

        const forceSyncPushBtn = $('#forceSyncPushBtn');
        const forceSyncPullBtn = $('#forceSyncPullBtn');
        const playtimeStatsList = $('#playtimeStatsList');
        const syncStatus = $('#syncStatus');

        let isLoginMode = true;

        if (!profileBtn) return; // not on ghost-ui

        // Modal toggling
        profileBtn.addEventListener('click', () => {
            profileModal.classList.add('active');
            refreshPlaytimeStats();
        });

        closeProfileBtn.addEventListener('click', () => {
            profileModal.classList.remove('active');
        });

        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) profileModal.classList.remove('active');
        });

        // Auth Tabs
        showLoginBtn.addEventListener('click', () => {
            isLoginMode = true;
            showLoginBtn.classList.add('active');
            showRegisterBtn.classList.remove('active');
            authSubmitBtn.textContent = 'Login';
            authError.style.display = 'none';
        });

        showRegisterBtn.addEventListener('click', () => {
            isLoginMode = false;
            showRegisterBtn.classList.add('active');
            showLoginBtn.classList.remove('active');
            authSubmitBtn.textContent = 'Register';
            authError.style.display = 'none';
        });

        // Check Auth Status on Load
        async function checkAuthStatus() {
            try {
                const res = await fetch('/api/me');
                if (res.ok) {
                    const data = await res.json();
                    setLoggedInUser(data.user);
                } else {
                    setLoggedOut();
                }
            } catch (e) {
                setLoggedOut();
            }
        }

        function setLoggedInUser(user) {
            authView.style.display = 'none';
            profileView.style.display = 'flex';
            profileUsernameDisplay.textContent = user.username;
            profileText.textContent = user.username;
            if (user.profile_picture_url) {
                profilePicPreview.src = user.profile_picture_url;
            }
        }

        function setLoggedOut() {
            authView.style.display = 'flex';
            profileView.style.display = 'none';
            profileText.textContent = 'Login';
        }

        // Form Submit
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            authError.style.display = 'none';
            const endpoint = isLoginMode ? '/api/login' : '/api/register';
            
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: authUsername.value.trim(),
                        password: authPassword.value
                    })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    authError.textContent = data.error || 'Authentication failed';
                    authError.style.display = 'block';
                } else {
                    if (isLoginMode) {
                        showToast('Logged in successfully', 'success');
                        setLoggedInUser(data.user);
                        if (window.GhostArcadeSync) {
                            window.GhostArcadeSync.pull().then(refreshPlaytimeStats);
                        }
                    } else {
                        showToast('Registration successful! Please login.', 'success');
                        showLoginBtn.click();
                    }
                    authPassword.value = '';
                }
            } catch (err) {
                authError.textContent = 'Network error occurred.';
                authError.style.display = 'block';
            }
        });

        // Logout
        logoutBtn.addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST' });
            setLoggedOut();
            profilePicPreview.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\u{1F464}</text></svg>";
            showToast('Logged out', 'info');
        });

        // Profile Picture Upload
        profilePicUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('avatar', file);

            try {
                const res = await fetch('/api/profile/picture', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (res.ok && data.url) {
                    profilePicPreview.src = data.url;
                    showToast('Profile picture updated!', 'success');
                } else {
                    showToast(data.error || 'Failed to upload picture', 'error');
                }
            } catch (err) {
                showToast('Network error uploading picture', 'error');
            }
        });

        // Playtime Stats
        function refreshPlaytimeStats() {
            playtimeStatsList.innerHTML = '';
            let stats = {};
            try {
                const data = localStorage.getItem('ghostArcade_playtime');
                if (data) stats = JSON.parse(data);
            } catch(e) {}

            const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
            
            if (entries.length === 0) {
                playtimeStatsList.innerHTML = '<div style="color:var(--text-dim); text-align:center;">No games played yet.</div>';
                return;
            }

            entries.forEach(([url, seconds]) => {
                const hrs = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                let timeStr = '';
                if (hrs > 0) timeStr += \`\${hrs}h \`;
                timeStr += \`\${mins}m\`;

                // find game title
                let title = 'Unknown Game';
                const gameObj = allGames.find(g => g.url === url);
                if (gameObj) title = gameObj.title;

                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.padding = '4px 0';
                row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                row.innerHTML = \`<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">\${escHTML(title)}</span><span style="color:var(--cyan); font-family:monospace;">\${timeStr}</span>\`;
                playtimeStatsList.appendChild(row);
            });
        }

        // Sync Buttons
        forceSyncPushBtn.addEventListener('click', async () => {
            syncStatus.textContent = 'Pushing to cloud...';
            if (window.GhostArcadeSync) {
                await window.GhostArcadeSync.push();
                syncStatus.textContent = 'Push successful!';
                setTimeout(() => syncStatus.textContent = '', 3000);
            }
        });

        forceSyncPullBtn.addEventListener('click', async () => {
            syncStatus.textContent = 'Pulling from cloud...';
            if (window.GhostArcadeSync) {
                await window.GhostArcadeSync.pull();
                refreshPlaytimeStats();
                syncStatus.textContent = 'Pull successful!';
                setTimeout(() => syncStatus.textContent = '', 3000);
            }
        });

        checkAuthStatus();
    }

    document.addEventListener('DOMContentLoaded', initProfile);

})();
`, {
        headers: {
          "content-type": "application/javascript;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/play.html") {
      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Drive - Google Drive</title>
    <link rel="icon" href="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
    <style>
        /* \u2550\u2550\u2550 Player Page Styles \u2550\u2550\u2550 */
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --bg: #060609;
            --surface: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.06);
            --text: #f0f0f5;
            --text-dim: rgba(255, 255, 255, 0.5);
            --cyan: #00e5ff;
            --glow-cyan: rgba(0, 229, 255, 0.25);
        }

        body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: var(--bg);
            color: var(--text);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            -webkit-font-smoothing: antialiased;
        }

        /* \u2500\u2500\u2500 Top Bar \u2500\u2500\u2500 */
        .player-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background: var(--surface);
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 10;
            flex-shrink: 0;
            gap: 12px;
        }

        .player-bar__left {
            display: flex;
            align-items: center;
            gap: 14px;
            min-width: 0;
        }

        .player-bar__right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        /* \u2500\u2500\u2500 Buttons \u2500\u2500\u2500 */
        .bar-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text-dim);
            font-family: inherit;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.25s ease;
            white-space: nowrap;
        }

        .bar-btn svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        .bar-btn:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: var(--glow-cyan);
            color: var(--cyan);
        }

        /* \u2500\u2500\u2500 Game Title \u2500\u2500\u2500 */
        .game-title {
            font-family: 'Outfit', sans-serif;
            font-size: 14px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.85);
            max-width: 250px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* \u2500\u2500\u2500 Iframe \u2500\u2500\u2500 */
        .game-frame {
            flex: 1;
            width: 100%;
            border: none;
            background: #000;
        }

        /* \u2500\u2500\u2500 Loading Overlay \u2500\u2500\u2500 */
        .loading-overlay {
            position: absolute;
            inset: 0;
            top: 45px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            z-index: 5;
            gap: 16px;
            transition: opacity 0.4s ease;
        }

        .loading-overlay.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(255, 255, 255, 0.06);
            border-top-color: var(--cyan);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        .loading-text {
            font-size: 13px;
            color: var(--text-dim);
            letter-spacing: 0.5px;
        }

        .error-state {
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: absolute;
            inset: 0;
            top: 45px;
            background: var(--bg);
            z-index: 5;
            gap: 12px;
            text-align: center;
            padding: 24px;
        }

        .error-state.visible {
            display: flex;
        }

        .error-state__icon { font-size: 48px; opacity: 0.6; }
        .error-state__title { font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 700; }
        .error-state__text { font-size: 13px; color: var(--text-dim); max-width: 360px; line-height: 1.6; }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* \u2500\u2500\u2500 Ghost Mode Indicator \u2500\u2500\u2500 */
        .ghost-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(0, 229, 255, 0.08);
            border: 1px solid rgba(0, 229, 255, 0.15);
            border-radius: 100px;
            font-size: 11px;
            font-weight: 600;
            color: var(--cyan);
            letter-spacing: 0.3px;
        }

        /* \u2500\u2500\u2500 Game Timer \u2500\u2500\u2500 */
        .game-timer {
            font-family: monospace;
            font-size: 13px;
            font-weight: 600;
            color: var(--cyan);
            background: rgba(0, 229, 255, 0.08);
            border: 1px solid rgba(0, 229, 255, 0.15);
            padding: 5px 10px;
            border-radius: 6px;
            cursor: help;
        }

        /* \u2500\u2500\u2500 Quick Switcher Dropdown \u2500\u2500\u2500 */
        .dropdown {
            position: relative;
            display: inline-block;
        }

        .dropdown-content {
            display: none;
            position: absolute;
            right: 0;
            top: 100%;
            margin-top: 8px;
            min-width: 220px;
            background: rgba(10, 10, 18, 0.95);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--border);
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            z-index: 100;
            overflow: hidden;
        }

        .dropdown-content.show {
            display: flex;
            flex-direction: column;
        }

        .dropdown-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            color: var(--text-dim);
            text-decoration: none;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            background: transparent;
            border: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            width: 100%;
            text-align: left;
            cursor: pointer;
        }

        .dropdown-item:last-child {
            border-bottom: none;
        }

        .dropdown-item:hover {
            background: rgba(255, 255, 255, 0.04);
            color: var(--cyan);
        }

        .dropdown-item img {
            width: 18px;
            height: 18px;
            border-radius: 4px;
            object-fit: cover;
        }

        /* \u2500\u2500\u2500 Shortcuts Overlay \u2500\u2500\u2500 */
        .shortcuts-overlay {
            position: fixed;
            inset: 0;
            background: rgba(4, 4, 6, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .shortcuts-content {
            background: rgba(10, 10, 18, 0.95);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
        }

        .shortcuts-title {
            font-family: 'Outfit', sans-serif;
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: var(--cyan);
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
        }

        .shortcuts-grid {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .shortcut-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
        }

        .shortcut-key {
            font-family: monospace;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 3px 8px;
            border-radius: 4px;
            color: var(--cyan);
            font-weight: 600;
        }

        .shortcut-action {
            color: var(--text-dim);
        }

        /* \u2500\u2500\u2500 Responsive \u2500\u2500\u2500 */
        @media (max-width: 768px) {
            .game-timer { display: none; }
        }

        @media (max-width: 600px) {
            .player-bar { padding: 6px 10px; }
            .game-title { max-width: 130px; font-size: 13px; }
            .bar-btn span { display: none; }
            .bar-btn { padding: 8px 10px; }
        }

        /* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
           CUSTOM CURSOR
           \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
        body.custom-cursor-active,
        body.custom-cursor-active * {
            cursor: none !important;
        }

        .custom-cursor-dot {
            position: fixed;
            width: 8px;
            height: 8px;
            background-color: var(--cursor-color, var(--cyan));
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            transform: translate(-50%, -50%);
            transition: width 0.2s, height 0.2s, background-color 0.3s;
            opacity: 0;
        }

        .custom-cursor-ring {
            position: fixed;
            width: 36px;
            height: 36px;
            border: 2px solid var(--cursor-color, var(--cyan));
            border-radius: 50%;
            pointer-events: none;
            z-index: 9999;
            transform: translate(-50%, -50%);
            transition: width 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)), height 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)), border-color 0.3s, background-color 0.3s;
            box-shadow: 0 0 10px var(--cursor-glow, var(--glow-cyan));
            opacity: 0;
        }

        body.cursor-hovering .custom-cursor-ring {
            width: 50px;
            height: 50px;
            background-color: var(--cursor-glow, var(--glow-cyan));
            border-color: var(--cursor-color, var(--cyan));
        }

        body.cursor-hovering .custom-cursor-dot {
            width: 4px;
            height: 4px;
        }

        body.cursor-clicking .custom-cursor-ring {
            width: 28px;
            height: 28px;
            background-color: var(--cursor-glow, var(--glow-cyan));
        }

        /* Orb */
        .custom-cursor-orb {
            position: fixed;
            width: 24px;
            height: 24px;
            background-color: var(--cursor-glow, var(--glow-cyan));
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            transform: translate(-50%, -50%);
            transition: width 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)), height 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)), background-color 0.3s;
            box-shadow: 0 0 15px var(--cursor-glow, var(--glow-cyan));
            display: none;
        }

        body.cursor-hovering .custom-cursor-orb {
            width: 40px;
            height: 40px;
            background-color: var(--cursor-color, var(--cyan));
        }

        body.cursor-clicking .custom-cursor-orb {
            width: 16px;
            height: 16px;
        }

        /* Cyber */
        .custom-cursor-cyber {
            position: fixed;
            width: 32px;
            height: 32px;
            pointer-events: none;
            z-index: 10000;
            transform: translate(-50%, -50%) rotate(0deg);
            transition: width 0.2s, height 0.2s;
            display: none;
        }
        .cyber-line {
            position: absolute;
            background-color: var(--cursor-color, var(--cyan));
            transition: all 0.2s;
            box-shadow: 0 0 8px var(--cursor-glow, var(--glow-cyan));
        }
        .cyber-t, .cyber-b { width: 2px; height: 10px; left: 15px; }
        .cyber-l, .cyber-r { width: 10px; height: 2px; top: 15px; }
        .cyber-t { top: -2px; }
        .cyber-b { bottom: -2px; }
        .cyber-l { left: -2px; }
        .cyber-r { right: -2px; }

        body.cursor-hovering .custom-cursor-cyber {
            width: 24px;
            height: 24px;
        }
        body.cursor-hovering .cyber-t, body.cursor-hovering .cyber-b { height: 6px; left: 11px; }
        body.cursor-hovering .cyber-l, body.cursor-hovering .cyber-r { width: 6px; top: 11px; }

        body.cursor-clicking .custom-cursor-cyber {
            transform: translate(-50%, -50%) scale(0.8) !important;
        }

        /* Simple */
        .custom-cursor-simple {
            position: fixed;
            width: 16px;
            height: 16px;
            pointer-events: none;
            z-index: 10000;
            transform: translate(-50%, -50%);
            transition: transform 0.1s;
            display: none;
        }
        .simple-v, .simple-h {
            position: absolute;
            background-color: var(--cursor-color, #ffffff);
        }
        .simple-v {
            width: 2px;
            height: 16px;
            left: 7px;
            top: 0;
        }
        .simple-h {
            width: 16px;
            height: 2px;
            left: 0;
            top: 7px;
        }
        body.cursor-hovering .custom-cursor-simple {
            transform: translate(-50%, -50%) scale(1.3);
        }
        body.cursor-clicking .custom-cursor-simple {
            transform: translate(-50%, -50%) scale(0.8);
        }
    </style>
</head>
<body>

    <!-- Custom Cursors -->
    <div id="cursorContainer" hidden>
        <!-- Ring -->
        <div class="custom-cursor-dot" id="cursorDot"></div>
        <div class="custom-cursor-ring" id="cursorRing"></div>
        <!-- Orb -->
        <div class="custom-cursor-orb" id="cursorOrb"></div>
        <!-- Cyber -->
        <div class="custom-cursor-cyber" id="cursorCyber">
            <div class="cyber-line cyber-t"></div>
            <div class="cyber-line cyber-b"></div>
            <div class="cyber-line cyber-l"></div>
            <div class="cyber-line cyber-r"></div>
        </div>
        <!-- Simple -->
        <div class="custom-cursor-simple" id="cursorSimple">
            <div class="simple-v"></div>
            <div class="simple-h"></div>
        </div>
    </div>

    <!-- Top Bar -->
    <div class="player-bar">
        <div class="player-bar__left">
            <a class="bar-btn" id="backBtn" href="ghost-ui">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
                </svg>
                <span>Back</span>
            </a>
            <span class="game-title" id="gameTitle">Loading...</span>
            <span class="game-timer" id="gameTimer" title="Session play time (Hover for lifetime stats)">00:00</span>
        </div>

        <div class="player-bar__right">
            <span class="ghost-badge" id="ghostBadge" hidden>\u{1F47B} Ghost</span>

            <!-- Quick Switcher Dropdown -->
            <div class="dropdown" id="quickSwitcherDropdown">
                <button class="bar-btn" id="quickSwitchBtn" title="Switch games instantly">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M4 4l17 17"/>
                    </svg>
                    <span>Quick Switch</span>
                </button>
                <div class="dropdown-content" id="quickSwitchContent">
                    <!-- Loaded dynamically -->
                </div>
            </div>

            <!-- Reload Button -->
            <button class="bar-btn" id="reloadBtn" title="Reload game (R)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
                <span>Reload</span>
            </button>

            <!-- Favorite Button -->
            <button class="bar-btn" id="favBtn" title="Toggle favorite (F)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="favIcon">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                <span id="favText">Favorite</span>
            </button>

            <!-- Fullscreen Button -->
            <button class="bar-btn" id="fullscreenBtn" title="Toggle fullscreen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
                <span>Fullscreen</span>
            </button>

            <!-- Help/Shortcuts Button -->
            <button class="bar-btn" id="helpBtn" title="Keyboard Shortcuts (?)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>
                </svg>
            </button>
        </div>
    </div>

    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading game...</span>
    </div>

    <!-- Error State -->
    <div class="error-state" id="errorState">
        <span class="error-state__icon">\u{1F480}</span>
        <h2 class="error-state__title">Failed to load game</h2>
        <p class="error-state__text">The game file couldn't be fetched. It may have been moved or deleted.</p>
        <a class="bar-btn" href="ghost-ui" style="margin-top:8px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
                <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
            </svg>
            <span>Back to Games</span>
        </a>
    </div>

    <!-- Keyboard Shortcuts Modal -->
    <div class="shortcuts-overlay" id="shortcutsOverlay" style="display:none">
        <div class="shortcuts-content">
            <h3 class="shortcuts-title">Keyboard Shortcuts</h3>
            <div class="shortcuts-grid">
                <div class="shortcut-row">
                    <span class="shortcut-key" id="shortcutPanicDesc">Ctrl + \`</span>
                    <span class="shortcut-action">Panic Redirect</span>
                </div>
                <div class="shortcut-row">
                    <span class="shortcut-key">?</span>
                    <span class="shortcut-action">Toggle Shortcuts overlay</span>
                </div>
                <div class="shortcut-row">
                    <span class="shortcut-key">R</span>
                    <span class="shortcut-action">Reload game</span>
                </div>
                <div class="shortcut-row">
                    <span class="shortcut-key">F</span>
                    <span class="shortcut-action">Favorite/Unfavorite game</span>
                </div>
            </div>
            <button class="bar-btn" id="closeShortcutsBtn" style="margin-top: 16px; width: 100%; justify-content: center;">Close</button>
        </div>
    </div>

    <!-- Game Iframe -->
    <iframe class="game-frame" id="gameFrame" allowfullscreen></iframe>

    <script src="/sync.js"><\/script>
    <script>
    (function() {
        'use strict';
        
        const $ = (s) => document.querySelector(s);

        // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
        // CUSTOM CURSOR LOGIC
        // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
        let cursorContainer = null;
        let cursorDot = null, cursorRing = null, cursorOrb = null, cursorCyber = null, cursorSimple = null;
        let cursorRingX = 0, cursorRingY = 0;
        let cursorMouseX = 0, cursorMouseY = 0;
        let cursorHasMoved = false;

        function initCustomCursor(style) {
            cursorContainer = $('#cursorContainer');
            cursorDot = $('#cursorDot');
            cursorRing = $('#cursorRing');
            cursorOrb = $('#cursorOrb');
            cursorCyber = $('#cursorCyber');
            cursorSimple = $('#cursorSimple');

            if (!cursorContainer) return;
            cursorContainer.hidden = false;

            window.addEventListener('mousemove', (e) => {
                if (style === 'none') return;
                cursorMouseX = e.clientX;
                cursorMouseY = e.clientY;

                if (!cursorHasMoved) {
                    cursorRingX = cursorMouseX;
                    cursorRingY = cursorMouseY;
                    cursorHasMoved = true;
                    updateCursorVisibility(true, style);
                }

                if (style === 'ring') {
                    if (cursorDot) { cursorDot.style.left = \`\${cursorMouseX}px\`; cursorDot.style.top = \`\${cursorMouseY}px\`; }
                } else if (style === 'orb') {
                    if (cursorOrb) { cursorOrb.style.left = \`\${cursorMouseX}px\`; cursorOrb.style.top = \`\${cursorMouseY}px\`; }
                } else if (style === 'cyber') {
                    if (cursorCyber) { cursorCyber.style.left = \`\${cursorMouseX}px\`; cursorCyber.style.top = \`\${cursorMouseY}px\`; }
                } else if (style === 'simple') {
                    if (cursorSimple) { cursorSimple.style.left = \`\${cursorMouseX}px\`; cursorSimple.style.top = \`\${cursorMouseY}px\`; }
                }
            });

            window.addEventListener('mousedown', () => { document.body.classList.add('cursor-clicking'); });
            window.addEventListener('mouseup', () => { document.body.classList.remove('cursor-clicking'); });

            document.addEventListener('mouseover', (e) => {
                if (style === 'none') return;
                const target = e.target;
                if (target && (target.closest('button') || target.closest('a'))) {
                    document.body.classList.add('cursor-hovering');
                }
            });

            document.addEventListener('mouseout', (e) => {
                const target = e.target;
                if (target && (target.closest('button') || target.closest('a'))) {
                    document.body.classList.remove('cursor-hovering');
                }
            });

            document.addEventListener('mouseenter', () => { if (style !== 'none' && cursorHasMoved) updateCursorVisibility(true, style); });
            document.addEventListener('mouseleave', () => { updateCursorVisibility(false, style); });

            cursorTick(style);
        }

        function updateCursorVisibility(visible, style) {
            const opacity = visible ? '1' : '0';
            if (cursorDot) cursorDot.style.opacity = (style === 'ring') ? opacity : '0';
            if (cursorRing) cursorRing.style.opacity = (style === 'ring') ? opacity : '0';
            if (cursorOrb) cursorOrb.style.display = (style === 'orb' && visible) ? 'block' : 'none';
            if (cursorCyber) cursorCyber.style.display = (style === 'cyber' && visible) ? 'block' : 'none';
            if (cursorSimple) cursorSimple.style.display = (style === 'simple' && visible) ? 'block' : 'none';
        }

        function cursorTick(style) {
            if (style === 'ring' && cursorHasMoved && cursorRing) {
                cursorRingX += (cursorMouseX - cursorRingX) * 0.15;
                cursorRingY += (cursorMouseY - cursorRingY) * 0.15;
                cursorRing.style.left = \`\${cursorRingX}px\`;
                cursorRing.style.top = \`\${cursorRingY}px\`;
            } else if (style === 'cyber' && cursorHasMoved && cursorCyber && !document.body.classList.contains('cursor-clicking')) {
                const dx = cursorMouseX - cursorRingX;
                const dy = cursorMouseY - cursorRingY;
                cursorRingX += dx * 0.2;
                cursorRingY += dy * 0.2;
                const speed = Math.sqrt(dx*dx + dy*dy);
                const rot = Math.min(speed * 2, 45);
                cursorCyber.style.transform = \`translate(-50%, -50%) rotate(\${rot}deg)\`;
            } else if (style === 'cyber') {
                cursorRingX = cursorMouseX;
                cursorRingY = cursorMouseY;
            }
            requestAnimationFrame(() => cursorTick(style));
        }

        const STORAGE_FAV = 'ghostArcade_favorites';
        const STORAGE_RECENT = 'ghostArcade_recent';
        const STORAGE_SETTINGS = 'ghostArcade_settings';
        const STORAGE_PLAYTIME = 'ghostArcade_playtime';

        // \u2500\u2500\u2500 Settings Loader \u2500\u2500\u2500
        const DEFAULT_SETTINGS = {
            accentColor: '#00e5ff',
            tabTitle: 'Google Drive',
            tabFavicon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
            panicKey: '\`',
            panicCtrl: true,
            panicRedirect: 'https://www.google.com',
            autoGhost: false
        };

        try {
            const savedSettings = localStorage.getItem('ghostArcade_settings');
            let cursorColor = 'match';
            let cursorStyle = 'ring';
            let accentColor = '#00e5ff';
            
            if (savedSettings) {
                try {
                    const settings = JSON.parse(savedSettings);
                    if (settings.accentColor) {
                        accentColor = settings.accentColor;
                        document.documentElement.style.setProperty('--cyan', accentColor);
                        document.documentElement.style.setProperty('--glow-cyan', accentColor + '40');
                    }
                    if (settings.cursorStyle !== undefined) cursorStyle = settings.cursorStyle;
                    if (settings.cursorColor !== undefined) cursorColor = settings.cursorColor;
                } catch (e) {}
            }

            const hex = cursorColor === 'match' ? accentColor : cursorColor;
            document.documentElement.style.setProperty('--cursor-color', hex);
            document.documentElement.style.setProperty('--cursor-glow', hex + '59');

            if (cursorStyle !== 'none') {
                document.body.classList.add('custom-cursor-active');
                initCustomCursor(cursorStyle);
            }
        } catch(e) {}

        let settings = DEFAULT_SETTINGS;
        try {
            const data = localStorage.getItem(STORAGE_SETTINGS);
            if (data) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
        } catch(e) {}

        applyAccentColor(settings.accentColor);

        function applyAccentColor(hex) {
            document.documentElement.style.setProperty('--cyan', hex);
            document.documentElement.style.setProperty('--glow-cyan', hexToRgba(hex, 0.25));
        }

        function hexToRgba(hex, alpha) {
            let c;
            if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
                c = hex.substring(1).split('');
                if (c.length === 3) {
                    c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                }
                c = '0x' + c.join('');
                return \`rgba(\${(c >> 16) & 255}, \${(c >> 8) & 255}, \${c & 255}, \${alpha})\`;
            }
            return \`rgba(0, 229, 255, \${alpha})\`;
        }

        // \u2500\u2500\u2500 Query Parameters \u2500\u2500\u2500
        let params = new URLSearchParams(window.location.search);
        let gameUrl = params.get('url');
        let gameTitle = params.get('title') || 'Game';
        let isGhost = params.get('ghost') === '1' || settings.autoGhost;

        // DOM Elements
        const titleEl = document.getElementById('gameTitle');
        const gameFrame = document.getElementById('gameFrame');
        const loadingOverlay = document.getElementById('loadingOverlay');
        const errorState = document.getElementById('errorState');
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const backBtn = document.getElementById('backBtn');
        const ghostBadge = document.getElementById('ghostBadge');
        const favBtn = document.getElementById('favBtn');
        const favIcon = document.getElementById('favIcon');
        const favText = document.getElementById('favText');
        const reloadBtn = document.getElementById('reloadBtn');
        const gameTimerEl = document.getElementById('gameTimer');
        
        // Quick Switcher dropdown
        const quickSwitchBtn = document.getElementById('quickSwitchBtn');
        const quickSwitchContent = document.getElementById('quickSwitchContent');
        
        // Shortcuts DOM
        const helpBtn = document.getElementById('helpBtn');
        const shortcutsOverlay = document.getElementById('shortcutsOverlay');
        const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');
        const shortcutPanicDesc = document.getElementById('shortcutPanicDesc');

        // Update shortcuts text descriptions
        if (shortcutPanicDesc) {
            shortcutPanicDesc.textContent = \`\${settings.panicCtrl ? 'Ctrl + ' : ''}\${settings.panicKey.toUpperCase()}\`;
        }

        // \u2500\u2500\u2500 Favorites logic \u2500\u2500\u2500
        let favorites = [];
        try {
            const data = localStorage.getItem(STORAGE_FAV);
            if (data) favorites = JSON.parse(data);
        } catch(e) {}

        function updateFavUI() {
            const isFav = gameUrl && favorites.includes(gameUrl);
            if (isFav) {
                favIcon.setAttribute('fill', 'currentColor');
                favIcon.style.color = '#ff2d7b';
                favText.style.color = '#ff2d7b';
                favText.textContent = 'Favorited';
            } else {
                favIcon.setAttribute('fill', 'none');
                favIcon.style.color = '';
                favText.style.color = '';
                favText.textContent = 'Favorite';
            }
        }

        if (gameUrl) {
            updateFavUI();
            favBtn.addEventListener('click', toggleFavorite);
        }

        function toggleFavorite() {
            if (!gameUrl) return;
            const idx = favorites.indexOf(gameUrl);
            if (idx > -1) {
                favorites.splice(idx, 1);
            } else {
                favorites.push(gameUrl);
            }
            try {
                localStorage.setItem(STORAGE_FAV, JSON.stringify(favorites));
            } catch(e) {}
            updateFavUI();
        }

        // \u2500\u2500\u2500 Timer & Lifetime stats \u2500\u2500\u2500
        let sessionSeconds = 0;
        let lifetimeSeconds = 0;

        // Load lifetime play time
        let playtimeStats = {};
        try {
            const data = localStorage.getItem(STORAGE_PLAYTIME);
            if (data) playtimeStats = JSON.parse(data);
        } catch(e) {}

        if (gameUrl) {
            lifetimeSeconds = playtimeStats[gameUrl] || 0;
        }

        function updateTimerUI() {
            sessionSeconds++;
            lifetimeSeconds++;

            // Save lifetime playtime
            if (gameUrl) {
                playtimeStats[gameUrl] = lifetimeSeconds;
                try {
                    localStorage.setItem(STORAGE_PLAYTIME, JSON.stringify(playtimeStats));
                } catch(e) {}
            }

            // Format session time
            const formatTime = (totalSeconds) => {
                const hrs = Math.floor(totalSeconds / 3600);
                const mins = Math.floor((totalSeconds % 3600) / 60);
                const secs = totalSeconds % 60;
                const pad = (n) => String(n).padStart(2, '0');
                if (hrs > 0) {
                    return \`\${pad(hrs)}:\${pad(mins)}:\${pad(secs)}\`;
                }
                return \`\${pad(mins)}:\${pad(secs)}\`;
            };

            gameTimerEl.textContent = formatTime(sessionSeconds);

            // Lifetime string
            const formatLifetime = (totalSeconds) => {
                const hrs = Math.floor(totalSeconds / 3600);
                const mins = Math.floor((totalSeconds % 3600) / 60);
                if (hrs > 0) {
                    return \`\${hrs} hr \${mins} min lifetime\`;
                }
                return \`\${mins} min lifetime\`;
            };
            gameTimerEl.title = \`Session: \${formatTime(sessionSeconds)} (Total played: \${formatLifetime(lifetimeSeconds)})\`;
        }

        // Start timer interval
        let timerInterval = setInterval(updateTimerUI, 1000);

        // \u2500\u2500\u2500 Set Cloaking Headers \u2500\u2500\u2500
        function updatePageTitleAndFavicon() {
            titleEl.textContent = gameTitle;
            if (isGhost) {
                ghostBadge.hidden = false;
                backBtn.href = 'ghost-ui?ghost=1';
                document.title = settings.tabTitle;
                
                // set preset favicon
                let link = document.querySelector("link[rel*='icon']");
                if (!link) {
                    link = document.createElement('link');
                    link.rel = 'icon';
                    document.head.appendChild(link);
                }
                link.href = settings.tabFavicon;
            } else {
                ghostBadge.hidden = true;
                backBtn.href = 'ghost-ui';
                document.title = gameTitle + ' \u2014 Ghost Arcade';
                let link = document.querySelector("link[rel*='icon']");
                if (link) {
                    link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>\u{1F47B}</text></svg>';
                }
            }
        }
        updatePageTitleAndFavicon();

        // \u2500\u2500\u2500 Load Game Iframe \u2500\u2500\u2500
        function getProxyUrl(url) {
            if (!url) return '';
            if (url.startsWith('/proxy/')) return url;
            if (window.location.protocol === 'file:') return url;
            return '/proxy/' + url;
        }

        function loadGameInFrame(url) {
            loadingOverlay.classList.remove('hidden');
            errorState.classList.remove('visible');
            gameFrame.src = '';
            
            if (url) {
                try {
                    gameFrame.src = getProxyUrl(url);
                    gameFrame.addEventListener('load', () => {
                        loadingOverlay.classList.add('hidden');
                    }, { once: true });

                    // Fallback
                    setTimeout(() => {
                        loadingOverlay.classList.add('hidden');
                    }, 8000);
                } catch (err) {
                    console.error('Frame loading error:', err);
                    showError();
                }
            } else {
                showError();
            }
        }

        if (gameUrl) {
            loadGameInFrame(gameUrl);
        } else {
            showError();
        }

        function showError() {
            loadingOverlay.classList.add('hidden');
            errorState.classList.add('visible');
        }

        // \u2500\u2500\u2500 Reload Iframe Button \u2500\u2500\u2500
        if (reloadBtn) {
            reloadBtn.addEventListener('click', reloadGame);
        }

        function reloadGame() {
            if (gameUrl) {
                loadGameInFrame(gameUrl);
                // Reset session seconds
                sessionSeconds = 0;
            }
        }

        // \u2500\u2500\u2500 Fullscreen \u2500\u2500\u2500
        fullscreenBtn.addEventListener('click', () => {
            if (gameFrame.requestFullscreen) {
                gameFrame.requestFullscreen();
            } else if (gameFrame.webkitRequestFullscreen) {
                gameFrame.webkitRequestFullscreen();
            } else if (gameFrame.msRequestFullscreen) {
                gameFrame.msRequestFullscreen();
            }
        });

        // \u2500\u2500\u2500 Help / Keyboard Shortcuts Modal \u2500\u2500\u2500
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                shortcutsOverlay.style.display = 'flex';
            });
        }

        if (closeShortcutsBtn) {
            closeShortcutsBtn.addEventListener('click', () => {
                shortcutsOverlay.style.display = 'none';
            });
        }

        if (shortcutsOverlay) {
            shortcutsOverlay.addEventListener('click', (e) => {
                if (e.target === shortcutsOverlay) {
                    shortcutsOverlay.style.display = 'none';
                }
            });
        }

        // \u2500\u2500\u2500 Keyboard Listeners \u2500\u2500\u2500
        document.addEventListener('keydown', (e) => {
            // Panic Button check
            const matchesPanicCtrl = e.ctrlKey === settings.panicCtrl;
            const matchesPanicKey = e.key.toLowerCase() === settings.panicKey.toLowerCase();
            
            if (matchesPanicCtrl && matchesPanicKey) {
                e.preventDefault();
                window.location.href = settings.panicRedirect;
            }

            // Other shortcut keys inside player
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

            if (e.key === '?') {
                e.preventDefault();
                shortcutsOverlay.style.display = shortcutsOverlay.style.display === 'none' ? 'flex' : 'none';
            } else if (e.key.toLowerCase() === 'r') {
                e.preventDefault();
                reloadGame();
            } else if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                toggleFavorite();
            } else if (e.key === 'Escape' && shortcutsOverlay.style.display === 'flex') {
                shortcutsOverlay.style.display = 'none';
            }
        });

        // \u2500\u2500\u2500 Quick Switcher Dropdown \u2500\u2500\u2500
        if (quickSwitchBtn) {
            quickSwitchBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                quickSwitchContent.classList.toggle('show');
                populateQuickSwitcher();
            });

            // Close switcher on click outside
            document.addEventListener('click', (e) => {
                if (quickSwitchContent.classList.contains('show') && !e.target.closest('#quickSwitcherDropdown')) {
                    quickSwitchContent.classList.remove('show');
                }
            });
        }

        function populateQuickSwitcher() {
            let recent = [];
            try {
                const data = localStorage.getItem(STORAGE_RECENT);
                if (data) recent = JSON.parse(data);
            } catch(e) {}

            // Filter out the currently playing game
            const otherGames = recent.filter(r => r.url !== gameUrl).slice(0, 5);

            if (otherGames.length === 0) {
                quickSwitchContent.innerHTML = \`<div class="dropdown-item" style="color:var(--text-dim); cursor:default;">No other recent games</div>\`;
                return;
            }

            quickSwitchContent.innerHTML = otherGames.map(game => {
                const thumb = game.image || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23101018"><rect width="100" height="100"/><text x="50%" y="55%" font-size="40" text-anchor="middle" dominant-baseline="middle">\u{1F3AE}</text></svg>';
                return \`
                    <button class="dropdown-item" data-url="\${esc(game.url)}" data-title="\${esc(game.title)}" data-image="\${esc(thumb)}">
                        <img src="\${esc(getProxyUrl(thumb))}" alt="\${esc(game.title)}" onerror="this.style.display='none'">
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${escHTML(game.title)}</span>
                    </button>
                \`;
            }).join('');

            // Click listener for dropdown items
            quickSwitchContent.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    const nextUrl = item.dataset.url;
                    const nextTitle = item.dataset.title;
                    const nextImage = item.dataset.image;

                    // Hide dropdown
                    quickSwitchContent.classList.remove('show');

                    // Load new game without refreshing entire page
                    gameUrl = nextUrl;
                    gameTitle = nextTitle;
                    
                    // Reset session time
                    sessionSeconds = 0;
                    lifetimeSeconds = playtimeStats[gameUrl] || 0;

                    // Update URL params
                    const newParams = new URLSearchParams(window.location.search);
                    newParams.set('url', gameUrl);
                    newParams.set('title', gameTitle);
                    const newUrl = window.location.pathname + '?' + newParams.toString();
                    window.history.replaceState({ path: newUrl }, '', newUrl);

                    // Add to recent log
                    addRecentGameLog(gameUrl, gameTitle, nextImage);

                    // Reinit UI elements
                    updatePageTitleAndFavicon();
                    updateFavUI();
                    loadGameInFrame(gameUrl);
                });
            });
        }

        function addRecentGameLog(url, title, image) {
            let recent = [];
            try {
                const data = localStorage.getItem(STORAGE_RECENT);
                if (data) recent = JSON.parse(data);
            } catch(e) {}

            recent = recent.filter(r => r.url !== url);
            recent.unshift({ url, title, image, playedAt: Date.now() });
            
            try {
                localStorage.setItem(STORAGE_RECENT, JSON.stringify(recent.slice(0, MAX_RECENT)));
            } catch(e) {}
        }

        function esc(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function escHTML(str) {
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        }

        // \u2500\u2500\u2500 Cloud Syncing \u2500\u2500\u2500
        if (window.GhostArcadeSync) {
            // Initial pull on load
            window.GhostArcadeSync.pull().then(() => {
                // If pull imported localStorage, we should update timer variables
                try {
                    const data = localStorage.getItem(STORAGE_PLAYTIME);
                    if (data) {
                        playtimeStats = JSON.parse(data);
                        if (gameUrl) lifetimeSeconds = playtimeStats[gameUrl] || 0;
                    }
                } catch(e) {}
            });

            // Auto-sync every 5 minutes
            setInterval(() => {
                window.GhostArcadeSync.push();
            }, 5 * 60 * 1000);

            // Sync on closing game
            window.addEventListener('beforeunload', (e) => {
                window.GhostArcadeSync.push();
                // We do not prevent default here, just try to fire off the fetch before the page unloads
            });
        }

    })();
    <\/script>
</body>
</html>
`, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    if (path === "/sync.js") {
      return new Response("// sync.js - Cloud Syncing Utility\n\nwindow.GhostArcadeSync = {\n    async push() {\n        try {\n            console.log('[Sync] Exporting data...');\n            const lsData = this.exportLocalStorage();\n            const idbData = await this.exportIndexedDB();\n\n            const response = await fetch('/api/sync/push', {\n                method: 'POST',\n                headers: { 'Content-Type': 'application/json' },\n                body: JSON.stringify({\n                    localStorageJson: JSON.stringify(lsData),\n                    indexedDbJson: JSON.stringify(idbData)\n                })\n            });\n\n            if (response.ok) {\n                console.log('[Sync] Data successfully pushed to cloud.');\n            } else {\n                console.error('[Sync] Failed to push data.');\n            }\n        } catch (e) {\n            console.error('[Sync] Push error:', e);\n        }\n    },\n\n    async pull() {\n        try {\n            console.log('[Sync] Fetching data from cloud...');\n            const response = await fetch('/api/sync/pull');\n            if (response.status === 401) {\n                console.log('[Sync] Not logged in, skipping pull.');\n                return;\n            }\n\n            const resData = await response.json();\n            if (resData.success) {\n                if (resData.localStorageJson) {\n                    const lsData = JSON.parse(resData.localStorageJson);\n                    this.importLocalStorage(lsData);\n                }\n                \n                if (resData.indexedDbJson) {\n                    const idbData = JSON.parse(resData.indexedDbJson);\n                    await this.importIndexedDB(idbData);\n                }\n                console.log('[Sync] Data successfully pulled and imported.');\n            }\n        } catch (e) {\n            console.error('[Sync] Pull error:', e);\n        }\n    },\n\n    exportLocalStorage() {\n        const data = {};\n        for (let i = 0; i < localStorage.length; i++) {\n            const key = localStorage.key(i);\n            data[key] = localStorage.getItem(key);\n        }\n        return data;\n    },\n\n    importLocalStorage(data) {\n        if (!data || typeof data !== 'object') return;\n        // Merge instead of clear to not destroy unsynced local data if any\n        for (const [key, value] of Object.entries(data)) {\n            localStorage.setItem(key, value);\n        }\n    },\n\n    async exportIndexedDB() {\n        const exportData = {};\n        if (!window.indexedDB.databases) {\n            console.warn('[Sync] indexedDB.databases() not supported. Cannot sync IndexedDB automatically.');\n            return exportData;\n        }\n\n        const dbs = await window.indexedDB.databases();\n        for (const dbInfo of dbs) {\n            try {\n                const dbData = await this.exportSingleDB(dbInfo.name, dbInfo.version);\n                exportData[dbInfo.name] = { version: dbInfo.version, stores: dbData };\n            } catch (err) {\n                console.error(\\`[Sync] Failed to export DB \\${dbInfo.name}:\\`, err);\n            }\n        }\n        return exportData;\n    },\n\n    exportSingleDB(dbName, version) {\n        return new Promise((resolve, reject) => {\n            const request = window.indexedDB.open(dbName, version);\n            request.onerror = () => reject(request.error);\n            request.onsuccess = (e) => {\n                const db = e.target.result;\n                const storeNames = Array.from(db.objectStoreNames);\n                const dbExport = {};\n\n                if (storeNames.length === 0) {\n                    db.close();\n                    return resolve(dbExport);\n                }\n\n                let completed = 0;\n                let hasError = false;\n\n                const transaction = db.transaction(storeNames, 'readonly');\n                transaction.onerror = () => {\n                    if (!hasError) { hasError = true; db.close(); reject(transaction.error); }\n                };\n\n                storeNames.forEach(storeName => {\n                    const store = transaction.objectStore(storeName);\n                    const allRequest = store.getAll();\n                    const keysRequest = store.getAllKeys();\n\n                    Promise.all([\n                        new Promise(res => { allRequest.onsuccess = () => res(allRequest.result); }),\n                        new Promise(res => { keysRequest.onsuccess = () => res(keysRequest.result); })\n                    ]).then(([values, keys]) => {\n                        const storeData = {};\n                        for (let i = 0; i < keys.length; i++) {\n                            storeData[keys[i]] = values[i];\n                        }\n                        dbExport[storeName] = storeData;\n                        \n                        completed++;\n                        if (completed === storeNames.length) {\n                            db.close();\n                            resolve(dbExport);\n                        }\n                    });\n                });\n            };\n        });\n    },\n\n    async importIndexedDB(data) {\n        if (!data || typeof data !== 'object') return;\n\n        for (const [dbName, dbInfo] of Object.entries(data)) {\n            try {\n                await this.importSingleDB(dbName, dbInfo.version, dbInfo.stores);\n            } catch (err) {\n                console.error(\\`[Sync] Failed to import DB \\${dbName}:\\`, err);\n            }\n        }\n    },\n\n    importSingleDB(dbName, version, storesData) {\n        return new Promise((resolve, reject) => {\n            const request = window.indexedDB.open(dbName, version);\n            \n            request.onupgradeneeded = (e) => {\n                const db = e.target.result;\n                for (const storeName of Object.keys(storesData)) {\n                    if (!db.objectStoreNames.contains(storeName)) {\n                        db.createObjectStore(storeName);\n                    }\n                }\n            };\n\n            request.onerror = () => reject(request.error);\n            request.onsuccess = (e) => {\n                const db = e.target.result;\n                const storeNames = Object.keys(storesData).filter(s => db.objectStoreNames.contains(s));\n                \n                if (storeNames.length === 0) {\n                    db.close();\n                    return resolve();\n                }\n\n                const transaction = db.transaction(storeNames, 'readwrite');\n                transaction.oncomplete = () => {\n                    db.close();\n                    resolve();\n                };\n                transaction.onerror = () => {\n                    db.close();\n                    reject(transaction.error);\n                };\n\n                storeNames.forEach(storeName => {\n                    const store = transaction.objectStore(storeName);\n                    const storeData = storesData[storeName];\n                    for (const [key, value] of Object.entries(storeData)) {\n                        let parsedKey = key;\n                        // Attempt to parse number keys if they were stringified\n                        if (!isNaN(key)) parsedKey = Number(key);\n                        store.put(value, parsedKey);\n                    }\n                });\n            };\n        });\n    }\n};\n", {
        headers: {
          "content-type": "application/javascript;charset=UTF-8",
          "cross-origin-embedder-policy": "require-corp",
          "cross-origin-opener-policy": "same-origin"
        }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
