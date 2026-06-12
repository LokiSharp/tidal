/**
 * Converter: .list (Surge) ↔ .yaml (Clash) 格式互转
 */

export interface ConversionWarning {
    line: number;
    rule: string;
    reason: string;
}

export interface YamlToListResult {
    content: string;
    warnings: ConversionWarning[];
}

const SURGE_RULE_TYPES = new Set([
    'DOMAIN',
    'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD',
    'IP-CIDR',
    'IP-CIDR6',
    'GEOIP',
    'PROCESS-NAME',
    'USER-AGENT',
    'URL-REGEX',
    'SRC-IP',
    'IN-PORT',
    'DEST-PORT',
    'PROTOCOL',
    'SCRIPT',
    'RULE-SET',
    'DOMAIN-SET',
    'AND',
    'OR',
    'NOT',
    'FINAL',
]);

const CLASH_ONLY_RULE_TYPES = new Set([
    'DOMAIN-WILDCARD',
    'DOMAIN-REGEX',
    'GEOSITE',
    'IP-SUFFIX',
    'IP-ASN',
    'SRC-GEOIP',
    'SRC-IP-ASN',
    'SRC-IP-CIDR',
    'SRC-IP-SUFFIX',
    'SRC-PORT',
    'IN-TYPE',
    'IN-USER',
    'IN-NAME',
    'PROCESS-PATH',
    'PROCESS-PATH-WILDCARD',
    'PROCESS-PATH-REGEX',
    'PROCESS-NAME-WILDCARD',
    'PROCESS-NAME-REGEX',
    'UID',
    'DSCP',
    'SUB-RULE',
    'MATCH',
]);

const CLASH_RULE_TYPES = new Set([
    'DOMAIN',
    'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD',
    'DOMAIN-WILDCARD',
    'DOMAIN-REGEX',
    'GEOSITE',
    'IP-CIDR',
    'IP-CIDR6',
    'IP-SUFFIX',
    'IP-ASN',
    'GEOIP',
    'SRC-GEOIP',
    'SRC-IP-ASN',
    'SRC-IP-CIDR',
    'SRC-IP-SUFFIX',
    'DST-PORT',
    'SRC-PORT',
    'IN-PORT',
    'IN-TYPE',
    'IN-USER',
    'IN-NAME',
    'PROCESS-PATH',
    'PROCESS-PATH-WILDCARD',
    'PROCESS-PATH-REGEX',
    'PROCESS-NAME',
    'PROCESS-NAME-WILDCARD',
    'PROCESS-NAME-REGEX',
    'UID',
    'NETWORK',
    'DSCP',
    'RULE-SET',
    'AND',
    'OR',
    'NOT',
    'SUB-RULE',
    'MATCH',
]);

/**
 * 将 Surge .list 格式转换为 Clash payload YAML 格式
 *
 * .list 格式示例：
 *   # > Telegram
 *   DOMAIN-SUFFIX,telegram.org
 *   IP-CIDR,91.108.4.0/22,no-resolve
 *
 * 生成的 .yaml 格式：
 *   payload:
 *     # > Telegram
 *     - DOMAIN-SUFFIX,telegram.org
 *     - IP-CIDR,91.108.4.0/22,no-resolve
 */
export function listToYaml(listContent: string): string {
    const lines = listContent.split('\n');
    const yamlLines: string[] = ['payload:'];

    for (const line of lines) {
        const trimmed = line.trim();

        // 跳过空行
        if (trimmed === '') continue;

        // 注释行保留为 YAML 注释
        if (trimmed.startsWith('#')) {
            yamlLines.push(`  ${trimmed}`);
        } else if (trimmed.startsWith('//')) {
            yamlLines.push(`  # ${trimmed.slice(2).trimStart()}`);
        } else {
            yamlLines.push(`  - ${trimmed}`);
        }
    }

    return yamlLines.join('\n') + '\n';
}

/**
 * 将 Clash payload YAML 格式转换回 Surge .list 格式
 */
export function yamlToList(yamlContent: string): string {
    return yamlToListWithDiagnostics(yamlContent).content;
}

/**
 * 将 Clash payload YAML 格式转换回 Surge .list 格式，并报告 Surge 不兼容规则。
 */
export function yamlToListWithDiagnostics(yamlContent: string): YamlToListResult {
    const lines = yamlContent.split('\n');
    const listLines: string[] = [];
    const warnings: ConversionWarning[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 跳过 payload: 头和空行
        if (trimmed === '' || trimmed === 'payload:') continue;

        // YAML 注释 → .list 注释
        if (trimmed.startsWith('#')) {
            listLines.push(trimmed);
        }
        // YAML 列表项 → .list 行
        else if (trimmed.startsWith('- ')) {
            const rule = unquoteYamlScalar(trimmed.slice(2).trim());
            const converted = toSurgeRule(rule);

            if (converted.rule) {
                listLines.push(converted.rule);
            } else {
                warnings.push({
                    line: i + 1,
                    rule,
                    reason: converted.reason,
                });
            }
        }
    }

    return {
        content: listLines.join('\n') + '\n',
        warnings,
    };
}

/**
 * 校验 Clash/Mihomo payload YAML 中是否混入非 Clash 规则类型。
 */
export function validateClashProvider(yamlContent: string): ConversionWarning[] {
    const warnings: ConversionWarning[] = [];
    const lines = yamlContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed.startsWith('- ')) continue;

        const rule = unquoteYamlScalar(trimmed.slice(2).trim());
        const type = getRuleType(rule);

        if (!CLASH_RULE_TYPES.has(type)) {
            warnings.push({
                line: i + 1,
                rule,
                reason: `${type || 'unknown'} is not supported by Clash/Mihomo in this converter`,
            });
        }
    }

    return warnings;
}

function unquoteYamlScalar(value: string): string {
    if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

function toSurgeRule(rule: string): { rule?: string; reason: string } {
    const type = getRuleType(rule);
    const commaIdx = rule.indexOf(',');
    const rest = commaIdx === -1 ? '' : rule.slice(commaIdx);

    if (type === 'DST-PORT') {
        return { rule: `DEST-PORT${rest}`, reason: '' };
    }

    if (type === 'NETWORK') {
        const value = rest.slice(1).trim().toUpperCase();
        if (value === 'TCP' || value === 'UDP') {
            return { rule: `PROTOCOL,${value}`, reason: '' };
        }
    }

    if (SURGE_RULE_TYPES.has(type)) {
        return { rule, reason: '' };
    }

    if (CLASH_ONLY_RULE_TYPES.has(type)) {
        return { reason: `${type} is only supported by Clash/Mihomo in this converter` };
    }

    return { reason: `${type || 'unknown'} is not recognized by this converter` };
}

function getRuleType(rule: string): string {
    const commaIdx = rule.indexOf(',');
    return (commaIdx === -1 ? rule : rule.slice(0, commaIdx)).trim().toUpperCase();
}
