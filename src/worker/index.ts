/**
 * Tidal Cloudflare Worker
 *
 * API:
 *   GET /              工具信息
 *   GET /health        健康检查
 *   GET /sub?url=...   订阅转换 + 配置拼装
 */

import { Hono } from 'hono';
import { parseSubscription, nodesToClashYaml, nodesToSurgeConf } from '../core/parser.js';
import { assembleClashConfig, assembleSurgeConfig } from '../core/merger.js';

const app = new Hono();

app.get('/', (c) => {
    return c.json({
        name: 'Tidal',
        version: '0.2.0',
        description: 'Rule-set hosting and subscription management',
        endpoints: {
            'GET /': 'This help message',
            'GET /health': 'Health check',
            'GET /sub': 'Subscription convert + config assembly',
        },
        usage: {
            '/sub': {
                params: {
                    url: '(required) Subscription URL',
                    format: '(optional) "clash" | "surge", default: "clash"',
                    template: '(optional) "dns" | "tun" | "tap", default: "dns" (Clash only)',
                    full: '(optional) "true" = full config, "false" = nodes only, default: "true"',
                },
                example: '/sub?url=https://example.com/subscribe&format=clash&template=dns',
            },
        },
    });
});

app.get('/health', (c) => {
    return c.json({ status: 'ok' });
});

app.get('/sub', async (c) => {
    try {
        const url = c.req.query('url');
        const format = c.req.query('format') || 'clash';
        const template = c.req.query('template') || 'dns';
        const full = c.req.query('full') !== 'false';

        if (!url) {
            return c.json({ error: 'Missing "url" query parameter' }, 400);
        }

        // 1. 拉取订阅
        const response = await fetch(url, {
            headers: { 'User-Agent': 'ClashForAndroid/2.5.12' },
        });

        if (!response.ok) {
            return c.json({
                error: `Failed to fetch subscription: ${response.status} ${response.statusText}`,
            }, 502);
        }

        const content = await response.text();

        // 2. 解析节点
        const nodes = parseSubscription(content);

        if (nodes.length === 0) {
            return c.json({ error: 'No proxy nodes found in subscription' }, 422);
        }

        // 3. 输出
        if (full) {
            if (format === 'surge') {
                const config = await assembleSurgeConfig(nodes);
                return c.text(config, 200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-Node-Count': String(nodes.length),
                });
            }
            const config = await assembleClashConfig(nodes, template);
            return c.text(config, 200, {
                'Content-Type': 'text/yaml; charset=utf-8',
                'X-Node-Count': String(nodes.length),
            });
        }

        // 仅节点
        if (format === 'surge') {
            return c.text(nodesToSurgeConf(nodes), 200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'X-Node-Count': String(nodes.length),
            });
        }
        return c.text(nodesToClashYaml(nodes), 200, {
            'Content-Type': 'text/yaml; charset=utf-8',
            'X-Node-Count': String(nodes.length),
        });

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ error: message }, 500);
    }
});

export default app;
