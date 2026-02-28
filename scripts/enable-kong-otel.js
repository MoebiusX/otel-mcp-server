
// global fetch is available in Node 18+
import config from './config.js';

async function enableOtel() {
    // Use internal URL for local Docker access
    const KONG_ADMIN_URL = config.kong.internalAdminUrl;

    console.log('📡 Enabling OpenTelemetry on Kong Gateway via Admin API...');

    // OpenTelemetry Plugin definition
    const params = new URLSearchParams();
    params.append('name', 'opentelemetry');

    // Basic attributes
    // params.append('config.resource_attributes.service.name', 'kong-gateway'); 
    // Nested fields in url-encoded are tricky with Kong versions. 
    // Let's try omitting resource attributes first, or use JSON body which is safer.

    try {
        // 1. Check if plugin exists
        const getRes = await fetch(`${KONG_ADMIN_URL}/plugins`);
        const plugins = await getRes.json();
        const existing = plugins.data.find(p => p.name === 'opentelemetry');

        let res;
        const payload = {
            name: 'opentelemetry',
            config: {
                endpoint: 'http://otel-collector:4318/v1/traces',
                resource_attributes: {
                    'service.name': 'api-gateway'
                },
                header_type: 'w3c'
            }
        };

        if (existing) {
            console.log(`🔄 Updating existing OpenTelemetry plugin (ID: ${existing.id})...`);
            res = await fetch(`${KONG_ADMIN_URL}/plugins/${existing.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            console.log('✨ Creating new OpenTelemetry plugin...');
            res = await fetch(`${KONG_ADMIN_URL}/plugins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (res.status === 201 || res.status === 200) {
            console.log('✅ OpenTelemetry plugin configured successfully on Kong.');
        } else {
            const text = await res.text();
            console.error(`❌ Failed to configure OpenTelemetry: ${res.status} ${text}`);
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ Error connecting to Kong Admin API:', e.message);
        process.exit(1);
    }
}

enableOtel();
