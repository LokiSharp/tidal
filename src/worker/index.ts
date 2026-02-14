/**
 * Tidal Cloudflare Worker
 *
 * 当前为基础骨架，后续扩展：
 * - GET /convert?url=...&format=clash|surge  订阅格式转换
 * - GET /subscribe?url=...&template=...       订阅合并
 */

import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => {
    return c.json({
        name: 'Tidal',
        version: '0.1.0',
        description: 'Proxy rule-set hosting and subscription management',
        endpoints: {
            '/': 'This help message',
            '/health': 'Health check',
        },
    });
});

app.get('/health', (c) => {
    return c.json({ status: 'ok' });
});

export default app;
