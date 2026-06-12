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
                            'Set-Cookie': `token=${token}; HttpOnly; Max-Age=2592000; Path=/`
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
                    
                    const arrayBuffer = await file.arrayBuffer();
                    
                    if (arrayBuffer.byteLength > 500 * 1024) {
                        return new Response(JSON.stringify({ error: 'Image too large (max 500KB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                    }

                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = '';
                    const chunkSize = 8192;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                    }
                    const base64 = btoa(binary);
                    const fileUrl = `data:${file.type || 'image/jpeg'};base64,${base64}`;
                    
                    await env.DB.prepare('UPDATE users SET profile_picture_url = ? WHERE id = ?')
                        .bind(fileUrl, user.id)
                        .run();
                        
                    return new Response(JSON.stringify({ success: true, url: fileUrl }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (request.method === 'POST' && path === '/api/sync/push') {
                    const body = await request.json();
                    await env.DB.prepare(`
                        INSERT INTO user_data (user_id, local_storage_json, indexed_db_json, last_synced) 
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(user_id) DO UPDATE SET 
                            local_storage_json = excluded.local_storage_json,
                            indexed_db_json = excluded.indexed_db_json,
                            last_synced = CURRENT_TIMESTAMP
                    `).bind(user.id, body.localStorageJson || '{}', body.indexedDbJson || '{}').run();
                    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                }

                if (request.method === 'GET' && path === '/api/sync/pull') {
                    const row = await env.DB.prepare('SELECT local_storage_json, indexed_db_json, last_synced FROM user_data WHERE user_id = ?')
                        .bind(user.id)
                        .first();
                    if (!row) {
                        return new Response(JSON.stringify({ 
                            success: true, 
                            localStorageJson: '{}', 
                            indexedDbJson: '{}',
                            lastSynced: null
                        }), { headers: { 'Content-Type': 'application/json' } });
                    }
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

