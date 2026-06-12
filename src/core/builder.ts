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
import { validateClashProvider, yamlToListWithDiagnostics, type ConversionWarning } from './converter.js';

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
        for (const warning of validateClashProvider(content)) {
            validationErrors.push({ file: relPath, warning });
        }

        const result = yamlToListWithDiagnostics(content);
        await writeFile(destPath, result.content, 'utf-8');

        for (const warning of result.warnings) {
            allWarnings.push({ file: relPath, warning });
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
    const verified = surgeCount === clashCount && validationErrors.length === 0;

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
    };
}
