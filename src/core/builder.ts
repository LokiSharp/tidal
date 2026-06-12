/**
 * Builder: 构建规则集
 *
 * 流程：
 * 1. 清理 dist/
 * 2. 复制 rules/Clash → dist/Clash（Clash YAML 为唯一规则源）
 * 3. 复制 rules/Surge → dist/Surge（配置片段）
 * 4. 遍历 rules/Clash/Provider/*.yaml → dist/Surge/Provider/*.list
 * 5. 校验 Clash/Surge Provider 文件数量一致
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { analyzeClashProvider, type ConversionWarning } from './converter.js';

export interface BuildOptions {
    /** rules 目录路径 */
    rulesDir: string;
    /** dist 输出目录路径 */
    distDir: string;
}

export interface BuildResult {
    /** 转换的文件数 */
    convertedCount: number;
    /** Surge Provider 文件数 */
    surgeCount: number;
    /** Clash Provider 文件数 */
    clashCount: number;
    /** 是否通过校验 */
    verified: boolean;
    /** 生成 Surge 时跳过的 Clash-only 规则数 */
    warningCount: number;
    /** Clash 源规则校验错误数 */
    validationErrorCount: number;
    /** Clash / Surge 主规则引用不一致数 */
    routeParityErrorCount: number;
}

/**
 * 递归查找目录下所有指定扩展名的文件
 */
async function findFiles(dir: string, ext: string): Promise<string[]> {
    const results: string[] = [];

    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            const subFiles = await findFiles(fullPath, ext);
            results.push(...subFiles);
        } else if (entry.name.endsWith(ext)) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
}

/**
 * 检查路径是否存在
 */
async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function normalizeRuleSetTarget(target: string): string {
    let candidate = target.trim();

    if (/^https?:\/\//i.test(candidate)) {
        try {
            candidate = new URL(candidate).pathname;
        } catch {
            // Keep the raw target if URL parsing fails.
        }
    }

    const lastSegment = candidate.split('/').filter(Boolean).pop() ?? candidate;

    try {
        candidate = decodeURIComponent(lastSegment);
    } catch {
        candidate = lastSegment;
    }

    return candidate.replace(/\.(yaml|yml|list)$/i, '');
}

function collectRuleSetNames(content: string): Set<string> {
    const names = new Set<string>();

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        const ruleLine = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : trimmed;
        if (!ruleLine.startsWith('RULE-SET,')) continue;

        const match = ruleLine.match(/^RULE-SET,([^,]+),/);
        if (!match) continue;

        names.add(normalizeRuleSetTarget(match[1]));
    }

    return names;
}

async function validateRuleSetParity(clashRulePath: string, surgeRulePath: string): Promise<{
    missingInSurge: string[];
    missingInClash: string[];
}> {
    const [clashContent, surgeContent] = await Promise.all([
        readFile(clashRulePath, 'utf-8'),
        readFile(surgeRulePath, 'utf-8'),
    ]);

    const clashRuleSets = collectRuleSetNames(clashContent);
    const surgeRuleSets = collectRuleSetNames(surgeContent);

    return {
        missingInSurge: [...clashRuleSets].filter((name) => !surgeRuleSets.has(name)).sort(),
        missingInClash: [...surgeRuleSets].filter((name) => !clashRuleSets.has(name)).sort(),
    };
}

/**
 * 执行完整构建流程
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
    const { rulesDir, distDir } = options;
    const clashDir = join(rulesDir, 'Clash');
    const surgeDir = join(rulesDir, 'Surge');
    const sourceClashProviderDir = join(clashDir, 'Provider');
    const distClashDir = join(distDir, 'Clash');
    const distSurgeDir = join(distDir, 'Surge');
    const clashProviderDir = join(distClashDir, 'Provider');
    const surgeProviderDir = join(distDir, 'Surge', 'Provider');
    const allWarnings: Array<{ file: string; warning: ConversionWarning }> = [];
    const validationErrors: Array<{ file: string; warning: ConversionWarning }> = [];
    const ruleSetParity = await validateRuleSetParity(
        join(clashDir, 'Rule.yaml'),
        join(surgeDir, 'Rule.conf'),
    );

    console.log('🌊 Tidal build starting...');

    // 1. 清理 dist
    if (await exists(distDir)) {
        await rm(distDir, { recursive: true });
    }
    await ensureDir(distDir);

    // 2. 复制 Clash 原始配置与 Provider
    await cp(clashDir, distClashDir, { recursive: true });

    // 3. 复制 Surge 配置片段
    await cp(surgeDir, distSurgeDir, { recursive: true });
    await rm(surgeProviderDir, { recursive: true, force: true });
    await ensureDir(surgeProviderDir);

    // 4. 从 Clash Provider 生成 Surge Provider
    const yamlFiles = [
        ...(await findFiles(sourceClashProviderDir, '.yaml')),
        ...(await findFiles(sourceClashProviderDir, '.yml')),
    ];
    let convertedCount = 0;

    for (const yamlFile of yamlFiles) {
        const relPath = relative(sourceClashProviderDir, yamlFile);
        const listRelPath = relPath.replace(/\.(yaml|yml)$/, '.list');
        const destPath = join(surgeProviderDir, listRelPath);

        await ensureDir(dirname(destPath));

        const content = await readFile(yamlFile, 'utf-8');
        const result = analyzeClashProvider(content);
        await writeFile(destPath, result.content, 'utf-8');

        for (const warning of result.warnings) {
            allWarnings.push({ file: relPath, warning });
        }
        for (const warning of result.validationErrors) {
            validationErrors.push({ file: relPath, warning });
        }

        convertedCount++;
    }

    if (validationErrors.length > 0) {
        console.error(`❌ Found ${validationErrors.length} non-Clash rules in Clash source providers`);
        for (const { file, warning } of validationErrors.slice(0, 20)) {
            console.error(`   ${file}:${warning.line} ${warning.rule} (${warning.reason})`);
        }
        if (validationErrors.length > 20) {
            console.error(`   ...and ${validationErrors.length - 20} more`);
        }
    }

    if (ruleSetParity.missingInSurge.length > 0 || ruleSetParity.missingInClash.length > 0) {
        console.error('❌ Clash / Surge rule-set parity mismatch');
        if (ruleSetParity.missingInSurge.length > 0) {
            console.error(`   Missing in Surge: ${ruleSetParity.missingInSurge.join(', ')}`);
        }
        if (ruleSetParity.missingInClash.length > 0) {
            console.error(`   Missing in Clash: ${ruleSetParity.missingInClash.join(', ')}`);
        }
    }

    console.log(`✅ Copied ${convertedCount} Clash YAML rule-sets`);
    console.log(`✅ Generated ${convertedCount} Surge list rule-sets`);

    if (allWarnings.length > 0) {
        console.warn(`⚠️  Skipped ${allWarnings.length} Clash-only rules while generating Surge providers`);
        for (const { file, warning } of allWarnings.slice(0, 20)) {
            console.warn(`   ${file}:${warning.line} ${warning.rule} (${warning.reason})`);
        }
        if (allWarnings.length > 20) {
            console.warn(`   ...and ${allWarnings.length - 20} more`);
        }
    }

    // 5. 校验
    const surgeFiles = await findFiles(surgeProviderDir, '.list');
    const clashFiles = await findFiles(clashProviderDir, '.yaml');
    const surgeCount = surgeFiles.length;
    const clashCount = clashFiles.length;
    const routeParityErrorCount =
        ruleSetParity.missingInSurge.length + ruleSetParity.missingInClash.length;
    const verified =
        surgeCount === clashCount &&
        validationErrors.length === 0 &&
        routeParityErrorCount === 0;

    if (verified) {
        console.log(`✅ File count matches: ${surgeCount} provider files`);
    } else {
        console.error(`❌ Mismatch: ${surgeCount} .list vs ${clashCount} .yaml`);
    }

    console.log(`🌊 Build complete → ${distDir}`);

    return {
        convertedCount,
        surgeCount,
        clashCount,
        verified,
        warningCount: allWarnings.length,
        validationErrorCount: validationErrors.length,
        routeParityErrorCount,
    };
}
