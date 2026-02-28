
import config from './config.js';

async function enableCors() {
    // Use internal URL for local Docker access
    const KONG_ADMIN_URL = config.kong.internalAdminUrl;
    console.log('🌍 Enabling CORS on Kong Gateway...');

    // 1. Check if plugin exists
    try {
        const getRes = await fetch(`${KONG_ADMIN_URL}/plugins`);
        const plugins = await getRes.json();
        const existing = plugins.data && plugins.data.find(p => p.name === 'cors');

        // NOTE: When credentials: true, origins cannot be '*' - must be explicit list
        // Include localhost and all common network access patterns
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:5000',
            'http://localhost:8000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5000',
            'http://127.0.0.1:8000',
            // Network access (use VITE_KONG_URL to get the configured IP)
            `http://${new URL(config.vite.kongUrl).hostname}:5173`,
            `http://${new URL(config.vite.kongUrl).hostname}:5000`,
            `http://${new URL(config.vite.kongUrl).hostname}:8000`,
        ];

        const payload = {
            name: 'cors',
            config: {
                origins: allowedOrigins,
                methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
                headers: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'x-trace-id', 'x-span-id', 'traceparent'],
                exposed_headers: ['x-trace-id', 'x-span-id'],
                credentials: true,
                max_age: 3600
            }
        };

        let res;
        if (existing) {
            console.log(`🔄 Updating existing CORS plugin (ID: ${existing.id})...`);
            res = await fetch(`${KONG_ADMIN_URL}/plugins/${existing.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            console.log('✨ Creating new CORS plugin...');
            res = await fetch(`${KONG_ADMIN_URL}/plugins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.status === 201 || res.status === 200) {
            console.log('✅ CORS enabled successfully on Kong.');
        } else {
            const text = await res.text();
            console.error(`❌ Failed to enable CORS: ${res.status} ${text}`);
            process.exit(1);
        }

    } catch (e) {
        console.error('❌ Error connecting to Kong Admin API:', e.message);
        process.exit(1);
    }
}

enableCors();
