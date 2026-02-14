/**
 * 订阅解析器：解析机场订阅内容，提取节点列表
 *
 * 支持的订阅格式：
 * 1. Clash YAML（包含 proxies: 数组）
 * 2. Surge conf（包含 [Proxy] 段）
 */

/** 代理节点通用接口 */
export interface ProxyNode {
    /** 节点名称 */
    name: string;
    /** 协议类型（ss, vmess, trojan, hysteria2 等）*/
    type: string;
    /** 原始配置对象（保留所有字段，用于原样输出）*/
    raw: Record<string, unknown>;
}

/**
 * 自动检测订阅格式并解析节点
 */
export function parseSubscription(content: string): ProxyNode[] {
    const trimmed = content.trim();

    // Clash YAML 格式
    if (trimmed.startsWith('proxies:') || trimmed.includes('\nproxies:')) {
        return parseClashYaml(trimmed);
    }

    // Surge conf 格式
    if (trimmed.includes('[Proxy]')) {
        return parseSurgeConf(trimmed);
    }

    throw new Error('无法识别的订阅格式，仅支持 Clash YAML 和 Surge conf');
}

// ===== Clash YAML 解析 =====

/**
 * 解析 Clash YAML 格式的订阅
 */
function parseClashYaml(content: string): ProxyNode[] {
    const nodes: ProxyNode[] = [];
    const lines = content.split('\n');

    let inProxies = false;
    let currentNode: string[] = [];

    for (const line of lines) {
        if (line.trimStart() === 'proxies:') {
            inProxies = true;
            continue;
        }

        if (!inProxies) continue;

        // 遇到新的顶级 key，结束 proxies 段
        if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
            if (currentNode.length > 0) {
                const node = parseYamlNode(currentNode);
                if (node) nodes.push(node);
            }
            break;
        }

        const trimmed = line.trimStart();

        // 新的数组项
        if (trimmed.startsWith('- ')) {
            if (currentNode.length > 0) {
                const node = parseYamlNode(currentNode);
                if (node) nodes.push(node);
            }
            currentNode = [trimmed.slice(2)];
        } else if (currentNode.length > 0 && trimmed.length > 0) {
            currentNode.push(trimmed);
        }
    }

    if (currentNode.length > 0) {
        const node = parseYamlNode(currentNode);
        if (node) nodes.push(node);
    }

    return nodes;
}

function parseYamlNode(lines: string[]): ProxyNode | null {
    const joined = lines.join('\n');
    const raw: Record<string, unknown> = {};

    // 内联 JSON 风格 { name: xxx, type: ss, ... }
    if (joined.trimStart().startsWith('{')) {
        const cleaned = joined.trim().replace(/^\{/, '').replace(/\}$/, '');
        for (const pair of splitTopLevel(cleaned, ',')) {
            const colonIdx = pair.indexOf(':');
            if (colonIdx === -1) continue;
            const key = pair.slice(0, colonIdx).trim();
            const value = parseYamlValue(pair.slice(colonIdx + 1).trim());
            raw[key] = value;
        }
    } else {
        // 多行 key: value 格式
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            const value = parseYamlValue(line.slice(colonIdx + 1).trim());
            raw[key] = value;
        }
    }

    const name = String(raw['name'] || '');
    const type = String(raw['type'] || '');
    if (!name || !type) return null;

    return { name, type, raw };
}

function splitTopLevel(str: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inQuote = '';
    let current = '';

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];

        if (inQuote) {
            current += ch;
            if (ch === inQuote && str[i - 1] !== '\\') inQuote = '';
            continue;
        }

        if (ch === '"' || ch === "'") {
            inQuote = ch;
            current += ch;
            continue;
        }

        if (ch === '{' || ch === '[') { depth++; current += ch; continue; }
        if (ch === '}' || ch === ']') { depth--; current += ch; continue; }

        if (depth === 0 && ch === sep) {
            parts.push(current);
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim()) parts.push(current);
    return parts;
}

function parseYamlValue(str: string): unknown {
    if (str === '' || str === 'null' || str === '~') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;

    // 去掉引号
    if ((str.startsWith('"') && str.endsWith('"')) ||
        (str.startsWith("'") && str.endsWith("'"))) {
        return str.slice(1, -1);
    }

    const num = Number(str);
    if (!isNaN(num) && str !== '') return num;

    // 数组 [a, b, c]
    if (str.startsWith('[') && str.endsWith(']')) {
        const inner = str.slice(1, -1);
        return splitTopLevel(inner, ',').map(s => parseYamlValue(s.trim()));
    }

    return str;
}

// ===== Surge conf 解析 =====

/**
 * 解析 Surge conf 格式的订阅
 * 提取 [Proxy] 段中的节点
 */
function parseSurgeConf(content: string): ProxyNode[] {
    const nodes: ProxyNode[] = [];
    const lines = content.split('\n');

    let inProxy = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // 进入 [Proxy] 段
        if (trimmed === '[Proxy]') {
            inProxy = true;
            continue;
        }

        // 遇到下一个 [] 段，结束
        if (inProxy && trimmed.startsWith('[') && trimmed.endsWith(']')) {
            break;
        }

        if (!inProxy) continue;
        if (trimmed === '' || trimmed.startsWith('#')) continue;

        // 解析 Surge 代理行：名称 = 类型, server, port, key=value, ...
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const name = trimmed.slice(0, eqIdx).trim();
        const rest = trimmed.slice(eqIdx + 1).trim();

        // 使用 splitTopLevel 正确处理引号内的逗号
        const parts = splitTopLevel(rest, ',').map(s => s.trim());

        if (parts.length < 3) continue;

        const type = parts[0].toLowerCase();
        const server = parts[1];
        const port = parseInt(parts[2]);

        const raw: Record<string, unknown> = { name, type, server, port };

        // 解析剩余的 key=value 参数
        for (let i = 3; i < parts.length; i++) {
            const kvIdx = parts[i].indexOf('=');
            if (kvIdx !== -1) {
                const key = parts[i].slice(0, kvIdx).trim();
                let value = parts[i].slice(kvIdx + 1).trim();
                // 去掉外层引号
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                raw[key] = value;
            }
        }

        nodes.push({ name, type, raw });
    }

    return nodes;
}

// ===== 序列化函数 =====

/**
 * 将节点列表序列化为 Clash proxies YAML 格式
 */
export function nodesToClashYaml(nodes: ProxyNode[]): string {
    const lines: string[] = ['proxies:'];

    for (const node of nodes) {
        lines.push(`  - {${objectToInlineYaml(node.raw)}}`);
    }

    return lines.join('\n') + '\n';
}

function objectToInlineYaml(obj: Record<string, unknown>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined || value === null) continue;
        parts.push(`${key}: ${valueToInlineYaml(value)}`);
    }

    return parts.join(', ');
}

function valueToInlineYaml(value: unknown): string {
    if (typeof value === 'string') {
        if (value.includes(',') || value.includes('{') || value.includes('}') ||
            value.includes('[') || value.includes(']') || value.includes(':') ||
            value.includes('#') || value.includes("'") || value === '') {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(v => valueToInlineYaml(v)).join(', ')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        return `{${objectToInlineYaml(value as Record<string, unknown>)}}`;
    }
    return String(value);
}

/**
 * 将节点列表序列化为 Surge [Proxy] 段格式
 */
export function nodesToSurgeConf(nodes: ProxyNode[]): string {
    const lines: string[] = [];

    for (const node of nodes) {
        const r = node.raw;
        const params = Object.entries(r)
            .filter(([k]) => !['name', 'type', 'server', 'port'].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');

        const base = `${r['name']} = ${r['type']}, ${r['server']}, ${r['port']}`;
        lines.push(params ? `${base}, ${params}` : base);
    }

    return lines.join('\n') + '\n';
}
