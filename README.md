# microCMS to OpenAPI & Documentation Generator

microCMS の管理画面からエクスポートしたスキーマ JSON（**無加工**）を読み込み、OpenAPI 3.0 仕様（YAML）およびプレーンな Redoc HTML ドキュメント（`dist/api.html`）を自動生成するツールキットです。

---

## 目次

- [特徴](#特徴)
- [前提条件と運用の流れ](#前提条件と運用の流れ)
- [インストール](#インストール)
- [利用可能なコマンド](#利用可能なコマンド)
  - [主要な npm スクリプト](#主要な-npm-スクリプト)
  - [CLI オプション詳細](#cli-オプション詳細)
- [設定ファイル (microcms.config.json) の書き方](#設定ファイル-microcmsconfigjson-の書き方)
  - [設定項目一覧](#設定項目一覧)
  - [設定例](#設定例)
  - [エンドポイント個別設定 (endpoints)](#エンドポイント個別設定-endpoints)
- [出力ファイルと公開方法](#出力ファイルと公開方法)
- [ディレクトリ構成](#ディレクトリ構成)
- [対応仕様・型マッピング詳細](#対応仕様型マッピング詳細)

---

## 特徴

- **無加工の JSON をそのまま配置**: `schemas/` 配下に microCMS からエクスポートした JSON を置くだけで自動解析（JSON を手作業で編集する必要はありません）。
- **公式仕様完全準拠**:
  - `select` フィールドの配列出力（単一選択時でも microCMS 仕様どおり `type: array, maxItems: 1`）
  - `customField`（単一オブジェクト）と `repeater`（配列）の分離
  - 未入力リレーションの `nullable: true`
  - **コンテンツ参照 / 複数コンテンツ参照（`relation` / `relationList`）**:
    - 参照先エンドポイント（`referencedApiEndpoint`）および表示名（`x-referenced-api-endpoint`, `x-referenced-api-name`）を YAML に明記。
    - 参照先表示フィールド（`listViewFieldId`）およびそのフィールド名（`x-list-view-field-id`, `x-list-view-field-name`）も自動解決して記載。
  - **カスタムフィールド（`customFields`）の全集約と参照情報の記載**:
    - 未参照のものも含め、スキーマで定義されている全カスタムフィールドを `components.schemas` に集約出力。
    - フィールド側でカスタムフィールドを参照（`customField` / `repeater`）している場合、参照先カスタムフィールドの `name` や ID（`x-custom-field-ids`, `x-custom-field-names`）を記載。
  - 画像（`media`: `url`, `width`, `height`, `alt`）およびファイル（`file`: `url`, `fileSize`）
  - 各種バリデーション（`minItems`/`maxItems`、推奨画像サイズ、日付形式、カスタム CSS クラスなど）
  - 公式クエリパラメータ（`depth`, `ids`, `draftKey`, `limit`, `offset`, `filters` など）
  - 公式共通エラーモデル（400, 401, 404, 429）およびヘッダー（`x-current-date-time`）
- **プレーンな HTML ドキュメント (`dist/api.html`)**:
  - 他社 API リファレンスと同様の **Redoc** による見やすい 3 カラム構成。
  - 単一ファイル完結（インラインスペック型）のため、サーバーへ `api.html` を 1 つ配置するだけで動作（CORS 制限なし）。
- **設定カスタマイズ対応**:
  - `microcms.config.json` によりサービス ID の URL 反映や、自動採番エンドポイント（例: `2w26g39c3ibq` → `/notices`）のエイリアス定義が可能。

---

## 前提条件と運用の流れ

1. **microCMS からスキーマをエクスポート**
   - microCMS 管理画面の「API設定」>「エクスポート」から、各 API の JSON 定義をダウンロードします。
2. **`schemas/` ディレクトリに配置**
   - ダウンロードした JSON ファイル群を `./schemas/` 配下にそのまま配置します（**ファイルの中身は一切変更不要**です）。
3. **`microcms.config.json` を編集（任意）**
   - サービス ID やエンドポイントの表示名・エイリアスを設定します。
4. **ビルドを実行**
   - `npm run build` を実行すると、`openapi.yaml` と `dist/api.html` が出力されます。
5. **公開・確認**
   - `npm run preview` でローカル確認、または `dist/api.html` を Web サーバーにアップロードして公開します。

---

## インストール

```bash
pnpm install
# または
npm install
```

---

## 利用可能なコマンド

### 主要な npm スクリプト

| コマンド | 説明 | 主な用途 |
| :--- | :--- | :--- |
| **`npm run build`** | `openapi.yaml` と `dist/api.html` を一括生成（推奨） | 日常のビルド・デプロイ前 |
| **`npm run generate`** | `schemas/` の JSON から `openapi.yaml` を生成 | YAML 仕様書のみ作成・更新したい場合 |
| **`npm run build:docs`** | 既存の `openapi.yaml` から `dist/api.html` を生成 | HTML ドキュメントのみ再生成したい場合 |
| **`npm run preview`** | 内蔵ローカルサーバー（ポート 3000）でドキュメントを表示 | ブラウザでの表示確認（`http://localhost:3000`） |
| **`npm test`** | スキーマ変換ロジックおよび HTML 生成のテストを実行 | 仕様準拠の動作確認 |

### CLI オプション詳細

#### 1. OpenAPI 生成スクリプト (`generate-openapi.mjs`)
直接 `node` コマンドで引数を指定することも可能です。

```bash
node generate-openapi.mjs [options] [schemas_dir] [output_file]
```

- `-s, --schemas <dir>`: スキーマ JSON の格納ディレクトリ（デフォルト: `./schemas`）
- `-o, --output <file>`: 出力先 YAML ファイル名（デフォルト: `openapi.yaml`）
- `-c, --config <file>`: 設定ファイルパス（デフォルト: `./microcms.config.json` があれば自動読込）
- `-h, --help`: ヘルプを表示

*例:*
```bash
# 特定のスキーマフォルダと出力先を指定
node generate-openapi.mjs -s ./my-schemas -o ./docs/swagger.yaml -c ./custom-config.json
```

#### 2. ドキュメント生成スクリプト (`build-docs.mjs`)

```bash
node build-docs.mjs [options]
```

- `-i, --input <file>`: 入力 OpenAPI YAML ファイル（デフォルト: `openapi.yaml`）
- `-o, --output <file>`: 出力先 HTML ファイル（デフォルト: `dist/api.html`）
- `-e, --engine <engine>`: レンダリングエンジン（デフォルト: `redoc`、`scalar` も選択可）
- `-s, --serve`: 内蔵ローカルサーバーを同時に起動
- `-p, --port <number>`: サーバーのポート番号（デフォルト: `3000`）
- `-h, --help`: ヘルプを表示

*例:*
```bash
# ポート8080でプレビューサーバーを起動
node build-docs.mjs --serve --port 8080
```

---

## 設定ファイル (`microcms.config.json`) の書き方

プロジェクトルートに `microcms.config.json` を配置することで、API 全体の基本情報や、microCMS 特有のエンドポイント命名を直感的な名前に上書きできます。

### 設定項目一覧

| フィールド | 型 | 必須 | 説明 | デフォルト |
| :--- | :---: | :---: | :--- | :--- |
| **`serviceId`** | `string` | 推奨 | microCMS のサービス ID。指定すると `servers` の URL が `https://{serviceId}.microcms.io/api/v1` に展開されます。 | `your-service` |
| **`title`** | `string` | 任意 | API 仕様書のタイトル。 | `microCMS API` |
| **`description`** | `string` | 任意 | API 仕様書の概要説明文（Markdown 対応）。 | 自動生成の説明文 |
| **`version`** | `string` | 任意 | API のバージョン表記。 | `1.0.0` |
| **`url`** | `string` | 任意 | サーバー URL を独自ドメインなどに完全カスタムしたい場合に指定。 | - |
| **`endpoints`** | `object` | 任意 | 各 API スキーマのパスやモデル名、表示名の上書き設定。 | 自動推定 |

### 設定例

```json
{
  "serviceId": "hogehoge",
  "title": "hogehogeサイト microCMS Content API",
  "description": "microCMS スキーマから自動生成された OpenAPI 仕様書です。",
  "version": "1.0.0",
  "endpoints": {
    "blogs": {
      "alias": "notes",
      "modelName": "Notes",
      "displayName": "ノート",
      "type": "list"
    },
    "category": {
      "alias": "categories",
      "displayName": "カテゴリ"
    }
  }
}
```

### エンドポイント個別設定 (`endpoints`)

microCMS で自動採番された API エンドポイント（例: `2w26g39c3ibq`）や、パス名を複数形に変えたい場合に指定します。

キーには **スキーマ JSON のファイル名（拡張子なし）** を指定します。

| 設定キー | 型 | 説明 |
| :--- | :---: | :--- |
| `alias` | `string` | OpenAPI のパス名。例えば `"alias": "notes"` とすると、`/notes`（一覧）および `/notes/{contentId}`（詳細）になります。 |
| `modelName` | `string` | TypeScript や OpenAPI で使用されるスキーマ型名（PascalCase 推奨）。例: `"Notes"` とすると、単体は `NoNotestice`、一覧レスポンスは `NotesListResponse` になります。 |
| `displayName` | `string` | ドキュメントのタグや Summary に使われる日本語名称。例: `"お知らせ"` とすると、タグが `お知らせ` になり、サマリーが `お知らせ 一覧取得` になります。 |
| `type` | `"list" \| "object"` | API の形式。未指定時は JSON スキーマから自動判定されますが、明示的に上書きも可能です。 |

> [!TIP]
> `microcms.config.json` が存在しない、または特定の API が未定義の場合でも、ファイル名からパスや型名を自動推定して生成するため、設定なし（ゼロコンフィグ）でも動作します。

---

## 出力ファイルと公開方法

`npm run build` を実行すると、以下のファイルが生成されます。

- **`dist/api.html`** (Web サーバー配信用)
  - Redoc standalone CDN と OpenAPI スペック（JSON）をインライン埋め込みした**自己完結型 HTML** です。
  - **このファイル 1 つを Apache, Nginx, S3, Firebase Hosting などの任意の Web サーバーにアップロードするだけで、API ドキュメントとしてそのまま公開できます**。
  - 外部の YAML ファイルを動的 fetch しないため、CORS エラーや相対パスの解決失敗が起こりません。
- **`dist/openapi.yaml` / `openapi.yaml`**
  - OpenAPI 3.0.3 準拠の仕様ファイルです。
  - `openapi-typescript` や `orval` などを用いたフロントエンド・アプリ側での TypeScript 型定義生成や、Postman / Swagger UI へのインポートに利用できます。

---

## ディレクトリ構成

```text
.
├── schemas/                # microCMS からエクスポートした JSON ファイル群 (無加工で配置)
│   ├── categories.json
│   ├── news.json
│   ├── players.json
│   └── ...
├── dist/                   # ビルド出力ディレクトリ
│   ├── api.html            # サーバー配信用 HTML ドキュメント (Redoc)
│   └── openapi.yaml        # 配信用 YAML コピー
├── test/                   # 単体テストコード (npm test)
│   ├── generate.test.mjs
│   └── build-docs.test.mjs
├── generate-openapi.mjs    # スキーマ変換スクリプト
├── build-docs.mjs          # HTML ドキュメントビルドスクリプト
├── microcms.config.json    # プロジェクト個別設定ファイル
├── openapi.yaml            # ルートに出力された OpenAPI 仕様書
├── package.json
└── README.md
```

---

## 対応仕様・型マッピング詳細

| microCMS フィールド種別 (`kind`) | OpenAPI 型マッピング | 備考 |
| :--- | :--- | :--- |
| `text`, `textArea`, `richEditorV2` | `string` | リッチエディタのカスタムクラスは `x-custom-classes` に抽出 |
| `number` | `number` / `integer` | 最大値・最小値バリデーションを反映 |
| `boolean` | `boolean` | デフォルト値（`true`/`false`）を反映 |
| `date` | `string` (`format: date-time`) | 日付のみフラグがある場合は説明文に注記 |
| `select` | `array` | 単一選択時は `maxItems: 1`、候補値を `enum` に設定 |
| `media` (画像) | `$ref: '#/components/schemas/MicroCMSImage'` | `url`, `width`, `height`, `alt` |
| `file` (ファイル) | `$ref: '#/components/schemas/MicroCMSFile'` | `url`, `fileSize` |
| `relation` | `$ref: '#/components/schemas/{ReferencedModel}'` | 未入力時 `nullable: true`、参照先API（`x-referenced-api-endpoint`, `x-referenced-api-name`）および表示フィールド（`x-list-view-field-id`, `x-list-view-field-name`）を記載 |
| `relationList` | `array` (`items: { $ref: '...' }`) | 未入力時 `[]`、件数バリデーション（`minItems`/`maxItems`）反映、参照先API・フィールド情報を記載 |
| `customField` (単一) | `$ref: '#/components/schemas/CustomField_...'` | 単一オブジェクトとして展開、参照カスタムフィールド名（`x-custom-field-names`）を記載 |
| `repeater` (複数) | `array` (`items: { oneOf: [...] }`) | `discriminator`（`fieldId`）付き判別共用体、参照カスタムフィールド名（`x-custom-field-names`）を記載 |
