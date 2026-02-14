/**
 * 配置合并器：将模板 + 节点 + 规则拼装成完整的 Clash / Surge 配置
 *
 * Clash 完整配置 = Head (通用设置) + proxies (节点) + proxy-groups + rules + rule-providers
 * Surge 完整配置 = [General] + [Proxy] + [Proxy Group] + [Rule] + [Host] + [MITM]
 */

import type { ProxyNode } from './parser.js';
import { nodesToClashYaml, nodesToSurgeConf } from './parser.js';

/** GitHub Pages 模板基础 URL */
const TEMPLATE_BASE = 'https://lokisharp.github.io/tidal';

/** Clash 模板名到文件的映射 */
const CLASH_HEAD_MAP: Record<string, string> = {
    dns: 'Clash/Head_dns.yaml',
    tun: 'Clash/Head_tun.yaml',
    tap: 'Clash/Head_tap.yaml',
};

// ===== 代理组定义 =====

/** 代理组名称列表（节点选择组都引用这些） */
const PROXY_GROUP_NAMES = [
    'Transit', 'Netflix', 'Disney Plus', 'YouTube', 'Max', 'Spotify',
    'Asian TV', 'Global TV', 'CN Mainland TV', 'Apple TV', 'Apple',
    'Telegram', 'Crypto', 'Discord', 'Google FCM', 'Microsoft',
    'AI Suite', 'PayPal', 'Scholar', 'Speedtest', 'Steam', 'TikTok',
    'miHoYo', 'Domestic', 'Others',
] as const;

/** 需要 REJECT 的策略组 */
const REJECT_GROUPS = ['AdBlock', 'HTTPDNS'];

/**
 * 生成 Clash proxy-groups YAML
 */
function generateClashProxyGroups(nodeNames: string[]): string {
    const lines: string[] = ['proxy-groups:'];
    const allProxies = nodeNames.map(n => `"${n}"`).join(', ');

    // 节点选择（手动）
    lines.push(`  - name: "🚀 节点选择"`);
    lines.push(`    type: select`);
    lines.push(`    proxies: [${allProxies}, DIRECT]`);

    // 自动选择（延迟最低）
    lines.push(`  - name: "♻️ 自动选择"`);
    lines.push(`    type: url-test`);
    lines.push(`    proxies: [${allProxies}]`);
    lines.push(`    url: 'http://www.gstatic.com/generate_204'`);
    lines.push(`    interval: 300`);

    // REJECT 组
    for (const name of REJECT_GROUPS) {
        lines.push(`  - name: "${name}"`);
        lines.push(`    type: select`);
        lines.push(`    proxies: [REJECT, DIRECT]`);
    }

    // 各策略组：可选 节点选择/自动选择/各节点/DIRECT
    for (const name of PROXY_GROUP_NAMES) {
        lines.push(`  - name: "${name}"`);
        lines.push(`    type: select`);
        lines.push(`    proxies: ["🚀 节点选择", "♻️ 自动选择", ${allProxies}, DIRECT]`);
    }

    return lines.join('\n') + '\n';
}

/**
 * 生成 Surge [Proxy Group] 段
 */
function generateSurgeProxyGroups(nodeNames: string[]): string {
    const lines: string[] = ['[Proxy Group]'];
    const allNodes = nodeNames.join(', ');

    lines.push(`🚀 节点选择 = select, ${allNodes}, DIRECT`);
    lines.push(`♻️ 自动选择 = url-test, ${allNodes}, url=http://www.gstatic.com/generate_204, interval=300`);

    for (const name of REJECT_GROUPS) {
        lines.push(`${name} = select, REJECT, DIRECT`);
    }

    for (const name of PROXY_GROUP_NAMES) {
        lines.push(`${name} = select, 🚀 节点选择, ♻️ 自动选择, ${allNodes}, DIRECT`);
    }

    return lines.join('\n') + '\n';
}

/**
 * 拉取模板文件
 */
async function fetchTemplate(path: string): Promise<string> {
    const url = `${TEMPLATE_BASE}/${path}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch template ${path}: ${res.status}`);
    }
    return res.text();
}

/**
 * 组装完整的 Clash 配置
 */
export async function assembleClashConfig(
    nodes: ProxyNode[],
    template: string = 'dns',
): Promise<string> {
    const headPath = CLASH_HEAD_MAP[template];
    if (!headPath) {
        throw new Error(`Unknown Clash template: ${template}. Available: ${Object.keys(CLASH_HEAD_MAP).join(', ')}`);
    }

    // 并行拉取模板
    const [head, rule] = await Promise.all([
        fetchTemplate(headPath),
        fetchTemplate('Clash/Rule.yaml'),
    ]);

    const nodeNames = nodes.map(n => n.name);
    const proxiesYaml = nodesToClashYaml(nodes);
    const proxyGroups = generateClashProxyGroups(nodeNames);

    // 拼装：Head + proxies + proxy-groups + rules
    return [
        head.trimEnd(),
        '',
        proxiesYaml.trimEnd(),
        '',
        proxyGroups.trimEnd(),
        '',
        'rules:',
        rule.trimEnd(),
        '',
    ].join('\n');
}

/**
 * 组装完整的 Surge 配置
 */
export async function assembleSurgeConfig(
    nodes: ProxyNode[],
): Promise<string> {
    // 并行拉取模板
    const [head, rule, mitm] = await Promise.all([
        fetchTemplate('Surge/Head.conf'),
        fetchTemplate('Surge/Rule.conf'),
        fetchTemplate('Surge/MitM.conf'),
    ]);

    const nodeNames = nodes.map(n => n.name);
    const proxiesConf = nodesToSurgeConf(nodes);
    const proxyGroups = generateSurgeProxyGroups(nodeNames);

    // Surge Rule.conf 的 [Rule] 部分需要提取出来
    // Rule.conf 直接以 RULE-SET 开头，后面跟 [Host] 段
    const ruleSection = '[Rule]\n' + rule.trimEnd();

    // 拼装
    return [
        head.trimEnd(),
        '',
        '[Proxy]',
        proxiesConf.trimEnd(),
        '',
        proxyGroups.trimEnd(),
        '',
        ruleSection,
        '',
        mitm.trimEnd(),
        '',
    ].join('\n');
}
