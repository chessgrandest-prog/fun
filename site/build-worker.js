const fs = require('fs');
const path = require('path');

const files = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/styles.css': 'styles.css',
    '/script.js': 'script.js',
    '/play.html': 'play.html'
};

const contentTypes = {
    'index.html': 'text/html;charset=UTF-8',
    'styles.css': 'text/css;charset=UTF-8',
    'script.js': 'application/javascript;charset=UTF-8',
    'play.html': 'text/html;charset=UTF-8'
};

let workerCode = `export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // PROXY ROUTE to bypass github blocks
        if (path === '/proxy') {
            const targetUrl = url.searchParams.get('url');
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
                
                return new Response(res.body, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: newHeaders
                });
            } catch (err) {
                return new Response('Proxy error: ' + err.message, { status: 500 });
            }
        }

        // DYNAMIC GAMES.JSON (fetches from your GitHub automatically)
        if (path === '/games.json') {
            try {
                // IMPORTANT: Adjust this URL if your games.json is in a different folder on GitHub!
                const githubUrl = 'https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/games.json';
                
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
                return new Response(JSON.stringify({ error: 'Failed to load games list' }), { 
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
                headers: { 'content-type': '${mime}' }
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
