const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME_TYPES = {
    '.html': 'text/html;charset=UTF-8',
    '.css': 'text/css;charset=UTF-8',
    '.js': 'application/javascript;charset=UTF-8',
    '.json': 'application/json;charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    
    // Rewrite routes to match worker routes
    if (urlPath === '/' || urlPath === '/index.html') {
        urlPath = '/index.html';
    } else if (urlPath === '/ghost-ui') {
        urlPath = '/ghost-ui.html';
    } else if (urlPath === '/play') {
        urlPath = '/play.html';
    }

    const filePath = path.join(__dirname, urlPath);
    
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': mime,
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        });

        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
