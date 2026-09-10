import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

/**
 * kebab-case, snake_case を PascalCase に変換
 */
export function toPascalCase(str) {
    return str
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

/**
 * microCMSのフィールド定義をOpenAPIスキーマにマッピング
 */
export function mapFieldToSchema(field, currentEndpoint, registeredCustomFields, referencedModels, fallbackFieldHints = {}) {
    const schema = {};

    // 説明文の組み立て（name, description, isUnique, imageSize, dateFormat などの付加情報）
    const descParts = [];
    if (field.name) descParts.push(field.name);
    if (field.description) descParts.push(field.description);
    if (field.isUnique) descParts.push('※一意な値');
    if (field.dateFormat) descParts.push('※日付のみ指定 (時刻は00:00:00 UTC)');
    if (field.imageSizeValidation?.imageSize) {
        const { width, height } = field.imageSizeValidation.imageSize;
        descParts.push(`推奨サイズ: ${width}x${height}px`);
    }

    // リッチエディタのカスタムクラス一覧
    if (field.customClassList && field.customClassList.length > 0) {
        schema['x-custom-classes'] = field.customClassList.map((c) => ({
            name: c.name,
            value: c.value,
        }));
        const classNames = field.customClassList.map((c) => `${c.value} (${c.name})`).join(', ');
        descParts.push(`カスタムクラス: ${classNames}`);
    }

    if (descParts.length > 0) {
        schema.description = descParts.join(' - ');
    }

    // 初期値 (initialValue) のハンドリング
    // microCMS特有の ["DEFAULT"] や空文字プレースホルダーは除外
    if (
        field.initialValue !== null &&
        field.initialValue !== undefined &&
        !(Array.isArray(field.initialValue) && field.initialValue.includes('DEFAULT')) &&
        !(typeof field.initialValue === 'string' && field.initialValue === '')
    ) {
        schema.default = field.initialValue;
    }

    // 任意項目の場合、API未入力時に null が返り得るフィールドには nullable: true を設定
    if (!field.required) {
        schema.nullable = true;
    }

    switch (field.kind) {
        case 'text':
        case 'textArea': {
            schema.type = 'string';
            if (field.textSizeLimitValidation?.textSize) {
                const { min, max } = field.textSizeLimitValidation.textSize;
                if (typeof min === 'number') schema.minLength = min;
                if (typeof max === 'number') schema.maxLength = max;
            }
            if (field.patternMatchValidation?.regex) {
                schema.pattern = field.patternMatchValidation.regex;
            }
            break;
        }

        case 'richEditor':
        case 'richEditorV2':
            schema.type = 'string';
            schema.description = (schema.description ? schema.description + ' ' : '') + '(HTML)';
            break;

        case 'number': {
            schema.type = 'number';
            if (field.numberSizeLimitValidation?.numberSize) {
                const { min, max } = field.numberSizeLimitValidation.numberSize;
                if (typeof min === 'number') schema.minimum = min;
                if (typeof max === 'number') schema.maximum = max;
            }
            break;
        }

        case 'boolean':
            schema.type = 'boolean';
            delete schema.nullable; // boolean は未入力時 false がデフォルトで入る
            if (schema.default === undefined) {
                schema.default = false;
            }
            break;

        case 'date':
            schema.type = 'string';
            schema.format = 'date-time';
            break;

        case 'select': {
            const enumValues = Array.isArray(field.selectItems)
                ? field.selectItems.map((item) => (typeof item === 'object' && item !== null ? item.value ?? item.name : item))
                : [];

            // microCMS公式仕様: 単一選択であってもAPIレスポンスは配列 (["val"])
            schema.type = 'array';
            schema.items = {
                type: 'string',
                ...(enumValues.length > 0 ? { enum: enumValues } : {}),
            };
            if (!field.multipleSelect) {
                schema.maxItems = 1; // 単一選択は最大1件
            }
            if (schema.default === undefined) {
                schema.default = [];
            }
            delete schema.nullable; // select は空の場合 [] になるため nullable 不要
            break;
        }

        case 'media':
            // 共通スキーマ MicroCMSImage への参照
            if (!field.required) {
                schema.allOf = [{ $ref: '#/components/schemas/MicroCMSImage' }];
                delete schema.type;
            } else {
                schema.$ref = '#/components/schemas/MicroCMSImage';
            }
            break;

        case 'mediaList':
            schema.type = 'array';
            schema.items = { $ref: '#/components/schemas/MicroCMSImage' };
            if (schema.default === undefined) {
                schema.default = [];
            }
            delete schema.nullable; // mediaList は未入力時 []
            break;

        case 'file':
            // ファイルフィールド
            if (!field.required) {
                schema.allOf = [{ $ref: '#/components/schemas/MicroCMSFile' }];
                delete schema.type;
            } else {
                schema.$ref = '#/components/schemas/MicroCMSFile';
            }
            break;

        case 'relation': {
            const refEndpoint = field.referencedApiEndpoint || 'relation';
            const refModel = toPascalCase(refEndpoint);
            referencedModels.add(refModel);
            if (field.listViewFieldId) {
                fallbackFieldHints[refModel] = field.listViewFieldId;
            }
            // relation は未入力時常に null が返る
            schema.allOf = [{ $ref: `#/components/schemas/${refModel}` }];
            schema.nullable = true;
            delete schema.type;
            break;
        }

        case 'relationList': {
            schema.type = 'array';
            const refEndpoint = field.referencedApiEndpoint || 'relation';
            const refModel = toPascalCase(refEndpoint);
            referencedModels.add(refModel);
            if (field.listViewFieldId) {
                fallbackFieldHints[refModel] = field.listViewFieldId;
            }
            schema.items = { $ref: `#/components/schemas/${refModel}` };

            if (field.relationListCountLimitValidation?.relationListCount) {
                const { min, max } = field.relationListCountLimitValidation.relationListCount;
                if (typeof min === 'number') schema.minItems = min;
                if (typeof max === 'number') schema.maxItems = max;
            }
            if (schema.default === undefined) {
                schema.default = [];
            }
            delete schema.nullable; // relationList は未入力時 []
            break;
        }

        case 'customField': {
            // 単一カスタムフィールド（Object）
            const cfIds = field.customFieldIds || [];
            if (cfIds.length === 1) {
                const targetId = cfIds[0];
                const key = `${currentEndpoint}_${targetId}`;
                const cfModel = registeredCustomFields[key] || registeredCustomFields[targetId];
                if (cfModel) {
                    schema.allOf = [{ $ref: `#/components/schemas/${cfModel}` }];
                } else {
                    schema.type = 'object';
                }
            } else if (cfIds.length > 1) {
                schema.oneOf = cfIds.map((targetId) => {
                    const key = `${currentEndpoint}_${targetId}`;
                    const cfModel = registeredCustomFields[key] || registeredCustomFields[targetId];
                    return cfModel
                        ? { $ref: `#/components/schemas/${cfModel}` }
                        : { type: 'object' };
                });
                schema.discriminator = { propertyName: 'fieldId' };
            } else {
                schema.type = 'object';
            }
            break;
        }

        case 'repeater': {
            // 繰り返しフィールド（Array）
            schema.type = 'array';
            const cfIds = field.customFieldIds || [];

            if (cfIds.length === 1) {
                const targetId = cfIds[0];
                const key = `${currentEndpoint}_${targetId}`;
                const cfModel = registeredCustomFields[key] || registeredCustomFields[targetId];
                schema.items = cfModel
                    ? { $ref: `#/components/schemas/${cfModel}` }
                    : { type: 'object' };
            } else if (cfIds.length > 1) {
                schema.items = {
                    oneOf: cfIds.map((targetId) => {
                        const key = `${currentEndpoint}_${targetId}`;
                        const cfModel = registeredCustomFields[key] || registeredCustomFields[targetId];
                        return cfModel
                            ? { $ref: `#/components/schemas/${cfModel}` }
                            : { type: 'object' };
                    }),
                    discriminator: { propertyName: 'fieldId' },
                };
            } else {
                schema.items = { type: 'object' };
            }

            // repeaterCountLimitValidation の反映
            if (field.repeaterCountLimitValidation?.repeaterCount) {
                const { min, max } = field.repeaterCountLimitValidation.repeaterCount;
                if (typeof min === 'number') schema.minItems = min;
                if (typeof max === 'number') schema.maxItems = max;
            }
            break;
        }

        default:
            schema.type = 'string';
            break;
    }

    return schema;
}

/**
 * OpenAPI ドキュメントの基本骨格を生成
 */
export function createBaseDoc(config = {}) {
    const serviceId = config.serviceId;
    let serverUrl;
    let serverVariables = undefined;

    if (config.url) {
        serverUrl = serviceId
            ? config.url.replace('{your-service-id}', serviceId).replace('{serviceId}', serviceId)
            : config.url;
        if (!serviceId && serverUrl.includes('{your-service-id}')) {
            serverVariables = {
                'your-service-id': { default: 'your-service' },
            };
        }
    } else if (serviceId) {
        serverUrl = `https://${serviceId}.microcms.io/api/v1`;
    } else {
        serverUrl = 'https://{your-service-id}.microcms.io/api/v1';
        serverVariables = {
            'your-service-id': { default: 'your-service' },
        };
    }

    const serverItem = {
        url: serverUrl,
        description: 'microCMS Content API',
    };
    if (serverVariables) {
        serverItem.variables = serverVariables;
    }

    return {
        openapi: '3.0.3',
        info: {
            title: config.title || 'microCMS API',
            version: config.version || '1.0.0',
            description: config.description || 'Auto-generated OpenAPI spec from microCMS schemas',
        },
        servers: config.servers || [serverItem],
        paths: {},
        components: {
            securitySchemes: {
                XApiKey: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-MICROCMS-API-KEY',
                },
            },
            schemas: {
                MicroCMSContentBase: {
                    type: 'object',
                    properties: {
                        createdAt: { type: 'string', format: 'date-time', description: '作成日時 (UTC)' },
                        updatedAt: { type: 'string', format: 'date-time', description: '更新日時 (UTC)' },
                        publishedAt: { type: 'string', format: 'date-time', nullable: true, description: '公開日時 (UTC)' },
                        revisedAt: { type: 'string', format: 'date-time', nullable: true, description: '改訂日時 (UTC)' },
                    },
                    required: ['createdAt', 'updatedAt'],
                },
                MicroCMSImage: {
                    type: 'object',
                    description: 'microCMS 画像オブジェクト',
                    properties: {
                        url: { type: 'string', format: 'uri', description: '画像URL' },
                        height: { type: 'integer', nullable: true, description: '画像の高さ (px)' },
                        width: { type: 'integer', nullable: true, description: '画像の幅 (px)' },
                        alt: { type: 'string', nullable: true, description: '代替テキスト' },
                    },
                    required: ['url'],
                },
                MicroCMSFile: {
                    type: 'object',
                    description: 'microCMS ファイルオブジェクト',
                    properties: {
                        url: { type: 'string', format: 'uri', description: 'ファイルURL' },
                        fileSize: { type: 'integer', description: 'ファイルサイズ (Bytes)' },
                    },
                    required: ['url'],
                },
                MicroCMSError: {
                    type: 'object',
                    description: 'microCMS エラーレスポンス',
                    properties: {
                        message: { type: 'string', description: 'エラーメッセージ' },
                    },
                    required: ['message'],
                },
            },
            parameters: {
                limitParam: {
                    name: 'limit',
                    in: 'query',
                    description: '取得件数 (0〜100)',
                    schema: { type: 'integer', minimum: 0, maximum: 100, default: 10 },
                },
                offsetParam: {
                    name: 'offset',
                    in: 'query',
                    description: '取得開始位置 (0以上)',
                    schema: { type: 'integer', minimum: 0, default: 0 },
                },
                depthParam: {
                    name: 'depth',
                    in: 'query',
                    description: 'リレーション展開の深さ (0〜3)',
                    schema: { type: 'integer', minimum: 0, maximum: 3, default: 1 },
                },
                ordersParam: {
                    name: 'orders',
                    in: 'query',
                    description: '並び順 (例: -publishedAt, publishedAt,-updatedAt, system:default)',
                    schema: { type: 'string' },
                },
                qParam: {
                    name: 'q',
                    in: 'query',
                    description: 'キーワード検索（複数フィールドを対象とした全文検索）',
                    schema: { type: 'string' },
                },
                fieldsParam: {
                    name: 'fields',
                    in: 'query',
                    description: '取得するフィールドの絞り込み（カンマ区切り、例: title,main_image,author.name）',
                    schema: { type: 'string' },
                },
                filtersParam: {
                    name: 'filters',
                    in: 'query',
                    description: '条件絞り込み (equals, not_equals, contains, not_contains, less_than, greater_than, exists, not_exists, begins_with, [and], [or])',
                    schema: { type: 'string' },
                },
                idsParam: {
                    name: 'ids',
                    in: 'query',
                    description: '複数コンテンツIDのカンマ区切りリスト (最大50件)',
                    schema: { type: 'string' },
                },
                draftKeyParam: {
                    name: 'draftKey',
                    in: 'query',
                    description: '下書きプレビュー用キー',
                    schema: { type: 'string' },
                },
                richEditorFormatParam: {
                    name: 'richEditorFormat',
                    in: 'query',
                    description: '旧リッチエディタの出力形式',
                    schema: { type: 'string', enum: ['html', 'object'], default: 'html' },
                },
            },
            responses: {
                BadRequest: {
                    description: 'リクエストパラメータ不正',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/MicroCMSError' } } },
                },
                Unauthorized: {
                    description: 'APIキー不正・未設定',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/MicroCMSError' } } },
                },
                NotFound: {
                    description: 'コンテンツが見つかりません（または非公開・下書き）',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/MicroCMSError' } } },
                },
                TooManyRequests: {
                    description: 'APIレート制限超過',
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/MicroCMSError' } } },
                },
            },
        },
        security: [{ XApiKey: [] }],
    };
}

/**
 * スキーマファイルを読み込みOpenAPI仕様オブジェクトを構築
 */
export function generateOpenApi(targetFiles, config = {}) {
    const rootDoc = createBaseDoc(config);
    const registeredCustomFields = {};
    const referencedModels = new Set();
    const fallbackFieldHints = {};
    const usedCustomFieldKeys = new Set();
    const parsedFiles = [];

    const commonHeaders = {
        'x-current-date-time': {
            description: 'サーバー時刻 (ISO 8601 UTC)',
            schema: { type: 'string', format: 'date-time' },
        },
    };

    const commonErrorResponses = {
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { $ref: '#/components/responses/NotFound' },
        '429': { $ref: '#/components/responses/TooManyRequests' },
    };

    // 1パス目: ファイル名の判定・パース・カスタムフィールドの収集
    for (const filePath of targetFiles) {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const fileName = path.basename(filePath);

        // ファイル名規則:
        // xxx.object.json -> オブジェクト形式 (endpoint: xxx)
        // xxx.json        -> リスト形式 (endpoint: xxx)
        let isObject = fileName.endsWith('.object.json');
        let endpoint = isObject
            ? fileName.slice(0, -'.object.json'.length)
            : fileName.slice(0, -'.json'.length);

        let modelName = toPascalCase(endpoint);
        let displayName = endpoint;

        // config.json によるオーバーライド適用
        const endpointConfig = config.endpoints?.[endpoint];
        if (endpointConfig) {
            if (endpointConfig.type) {
                isObject = endpointConfig.type === 'object';
            }
            if (endpointConfig.modelName) {
                modelName = endpointConfig.modelName;
            } else if (endpointConfig.alias) {
                modelName = toPascalCase(endpointConfig.alias);
            }
            if (endpointConfig.displayName) {
                displayName = endpointConfig.displayName;
            }
        }

        parsedFiles.push({ endpoint, modelName, displayName, isObject, content, endpointConfig });

        // カスタムフィールドのインデックス化
        for (const cf of content.customFields || []) {
            const cfModelName = `CustomField_${modelName}_${toPascalCase(cf.fieldId)}`;
            registeredCustomFields[`${endpoint}_${cf.fieldId}`] = cfModelName;
            if (!registeredCustomFields[cf.fieldId]) {
                registeredCustomFields[cf.fieldId] = cfModelName;
            }
        }

        // 実際に利用されている customFieldIds を再帰的にマーク
        function collectUsedCfIds(fields = []) {
            for (const f of fields) {
                if ((f.kind === 'repeater' || f.kind === 'customField') && f.customFieldIds) {
                    for (const id of f.customFieldIds) {
                        const fullKey = `${endpoint}_${id}`;
                        if (!usedCustomFieldKeys.has(fullKey)) {
                            usedCustomFieldKeys.add(fullKey);
                            usedCustomFieldKeys.add(id);

                            // ネストされたカスタムフィールドがあれば再帰探索
                            const matchedCf = (content.customFields || []).find((c) => c.fieldId === id);
                            if (matchedCf && matchedCf.fields) {
                                collectUsedCfIds(matchedCf.fields);
                            }
                        }
                    }
                }
            }
        }

        collectUsedCfIds(content.apiFields);
    }

    // 2パス目: 実際に使用されている customFields のみスキーマ生成
    for (const item of parsedFiles) {
        for (const cf of item.content.customFields || []) {
            const key = `${item.endpoint}_${cf.fieldId}`;
            if (!usedCustomFieldKeys.has(key) && !usedCustomFieldKeys.has(cf.fieldId)) {
                continue;
            }

            const cfModelName = registeredCustomFields[key] || registeredCustomFields[cf.fieldId];
            if (rootDoc.components.schemas[cfModelName]) continue;

            const cfProps = {};
            const cfRequired = ['fieldId'];

            for (const f of cf.fields || []) {
                cfProps[f.fieldId] = mapFieldToSchema(
                    f,
                    item.endpoint,
                    registeredCustomFields,
                    referencedModels,
                    fallbackFieldHints
                );
                if (f.required) cfRequired.push(f.fieldId);
            }

            rootDoc.components.schemas[cfModelName] = {
                type: 'object',
                description: cf.name || cf.fieldId,
                properties: {
                    fieldId: {
                        type: 'string',
                        enum: [cf.fieldId],
                        description: 'カスタムフィールド識別子',
                    },
                    ...cfProps,
                },
                required: cfRequired,
            };
        }
    }

    // 3パス目: メインモデル・エンドポイント生成
    for (const item of parsedFiles) {
        const { endpoint, modelName, displayName, isObject, content, endpointConfig } = item;
        const pathEndpoint = endpointConfig?.alias || endpoint;
        const apiFields = content.apiFields || [];
        const userProperties = {};
        const requiredFields = [];

        for (const field of apiFields) {
            userProperties[field.fieldId] = mapFieldToSchema(
                field,
                endpoint,
                registeredCustomFields,
                referencedModels,
                fallbackFieldHints
            );
            if (field.required) requiredFields.push(field.fieldId);
        }

        if (!isObject) {
            // リスト形式
            rootDoc.components.schemas[modelName] = {
                allOf: [
                    { $ref: '#/components/schemas/MicroCMSContentBase' },
                    {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'コンテンツID' },
                            ...userProperties,
                        },
                        required: ['id', ...requiredFields],
                    },
                ],
            };

            rootDoc.components.schemas[`${modelName}ListResponse`] = {
                type: 'object',
                description: `${displayName} 一覧レスポンス`,
                properties: {
                    contents: {
                        type: 'array',
                        items: { $ref: `#/components/schemas/${modelName}` },
                    },
                    totalCount: { type: 'integer', description: '該当コンテンツの総件数' },
                    offset: { type: 'integer', description: '現在の取得オフセット' },
                    limit: { type: 'integer', description: '1ページあたりの取得件数' },
                },
                required: ['contents', 'totalCount', 'offset', 'limit'],
            };

            // 一覧取得
            rootDoc.paths[`/${pathEndpoint}`] = {
                get: {
                    tags: [displayName],
                    summary: `${displayName} 一覧取得`,
                    operationId: `list${modelName}`,
                    parameters: [
                        { $ref: '#/components/parameters/limitParam' },
                        { $ref: '#/components/parameters/offsetParam' },
                        { $ref: '#/components/parameters/depthParam' },
                        { $ref: '#/components/parameters/ordersParam' },
                        { $ref: '#/components/parameters/qParam' },
                        { $ref: '#/components/parameters/fieldsParam' },
                        { $ref: '#/components/parameters/filtersParam' },
                        { $ref: '#/components/parameters/idsParam' },
                        { $ref: '#/components/parameters/draftKeyParam' },
                        { $ref: '#/components/parameters/richEditorFormatParam' },
                    ],
                    responses: {
                        '200': {
                            description: '一覧取得成功',
                            headers: commonHeaders,
                            content: {
                                'application/json': {
                                    schema: { $ref: `#/components/schemas/${modelName}ListResponse` },
                                },
                            },
                        },
                        ...commonErrorResponses,
                    },
                },
            };

            // 詳細取得
            rootDoc.paths[`/${pathEndpoint}/{contentId}`] = {
                get: {
                    tags: [displayName],
                    summary: `${displayName} 詳細取得`,
                    operationId: `get${modelName}ById`,
                    parameters: [
                        { name: 'contentId', in: 'path', required: true, schema: { type: 'string' }, description: 'コンテンツID' },
                        { $ref: '#/components/parameters/draftKeyParam' },
                        { $ref: '#/components/parameters/fieldsParam' },
                        { $ref: '#/components/parameters/depthParam' },
                        { $ref: '#/components/parameters/richEditorFormatParam' },
                    ],
                    responses: {
                        '200': {
                            description: '詳細取得成功',
                            headers: commonHeaders,
                            content: {
                                'application/json': {
                                    schema: { $ref: `#/components/schemas/${modelName}` },
                                },
                            },
                        },
                        ...commonErrorResponses,
                    },
                },
            };
        } else {
            // オブジェクト形式
            rootDoc.components.schemas[modelName] = {
                allOf: [
                    { $ref: '#/components/schemas/MicroCMSContentBase' },
                    {
                        type: 'object',
                        properties: userProperties,
                        ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
                    },
                ],
            };

            rootDoc.paths[`/${pathEndpoint}`] = {
                get: {
                    tags: [displayName],
                    summary: `${displayName} 取得 (オブジェクト形式)`,
                    operationId: `get${modelName}`,
                    parameters: [
                        { $ref: '#/components/parameters/draftKeyParam' },
                        { $ref: '#/components/parameters/fieldsParam' },
                        { $ref: '#/components/parameters/depthParam' },
                        { $ref: '#/components/parameters/richEditorFormatParam' },
                    ],
                    responses: {
                        '200': {
                            description: '取得成功',
                            headers: commonHeaders,
                            content: {
                                'application/json': {
                                    schema: { $ref: `#/components/schemas/${modelName}` },
                                },
                            },
                        },
                        ...commonErrorResponses,
                    },
                },
            };
        }

        console.log(`- 解析完了: ${endpoint} -> /${pathEndpoint} (${isObject ? 'オブジェクト形式' : 'リスト形式'})`);
    }

    // 4パス目: 参照先モデル（未定義エンドポイント）のフォールバック生成
    for (const refModel of referencedModels) {
        if (!rootDoc.components.schemas[refModel]) {
            const hintField = fallbackFieldHints[refModel] || 'title';
            rootDoc.components.schemas[refModel] = {
                allOf: [
                    { $ref: '#/components/schemas/MicroCMSContentBase' },
                    {
                        type: 'object',
                        description: `参照先 [${refModel}] のフォールバック定義`,
                        properties: {
                            id: { type: 'string', description: 'コンテンツID' },
                            [hintField]: { type: 'string', description: `${hintField} (推測)` },
                        },
                        required: ['id'],
                    },
                ],
            };
            console.log(`- 参照先スキーマを自動フォールバック補完: ${refModel} (表示名フィールド: ${hintField})`);
        }
    }

    return rootDoc;
}

// CLI実行部
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
    let parsedCli;
    try {
        parsedCli = parseArgs({
            args: process.argv.slice(2),
            options: {
                schemas: { type: 'string', short: 's' },
                output: { type: 'string', short: 'o' },
                config: { type: 'string', short: 'c' },
                help: { type: 'boolean', short: 'h' },
            },
            allowPositionals: true,
        });
    } catch {
        parsedCli = { values: {}, positionals: process.argv.slice(2).filter((arg) => !arg.startsWith('--')) };
    }

    if (parsedCli.values?.help) {
        console.log(`
使用方法:
  node generate-openapi.mjs [options] [schemas_dir] [output_file]

オプション:
  -s, --schemas <dir>    microCMSスキーマJSONの格納ディレクトリ (デフォルト: ./schemas)
  -o, --output <file>    出力先OpenAPI YAMLファイル (デフォルト: openapi.yaml)
  -c, --config <file>    設定ファイル (デフォルト: ./microcms.config.json があれば自動読込)
  -h, --help             ヘルプを表示
`);
        process.exit(0);
    }

    const schemasDir = parsedCli.values?.schemas || parsedCli.positionals?.[0] || './schemas';
    const outputFile = parsedCli.values?.output || parsedCli.positionals?.[1] || 'openapi.yaml';
    const configPath = parsedCli.values?.config || (fs.existsSync('./microcms.config.json') ? './microcms.config.json' : null);

    let config = {};
    if (configPath && fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            console.log(`設定ファイルを読み込みました: ${configPath}`);
        } catch (e) {
            console.warn(`設定ファイルの読み込みに失敗しました (${configPath}):`, e.message);
        }
    }

    const resolvedPath = path.resolve(schemasDir);
    let targetFiles = [];

    if (!fs.existsSync(resolvedPath)) {
        console.error(`エラー: パスが見つかりません: ${schemasDir}`);
        process.exit(1);
    }

    if (fs.statSync(resolvedPath).isDirectory()) {
        targetFiles = fs
            .readdirSync(resolvedPath)
            .filter((file) => file.endsWith('.json'))
            .map((file) => path.join(resolvedPath, file));
    } else if (resolvedPath.endsWith('.json')) {
        targetFiles = [resolvedPath];
    }

    const rootDoc = generateOpenApi(targetFiles, config);
    const yamlStr = YAML.stringify(rootDoc);
    fs.writeFileSync(outputFile, yamlStr, 'utf-8');

    console.log(`\n🎉 OpenAPI仕様の統合出力が完了しました: ${outputFile}`);
}
