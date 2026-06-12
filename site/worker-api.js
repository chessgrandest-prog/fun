// Utility functions for Web Crypto
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// JWT Implementation
function base64urlEncode(source) {
    let encoded = btoa(String.fromCharCode.apply(null, new Uint8Array(source)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return encoded;
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function signToken(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encoder = new TextEncoder();
    
    const headB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
    const payB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
    
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(headB64 + '.' + payB64)
    );
    
    const sigB64 = base64urlEncode(signature);
    return headB64 + '.' + payB64 + '.' + sigB64;
}

async function verifyToken(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const header = parts[0];
    const payload = parts[1];
    const signature = parts[2];
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );
    
    const isValid = await crypto.subtle.verify(
        'HMAC',
        key,
        base64urlDecode(signature),
        encoder.encode(header + '.' + payload)
    );
    
    if (!isValid) return null;
    
    return JSON.parse(new TextDecoder().decode(base64urlDecode(payload)));
}

function parseCookies(request) {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce((acc, cookie) => {
        const [name, ...rest] = cookie.split('=');
        acc[name.trim()] = rest.join('=').trim();
        return acc;
    }, {});
}

async function authenticate(request, env) {
    const cookies = parseCookies(request);
    const token = cookies['token'];
    if (!token) return null;
    const secret = env.JWT_SECRET || 'super-secret-arcade-key-2026';
    return await verifyToken(token, secret);
}

// API Routes
if (path.startsWith('/api/')) {
    try {
        if (request.method === 'POST' && path === '/api/register') {
            const body = await request.json();
            if (!body.username || !body.password) {
                return new Response(JSON.stringify({ error: 'Username and password required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            
            const hashedPassword = await hashPassword(body.password);
            
            try {
                const res = await env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
                    .bind(body.username, hashedPassword)
                    .run();
                    
                // In D1, res.meta.last_row_id contains the ID
                const userId = res.meta.last_row_id;
                
                await env.DB.prepare('INSERT INTO user_data (user_id) VALUES (?)')
                    .bind(userId)
                    .run();
                    
                return new Response(JSON.stringify({ success: true, message: 'User registered successfully' }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                if (e.message.includes('UNIQUE')) {
                    return new Response(JSON.stringify({ error: 'Username already exists' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }
                throw e;
            }
        }

        if (request.method === 'POST' && path === '/api/login') {
            const body = await request.json();
            const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
                .bind(body.username)
                .first();
                
            if (!user) {
                return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            
            const validPassword = await hashPassword(body.password) === user.password_hash;
            if (!validPassword) {
                return new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            
            const secret = env.JWT_SECRET || 'super-secret-arcade-key-2026';
            const token = await signToken({ id: user.id, username: user.username }, secret);
            
            return new Response(JSON.stringify({ 
                success: true, 
                user: { id: user.id, username: user.username, profile_picture_url: user.profile_picture_url } 
            }), { 
                headers: { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': \`token=\${token}; HttpOnly; Max-Age=2592000; Path=/\`
                } 
            });
        }

        if (request.method === 'POST' && path === '/api/logout') {
            return new Response(JSON.stringify({ success: true }), { 
                headers: { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': 'token=; HttpOnly; Max-Age=0; Path=/'
                } 
            });
        }

        // Authenticated routes
        const user = await authenticate(request, env);
        if (!user && path !== '/api/login' && path !== '/api/register' && path !== '/api/logout') {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }

        if (request.method === 'GET' && path === '/api/me') {
            const dbUser = await env.DB.prepare('SELECT id, username, profile_picture_url FROM users WHERE id = ?')
                .bind(user.id)
                .first();
            if (!dbUser) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            return new Response(JSON.stringify({ user: dbUser }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (request.method === 'POST' && path === '/api/profile/picture') {
            const formData = await request.formData();
            const file = formData.get('avatar');
            if (!file) return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '';
            const key = user.id + '-' + uniqueSuffix + ext;
            
            await env.PROFILE_PICTURES.put(key, file.stream(), {
                httpMetadata: { contentType: file.type }
            });
            
            const fileUrl = '/uploads/' + key;
            await env.DB.prepare('UPDATE users SET profile_picture_url = ? WHERE id = ?')
                .bind(fileUrl, user.id)
                .run();
                
            return new Response(JSON.stringify({ success: true, url: fileUrl }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (request.method === 'POST' && path === '/api/sync/push') {
            const body = await request.json();
            await env.DB.prepare('UPDATE user_data SET local_storage_json = ?, indexed_db_json = ?, last_synced = CURRENT_TIMESTAMP WHERE user_id = ?')
                .bind(body.localStorageJson || '{}', body.indexedDbJson || '{}', user.id)
                .run();
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (request.method === 'GET' && path === '/api/sync/pull') {
            const row = await env.DB.prepare('SELECT local_storage_json, indexed_db_json, last_synced FROM user_data WHERE user_id = ?')
                .bind(user.id)
                .first();
            if (!row) return new Response(JSON.stringify({ error: 'Failed to fetch sync data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            return new Response(JSON.stringify({ 
                success: true, 
                localStorageJson: row.local_storage_json, 
                indexedDbJson: row.indexed_db_json,
                lastSynced: row.last_synced
            }), { headers: { 'Content-Type': 'application/json' } });
        }
        
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// Serve uploaded profile pictures from R2
if (request.method === 'GET' && path.startsWith('/uploads/')) {
    const key = path.substring(9); // remove '/uploads/'
    const object = await env.PROFILE_PICTURES.get(key);
    
    if (!object) {
        return new Response('Not Found', { status: 404 });
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    
    return new Response(object.body, { headers });
}
