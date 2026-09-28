import test from 'node:test';
import assert from 'node:assert/strict';
import { toPascalCase, mapFieldToSchema, generateOpenApi, createBaseDoc } from '../generate-openapi.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('toPascalCase converts snake_case and kebab-case', () => {
    assert.equal(toPascalCase('user_profile'), 'UserProfile');
    assert.equal(toPascalCase('user-profile'), 'UserProfile');
    assert.equal(toPascalCase('works'), 'Works');
});

test('mapFieldToSchema: select field produces array even when multipleSelect is false (microCMS spec)', () => {
    const singleSelectField = {
        fieldId: 'category',
        name: 'カテゴリ',
        kind: 'select',
        multipleSelect: false,
        selectItems: [{ value: 'tech' }, { value: 'life' }],
        required: true,
    };

    const schema = mapFieldToSchema(singleSelectField, 'test', {}, new Set());
    assert.equal(schema.type, 'array');
    assert.equal(schema.maxItems, 1);
    assert.deepEqual(schema.items.enum, ['tech', 'life']);
    assert.deepEqual(schema.default, []);

    const multiSelectField = {
        fieldId: 'tags',
        name: 'タグ',
        kind: 'select',
        multipleSelect: true,
        selectItems: [{ value: 'js' }, { value: 'ts' }],
        required: false,
    };

    const multiSchema = mapFieldToSchema(multiSelectField, 'test', {}, new Set());
    assert.equal(multiSchema.type, 'array');
    assert.equal(multiSchema.maxItems, undefined);
    assert.deepEqual(multiSchema.items.enum, ['js', 'ts']);
});

test('mapFieldToSchema: customField produces object whereas repeater produces array', () => {
    const customFieldsMap = {
        test_blockA: 'CustomField_Test_BlockA',
    };

    const singleCf = {
        fieldId: 'block',
        kind: 'customField',
        customFieldIds: ['blockA'],
        required: true,
    };

    const singleSchema = mapFieldToSchema(singleCf, 'test', customFieldsMap, new Set());
    assert.equal(singleSchema.type, undefined);
    assert.deepEqual(singleSchema.allOf, [{ $ref: '#/components/schemas/CustomField_Test_BlockA' }]);

    const repeaterCf = {
        fieldId: 'blocks',
        kind: 'repeater',
        customFieldIds: ['blockA'],
        repeaterCountLimitValidation: {
            repeaterCount: { min: 1, max: 5 },
        },
        required: true,
    };

    const repeaterSchema = mapFieldToSchema(repeaterCf, 'test', customFieldsMap, new Set());
    assert.equal(repeaterSchema.type, 'array');
    assert.deepEqual(repeaterSchema.items, { $ref: '#/components/schemas/CustomField_Test_BlockA' });
    assert.equal(repeaterSchema.minItems, 1);
    assert.equal(repeaterSchema.maxItems, 5);
});

test('mapFieldToSchema: media and file use common components', () => {
    const mediaField = {
        fieldId: 'thumbnail',
        name: 'サムネイル',
        kind: 'media',
        required: true,
        imageSizeValidation: { imageSize: { width: 800, height: 600 } },
    };

    const mediaSchema = mapFieldToSchema(mediaField, 'test', {}, new Set());
    assert.equal(mediaSchema.$ref, '#/components/schemas/MicroCMSImage');
    assert.match(mediaSchema.description, /800x600px/);

    const fileField = {
        fieldId: 'attachment',
        name: '添付ファイル',
        kind: 'file',
        required: true,
    };

    const fileSchema = mapFieldToSchema(fileField, 'test', {}, new Set());
    assert.equal(fileSchema.$ref, '#/components/schemas/MicroCMSFile');
});

test('mapFieldToSchema: relation has nullable: true for unrequired/null returns', () => {
    const refModels = new Set();
    const relationField = {
        fieldId: 'author',
        name: '著者',
        kind: 'relation',
        referencedApiEndpoint: 'authors',
        required: false,
    };

    const schema = mapFieldToSchema(relationField, 'test', {}, refModels);
    assert.equal(schema.nullable, true);
    assert.deepEqual(schema.allOf, [{ $ref: '#/components/schemas/Authors' }]);
    assert.ok(refModels.has('Authors'));
});

test('mapFieldToSchema: extracts customClassList and dateFormat metadata', () => {
    const richField = {
        fieldId: 'content',
        name: '本文',
        kind: 'richEditorV2',
        required: true,
        customClassList: [
            { name: 'ハイライト', value: 'highlight' },
            { name: '文字強調', value: 'textLarge' },
        ],
    };

    const schema = mapFieldToSchema(richField, 'test', {}, new Set());
    assert.ok(schema['x-custom-classes']);
    assert.equal(schema['x-custom-classes'].length, 2);
    assert.match(schema.description, /highlight \(ハイライト\)/);

    const dateField = {
        fieldId: 'launch',
        name: 'ローンチ時期',
        kind: 'date',
        dateFormat: true,
        required: true,
    };

    const dateSchema = mapFieldToSchema(dateField, 'test', {}, new Set());
    assert.match(dateSchema.description, /日付のみ指定/);
});

test('generateOpenApi integration with config and custom endpoints', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'microcms-test-'));
    const testNoticeSchema = {
        apiType: 'list',
        fields: [
            { fieldId: 'title', name: 'タイトル', kind: 'text', required: true },
            { fieldId: 'body', name: '本文', kind: 'textArea', required: false },
        ],
    };
    const testWorkSchema = {
        apiType: 'list',
        fields: [
            { fieldId: 'title', name: 'タイトル', kind: 'text', required: true },
        ],
    };

    const fileNotice = path.join(tmpDir, '2w26g39c3ibq.json');
    const fileWorks = path.join(tmpDir, 'works.json');
    fs.writeFileSync(fileNotice, JSON.stringify(testNoticeSchema), 'utf-8');
    fs.writeFileSync(fileWorks, JSON.stringify(testWorkSchema), 'utf-8');

    const targetFiles = [fileNotice, fileWorks];

    const config = {
        serviceId: 'test-service',
        endpoints: {
            '2w26g39c3ibq': {
                alias: 'notices',
                modelName: 'Notice',
                displayName: 'お知らせ',
                type: 'list',
            },
        },
    };

    const doc = generateOpenApi(targetFiles, config);

    // 基本情報検証
    assert.equal(doc.openapi, '3.0.3');
    assert.equal(doc.servers[0].url, 'https://test-service.microcms.io/api/v1');

    // 未設定時はテンプレート形式になることの検証
    const defaultDoc = createBaseDoc({});
    assert.equal(defaultDoc.servers[0].url, 'https://{your-service-id}.microcms.io/api/v1');
    assert.equal(defaultDoc.servers[0].variables['your-service-id'].default, 'your-service');

    // 共通モデル
    assert.ok(doc.components.schemas.MicroCMSImage);
    assert.ok(doc.components.schemas.MicroCMSFile);
    assert.ok(doc.components.schemas.MicroCMSError);
    assert.ok(doc.components.parameters.depthParam);
    assert.ok(doc.components.parameters.idsParam);
    assert.ok(doc.components.parameters.draftKeyParam);

    // エイリアス適用検証 (/notices)
    assert.ok(doc.paths['/notices']);
    assert.ok(doc.paths['/notices/{contentId}']);
    assert.equal(doc.paths['/notices'].get.operationId, 'listNotice');
    assert.equal(doc.paths['/notices/{contentId}'].get.operationId, 'getNoticeById');

    // レスポンスヘッダーおよびエラーステータス検証
    const listResp = doc.paths['/notices'].get.responses;
    assert.ok(listResp['200'].headers['x-current-date-time']);
    assert.ok(listResp['400']);
    assert.ok(listResp['401']);
    assert.ok(listResp['404']);
    assert.ok(listResp['429']);

    // works の operationId
    assert.ok(doc.paths['/works']);
    assert.equal(doc.paths['/works'].get.operationId, 'listWorks');
    assert.equal(doc.paths['/works/{contentId}'].get.operationId, 'getWorksById');

    // 後片付け
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mapFieldToSchema: relation and relationList include referencedApiEndpoint and field name metadata', () => {
    const endpointContext = {
        endpoints: new Map([
            [
                'sites',
                {
                    displayName: 'サイトマスタ',
                    modelName: 'Sites',
                    fieldsMap: new Map([
                        ['title', { fieldId: 'title', name: 'サイト名' }],
                    ]),
                },
            ],
        ]),
        customFields: new Map(),
    };

    const relationField = {
        fieldId: 'site',
        name: '所属サイト',
        kind: 'relation',
        referencedApiEndpoint: 'sites',
        listViewFieldId: 'title',
        required: false,
    };

    const schemaSingle = mapFieldToSchema(relationField, 'test', {}, new Set(), {}, endpointContext);
    assert.equal(schemaSingle['x-referenced-api-endpoint'], 'sites');
    assert.equal(schemaSingle['x-referenced-api-name'], 'サイトマスタ');
    assert.equal(schemaSingle['x-list-view-field-id'], 'title');
    assert.equal(schemaSingle['x-list-view-field-name'], 'サイト名');
    assert.match(schemaSingle.description, /参照先API: sites \(サイトマスタ\)/);
    assert.match(schemaSingle.description, /参照フィールド: title \(サイト名\)/);

    const relationListField = {
        fieldId: 'sites',
        name: '掲載先一覧',
        kind: 'relationList',
        referencedApiEndpoint: 'sites',
        listViewFieldId: 'title',
        required: true,
    };

    const schemaList = mapFieldToSchema(relationListField, 'test', {}, new Set(), {}, endpointContext);
    assert.equal(schemaList['x-referenced-api-endpoint'], 'sites');
    assert.equal(schemaList['x-referenced-api-name'], 'サイトマスタ');
    assert.equal(schemaList['x-list-view-field-id'], 'title');
    assert.equal(schemaList['x-list-view-field-name'], 'サイト名');
    assert.match(schemaList.description, /参照先API: sites \(サイトマスタ\)/);
    assert.match(schemaList.description, /参照フィールド: title \(サイト名\)/);
});

test('mapFieldToSchema: repeater and customField include referenced customField names', () => {
    const endpointContext = {
        endpoints: new Map(),
        customFields: new Map([
            ['test_blockA', { fieldId: 'blockA', name: 'ブロックA' }],
            ['blockA', { fieldId: 'blockA', name: 'ブロックA' }],
        ]),
    };

    const repeaterField = {
        fieldId: 'blocks',
        name: 'ブロックリスト',
        kind: 'repeater',
        customFieldIds: ['blockA'],
        required: true,
    };

    const schema = mapFieldToSchema(
        repeaterField,
        'test',
        { test_blockA: 'CustomField_Test_BlockA' },
        new Set(),
        {},
        endpointContext
    );
    assert.deepEqual(schema['x-custom-field-ids'], ['blockA']);
    assert.deepEqual(schema['x-custom-field-names'], ['ブロックA']);
    assert.match(schema.description, /参照カスタムフィールド: ブロックA \(blockA\)/);
});

test('generateOpenApi: registers all customFields in components.schemas even when unreferenced', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'microcms-cf-test-'));
    const bannerSchema = {
        apiType: 'list',
        apiFields: [
            { fieldId: 'title', name: 'タイトル', kind: 'text', required: true },
        ],
        customFields: [
            {
                fieldId: 'unreferenced_cf',
                name: '未参照カスタムフィールド',
                fields: [
                    { fieldId: 'subTitle', name: 'サブタイトル', kind: 'text', required: false },
                ],
            },
        ],
    };

    const file = path.join(tmpDir, 'banners.json');
    fs.writeFileSync(file, JSON.stringify(bannerSchema), 'utf-8');

    const doc = generateOpenApi([file], {});
    assert.ok(
        doc.components.schemas.CustomField_Banners_UnreferencedCf,
        '未参照のカスタムフィールドもcomponents.schemasに登録されること'
    );
    const cfSchema = doc.components.schemas.CustomField_Banners_UnreferencedCf;
    assert.equal(cfSchema['x-custom-field-id'], 'unreferenced_cf');
    assert.equal(cfSchema['x-custom-field-name'], '未参照カスタムフィールド');
    assert.ok(cfSchema.properties.subTitle);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});
