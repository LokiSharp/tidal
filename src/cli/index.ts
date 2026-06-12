#!/usr/bin/env node

/**
 * Tidal CLI - 代理规则管理工具
 *
 * 用法：
 *   npx tsx src/cli/index.ts build          构建规则集
 *   npx tsx src/cli/index.ts convert <file> 单文件转换（调试用）
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { build } from '../core/builder.js';
import { listToYaml, yamlToListWithDiagnostics } from '../core/converter.js';

const { positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
});

const command = positionals[0];

async function main() {
    switch (command) {
        case 'build': {
            const projectRoot = resolve(import.meta.dirname, '..', '..');
            const result = await build({
                rulesDir: resolve(projectRoot, 'rules'),
                distDir: resolve(projectRoot, 'dist'),
            });

            if (!result.verified) {
                process.exit(1);
            }
            break;
        }

        case 'convert': {
            const filePath = positionals[1];
            if (!filePath) {
                console.error('用法: tidal convert <file>');
                console.error('  将 .list 转为 .yaml，或将 .yaml 转为 .list');
                process.exit(1);
            }

            const absPath = resolve(filePath);
            const content = await readFile(absPath, 'utf-8');

            if (absPath.endsWith('.list')) {
                const yaml = listToYaml(content);
                const outPath = absPath.replace(/\.list$/, '.yaml');
                await writeFile(outPath, yaml, 'utf-8');
                console.log(`✅ ${basename(absPath)} → ${basename(outPath)}`);
            } else if (absPath.endsWith('.yaml') || absPath.endsWith('.yml')) {
                const result = yamlToListWithDiagnostics(content);
                const outPath = absPath.replace(/\.(yaml|yml)$/, '.list');
                await writeFile(outPath, result.content, 'utf-8');
                console.log(`✅ ${basename(absPath)} → ${basename(outPath)}`);

                if (result.warnings.length > 0) {
                    console.warn(`⚠️  跳过 ${result.warnings.length} 条 Surge 不兼容规则`);
                    for (const warning of result.warnings.slice(0, 20)) {
                        console.warn(`   L${warning.line}: ${warning.rule} (${warning.reason})`);
                    }
                    if (result.warnings.length > 20) {
                        console.warn(`   ...还有 ${result.warnings.length - 20} 条`);
                    }
                }
            } else {
                console.error('不支持的文件格式，只支持 .list 和 .yaml');
                process.exit(1);
            }
            break;
        }

        default:
            console.log(`🌊 Tidal - 代理规则管理工具

用法:
  npx tsx src/cli/index.ts <command>

命令:
  build      构建规则集（Clash YAML → Surge list）
  convert    单文件格式转换
`);
            break;
    }
}

main().catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
