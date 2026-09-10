import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

// 引数解析
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        input: { type: 'string', short: 'i', default: 'openapi.yaml' },
        output: { type: 'string', short: 'o', default: 'dist/api.html' },
        engine: { type: 'string', short: 'e', default: 'redoc' }, // 'redoc' (デフォルト) | 'scalar'
        serve: { type: 'boolean', short: 's', default: false },
        port: { type: 'string', short: 'p', default: '3000' },
        help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
});

if (values.help) {
    console.log(`
使用方法:
  node build-docs.mjs [options]

オプション:
  -i, --input <file>     入力OpenAPI YAMLファイル (デフォルト: openapi.yaml)
  -o, --output <file>    出力先HTMLファイル (デフォルト: dist/api.html)
  -e, --engine <engine>  UIエンジン 'redoc' または 'scalar' (デフォルト: redoc)
  -s, --serve            内蔵ローカルサーバーでプレビュー起動
  -p, --port <number>    サーバーポート番号 (デフォルト: 3000)
  -h, --help             ヘルプを表示
`);
    process.exit(0);
}

const inputFile = path.resolve(values.input);
const outputFile = path.resolve(values.output);
const engine = values.engine.toLowerCase();

if (!fs.existsSync(inputFile)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${values.input}`);
    process.exit(1);
}

const yamlContent = fs.readFileSync(inputFile, 'utf-8');
const specJson = YAML.parse(yamlContent);
const title = specJson.info?.title || 'microCMS API Documentation';

let html = '';

if (engine === 'redoc') {
    // Redoc テンプレート (参考サイトと同じプレーンなRedoc構成・インラインスペック)
    html = `<!DOCTYPE html>
<html>

<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <!-- needed for adaptive design -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      padding: 0;
      margin: 0;
    }
  </style>
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
</head>

<body>
  <div id="redoc-container"></div>
  <script src="https://cdn.redocly.com/redoc/v2.5.3/bundles/redoc.standalone.js"></script>
  <script>
    const spec = ${JSON.stringify(specJson)};
    Redoc.init(spec, {
      scrollYOffset: 0
    }, document.getElementById('redoc-container'));
  </script>
</body>

</html>`;
} else {
    // Scalar テンプレート (デフォルト: モダン、高速、インタラクティブAPIクライアント内蔵)
    html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script id="api-reference" type="application/json">
      ${JSON.stringify(specJson)}
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}

// 出力ディレクトリ作成 & 保存
const outDir = path.dirname(outputFile);
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outputFile, html, 'utf-8');
console.log(`✨ ドキュメントHTMLを生成しました (${engine}): ${path.relative(process.cwd(), outputFile)}`);

// YAMLを同じdistディレクトリにもコピー（動的取得を行いたい場合用）
const distYaml = path.join(outDir, 'openapi.yaml');
fs.copyFileSync(inputFile, distYaml);
console.log(`📄 openapi.yaml をコピーしました: ${path.relative(process.cwd(), distYaml)}`);

// ローカルプレビューサーバー
if (values.serve) {
    const port = parseInt(values.port, 10) || 3000;
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.yaml': 'text/yaml; charset=utf-8',
        '.yml': 'text/yaml; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
    };

    const server = http.createServer((req, res) => {
        const reqPath = req.url.split('?')[0];
        let filePath = reqPath === '/' ? outputFile : path.join(outDir, reqPath);

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = outputFile;
        }

        const ext = path.extname(filePath);
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        try {
            const content = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(port, () => {
        console.log(`\n🚀 プレビューサーバーを起動しました: http://localhost:${port}`);
        console.log(`   停止するには Ctrl+C を押してください\n`);
    });
}
