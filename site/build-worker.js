const fs = require('fs');
const path = require('path');

const files = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/ghost-ui': 'ghost-ui.html',
    '/styles.css': 'styles.css',
    '/script.js': 'script.js',
    '/play.html': 'play.html',
    '/sync.js': 'sync.js'
};

const contentTypes = {
    'index.html': 'text/html;charset=UTF-8',
    'ghost-ui.html': 'text/html;charset=UTF-8',
    'styles.css': 'text/css;charset=UTF-8',
    'script.js': 'application/javascript;charset=UTF-8',
    'play.html': 'text/html;charset=UTF-8',
    'sync.js': 'application/javascript;charset=UTF-8'
};

let workerCode = fs.readFileSync(path.join(__dirname, 'worker-api-functions.js'), 'utf8') + `
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        ` + fs.readFileSync(path.join(__dirname, 'worker-api-routes.js'), 'utf8') + `

        let targetUrlStr = null;
        // Auto-recover orphaned requests (like root-absolute scripts from proxied sites)
        const referer = request.headers.get('referer');
        if (referer && referer.includes('/proxy/http') && !path.startsWith('/proxy/') && !['/', '/ghost-ui', '/play.html', '/script.js', '/styles.css', '/games.json', '/movies.json'].includes(path)) {
            const originMatch = referer.match(/\\/proxy\\/(https?:\\/\\/[^\\/]+)/);
            if (originMatch) {
                targetUrlStr = originMatch[1] + path + url.search;
            }
        }

        // PROXY ROUTE to bypass github blocks
        if (path.startsWith('/proxy/') || targetUrlStr) {
            const targetUrl = targetUrlStr || request.url.substring(request.url.indexOf('/proxy/') + 7);
            if (!targetUrl) return new Response('Missing url parameter', { status: 400 });
            
            try {
                // Fetch the asset from the target URL (e.g. raw.githubusercontent.com)
                const res = await fetch(targetUrl, {
                    headers: { 'User-Agent': 'GhostArcadeWorker/1.0' }
                });
                
                // Copy the response, but remove restrictive security headers so it can be iframed/embedded
                const newHeaders = new Headers(res.headers);
                newHeaders.delete('x-frame-options');
                newHeaders.delete('content-security-policy');
                newHeaders.set('access-control-allow-origin', '*');
                
                const contentType = res.headers.get('content-type') || '';
                if (targetUrl.toLowerCase().endsWith('.html') || contentType.includes('text/html')) {
                    newHeaders.set('content-type', 'text/html;charset=UTF-8');
                    newHeaders.set('cross-origin-embedder-policy', 'require-corp');
                    newHeaders.set('cross-origin-opener-policy', 'same-origin');
                    let html = await res.text();
                    
                    if (!/<base\\b/i.test(html)) {
                        const basePath = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                        const baseTag = '<base href="/proxy/' + basePath + '">';
                        if (html.includes('<head>')) {
                            html = html.replace('<head>', '<head>' + baseTag);
                        } else if (html.includes('<HEAD>')) {
                            html = html.replace('<HEAD>', '<HEAD>' + baseTag);
                        } else if (html.includes('<html>') || html.includes('<HTML>')) {
                            html = html.replace(/<html>/i, '<html><head>' + baseTag + '</head>');
                        } else {
                            html = '<head>' + baseTag + '</head>' + html;
                        }
                    }

                    // Rewrite root-relative links in HTML so scripts load with the proxy path
                    try {
                        const targetOrigin = new URL(targetUrl).origin;
                        html = html.replace(/(src|href|action)=["']\\/(?!\\/)(?!proxy\\/)([^"']*)["']/gi, '$1="/proxy/' + targetOrigin + '/$2"');
                    } catch(e) {}

                    // Universal SDK shim: replaces known third-party SDK scripts with a
                    // Proxy-based mock that auto-handles ANY property access or method call.
                    // This works for ytgame.js and any future SDK-dependent games.
                    const sdkPatterns = [
                        { regex: /ytgame\\.js/i, global: 'ytgame' },
                        { regex: /game_api\\/v1/i, global: 'ytgame' }
                    ];
                    for (const sdk of sdkPatterns) {
                        if (sdk.regex.test(html)) {
                            const shimScript = '<script>(function(){' +
                                'function makeShim(){' +
                                    'var handler={' +
                                        'get:function(_,p){' +
                                            'if(p==="then"||p===Symbol.toPrimitive)return undefined;' +
                                            'if(p==="valueOf")return function(){return 0;};' +
                                            'if(p==="toString")return function(){return "";};' +
                                            'return makeShim();' +
                                        '},' +
                                        'apply:function(){return Promise.resolve(makeShim());},' +
                                        'construct:function(){return makeShim();}' +
                                    '};' +
                                    'return new Proxy(function(){},handler);' +
                                '}' +
                                'window["' + sdk.global + '"]=makeShim();' +
                            '})();<\\/script>';
                            html = html.replace(new RegExp('<script[^>]*(?:' + sdk.regex.source + ')[^>]*><\\/script>', 'gi'), shimScript);
                        }
                    }

                    // Inject Autoclicker Listener
                    const autoclickerScript = '<scr' + 'ipt>' +
                        '(function() {' +
                            'var active = false;' +
                            'var cps = 50;' +
                            'var mx = 0, my = 0;' +
                            'var lastClick = 0;' +
                            'var raf = null;' +
                            'var hotkey = { altKey: true, ctrlKey: false, shiftKey: false, key: "c" };' +
                            'window.addEventListener("mousemove", function(e) { mx = e.clientX; my = e.clientY; });' +
                            'function doClick() {' +
                                'var el = document.elementFromPoint(mx, my);' +
                                'if (el) {' +
                                    'if (el.id === "bigCookie" && typeof Game !== "undefined" && typeof Game.ClickCookie === "function") {' +
                                        'Game.ClickCookie();' +
                                    '} else {' +
                                        'var opts = { bubbles: true, cancelable: true, clientX: mx, clientY: my, button: 0, view: window };' +
                                        'el.dispatchEvent(new PointerEvent("pointerdown", opts));' +
                                        'el.dispatchEvent(new MouseEvent("mousedown", opts));' +
                                        'el.dispatchEvent(new PointerEvent("pointerup", opts));' +
                                        'el.dispatchEvent(new MouseEvent("mouseup", opts));' +
                                        'el.click();' +
                                    '}' +
                                '}' +
                            '}' +
                            'function loop(ts) {' +
                                'if (!active) return;' +
                                'var interval = 1000 / cps;' +
                                'var maxPerFrame = Math.ceil(cps / 30) + 1;' +
                                'var count = 0;' +
                                'while (ts - lastClick >= interval && count < maxPerFrame) {' +
                                    'doClick();' +
                                    'lastClick += interval;' +
                                    'count++;' +
                                '}' +
                                'if (ts - lastClick > 1000) lastClick = ts;' +
                                'raf = requestAnimationFrame(loop);' +
                            '}' +
                            'function start() {' +
                                'lastClick = performance.now();' +
                                'raf = requestAnimationFrame(loop);' +
                            '}' +
                            'function stop() {' +
                                'if (raf) cancelAnimationFrame(raf);' +
                                'raf = null;' +
                            '}' +
                            'window.addEventListener("message", function(e) {' +
                                'if (!e.data || !e.data.type) return;' +
                                'if (e.data.type === "AUTOCLICKER_SET") {' +
                                    'cps = parseInt(e.data.cps) || 50;' +
                                '} else if (e.data.type === "AUTOCLICKER_TOGGLE") {' +
                                    'active = e.data.active;' +
                                    'if (active) start(); else stop();' +
                                '} else if (e.data.type === "AUTOCLICKER_HOTKEY") {' +
                                    'hotkey = e.data.hotkey;' +
                                '}' +
                            '});' +
                            'window.addEventListener("keydown", function(e) {' +
                                'if (e.altKey === hotkey.altKey && e.ctrlKey === hotkey.ctrlKey && e.shiftKey === hotkey.shiftKey && e.key.toLowerCase() === hotkey.key) {' +
                                    'active = !active;' +
                                    'if (active) start(); else stop();' +
                                    'window.parent.postMessage({ type: "AUTOCLICKER_STATE_CHANGED", active: active }, "*");' +
                                '}' +
                            '});' +
                        '})();' +
                    '</' + 'script>';
                    
                    if (html.includes('</body>')) {
                        html = html.replace('</body>', autoclickerScript + '</body>');
                    } else if (html.includes('</BODY>')) {
                        html = html.replace('</BODY>', autoclickerScript + '</BODY>');
                    } else {
                        html += autoclickerScript;
                    }

                    return new Response(html, {
                        status: res.status,
                        statusText: res.statusText,
                        headers: newHeaders
                    });
                } else if (targetUrl.includes('terraria-wasm1') && (targetUrl.toLowerCase().endsWith('.js') || contentType.includes('javascript'))) {
                    newHeaders.set('content-type', 'application/javascript;charset=UTF-8');
                    newHeaders.set('cross-origin-embedder-policy', 'require-corp');
                    newHeaders.set('cross-origin-opener-policy', 'same-origin');
                    let js = await res.text();
                    
                    // Determine the base URL for this repo in the proxy
                    const repoBase = '/proxy/https://raw.githubusercontent.com/chessgrandest-prog/terraria-wasm1/main/';
                    
                    if (targetUrl.endsWith('/sw.js') || targetUrl.endsWith('/sw.js?')) {
                        // Rewrite sw.js: replace root-absolute cache paths with proxy paths
                        // e.g. "/backdrop.png" -> "/proxy/https://raw.../backdrop.png"
                        // e.g. "/_framework/" -> "/proxy/https://raw.../_framework/"
                        js = js.replace(/"\\/([^"]+)"/g, function(match, p1) {
                            // Only rewrite paths that look like game assets, not protocol URLs
                            if (p1.startsWith('/') || p1.startsWith('http')) return match;
                            return '"' + repoBase + p1 + '"';
                        });
                        // Also fix the bare "/" root path used for cache matching
                        js = js.replace('"/"', '"' + repoBase + '"');
                    } else {
                        // For index.js: rewrite service worker registration paths  
                        js = js.replace(/"\\/sw\\.js"/g, '"' + repoBase + 'sw.js"');
                        js = js.replace(/"\\/_framework\\/dotnet\\.js"/g, '"' + repoBase + '_framework/dotnet.js"');
                        js = js.replace(/scope:"\\/"/g, 'scope:"' + repoBase + '"');
                    }
                    
                    return new Response(js, {
                        status: res.status,
                        statusText: res.statusText,
                        headers: newHeaders
                    });
                }
                
                // Fix MIME types for common file types that raw.githubusercontent.com serves as text/plain
                const lowerUrl = targetUrl.toLowerCase();
                if (lowerUrl.endsWith('.css')) {
                    newHeaders.set('content-type', 'text/css;charset=UTF-8');
                } else if (lowerUrl.endsWith('.js') || lowerUrl.endsWith('.mjs')) {
                    newHeaders.set('content-type', 'application/javascript;charset=UTF-8');
                } else if (lowerUrl.endsWith('.wasm')) {
                    newHeaders.set('content-type', 'application/wasm');
                } else if (lowerUrl.endsWith('.json')) {
                    newHeaders.set('content-type', 'application/json;charset=UTF-8');
                } else if (lowerUrl.endsWith('.png')) {
                    newHeaders.set('content-type', 'image/png');
                } else if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) {
                    newHeaders.set('content-type', 'image/jpeg');
                } else if (lowerUrl.endsWith('.ico')) {
                    newHeaders.set('content-type', 'image/x-icon');
                } else if (lowerUrl.endsWith('.ttf')) {
                    newHeaders.set('content-type', 'font/ttf');
                } else if (lowerUrl.endsWith('.woff') || lowerUrl.endsWith('.woff2')) {
                    newHeaders.set('content-type', lowerUrl.endsWith('.woff2') ? 'font/woff2' : 'font/woff');
                }
                
                newHeaders.set('cross-origin-embedder-policy', 'require-corp');
                newHeaders.set('cross-origin-opener-policy', 'same-origin');
                
                return new Response(res.body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: newHeaders
                });
            } catch (err) {
                return new Response('Proxy error: ' + err.message, { status: 500 });
            }
        }

        // DYNAMIC GAMES.JSON & MOVIES.JSON (fetches from your GitHub automatically)
        if (path === '/games.json' || path === '/movies.json') {
            try {
                // IMPORTANT: Adjust this URL if your files are in a different folder on GitHub!
                const filename = path.substring(1);
                const githubUrl = 'https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/' + filename;
                
                const res = await fetch(githubUrl, {
                    headers: { 'User-Agent': 'GhostArcadeWorker/1.0' },
                    // Cache the response for 60 seconds so it's fast but still updates
                    cf: { cacheTtl: 60 } 
                });
                
                return new Response(res.body, {
                    status: res.status,
                    headers: {
                        'Content-Type': 'application/json;charset=UTF-8',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } catch (err) {
                return new Response(JSON.stringify({ error: 'Failed to load ' + path }), { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // STATIC ASSETS
`;

for (const [route, file] of Object.entries(files)) {
    const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const mime = contentTypes[file];
    
    workerCode += `
        if (path === '${route}') {
            return new Response(${JSON.stringify(content)}, {
                headers: { 
                    'content-type': '${mime}',
                    'cross-origin-embedder-policy': 'require-corp',
                    'cross-origin-opener-policy': 'same-origin'
                }
            });
        }
    `;
}

workerCode += `
        return new Response('Not Found', { status: 404 });
    }
};
`;

fs.writeFileSync(path.join(__dirname, 'worker.js'), workerCode);
console.log('worker.js generated successfully!');
