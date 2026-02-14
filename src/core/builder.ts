/**
 * Builder: 构建规则集（替代 build.sh）
 *
 * 流程：
 * 1. 清理 dist/
 * 2. 复制 rules/* → dist/
 * 3. 遍历 Provider/*.list → 转换为 Clash YAML → dist/Clash/Provider/
 * 4. 移动 .list → dist/Surge/Provider/
 * 5. 校验文件数量一致
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises';
import { join, relative, dirname, basename } from 'node:path';
import { listToYaml } from './converter.js';

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
    const providerDir = join(rulesDir, 'Provider');
    const clashProviderDir = join(distDir, 'Clash', 'Provider');
    const surgeProviderDir = join(distDir, 'Surge', 'Provider');

    console.log('🌊 Tidal build starting...');

    // 1. 清理 dist
    if (await exists(distDir)) {
        await rm(distDir, { recursive: true });
    }
    await ensureDir(distDir);

    // 2. 复制 rules/* → dist/
    await cp(rulesDir, distDir, { recursive: true });

    // 3. 转换 .list → .yaml
    await ensureDir(clashProviderDir);

    const listFiles = await findFiles(providerDir, '.list');
    let convertedCount = 0;

    for (const listFile of listFiles) {
        const relPath = relative(providerDir, listFile);
        const yamlRelPath = relPath.replace(/\.list$/, '.yaml');
        const destPath = join(clashProviderDir, yamlRelPath);

        await ensureDir(dirname(destPath));

        const content = await readFile(listFile, 'utf-8');
        const yamlContent = listToYaml(content);
        await writeFile(destPath, yamlContent, 'utf-8');

        convertedCount++;
    }

    // 4. 移动 .list → dist/Surge/Provider/
    const distProviderDir = join(distDir, 'Provider');
    await ensureDir(surgeProviderDir);

    if (await exists(distProviderDir)) {
        await cp(distProviderDir, surgeProviderDir, { recursive: true });
        await rm(distProviderDir, { recursive: true });
    }

    console.log(`✅ Generated ${convertedCount} Clash YAML rule-sets`);

    // 5. 校验
    const surgeFiles = await findFiles(surgeProviderDir, '.list');
    const clashFiles = await findFiles(clashProviderDir, '.yaml');
    const surgeCount = surgeFiles.length;
    const clashCount = clashFiles.length;
    const verified = surgeCount === clashCount;

    if (verified) {
        console.log(`✅ File count matches: ${surgeCount} provider files`);
    } else {
        console.error(`❌ Mismatch: ${surgeCount} .list vs ${clashCount} .yaml`);
    }

    console.log(`🌊 Build complete → ${distDir}`);

    return { convertedCount, surgeCount, clashCount, verified };
}
