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
