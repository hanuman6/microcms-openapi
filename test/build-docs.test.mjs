import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

test('build-docs generates dist/api.html with plain Redoc template', () => {
    const htmlPath = path.resolve('dist/api.html');

    // build:docs を実行
    execSync('node build-docs.mjs --engine redoc', { stdio: 'pipe' });

    assert.ok(fs.existsSync(htmlPath), 'dist/api.html が生成されていること');

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    // Redoc standalone CDN と init 呼び出しが含まれていること
    assert.match(htmlContent, /redoc\.standalone\.js/, 'Redoc standalone JS が含まれていること');
    assert.match(htmlContent, /<div id="redoc-container"><\/div>/, 'redoc-container 要素が存在すること');
    assert.match(htmlContent, /Redoc\.init\(spec,/, 'Redoc.init が呼ばれていること');
    assert.match(htmlContent, /office-cue|microCMS/, 'APIタイトルが含まれていること');
    assert.match(htmlContent, /スキーマ定義|Schemas/, 'スキーマ定義タグが含まれていること');
    assert.match(htmlContent, /SchemaDefinition/, 'SchemaDefinitionコンポーネントが含まれていること');
});
