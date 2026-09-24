---
id: T18
title: "アップロード用ルートを作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T11-server-validation]]"
  - "[[T08-spike-route-body]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/routes/upload.ts"
  - "tests/server/upload.test.ts"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T18 アップロード用ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T11-server-validation|T11]]、[[T08-spike-route-body|T08]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7章]]

## 目的

仕様書 7 章のアップロード処理を作る。

## 作業内容

- [x] ルートの定義([[T08-spike-route-body|T08]] の結果に基づく body の宣言。権限は `content:create`)
  - [[T08-spike-route-body#T18 で使うルートの宣言|T08 の雛形]]のとおり: `PluginRoute<UploadRequest>`、`methods: ["POST"]`、`request: { body: "json", maxBytes: 600_000 }`、`input: uploadRequestSchema`。`definePluginRoute` は json の入力の型が `unknown` になるので使わない
  - 単体テストで、スキーマに合わない入力が拒否されること(`input` の書き忘れは型エラーにならない)と、固定上限の入力を `JSON.stringify` したバイト数が `UPLOAD_MAX_BODY_BYTES` 以下であることを確かめる
- [x] `target.locale` を、サイトに設定されたロケールと照らし合わせる。`localeSchema` は EmDash の `LOCALE_CODE_PATTERN`(`references/emdash/packages/core/src/i18n/config.ts:15`)と同じ正規表現で、長さの上限が無い。450,002 文字のロケールも `uploadRequestSchema` を通った([[T08-spike-route-body#仕様書とほかのタスクへの影響|T08]])。照らし合わせ方(EmDash の i18n の設定の読み方)と、スキーマに長さの上限を足すかを決める([[T08-1-spec-route-body|T08-1]])
- [x] 検証([[T11-server-validation|T11]])→ `ctx.content.create("b64_images", …)` → `getVersioned` → `publish` → `imageRefs.put` → 参照を返す
  - `imageRefs.put` は公開より先にした(作成 → `imageRefs` → 公開)。理由は [[#失敗したときの後始末]]
  - 検証は `validateUpload(ctx.input, await ctx.schema.getCollection(ctx.input.target.collection))`。`checked.ok === false` なら `throw new PluginRouteError(checked.code, checked.message, ERROR_HTTP_STATUS[checked.code])`。`meta.bytes` と `imageRefs.bytes` には `checked.image.webpBytes` を入れる([[T11-server-validation#T18・T19 が使う export|T11]])
  - `ctx.schema` が無いのはプラグインの定義の誤りなので、500 にする(`INVALID_TARGET` にしない)
- [x] `target.entryId` があれば、最初の参照元として記録する
- [x] 途中で失敗したときの後始末(作成済みのエントリの扱い)を決めて実装する
- [x] アップロード 1 回は SQLite で 72 クエリ([[T10-spike-after-save#結果|T10]]。公開が 38 本で、うち 28 本は EmDash 本体の、メディアの使用状況の索引の更新)。上限(1 呼び出し 1,000。仕様書 2.2)には収まるが、減らせるところがあれば減らし、実装後のクエリ数を playground で測って記録する
- [x] 公開するとデータを丸ごと複製したリビジョンが 1 件でき、容量を約 2 倍使う(仕様書 5.4、[[T02-1-prettier-storage-capacity|T02-1]])。これを避ける方法があるかを確かめる(例: `supports: []` のコレクションで `ctx.content.create` の直後の状態、`publish` 以外で公開状態にする方法)。無ければ仕様書 5.4 の見積もりのままにする

## 完了条件

- [x] 単体テスト(偽の ctx): 正常系、検証エラー、作成・公開・保存それぞれの失敗
- [x] 1 リクエストのクエリ数を playground で測って記録した(上限は 1 呼び出し 1,000。仕様書 2.2)

## 変更してよいファイル

- `src/server/routes/upload.ts`
- `tests/server/upload.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/routes/upload.ts` に、アップロード用ルート `uploadRoute`(`PluginRoute<UploadRequest>`)とハンドラー `handleUpload` を作った。宣言は [[T08-spike-route-body#T18 で使うルートの宣言|T08 の雛形]]のとおり。ctx は使う部分だけの型(`UploadRouteContext`)にした([[T17-admin-data-routes|T17]] と同じ形)。
> - 処理の順番は **ロケールの確認 → 検証(①)→ 作成 → `imageRefs` → 公開 → 参照を返す**。リーダーの指定と仕様書 7 章の元の順番(作成 → 公開 → `imageRefs`)から、`imageRefs` と公開を入れ替えた([[#失敗したときの後始末]])。
> - playground を複製した使い捨てのサイト(`spikes/upload-route/`、git 管理外)で、本物と同じプラグイン ID(`base64-image`)で動かした。正しいアップロード、検証エラー、権限、失敗時の後始末、i18n、[[T19-image-entry-hook|T19]] と [[T20-owner-tracking|T20]] の hook との組み合わせを確かめた。クエリ数は SQLite で 75(i18n のサイトで 77)。
> - `tests/server/upload.test.ts` に 47 件のテストを書いた。実装を 31 通りに壊し、どれもテストが失敗することを確かめた。
> - 公開時のリビジョンの複製は、プラグインからは避けられなかった。仕様書 5.4 の見積もりは変えていない。
> - 知見ノート: [[emdash-plugin-upload-route]](ロケールの読み方、失敗時の後始末、T20 との関係、クエリの内訳、リビジョンの複製、検証を 2 回行う費用、再現手順)

### T29 がルートを登録する方法

spike で同じ形の `definePlugin` を動かして確かめた。根拠: **実測+公式ドキュメント**

```ts
import { uploadRoute } from "./server/routes/upload";
import { IMAGE_REFS_STORAGE, PLUGIN_ID, ROUTES } from "./shared/constants";

definePlugin({
	id: PLUGIN_ID,
	// アップロードが使うのは schema:read(フィールド定義)・content:write(作成とゴミ箱への移動)・content:publish(getVersioned と公開)
	capabilities: ["schema:read", "content:write", "content:publish" /* , ほかのルート・hook が使うもの */],
	storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } }, // ctx.storage.imageRefs
	routes: { [ROUTES.upload]: uploadRoute }, // POST /_emdash/api/plugins/base64-image/upload
});
```

- `content:read` は `content:write` と `content:publish` に含まれ、`definePlugin` が補う(`capabilities` は `["schema:read", "content:write", "content:publish", "content:read"]` になった。`references/emdash/packages/core/src/plugins/types.ts:84-107`)。根拠: **実測+公式ドキュメント**
- 仕様書 7 章の「必要な capability」の `content:revisions:read` は、9 章の下書きリビジョンの確認(`getRevision`)のためのもので、アップロードは使わない(`references/emdash/packages/core/src/plugins/content-access.ts:145-164`)。根拠: **公式ドキュメントのみ**
- capability かストレージが足りないと、ハンドラーは何も作らずに通常の `Error` を投げ、EmDash は 500 `INTERNAL_ERROR` にする。メッセージはサーバーのログに出る(例: `ctx.content.publish is missing. Declare the "content:publish" capability.`)。根拠: **実測のみ**(単体テスト)
- `content:beforeSave` は、`b64_images` なら T19 の hook に振り分ける。ルートの `ctx.content.create` もその hook を通る。

### T23 が使う応答

- 成功: 200 `{ "success": true, "data": { "ref": { "v": 1, "id", "locale", "width", "height", "alt": "" } } }`。`ref` はそのままフィールドの値にできる。T14 の `uploadImage`(`src/client/api.ts`)は、応答を `uploadResponseSchema` で確かめて `{ ref }` を返す。根拠: **実測+公式ドキュメント**
- `ref.locale` は画像エントリのロケール(サイトの既定ロケール)で、編集中のエントリのロケールではない。書き換えない(サイト側の `resolveBase64Images` は、このロケールで画像を引く)。
- 送る値: `target.entryId` を送るときは、そのエントリのロケールを `target.locale` に入れる([[#参照元の記録(T20)との関係]])。
- 失敗は `{ "success": false, "error": { "code", "message" } }`。`message` は英語で、ログと調査のためのもの。画面の文言はコードで決める(T14 の `error-messages.ts` に、どのコードの文言もある)。

| HTTP | code | いつ | 作られたもの |
|---|---|---|---|
| 400 | `INVALID_TARGET` | 保存先がこのプラグインの `json` フィールドでない。`target.locale` がサイトのロケールでない | なし |
| 400 | `IMAGE_DATA_INVALID` / `IMAGE_TOO_LARGE` / `IMAGE_DIMENSIONS_MISMATCH` / `IMAGE_EDGE_TOO_LONG` / `THUMB_DATA_INVALID` / `THUMB_TOO_LARGE` | 画像・サムネイルの検証(①) | なし |
| 400 | `IMAGE_ENTRY_INVALID` | 作成を保存 hook が拒否した(T19 の ②、またはほかのプラグイン)。`message` に hook のメッセージが入る(1,000 文字まで) | なし |
| 500 | `IMAGE_COLLECTION_MISSING` | `b64_images` が無い | なし |
| 500 | `UPLOAD_FAILED` | 作成・`imageRefs`・公開の失敗 | 作成のあとなら、ゴミ箱に移した画像エントリ |
| 500 | `INTERNAL_ERROR` | プラグインの定義(capability・ストレージ)や、サイトの既定ロケールの誤り | なし |
| 400 / 401 / 403 / 405 / 413 | `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `CSRF_REJECTED` / `METHOD_NOT_ALLOWED` / `INVALID_PLUGIN_REQUEST` | EmDash がハンドラーの前に返す([[emdash-plugin-route-body-limit]]) | なし |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 画像エントリはロケールを指定せずに作る(サイトの既定ロケール。仕様書 5.1)。参照の `locale` には、作成の結果のロケールを入れる | サイト側([[T15-site-resolve\|T15]])は参照の `locale` で画像を引く。i18n のサイトで、`ja` の画像を `en` の参照で引くと見つからなかった | 実測+公式ドキュメント |
| 2 | サイトのロケールは、`emdash` の `getI18nConfig()` で、リクエストのたびに読む。`ctx.site.locale` は使わない | `ctx.content.create` が使う既定ロケールは `getI18nConfig()`(Astro の `i18n` から作られる)の値(`core/src/plugins/context.ts:777`、`core/src/i18n/config.ts:54-77`)。設定はミドルウェアが最初のリクエストで入れる(`core/src/astro/middleware.ts:167-190`)。`ctx.site.locale` はオプション `emdash:locale` の値で、別物(`core/src/emdash-runtime.ts:1564`) | 実測+公式ドキュメント |
| 3 | `target.locale` は、i18n のサイトでは設定されたロケールのどれか(大文字・小文字を区別せず、表記は設定にそろえる)、i18n の無いサイトでは 35 文字まで。ほかは 400 `INVALID_TARGET`。フィールド定義を読む前に確かめる(拒否は 1 クエリ) | EmDash の `resolveContentCreateLocale` と同じ規則なので、エントリに保存されたロケールと一致する。35 は RFC 5646 の 4.4.1 が「言語タグの長さを制限するなら、少なくとも 35 文字のタグを受け付けなければならない(MUST)」とする長さ | 実測+公式ドキュメント / 外部ドキュメントのみ(35) |
| 4 | `target.locale` を省いたら、参照元のロケールはサイトの既定ロケールにする | ロケールを指定せずに作ったエントリは既定ロケールになる | 公式ドキュメントのみ |
| 5 | `localeSchema`([[T03-shared-contracts\|T03]])に長さの上限は足さない | 参照・参照元のスキーマでも使っていて、足すと既存の値の扱いが変わる。ルートの確認で、`imageRefs` に長い値は入らない。body の上限(600,000)で、正規表現が調べる長さも抑えられる | 推測のみ |
| 6 | 処理の順番を、作成 → `imageRefs` → 公開にした | [[#失敗したときの後始末]] | 実測+公式ドキュメント(失敗の起きやすさは推測のみ) |
| 7 | 作成のあとで失敗したら、画像エントリを `ctx.content.delete` でゴミ箱に移し、`imageRefs` の記録は残して、500 `UPLOAD_FAILED` を返す | プラグインは完全削除ができない。記録を残すと、画像管理ページに「ゴミ箱」の画像として出て、管理者が完全削除できる | 実測+公式ドキュメント |
| 8 | 保存 hook の拒否は 400 `IMAGE_ENTRY_INVALID` にし、hook のメッセージを 1,000 文字まで添える | `ctx.content.create` からは `ContentSaveRejectedError` でなく、`name` / `code` が `"SAVE_REJECTED"` の通常の `Error` が届く(`core/src/emdash-runtime.ts:2150-2155`)。投げ直すと、EmDash は `PluginRouteError` 以外を 500 `INTERNAL_ERROR` にする(`core/src/plugins/routes.ts:285-314`)。リーダーの指定 | 実測+公式ドキュメント |
| 9 | 作成の失敗のうち、`COLLECTION_NOT_FOUND` は 500 `IMAGE_COLLECTION_MISSING`、ほかは 500 `UPLOAD_FAILED`。元の例外の文は応答に入れず、ログに出す | サイトの設定の誤りを見分けられるようにする。データベースのエラーの文を利用者に見せない | 実測+公式ドキュメント |
| 10 | 検証は、ルート(①)と保存 hook(②)の 2 回のままにする | [[#検証を 2 回行う費用]] | 実測のみ(時間)/ 公式ドキュメントのみ(書き込み元を区別できないこと) |
| 11 | `_rev` は `getVersioned` で読む(3 クエリ) | 公式の説明が「Read first and pass the opaque `_rev`」(`skills/creating-plugins/references/content.md:33`)。作成の結果から作ると、`_rev` の中身の形に頼ることになる | 公式ドキュメントのみ |
| 12 | 公開時のリビジョンの複製は避けない | [[#公開時のリビジョンの複製]] | 実測+公式ドキュメント |
| 13 | ctx のメソッドは取り出さずに、元のオブジェクトを `this` にして呼ぶ | 0.39.1 のネイティブの実装は `this` に頼らない(`core/src/plugins/context.ts:206-226`、`:757-`)が、型はメソッドなので、`this` に頼る実装でも壊れないようにする。テストの偽物はクラスにして確かめる | 公式ドキュメントのみ(ほかの実装については推測のみ) |

### 失敗したときの後始末

| 失敗・中断した場所 | 応答 | 残るもの | 画像管理ページ([[T21-orphan-routes\|T21]])から |
|---|---|---|---|
| 作成より前 | 400 など | なし | — |
| 作成(保存 hook の拒否) | 400 `IMAGE_ENTRY_INVALID` | なし | — |
| 作成(そのほか) | 500 `UPLOAD_FAILED` / `IMAGE_COLLECTION_MISSING` | なし | — |
| `imageRefs` の保存 | 500 `UPLOAD_FAILED` | ゴミ箱の下書き(`imageRefs` なし) | 見えない |
| `getVersioned`・公開 | 500 `UPLOAD_FAILED` | ゴミ箱の下書き + `imageRefs` | 「ゴミ箱」・参照元なし(または `target.entryId` の参照元)として出て、完全削除できる |
| ゴミ箱への移動も失敗 | 500 `UPLOAD_FAILED`(ログに出す) | 下書き(+ `imageRefs`) | `imageRefs` があれば「ゴミ箱に入っていない」として出る |
| 作成と `imageRefs` の間で処理が止まった | 応答なし | 下書き(`imageRefs` なし) | 見えない |
| `imageRefs` と公開の間で止まった | 応答なし | 下書き + `imageRefs` | 「ゴミ箱に入っていない」・参照元なしとして出る |

- 仕様書の元の順番(作成 → 公開 → `imageRefs`)だと、公開の失敗と `imageRefs` の保存の失敗のどちらでも、`imageRefs` の無いエントリが残り、画像管理ページから見えない。公開の失敗(ほかのプラグインの公開のポリシー、`_rev` の衝突)は、データベースの失敗より起きやすいと考え、`imageRefs` を先にした。根拠: **推測のみ**(起きやすさ)
- ほかのプラグインの `content:beforePublish` が公開を拒否したとき: 500 `UPLOAD_FAILED`(50 クエリ)。画像エントリは `status: draft` のままゴミ箱に入り、`imageRefs` は残り、リビジョンは 0 件だった。根拠: **実測のみ**
- ほかのプラグインの `content:beforeSave` が保存を拒否したとき: 400 `IMAGE_ENTRY_INVALID`(5 クエリ)。画像エントリも `imageRefs` も増えなかった。根拠: **実測のみ**
- `imageRefs` の無いまま残ったエントリは、画像管理ページからは扱えない。EmDash 標準の `b64_images` のゴミ箱画面(重い。仕様書 10 章)から消すか、仕様書 19 章の「既存の `b64_images` を `imageRefs` に登録する機能」で拾う。起きるのは、データベースの失敗か処理の中断のときだけ。

### 参照元の記録(T20)との関係

- `target.entryId` から記録する最初の参照元は `{ collection: target.collection, entryId: target.entryId, locale, field: target.field }`。T20 の afterSave / afterPublish が記録する `{ collection: event.collection, entryId: event.content.id, locale: event.content.locale, field }` と同じ形で、T20 は 4 つのキーがすべて同じ参照元を重複させない。
- T20 の hook(`phase-3/t-20` のコピー)を spike のプラグインに登録し、投稿の作成 → `target.entryId` を付けたアップロード → 投稿の `cover` に参照を入れて保存 → 公開、の各段階のあとで `owners` を読んだ。エントリのロケールを送れば、i18n のサイトでも無いサイトでも、表記を変えて送っても(`EN`)、参照元は 1 件のままだった。根拠: **実測のみ**
- i18n のサイトで、`en` のエントリに `target.locale` を省いて送ると、参照元は既定の `ja` で記録され、保存のあと T20 が `en` の参照元を足して 2 件になった。同じエントリを指すので、画像管理の判定の結果は変わらない見込み。根拠: **実測のみ**(判定への影響は推測のみ)
- `entryId` を送らない対照では、保存のあと T20 が同じ形の参照元を 1 件足した(hook が動いていることの確認)。T20 の hook を入れても、アップロードのクエリ数は 75(i18n で 77)のままだった。根拠: **実測のみ**
- ルートは、新しい画像 ID の記録を `put` で作るだけで、既存の記録を書き換えない。画像 ID は応答で初めて返るので、T20 の追記(`compareAndSet`)と同じ記録に同時に書くことはない。根拠: **推測のみ**

### クエリ数

playground の複製(`astro dev`、SQLite)で、応答の `Server-Timing` の `db.count` と、`EMDASH_QUERY_LOG=1` の SQL のログを読んだ(内訳は [[emdash-plugin-upload-route#クエリ数]])。根拠: **実測のみ**

| リクエスト | db.count |
|---|---|
| 正しいアップロード(Contributor・Author・Editor・Admin。何回でも、T19・T20 の hook を入れても同じ) | **75** = ルートの固定費 1 + フィールド定義 2 + 作成 30 + `imageRefs` 1 + `getVersioned` 3 + 公開 38 |
| 同じ(i18n を設定したサイト) | 77(公開のあとに、翻訳の兄弟エントリを探す 2 本が加わる) |
| ロケール・スキーマ・body の上限・権限で拒否 | 1 |
| フィールドの無いコレクション / フィールド・画像の検証(①)で拒否 | 2 / 3 |
| 保存 hook の拒否 / 公開の拒否 | 5 / 50 |

- 作成と公開のそれぞれ 15 本は、EmDash 本体のメディアの使用状況の索引の更新(索引が有効かの確認 1 本 + 読み書き 14 本。[[T10-spike-after-save#結果|T10]] の「28」は 14 本 × 2)。[[T10-spike-after-save|T10]] の 72 に、検証のフィールド定義 2 と `imageRefs` 1 が加わった。
- 減らせるのは `getVersioned` の 3 本だけで、決定 11 の理由で減らしていない。上限(1 呼び出し 1,000。仕様書 2.2)には十分収まる。D1 での数は [[T32-cloudflare-check|T32]] で確かめる。
- 1 回の応答時間は、開発サーバーで 12〜24ms(サーバーを起動して最初のアップロードは 70ms)。根拠: **実測のみ**

### 公開時のリビジョンの複製

- 避けられない。作成で公開状態にはできず(`ContentCreateOptions` は `locale` と `translationOf` だけ)、`ctx.content.update` も公開しない。`supports: []` のコレクションの初めての公開は、その時点の値を `revisions` に複製する(`references/emdash/packages/core/src/database/repositories/content.ts:2308-2320`)。根拠: **実測+公式ドキュメント**
- 1×1 の仮の値(38 バイトの WebP)で作成・公開してから本来の値に差し替える案を試した。リビジョンは 95,592 → 166 バイトになり、サイトにも本来の画像が出た。しかし、標準 API(`POST /_emdash/api/revisions/{id}/restore`、Editor 以上)で公開中のリビジョンを復元すると、画像が 1×1 に戻った。差し替えの `ctx.content.update` は保存 hook を通らず(② の検証が抜ける)、クエリも 87 に増える。採らない。根拠: **実測+公式ドキュメント**
- 今の方法でも、リビジョンを復元すると、復元の記録として同じ大きさのリビジョンがもう 1 件できる。管理画面には `b64_images` のリビジョンの画面が出ないので、API で復元したときだけ起きる。根拠: **実測+公式ドキュメント**
- 仕様書 5.4 には、見積もりを変えずに、確かめた結果を書いた。

### 検証を 2 回行う費用

`validateUpload`(①)と `validateImageEntry`(②)を esbuild でまとめ、Node で測った(中央値。詳細は [[emdash-plugin-upload-route#検証を 2 回行う費用]])。根拠: **実測のみ**(Node 26、Apple M5 Pro。Workers では測っていない)

| 入力 | ①(`fromBase64` / `atob`) | ②(`fromBase64` / `atob`) |
|---|---|---|
| spike の画像(data URL 95,455 文字) | 0.012 / 0.064ms | 0.029 / 0.083ms |
| 固定上限に近い画像(497,655 文字) | 0.036 / 0.303ms | 0.148 / 0.414ms |
| 新しいプロセスの 1 回目 | 0.03 / 0.16ms | 0.80〜0.94 / 0.85〜0.90ms(zod の初期化を含む) |

- ② の分は、最も重い場合でも中央値 0.41ms、1 回目で約 0.9ms で、Workers Free の CPU 時間(10ms)と比べて小さい。仕様書 8 章の「処理の重さ」([[T11-server-validation|T11]] の、① と ② を含むルートの検証全体の値)とも食い違わない。
- 2 回のままにする理由: ① はフィールドの options(`maxStoredBytes` / `maxEdge`)とサムネイルを確かめ、失敗の理由ごとのコードを返す。② は保存先のフィールドを知らないが、REST・MCP・ほかのプラグインからの書き込みも確かめる。保存 hook は書き込み元を区別できない(`references/emdash/packages/core/src/plugins/hooks.ts:543`)ので、ルートからの書き込みだけ ② を飛ばすこともできない。根拠: **公式ドキュメントのみ**

### 動作確認(spike)

- 正しいアップロード: 200。画像エントリは `published` でリビジョン 1 件、`imageRefs` に記録(`owners` は `target.entryId` があるときだけ、`createdBy` はログイン中の利用者)。サイト側の `resolveBase64Images` で引けた(1024 × 768)。根拠: **実測のみ**
- 検証エラー: 寸法の不一致 → 400 `IMAGE_DIMENSIONS_MISMATCH`、widget でないフィールド・無いコレクション・`b64_images` 自身 → 400 `INVALID_TARGET`、長すぎるロケール(38 文字)・i18n のサイトで設定に無いロケール(`fr`)→ 400 `INVALID_TARGET`、`width: 0`・知らないキー・大きすぎるサムネイル → 400 `VALIDATION_ERROR`、600,001 バイト → 413。どれも画像エントリは増えなかった。根拠: **実測のみ**
- 権限: 未ログイン 401、Subscriber 403、Contributor・Author・Editor・Admin 200、`X-EmDash-Request` なし 403 `CSRF_REJECTED`。根拠: **実測+公式ドキュメント**
- ロケール: i18n の無いサイトでは画像エントリと参照が `en`、i18n(既定 `ja`、`ja` / `en`)のサイトでは `ja`。参照元のロケールは、送った `target.locale`(設定の表記)か既定ロケール。根拠: **実測+公式ドキュメント**
- 画面(T23・T27)はまだ無いので、WebP は cwebp で作り、REST で送った(手順は [[emdash-plugin-upload-route#再現手順]])。

### テスト

`tests/server/upload.test.ts`: 47 件(偽の ctx)。根拠: **実測のみ**

- ルートの宣言(permission・メソッド・body の上限・`input`・ハンドラー)。EmDash の `RouteContext<UploadRequest>` と `I18nConfig` を、ハンドラーの型に代入できること(型のテスト)。T29 の形で `definePlugin` に渡せること。スキーマに合わない入力の拒否。
- body の上限: 固定上限まで詰めた正しい入力(`target.locale` は 35 文字)は 509,475 バイト、ASCII 以外を `\uXXXX` で書くと 511,515 バイトで、600,000 に収まる。
- ロケール: i18n あり・なし、省略、表記、長さ、長いロケールをメッセージにそのまま入れないこと。
- 正しいアップロード: 呼び出しの順番、画像エントリの値(`meta.bytes` は WebP 本体のバイト数で、② も通る)、`filename` の有無、`imageRefs` の記録、参照元、i18n のサイトの参照の `locale`。
- 検証エラー 9 種類(何も作らない。ロケールはフィールド定義を読む前に確かめること)、利用者・定義・設定の誤り 7 種類、作成の失敗 5 種類(`SAVE_REJECTED` → 400 `IMAGE_ENTRY_INVALID` と、長い hook のメッセージの切り詰めを含む)、作成のあとの失敗 7 種類(ゴミ箱に移す・`imageRefs` を残す・ゴミ箱への移動の失敗)、既定のハンドラーが EmDash の i18n の設定をリクエストのたびに読むこと。
- 実装を 1 か所ずつ壊してテストを実行し、元に戻した。31 通りとも、1 件以上のテストが失敗した(括弧内は失敗した件数)。
  - 公開してから `imageRefs` を保存する(3)/ `meta.bytes` に data URL の長さを入れる(2)/ 公開に失敗してもゴミ箱に移さない(5)/ 参照元を記録しない(2)
  - i18n のサイトで `target.locale` を照らし合わせない(6)/ i18n の無いサイトで長さを確かめない(2)/ 表記を設定にそろえない(2)/ 画像エントリのロケールを `en` に固定する(2)/ ロケールをフィールド定義のあとで確かめる(1)/ 既定ロケールを作る前に確かめない(1)/ 作成したエントリのロケールを確かめない(1)
  - メソッドを `this` なしで呼ぶ(20)/ ルートに `input` を書き忘れる(2)/ body の上限を 500,000 にする(2)/ `ctx.user` を確かめない(1)/ `imageRefs` の宣言を作る前に確かめない(1)
  - `createdBy` に画像 ID を入れる(1)/ 参照の `alt` を空にしない(1)/ サムネイルに画像本体を入れる(1)/ `filename` を常に入れる(1)
  - `getVersioned` の `null` を扱わない(1)/ 公開に古い `_rev` を渡す(2)
  - `COLLECTION_NOT_FOUND` を区別しない(1)/ `SAVE_REJECTED` を区別しない(2)/ `SAVE_REJECTED` を 500 にする(2)/ hook のメッセージを切り詰めない(1)/ `UPLOAD_FAILED` を 400 にする(9)/ 検証のエラーを 500 にする(7)/ 検証のエラーで止めない(7)/ ゴミ箱の対象が無くてもログに出さない(1)/ 応答に元の例外の文を入れる(1)

### 仕様書への反映

このタスクで変えたところ(7 章と 5.4 だけ):

- 7 章: body の最大(509,462 → 511,515 バイト。`target.locale` の上限を 35 文字にしたため)、クエリ数(72 → 75、i18n で 77)、処理の順番(ロケールの確認、`imageRefs` を公開より先に、保存 hook の拒否は 400 `IMAGE_ENTRY_INVALID`)、失敗時の後始末、ロケールの扱い(widget は `target.entryId` を送るときにエントリのロケールも送ること)。
- 5.4: 「複製を避けられるかは T18 で確かめる」を、確かめた結果(避けられない。仮の値の案を採らない理由)に置き換えた。見積もりは変えていない。

リーダーに反映をお願いしたいところ(このタスクでは変えていない):

1. 8 章の表の ①: 「`target.locale` が、サイトに設定されたロケールであること(i18n が無ければ 35 文字まで)」を足す。不正なときは同じ 400(`INVALID_TARGET`)。
2. 4.2 の図: 「create → getVersioned → publish」のあとに「メタデータを保存」となっている。実装は create → `imageRefs` → getVersioned → publish。
3. 7 章の「必要な capability」は、プラグイン全体の一覧として読める。アップロードが使うのは `schema:read` / `content:write` / `content:publish` だけ(`content:revisions:read` は 9 章のため)。書き分けるかは T29 と合わせて決める。

> [!note] 反映済み(リーダー、マージのとき)
> 上の 1〜3(8 章の表の①、4.2 の図の順番、7 章の capability)を反映し、知見ノートを索引に登録した。

### 他のタスクへの影響

| タスク | 内容 |
|---|---|
| [[T29-plugin-definition\|T29]] | [[#T29 がルートを登録する方法]]のとおり。アップロードの capability は `schema:read` / `content:write` / `content:publish`(`content:read` は補われる)、ストレージは `imageRefs`。`src/index.ts` はこのタスクでは変えていない |
| [[T23-upload-hook\|T23]] / [[T27-image-widget\|T27]] / [[T28-gallery-widget\|T28]] | [[#T23 が使う応答]]のとおり。`target.entryId` を送るときは、そのエントリのロケールも `target.locale` に入れる(エントリの値をそのまま送れば、表記も T20 の記録と一致する)。`ref.locale` は画像のロケールなので書き換えない |
| [[T14-admin-i18n-api\|T14]] | `INVALID_TARGET` の文言(「保存先のフィールドが見つからないか…」)は、`target.locale` がサイトのロケールでないときにも出る。起きるのは、設定から外したロケールのエントリを編集するときくらい。文言を広げるかは T14・T23 の判断(推測のみ) |
| [[T21-orphan-routes\|T21]] | 公開で失敗した画像は、ゴミ箱の下書きとして `imageRefs` に残る(参照元なし、または `target.entryId` の参照元)。公開の前に処理が止まった画像は、ゴミ箱に入っていない下書きとして残る。どちらも完全削除の対象にできる。`imageRefs` の無いエントリは見えない。`owners` には、ロケールだけが違う同じエントリの参照元が並ぶことがある(`target.locale` を省いたとき) |
| [[T19-image-entry-hook\|T19]] | ルートが作る値は T19 の hook を通った(spike で 200・75 クエリ)。拒否されたときは、ルートが 400 `IMAGE_ENTRY_INVALID` にする |
| [[T20-owner-tracking\|T20]] | 最初の参照元は T20 と同じ形で、重複しなかった([[#参照元の記録(T20)との関係]]) |
| [[T32-cloudflare-check\|T32]] | D1 でのクエリ数(SQLite の `begin` / `commit` 4 本は出ない見込み)、アップロード全体の CPU 時間、workerd での `getI18nConfig()` |

> [!note] 反映済み(リーダー)
> 実行中の [[T23-upload-hook|T23]] と [[T21-orphan-routes|T21]] には、メッセージで伝えた。[[T25-images-page|T25]]・[[T27-image-widget|T27]]・[[T28-gallery-widget|T28]]・[[T29-plugin-definition|T29]]・[[T32-cloudflare-check|T32]] のノートと仕様書 19 章には、[[T18-1-handoff-upload-route|T18-1]] で書いた。T14 の `INVALID_TARGET` の文言は、[[T18-2-invalid-target-message|T18-2]] で、エントリの言語がサイトに無いときにも合うように直した。

### 未解決

1. `imageRefs` の保存で失敗したとき、または作成と `imageRefs` の間で処理が止まったときに残るエントリは、画像管理ページから扱えない。起きるのは、データベースの失敗か処理の中断のときだけ。拾うなら、仕様書 19 章の「既存の `b64_images` を `imageRefs` に登録する機能」が要る(サブタスクの候補)。
2. Workers(workerd + D1)での動作、クエリ数、CPU 時間は確かめていない([[T32-cloudflare-check|T32]])。
3. i18n のサイトで、Astro のロケールをオブジェクト(`{ path, codes }`)で書き、既定ロケールの `path` が参照の形に合わないとき、ルートは作る前に 500 にする。そういうサイトは作って試していない。根拠: **推測のみ**

### 変更したファイル

- 新規: `src/server/routes/upload.ts`、`tests/server/upload.test.ts`、`docs/emdash-plugin-upload-route.md`
- 変更: `plans/base64-image-plugin-spec.md`(5.4・7 章)、このノート
- `spikes/upload-route/**`(git 管理外。コミットしない)
