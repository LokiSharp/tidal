/**
 * Converter: .list (Surge) ↔ .yaml (Clash) 格式互转
 */

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
    const lines = yamlContent.split('\n');
    const listLines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // 跳过 payload: 头和空行
        if (trimmed === '' || trimmed === 'payload:') continue;

        // YAML 注释 → .list 注释
        if (trimmed.startsWith('#')) {
            listLines.push(trimmed);
        }
        // YAML 列表项 → .list 行
        else if (trimmed.startsWith('- ')) {
            listLines.push(trimmed.slice(2));
        }
    }

    return listLines.join('\n') + '\n';
}
