---
title: EmDash 0.39.1 のプラグイン API で、データの形に関わる制約
aliases:
  - プラグインの content API の制約
  - エントリ ID とゴミ箱の判定
tags:
  - docs
  - emdash
  - plugin
  - content
source_task: "[[T03-shared-contracts]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 のプラグイン API で、データの形に関わる制約

> [!summary] 要点
> - プラグインの `ctx.content.create` はエントリ ID を指定できない。新規作成時の `content:beforeSave` にも ID が渡らない。そのため、画像エントリの値に自分の ID は持たせられない(仕様書 5.1 から `id` を外した)。
> - seed で slug を省いたエントリは、seed に書いた `id` がそのままエントリ ID になる。ID は ULID とは限らない。seed は保存 hook を通らず、プラグインストレージも書かない。
> - `ctx.content.get` は、ゴミ箱に入ったエントリと、無いエントリの両方で `null` を返す。capability `content:restore` の `getTrashedVersioned` は、ゴミ箱に入っているエントリだけを返す。組み合わせると 3 つの状態を区別できる。
> - `ctx.content.get` は、見つかったとき 2 クエリ(行と、SEO が有効かの確認)を使う。
> - 管理画面が plugin widget に渡す props は `value` / `onChange` / `label` / `id` / `required` / `options` / `validation` / `minimal` だけ。コレクション・エントリ ID・ロケールは渡らない。
> - 根拠は、特に断りがなければ公式ドキュメントのみ(`references/emdash/packages/` 以下のソースを読んだ。実行はしていない)。
> - 関連: [[T03-shared-contracts]]、[[base64-image-plugin-spec#5. データモデル|仕様書 5 章]]、[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9 章]]、[[emdash-plugin-route-errors]]

## エントリ ID は作成が終わるまで決まらない

- プラグインの `ctx.content.create(collection, data, options)` は、runtime の `handleContentCreate(collection, { data, seo, locale, translationOf })` を呼ぶ。ID を渡す引数が無い(`core/src/emdash-runtime.ts:2128-2157`)。`ContentCreateOptions` も `locale` と `translationOf` だけ(`core/src/plugins/types.ts:475-480`)。
- `handleContentCreate` は、`content:beforeSave` を `runContentBeforeSave(body.data, collection, true, undefined, actor)` で呼ぶ。新規作成では ID の引数が `undefined`(`core/src/emdash-runtime.ts:3335-3350`)。ID はそのあと、リポジトリの `create` で `input.id ?? ulid()` として決まる(`core/src/database/repositories/content.ts:334`)。
- そのため、画像エントリの値(`b64_images` の `image` フィールド)は `id` を持たない。読み出すときにエントリ ID を `id` に入れる([[base64-image-plugin-spec#5. データモデル|仕様書 5.1]])。
- ルートから `ctx.content.create` を呼ぶと、保存 hook は動く(`skipSaveHooks` は、保存 hook の中から呼んだときだけ真)。ただし、呼んだプラグイン自身の `content:afterSave` は動かない(`excludeAfterSavePluginId`。`core/src/emdash-runtime.ts:2143-2148`)。

## seed のエントリ ID

- seed の各エントリの `id` は「seed の中で `$ref:` から参照するための ID」(`core/src/seed/types.ts:275-277`)。
- slug を省いたエントリは、この `id` がそのまま実際のエントリ ID になる(`...(entrySlug ? {} : { id: entry.id })`。`core/src/seed/apply.ts:676`)。slug があるエントリは ULID になる。
- `b64_images`(`routable: false`)を seed で作ると、slug を省くことが多いので、seed の `id` が ID になる。このプラグインの参照の `id` は、英数字で始まり英数字・`_`・`-` だけの 128 文字までに限る(`src/shared/schema.ts` の `entryIdSchema`)。seed の `id` もこれに合わせる([[T26-playground-pages]])。
- 参照の中の `"id": "$ref:<seed の id>"` は、seed を適用するときに実際の ID に置き換わる(`core/src/seed/apply.ts:1309-1316`)。
- seed はリポジトリを直接使ってエントリを作る(`core/src/seed/apply.ts:670-684`)。そのため、保存 hook(`content:beforeSave` / `content:afterSave`)を通らず、プラグインストレージも書かない。seed で作った `b64_images` の値はこのプラグインの検証を通っておらず、`imageRefs` にも記録が無い。読む側([[T15-site-resolve]]、[[T17-admin-data-routes]])は値をスキーマで確かめてから使う。

## ゴミ箱に入っているかの判定

| 状態 | `ctx.content.get` | `ctx.content.getTrashedVersioned` |
|---|---|---|
| ゴミ箱に入っていない | エントリ | `null` |
| ゴミ箱に入っている | `null` | `{ item, _rev }` |
| 無い(完全削除など) | `null` | `null` |

- `get` は `deleted_at IS NULL` の行だけを読む(`core/src/database/repositories/content.ts:561-576`)。
- `getTrashedVersioned` は、ゴミ箱を含めて読んだうえで、`isTrashed` が偽なら `null` を返す(`core/src/emdash-runtime.ts:3877-3892`)。
- `getTrashedVersioned` と `restore` は、capability `content:restore` を宣言したときだけ `ctx.content` に付く(`core/src/plugins/context.ts:1687-1704`、`core/src/plugins/types.ts:593`)。`content:restore` は `restore`(ゴミ箱から戻す)の権限も含む。
- `content:restore` を宣言しない場合は、「`imageRefs` にあって `get` が `null` ならゴミ箱」とみなせる。完全削除のときは `content:afterDelete`(`permanent: true`)で `imageRefs` から消すので、残るのは hook が失敗したときだけ([[T06-decision-trash-permission#後続タスク向けのメモ|T06]])。どちらにするかは [[T21-orphan-routes]] と [[T29-plugin-definition]] で決める。

## `ctx.content.get` のクエリ数

- `get` は `findById`(1 クエリ)のあと、`seoRepo.isEnabled(collection)`(1 クエリ)を呼ぶ。SEO が有効なら、さらに `seoRepo.get`(1 クエリ)を呼ぶ(`core/src/plugins/content-access.ts:25-51`、`core/src/database/repositories/seo.ts:45-52`)。
- `b64_images` は `supports: []` で SEO が無いので、見つかった画像 1 件につき 2 クエリ、見つからなければ 1 クエリ。プレビュー取得は 1 回 10 件まで(`PREVIEW_MAX_IDS`)にした。
  - T03 の時点では、D1 の上限を「1 リクエスト 50 クエリ」と考えて件数を決めた。実際の上限は 1 呼び出し 1,000 だった([[cloudflare-workers-free-d1-limits]])。
  - [[T17-admin-data-routes|T17]] の実測でも 10 件のままにした。理由は、クエリ数ではなく応答の大きさと CPU 時間(10 件で最大 5MB・約 3.5〜5.6ms)に変わった([[emdash-plugin-preview-thumbnail-routes]])。

## plugin widget に渡る props

- 管理画面は、フィールドの `widget` が `pluginId:widgetName` の形なら、そのプラグインの `fields[widgetName]` を次の props で描く(`admin/src/components/ContentEditor.tsx:1818-1843`)。

| prop | 中身 |
|---|---|
| `value` / `onChange` | フィールドの値と、変更を伝える関数 |
| `label` | フィールドの表示名 |
| `id` | `field-<フィールドの slug>`(`ContentEditor.tsx:1791`) |
| `required` / `validation` | フィールド定義の値 |
| `options` | フィールド定義の `options`(選択肢の配列のこともある型) |
| `minimal` | 簡易表示かどうか |

- コレクション・エントリ ID・ロケールは渡らない。アップロードの `target.collection` と `target.entryId` / `target.locale` は、widget が画面の URL などから求める([[T27-image-widget]]、[[T28-gallery-widget]])。フィールドの slug は `id` から `field-` を除けば分かる。
- `options` は配列のこともある型なので、`normalizeFieldOptions` はオブジェクトでなければ既定値にする(`src/shared/options.ts`)。

## `MediaValue` と `Image`

- `MediaValue` は `emdash` から型として import できる(`core/src/index.ts:60`、定義は `core/src/media/types.ts:254-283`)。必須は `id` だけで、`src` / `mimeType` / `width` / `height` / `filename` / `alt` / `meta`(`Record<string, unknown>`)などは省略できる。
- `emdash/ui` の `Image` は、`src` があればそれを使う(`core/src/components/EmDashImage.astro:139-140`)。
- 画像エントリの値に `id` と参照の `alt` を加えた型(`ResolvedBase64Image`)が `MediaValue` に代入できることを、型のテストで確かめた(`tests/shared/schema.test.ts`)。根拠: **実測のみ**(`tsc --noEmit`。`width` を文字列にすると型エラーになることも確かめた)

## ルートの permission の最低ロール

| permission | 最低ロール | このプラグインのルート |
|---|---|---|
| `content:read` | Subscriber | プレビュー取得、サムネイル取得 |
| `content:read_drafts` | Contributor | 画像管理の一覧 |
| `content:create` | Contributor | アップロード、ゴミ箱への移動 |

- 根拠: 公式ドキュメントのみ(`auth/src/rbac.ts:11-27`)。`src/shared/constants.ts` の `ROUTE_PERMISSIONS` が EmDash の `Permission` 型に合うことは、型のテストで確かめた(打ち間違えると型エラーになる。実測のみ)。
