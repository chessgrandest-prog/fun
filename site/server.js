const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const db = require('./database');
const fs = require('fs');

const app = express();
const PORT = 8080;
const JWT_SECRET = 'super-secret-arcade-key-2026';

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Add COOP/COEP headers for SharedArrayBuffer support in some emulators
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
});

// Setup multer for profile picture uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Static routes
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '')));

// Route rewrites for the custom URL paths
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ghost-ui', (req, res) => res.sendFile(path.join(__dirname, 'ghost-ui.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'play.html')));

// Local development proxy to mirror the Cloudflare worker proxy functionality
app.use('/proxy', async (req, res) => {
    let targetUrl = req.originalUrl.substring(req.originalUrl.indexOf('/proxy/') + 7);
    if (!targetUrl) return res.status(400).send('Missing url parameter');

    try {
        const fetchRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'GhostArcadeLocal/1.0' }
        });

        const contentType = fetchRes.headers.get('content-type') || '';
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // Pass through some headers
        if (contentType) res.setHeader('Content-Type', contentType);

        if (targetUrl.toLowerCase().endsWith('.html') || contentType.includes('text/html')) {
            let html = await fetchRes.text();
            
            if (!/<base\b/i.test(html)) {
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

            res.send(html);
        } else if (targetUrl.includes('terraria-wasm1') && (targetUrl.toLowerCase().endsWith('.js') || contentType.includes('javascript'))) {
            let js = await fetchRes.text();
            const repoBase = '/proxy/https://raw.githubusercontent.com/chessgrandest-prog/terraria-wasm1/main/';
            if (targetUrl.endsWith('/sw.js') || targetUrl.endsWith('/sw.js?')) {
                js = js.replace(/"\/([^"]+)"/g, function(match, p1) {
                    if (p1.startsWith('/') || p1.startsWith('http')) return match;
                    return '"' + repoBase + p1 + '"';
                });
                js = js.replace('"/"', '"' + repoBase + '"');
            } else {
                js = js.replace(/"\/sw\.js"/g, '"' + repoBase + 'sw.js"');
                js = js.replace(/"\/_framework\/dotnet\.js"/g, '"' + repoBase + '_framework/dotnet.js"');
                js = js.replace(/scope:"\/"/g, 'scope:"' + repoBase + '"');
            }
            res.setHeader('Content-Type', 'application/javascript;charset=UTF-8');
            res.send(js);
        } else {
            // Stream back binary data / other data
            const buffer = await fetchRes.arrayBuffer();
            res.send(Buffer.from(buffer));
        }
    } catch (err) {
        res.status(500).send('Proxy error: ' + err.message);
    }
});

// --- API Endpoints ---

// Auth Middleware
function authenticateToken(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
}

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Create empty user_data row
            const userId = this.lastID;
            db.run(`INSERT INTO user_data (user_id) VALUES (?)`, [userId]);

            res.json({ success: true, message: 'User registered successfully' });
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Invalid username or password' });

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        
        res.json({ 
            success: true, 
            user: { id: user.id, username: user.username, profile_picture_url: user.profile_picture_url } 
        });
    });
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// Get Current User Profile
app.get('/api/me', authenticateToken, (req, res) => {
    db.get(`SELECT id, username, profile_picture_url FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    });
});

// Upload Profile Picture
app.post('/api/profile/picture', authenticateToken, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const fileUrl = '/uploads/' + req.file.filename;
    db.run(`UPDATE users SET profile_picture_url = ? WHERE id = ?`, [fileUrl, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, url: fileUrl });
    });
});

// Sync Push (Upload data from client to server)
app.post('/api/sync/push', authenticateToken, (req, res) => {
    const { localStorageJson, indexedDbJson } = req.body;
    
    db.run(`UPDATE user_data SET local_storage_json = ?, indexed_db_json = ?, last_synced = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [localStorageJson || '{}', indexedDbJson || '{}', req.user.id], 
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed to sync data' });
            res.json({ success: true });
        }
    );
});

// Sync Pull (Download data from server to client)
app.get('/api/sync/pull', authenticateToken, (req, res) => {
    db.get(`SELECT local_storage_json, indexed_db_json, last_synced FROM user_data WHERE user_id = ?`, [req.user.id], (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Failed to fetch sync data' });
        res.json({ 
            success: true, 
            localStorageJson: row.local_storage_json, 
            indexedDbJson: row.indexed_db_json,
            lastSynced: row.last_synced
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
