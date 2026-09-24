---
title: サーバー側の画像の検証(アップロードと画像エントリ)の上限と、境界値のテストの作り方
aliases:
  - サーバー側の画像の検証
  - 画像の検証の上限
  - 境界値の WebP の作り方
tags:
  - docs
  - validation
  - webp
  - emdash
source_task: "[[T11-server-validation]]"
created: 2026-09-24
updated: 2026-09-24
---

# サーバー側の画像の検証(アップロードと画像エントリ)の上限と、境界値のテストの作り方

> [!summary] 要点
> - `src/server/validate.ts` は、仕様書 8 章の①(アップロード用ルート)と②(`b64_images` の保存 hook)で使う純粋な関数。失敗は例外ではなく `{ ok: false, code, reason, message, details }` で返す。呼び出し側が、ルートでは `PluginRouteError`、保存 hook では `ContentSaveRejectedError` に変換する。
> - EmDash 0.39.1 の保存 hook は、`ContentSaveRejectedError` 以外の例外を投げると、メッセージを隠した `CONTENT_HOOK_ERROR` にする。根拠: **公式ドキュメントのみ**
> - 管理画面は、フィールドの型を見ずに widget を割り当てる。保存時の検証は zod の結果を捨て、元のデータを保存する。そのため保存先は「このプラグインの widget」に加えて「`json` 型」も確かめる。根拠: **公式ドキュメントのみ**
> - 正しい data URL の長さは 23 + 4k で、WebP 全体のバイト数は偶数になる。上限 100,000 の前後の正しい data URL は 99,999 と 100,003。実際の WebP を `XMP ` チャンクで伸ばして作った(dwebp でデコードでき、webpinfo の警告もない)。根拠: **実測のみ**
> - 単色の 4096 × 4096 の画像は、可逆の WebP で 706 バイトになる。バイト数の上限とは別に、寸法の上限が要る。根拠: **実測のみ**
> - 固定上限の入力(data URL 499,999 文字 + サムネイル 7,999 文字)で、ルートの検証全体(JSON の parse・スキーマ・①・②)は中央値 0.40ms(`fromBase64`)/ 0.93ms(`atob`)。新しいプロセスでの 1 回目は 1.9ms / 3.1ms。Workers Free の CPU 時間 10ms より小さい。根拠: **実測のみ**(Node 26)
> - 関連: [[T11-server-validation]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8 章]]、[[webp-data-url-validation]](T04 の data URL と WebP の検査)、[[emdash-plugin-route-errors]]

## 作ったもの

| export | 使う場所 | 内容 |
|---|---|---|
| `validateUpload(input, collection)` | ① アップロード用ルート([[T18-upload-route\|T18]]) | 保存先を確かめてから、そのフィールドの options で画像本体とサムネイルを確かめる |
| `validateImageEntry(value)` | ② `b64_images` の `content:beforeSave`([[T19-image-entry-hook\|T19]]) | 画像エントリの値を、固定上限(`IMAGE_ENTRY_LIMITS`)で確かめる |
| `resolveUploadTarget(collection, target)` | ① の部品 | 保存先のフィールドが、このプラグインの widget の `json` フィールドか。適用する options を返す |
| `validateUploadImages(input, limits)` | ① の部品 | 画像本体(`dataUrl`)とサムネイル(`thumb`)だけを確かめる |
| `getFieldWidgetKind(field)` | [[T16-reference-hook\|T16]] など | フィールドが、このプラグインの widget の `json` フィールドなら種類を返す |
| `IMAGE_ENTRY_LIMITS` / `VALIDATION_ERROR_CODES` | — | ② の上限(500,000 バイト・4,096px)/ この検証が返すコード(どれも HTTP 400) |

- 結果の型、T04 の理由との対応、決めたことの理由は [[T11-server-validation#結果|T11 の結果]] に書いた。

## EmDash 0.39.1 の挙動(検証の設計に関わるもの)

### `ctx.schema.getCollection` が返すフィールド定義

- 返す型は `CollectionSchemaInfo`。`fields` の要素は `FieldSchemaInfo`(`slug` / `label` / `type` / `required` / `unique` / `default?` / `validation?` / `widget?` / `options?` / `searchable` / `indexed` / `translatable` / `sortOrder`)。`packages/core/src/plugins/types.ts:407`、`:423`
- `widget` と `options` は、値が無いときはキーごと省く(`packages/core/src/plugins/context.ts:334`)。`ctx.schema` は capability `schema:read` を宣言したときだけ付く(`:1706`)。
- `options` の型は `FieldWidgetOptions`(オブジェクト)だが、実際は DB の文字列を `JSON.parse` しただけの値(`packages/core/src/schema/registry.ts:1922`)。`null` や配列も入りうるので、`unknown` として `normalizeFieldOptions` に渡す。
- `validate.ts` は、必要な部分だけの型(`CollectionSchemaLike` / `FieldSchemaLike`)を受け取る。`CollectionSchemaInfo` をそのまま渡せることは、型のテストで確かめた。
- 根拠: **公式ドキュメントのみ**(ソースを読んだ)。型の代入は **実測のみ**(tsc)

### widget とフィールドの型

- 管理画面は `field.widget` が `pluginId:widgetName` の形なら、フィールドの型を見ずにプラグインの widget を描く(`packages/admin/src/components/ContentEditor.tsx:1807`)。プラグインの `FieldWidgetConfig.fieldTypes` は、マニフェストに書く宣言だけ(`packages/core/src/plugins/types.ts:1967`)。
- 保存時の検証(`packages/core/src/api/handlers/validation.ts:199-201`)は zod の `safeParse` の結果を問題の一覧にだけ使い、成功しても `{ ok: true }` を返すだけで、保存するのは元のデータ(`:304`)。
  - `json` 型は `z.unknown()`(`packages/core/src/schema/zod-generator.ts:174`)。
  - `image` 型は `z.object`(知らないキーを許す。`:130`)。参照 `{ v, id, locale, width, height, alt }` は `id` が文字列なので、この検証を通り、`v` と `locale` も残ったまま保存される見込み。ただし EmDash は `image` 型の値をメディアとして扱う。
  - `string` 型などは、オブジェクトの値を拒否する。アップロードは成功するのに参照を保存できず、使われない画像が残る。
- そのため、保存先は「widget がこのプラグインのもの」と「型が `json`」の両方を確かめる(`INVALID_TARGET`。理由は `NOT_PLUGIN_WIDGET` / `NOT_JSON_FIELD`)。
- 根拠: **公式ドキュメントのみ**(`image` 型に参照が保存されることは実行していない)

### 保存 hook とルートのエラー

- `content:beforeSave` で `ContentSaveRejectedError` を投げると、`SAVE_REJECTED` と `message` が API の応答になる。ほかの例外は `CONTENT_HOOK_ERROR` の固定の文になり、`message` は隠れる(`packages/core/src/emdash-runtime.ts:513`、`packages/core/src/plugins/save-rejection.ts:1-20`)。判定は名前でも行う(バンドラーがモジュールを複製したとき用)。
- `PluginRouteError` のコンストラクターは `(code, message, status = 400, details?)`(`packages/core/src/plugins/routes.ts:347`)。`details` は応答に入らない([[emdash-plugin-route-errors]])。
- 投げる例外の種類が呼び出し側ごとに違うので、検証は結果の値で返し、変換は呼び出し側で行う。
- 根拠: **公式ドキュメントのみ**

## 上限の決め方

| 対象 | 長さの上限 | 長辺の上限 | 備考 |
|---|---|---|---|
| ① 画像本体(`dataUrl`) | フィールドの `maxStoredBytes`(10,000〜500,000) | フィールドの `maxEdge`(96〜4,096) | options は `normalizeFieldOptions` で丸める。関数の中でも 500,000 と 16,383(`WEBP_MAX_DIMENSION`)で抑える |
| ① サムネイル(`thumb`) | 8,000(`THUMB_MAX_STORED_BYTES`) | 96(`THUMB_EDGE`) | ブラウザは 96px より大きいサムネイルを作らない(`src/client/thumbnail.ts`) |
| ② 画像エントリの `src` | 500,000(`MAX_STORED_BYTES_LIMIT`) | 4,096(`MAX_EDGE_LIMIT`) | どのフィールドの options でも ① が受け付けうる最大。① を通った値は ② も通る |

- 長さは、デコードする前に確かめる。data URL は ASCII なので、文字数がバイト数になる(ASCII 以外の文字は base64 の確認で拒否される)。
- ② は、スキーマ(`base64ImageEntrySchema`)より先に `src` の長さを確かめる。スキーマの正規表現(ASCII の確認)を大きな文字列に掛けないため。
- 上限が `NaN` のときは拒否する(比較を「以下なら通す」の形にした)。

### 小さなデータで大きな寸法

| 画像 | 形式 | バイト数 | 画素数 |
|---|---|---|---|
| 単色(#808080)4096 × 4096 | 可逆(`cwebp -lossless`) | 706 | 1,677 万(RGBA で約 64MB) |
| 同じ | 非可逆(`cwebp -q 50`) | 29,890 | 同じ |

- 可逆の単色画像は、寸法に関係なく小さい。サムネイルの上限 8,000 バイトにも、4096 × 4096 の画像が入る。一覧は 1 ページに最大 100 枚のサムネイルを表示するので、長辺の上限が要る。
- サーバーは圧縮データをデコードしない(ヘッダーだけを読む)ので、寸法はヘッダーの値で判断する。
- 根拠: **実測のみ**(cwebp 1.6.0、ImageMagick 7.1.2-31)

## 境界値のテストの作り方

### 正しい data URL になる長さ

- data URL の長さは `23 + 4 × ceil(B / 3)`(B は WebP 本体のバイト数)なので、23 + 4 の倍数(4 で割ると 3 余る数)にしかならない。
- RIFF のチャンクは偶数バイトに詰め物をするので、WebP 全体のバイト数は偶数になる(奇数の WebP は `parseWebp` が拒否する)。
- そのため、上限の前後の正しい data URL は次のとおり。100,000 / 100,001 / 500,000 / 500,001 / 8,000 / 8,001 文字の正しい data URL は作れない。

| 上限 | 通る最大(WebP 本体) | 超える最小(WebP 本体) |
|---|---|---|
| 8,000(サムネイル) | 7,999(5,982 B) | 8,003(5,984 B) |
| 100,000(既定) | 99,999(74,982 B) | 100,003(74,984 B) |
| 500,000(固定上限) | 499,999(374,982 B) | 500,003(374,984 B) |

- 長さの確認(デコードの前)は、正しい data URL の末尾に文字を足して試した。上限ちょうどの文字列は長さの確認を通り、base64 の確認(`INVALID_BASE64`)で拒否される。上限 + 1 は `IMAGE_TOO_LARGE`。上限ちょうどで正しい WebP を通すことは、フィールドの `maxStoredBytes` を 99,999 にして確かめた。
- 根拠: **実測のみ**(単体テスト)

### 実際の WebP を指定の大きさにする

拡張形式(`VP8X`)の WebP の末尾に `XMP ` チャンク(中身は 0)を足し、`VP8X` の XMP フラグ(0x04)を立て、RIFF のサイズ欄を直す。

```ts
function padWebp(webp: Uint8Array, size: number): Uint8Array {
	const payload = size - webp.length - 8; // 偶数であること
	const out = new Uint8Array(size);
	out.set(webp);
	out.set([0x58, 0x4d, 0x50, 0x20], webp.length); // "XMP "
	const view = new DataView(out.buffer);
	view.setUint32(webp.length + 4, payload, true);
	view.setUint32(4, size - 8, true);
	view.setUint8(20, view.getUint8(20) | 0x04); // VP8X の XMP フラグ
	return out;
}
```

- Chromium の canvas の出力(96 × 64)を 5,982 / 74,982 / 374,984 バイトに伸ばしたものは、dwebp 1.6.0 でデコードでき(96 × 64)、webpinfo 1.6.0 は「No error detected.」で警告も出さなかった。
- 未知のチャンク(`JUNK`)で伸ばすと、dwebp はデコードできるが、webpinfo は警告を 1 件出した。
- 根拠: **実測のみ**

### Chromium の canvas の出力

Playwright 1.63.0 の Chromium 153.0.8010.12(headless)で、不透明のグラデーションを描いた canvas を `toBlob("image/webp", 0.8)` で出力した。テストファイルに base64 で埋め込んだ(フィクスチャのファイルは作っていない)。

| 寸法 | バイト数 | チャンクの並び |
|---|---|---|
| 96 × 64 | 786 | `VP8X` + `ICCP`(464)+ `VP8 ` |
| 65 × 97(縦長) | 876 | 同じ |
| 4096 × 1 | 878 | 同じ |
| 4097 × 1 | 882 | 同じ |

- 幅 1px の細い画像にすると、長辺 4,096 / 4,097px の境界の WebP を 1KB 未満で作れる。
- 16,384px の WebP はエンコーダーでは作れない(libwebp の上限は 16,383px)。関数の中の上限(`WEBP_MAX_DIMENSION`)を試すテストだけ、`VP8L` のヘッダーを組み立てた。
- 根拠: **実測のみ**(チャンクの並びと寸法は webpinfo 1.6.0 で確かめた)

## 処理時間

固定上限の入力と既定の上限の入力で、`src/server/validate.ts` の関数と、ルートの検証全体を測った。単位は ms。

| 入力 | 測ったもの | `fromBase64` 中央値 / p95 | `atob` 中央値 / p95 |
|---|---|---|---|
| 固定上限(data URL 499,999 文字 + サムネイル 7,999 文字、body 508,188 バイト) | `validateUpload`(①) | 0.034 / 0.052 | 0.327 / 0.426 |
| 同じ | `validateImageEntry`(②) | 0.142 / 0.160 | 0.409 / 0.508 |
| 同じ | `uploadRequestSchema.safeParse`(ルートの `input`) | 0.113 / 0.123 | 0.116 / 0.133 |
| 同じ | JSON の parse + スキーマ + ① + ②(ルートの検証全体) | 0.405 / 0.446 | 0.933 / 0.985 |
| 既定(data URL 99,999 文字 + サムネイル 7,999 文字) | ルートの検証全体 | 0.087 / 0.100 | 0.194 / 0.233 |

- 新しいプロセスでの 1 回目(固定上限のルートの検証全体、5 回): `fromBase64` 1.85〜1.95ms、`atob` 2.97〜3.31ms。
- どれも Workers Free の CPU 時間 10ms より小さい。② のうち約 0.11ms は、スキーマの正規表現(ASCII の確認)を 500,000 文字に掛ける時間(`fromBase64` の場合の ② と ① の差)。
- アップロードでは、ルートの `ctx.content.create` が保存 hook を呼ぶので、① と ② の両方が 1 回ずつ動く。上の「ルートの検証全体」はその組み合わせ。
- Workers(workerd)では測っていない。`Uint8Array.fromBase64` があるかも確かめていない。無ければ `atob` の列になる見込み。根拠: **推測のみ**

### 手順

1. `src/server/validate.ts` などを esbuild 0.28.2 でまとめる(`--bundle --format=esm --platform=neutral --target=es2024`)。
2. Chromium の canvas の出力(96 × 64)を上の `padWebp` で 374,982 バイト(data URL 499,999 文字)と 5,982 バイト(7,999 文字)に伸ばし、入力を作る。フィールドの options は `{ maxStoredBytes: 500000 }`。
3. 300 回の空回しの後、1,000 回を 1 回ずつ `performance.now()` で測り、中央値と p95 を出す。`atob` の列は、`Object.defineProperty(Uint8Array, "fromBase64", { value: undefined, configurable: true })` で `fromBase64` を隠して測る。
4. 1 回目の時間は、新しいプロセスで空回しをせずに 1 回だけ測る。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0、esbuild 0.28.2、Playwright 1.63.0(Chromium 153.0.8010.12 headless)、cwebp / dwebp / webpinfo 1.6.0、ImageMagick 7.1.2-31。2026-09-24 に計測。
