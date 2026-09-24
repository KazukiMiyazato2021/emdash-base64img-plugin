---
title: 参照元の記録(afterSave / afterPublish)の動き、操作ごとの記録とクエリ数
aliases:
  - 参照元の記録の hook
  - imageRefs の owners の記録
  - errorPolicy continue の例外はログに出ない
tags:
  - docs
  - emdash
  - plugin
  - hooks
  - base64-image
source_task: "[[T20-owner-tracking]]"
created: 2026-09-24
updated: 2026-09-24
---

# 参照元の記録(afterSave / afterPublish)の動き、操作ごとの記録とクエリ数

> [!summary] 要点
> - 参照元 `{ collection, entryId, locale, field }` の値は、`event.collection`・`event.content.id`・`event.content.locale` から作る。afterSave と afterPublish のどちらの `content` にも `id` / `locale` がある。event のキーは、afterSave が `content` / `collection` / `isNew` / `actor`、afterPublish が `content` / `collection`。
> - hook のクエリは、参照の形の値が無ければ **0**。あれば、フィールド定義 2 + `getMany` 1 = **3**(記録済みなら書かない。ふつうの保存・自動保存・公開)。参照元が増える画像 1 枚につき **+2**(`getVersioned` + `compareAndSet`)。管理画面と REST の、作成・下書きの保存・自動保存・公開・一覧の一括公開・同じ画像を 2 つの投稿で使う、のどれでも、この数だった(SQLite)。
> - 管理画面の「公開」は保存(PUT)と公開(POST)の 2 リクエストで、afterSave と afterPublish の両方が呼ばれる(2 回目は記録済みで書かない)。一覧の一括公開と、複製したエントリの公開は afterPublish だけ。複製そのものはどの hook も呼ばない。
> - **`errorPolicy: "continue"` の hook が投げた例外は、EmDash がログに出さない**(結果の配列に残すだけ)。後に続くプラグインは呼ばれる。hook は失敗を自分で `ctx.log` に出す。
> - `priority: 50` にすると、既定(100)・`"abort"` のほかのプラグインの afterSave が例外を投げても、先に実行されて記録できる。そのプラグインより後の(優先度 200 の)プラグインは呼ばれない。
> - 開発サーバーのクエリログ(`EMDASH_QUERY_LOG=1`)には、応答を送り終えたあとに実行された hook のクエリが出ない。hook のクエリは、hook の前後で `getRequestContext().metrics.dbCount` の差を取って数えた。
> - 関連: [[T20-owner-tracking]]、[[emdash-plugin-storage-conditional-writes]]、[[emdash-after-save-payload]]、[[emdash-plugin-content-query-counts]]、[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9 章]]

> [!info] 確かめた方法と環境
> - playground を複製した使い捨てのサイト(`spikes/owner-tracking/site/`、git 管理外)に、次の 3 つのプラグインを入れた。[[#再現手順]]
>   - `base64-image`: T16 の beforeSave と、T20 の `trackImageOwners` を、呼び出しとクエリを数える ctx で呼ぶ afterSave / afterPublish(`priority: 50`、`errorPolicy: "continue"`)。T29 と同じく `imageOwnerHooks` をそのまま登録した起動でも、記録されることを確かめた
>   - `spike-thrower`: 既定の設定(優先度 100、`"abort"`)の afterSave。タイトルに `[boom]` があると例外を投げる
>   - `spike-observer`: 優先度 200 の afterSave / afterPublish。呼ばれたことだけを記録する
> - 操作は、REST(管理画面と同じリクエスト)と、Playwright で動かした管理画面の両方で行った。widget はまだ無いので、`cover` / `gallery` は JSON の入力欄に参照を入れた。
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`)、Playwright 1.63.0(Chromium 153.0.8010.12、headless)。開発サーバーはポート 4420。2026-09-24 に計測。行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。
> - Cloudflare Workers(workerd + D1)では確かめていない([[T32-cloudflare-check|T32]])。

## event と参照元の値

| 項目 | afterSave | afterPublish | 根拠 |
|---|---|---|---|
| event のキー | `content` / `collection` / `isNew` / `actor`(94 回) | `content` / `collection`(77 回) | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:603-645`、`:811-847`) |
| `content` | `contentItemToRecord(item)` = エントリ全体(`id` / `locale` / `status` / `data` / 更新で下書きがあれば `liveData` …) | 公開したあとのエントリ(`status: "published"`、`liveData` は無い) | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:545-547`、`:3669-3671`、`:4224-4232`) |
| `entryId` | `content.id` | `content.id` | 実測のみ |
| `locale` | `content.locale`(型は `string \| null`。このサイトでは `en`) | 同じ | 実測+公式ドキュメント(`core/src/database/repositories/types.ts:302`) |
| `collection` | `event.collection` | `event.collection` | 実測+公式ドキュメント |

- `locale` が `null` や、ID・ロケールが `imageOwnerSchema` に合わないときは、記録せずに警告を出す(クエリなし)。0.39.1 のマイグレーション(`019_i18n`)で、どの行にも `locale`(既定 `en`)が入るので、ふつうは起きない。根拠: 公式ドキュメントのみ
- 予約公開も `handleContentPublish` を通るので、afterPublish が呼ばれる(`core/src/emdash-runtime.ts:862-880`)。根拠: 公式ドキュメントのみ

## 操作ごとの記録とクエリ数

「hook のクエリ」は hook の前後の `metrics.dbCount` の差。どの行でも、呼び出しの数(`getCollection` 2、ほかは 1 回 1)から見込んだ数と一致した。「db.count」はリクエストの `Server-Timing`(hook のクエリは一部しか入らない)。根拠: どれも実測のみ(SQLite)。

### REST

| 操作 | リクエスト | 呼ばれた hook | `liveData` | 結果 | hook のクエリ | db.count |
|---|---|---|---|---|---|---|
| 作成 | `POST /content/posts` | afterSave(`isNew: true`) | 無い | 1 枚を追記 | 5 | 38 |
| 下書きの保存(未公開の投稿) | `PUT` | afterSave | ある(作成時の値) | 2 枚を追記、1 枚は記録済み | 7 | 59 |
| 自動保存 | `PUT`(`skipRevision`) | afterSave | ある | 3 枚とも記録済み | 3 | 64 |
| 公開(API だけ) | `POST …/publish` | afterPublish | 無い | 3 枚とも記録済み | 3 | 58 |
| 公開済みの投稿の下書きで cover を差し替え | `PUT` | afterSave | ある(公開版) | 新しい cover を追記。公開版の cover は記録済み | 5 | 59 |
| 同じ画像を 2 つ目の投稿で使う | `POST` | afterSave | 無い | 追記(`owners` が 2 件) | 5 | 38 |
| SEO だけの更新 | `PUT`(`data` なし) | afterSave(beforeSave は無し) | ある | 4 枚とも記録済み | 3 | 43 |
| 複製 5 件 → 5 件を並行に公開 | `POST …/duplicate` × 5 → `POST …/publish` × 5 | 複製: なし。公開: afterPublish × 5 | 無い | 5 件とも追記(`owners` が 6 件) | 5 ずつ | — |
| 同じ画像の投稿を 8 件同時に作成 | `POST` × 8 | afterSave × 8 | 無い | 8 件とも追記 | 5 ずつ | — |
| seed の画像を参照する投稿の公開 | `POST …/publish` | afterPublish | 無い | 記録が無い(`missing`)。作らずに警告 | 3 | — |
| 画像のフィールドを持たない `pages`(json に参照の形の値が無い / ある) | `POST /content/pages` | afterSave | 無い | 読み飛ばし(`no-references` / `no-image-fields`) | 0 / 2 | — |

- アップロードの代わりのルート(`ctx.content.create` → `getVersioned` → `publish`)では、このプラグインの afterSave は呼ばれず(ほかの 2 つには届く)、afterPublish は呼ばれて `b64_images` として読み飛ばした(クエリ 0)。T10 の結果と同じ。根拠: 実測+公式ドキュメント(`core/src/emdash-runtime.ts:2147`)

### 管理画面(Chromium)

| 操作 | 送られたリクエスト(db.count) | 呼ばれた hook | 結果 | hook のクエリ |
|---|---|---|---|---|
| 新規作成の画面で Save | `POST /content/posts`(40)、`POST …/lock`(11) | afterSave(`isNew: true`) | 追記 | 5 |
| 編集画面で Gallery を入れて Save | `PUT`(58。`data` は `title` / `cover` / `gallery`) | afterSave | Gallery の画像を追記、cover は記録済み | 5 |
| タイトルを変えて待つ(自動保存) | `PUT`(63、`skipRevision`) | afterSave | 記録済み | 3 |
| 「Publish now」→ 確認の「Publish now」 | `PUT`(65)→ `POST …/publish`(57) | afterSave → afterPublish | どちらも記録済み | 3 + 3 |
| 2 つ目の投稿を同じ cover で作成 | `POST`(40) | afterSave | 追記(`owners` が 2 件) | 5 |
| 一覧の行の「Duplicate」を 2 回 | `POST …/duplicate`(39、40) | **なし** | 変わらない | 0 |
| 一覧で 3 件(複製 2 件と元の下書き)を選んで「Publish」 | `POST …/publish` × 3(53 ずつ。確認のダイアログは無い) | afterPublish × 3 | 複製 2 件を追記、元は記録済み | 5 / 5 / 3 |

- 保存の後に入った URL は `/_emdash/admin/content/posts/<ID>?locale=en` だった(`?locale=` が付く)。根拠: 実測のみ
- hook の処理時間(クエリを含む)は 1 回 1〜3ms だった(SQLite、待ちなし)。根拠: 実測のみ

## hook の順番と errorPolicy

`spike-thrower`(優先度 100、`"abort"`)と `spike-observer`(優先度 200)を並べた。

| 場面 | 呼ばれた順 | 記録 | 根拠 |
|---|---|---|---|
| ふつうの保存 | base64-image(50)→ spike-thrower(100)→ spike-observer(200) | される | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:390-420`) |
| spike-thrower が例外(`[boom]`) | base64-image → spike-thrower(例外)。**spike-observer は呼ばれない**。サーバーのログに `EmDash afterSave hook error: …` | される(先に実行されたため) | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:638-640`、`core/src/emdash-runtime.ts:5572-5574`) |
| base64-image の hook が例外(`[throw]`、`errorPolicy: "continue"`) | base64-image(例外)→ spike-thrower → spike-observer | —(例外の前に記録した) | 実測+公式ドキュメント |
| 同上のときのサーバーのログ | **何も出ない** | — | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:630-641` は、`"continue"` のとき結果の配列に入れるだけ) |

- T20 の hook は例外を投げない(失敗は `ctx.log` に出す)。`errorPolicy: "continue"` で動きが変わるのは、hook がタイムアウト(既定 5,000ms)で失敗したときだけ。タイムアウトしても hook の処理は止まらずに続く(`core/src/plugins/hooks.ts:425-436` は `Promise.race` で打ち切るだけ)。根拠: 公式ドキュメントのみ
- 単体テストでも、EmDash の `createHookPipeline` に、例外を投げる既定の設定のプラグインを先に登録して、T20 の hook が先に実行されて記録することを確かめた(`tests/server/owners.test.ts`)。根拠: 実測のみ

## 記録が無い・壊れているとき

| 記録 | 動き | ログ | 根拠 |
|---|---|---|---|
| 無い(seed の画像、完全削除された画像) | 作らない | `warn`: `content:afterPublish: image owners were not recorded for images without an imageRefs record (created by seed or deleted permanently)` と `{ hook, collection, entryId, ids, count }` | 実測のみ |
| `owners` が配列でない・記録がオブジェクトでない | 書かない | `error`: `… because the imageRefs record is not an object or its owners is not an array` | 実測のみ |
| `imageRefsRecordSchema` に合わない(例: `thumb` が無い)が、`owners` は配列 | 追記する(ほかのキーはそのまま) | `warn`: `… were appended to imageRefs records that do not match the schema` | 実測のみ |

- ログは `ctx.log` の `console.warn` / `console.error` で、`[plugin:base64-image]` が前に付く(`core/src/plugins/context.ts:1295-1330`)。根拠: 実測+公式ドキュメント
- seed の投稿は、管理画面では保存できない(T16 の beforeSave が拒否する)。公開(API)・SEO だけの更新・一部のフィールドだけの PUT では afterSave / afterPublish まで進むので、上の警告が出る。根拠: 実測+公式ドキュメント([[T16-reference-hook#seed の画像の扱い]])

## hook のクエリの数え方

- 開発サーバーのクエリログ(`EMDASH_QUERY_LOG=1`)は、応答を送り終えたときに 1 回だけ書き出される(`core/src/database/instrumentation.ts:83` の `flushRecorder` は 2 回目以降は何もしない)。そのあとに `after()` で実行された hook のクエリは記録されても書き出されない。実測でも、hook の `compareAndSet`(`update "_plugin_storage" … "revision" = ?`)はログに無かった。根拠: 実測+公式ドキュメント
- `metrics.dbCount` は、クエリのたびにリクエストの文脈で数える(`instrumentation.ts` の `kyselyLog`)。`after()` の hook もリクエストの文脈の中で実行されるので(171 回すべてで文脈があった)、hook の前後の差が hook のクエリ数になる。同じリクエストのほかの `after()`(リビジョンの整理など)が重なると差に混ざりうるが、今回は呼び出しの数からの見込みと毎回一致した。根拠: 実測+公式ドキュメント

```ts
// spike のプラグインの計測(抜粋)
import { getRequestContext } from "emdash";

const metrics = getRequestContext()?.metrics;
const before = metrics?.dbCount;
const result = await trackImageOwners(event, countingCtx, "content:afterSave");
const dbDelta = before === undefined ? null : metrics!.dbCount - before;
```

## 記録から漏れる経路(T10 の表に足すもの)

| 経路 | 記録への影響 | 根拠 |
|---|---|---|
| i18n を有効にしたサイトで、「翻訳しない」(`translatable: false`)画像フィールド | 公開(と、revisions に対応しないコレクションの更新)のときに、EmDash が同じ翻訳グループのほかのロケールのエントリへ値を写す。写された側の hook は呼ばれないので、その側を保存・公開するまで参照元に入らない。写した元のエントリは記録されるので、画像が「参照元なし」になることは無い | 公式ドキュメントのみ(公開は `core/src/api/handlers/content.ts:1821-1834`、更新は `:1171-1181`(revisions に対応したコレクションの更新では `data` が渡らないので写さない。`core/src/emdash-runtime.ts:3627-3636`)、写す処理は `core/src/database/repositories/content.ts:1341-1392`) |
| 同時の保存・公開での追記の競合 | 版を確かめて書くので消えない。8 回試しても版が変わり続けたときだけ記録されない(警告を出す。エントリを次に保存・公開したときに記録される) | 実測のみ([[emdash-plugin-storage-conditional-writes]]) |

## 再現手順

1. `playground/src` と `tsconfig.json` を `spikes/owner-tracking/site/` に複製し、`package.json`(playground と同じ `dependencies`)、`astro.config.mjs`、`seed/seed.json`(`b64_images`・`posts`・画像のフィールドの無い `pages`、seed の画像とそれを参照する下書きの投稿)を置く。
2. `spikes/owner-tracking/site/` で起動する。プラグインを変えたら起動し直す。

```sh
SPIKE_OWNERS_MODE=cas EMDASH_QUERY_LOG=1 node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4420
node <worktree>/node_modules/astro/bin/astro.mjs dev stop
```

```js
// spikes/owner-tracking/site/astro.config.mjs(抜粋)
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [
		{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/spike-owners.ts", options: {} },
		{ id: "spike-thrower", version: "0.0.0", entrypoint: "/plugins/spike-thrower.ts", options: {} },
		{ id: "spike-observer", version: "0.0.0", entrypoint: "/plugins/spike-observer.ts", options: {} },
	],
	fonts: false,
}),
```

```ts
// spikes/owner-tracking/site/plugins/spike-owners.ts(抜粋)
import { definePlugin } from "emdash";
import { imageOwnerHooks, trackImageOwners } from "../../../../src/server/hooks/owners.ts";
import { validateReferencesBeforeSave } from "../../../../src/server/hooks/references.ts";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read"],
		storage: { imageRefs: { indexes: ["createdAt"] } },
		hooks: {
			"content:beforeSave": { handler: async (event, ctx) => validateReferencesBeforeSave(event, ctx) },
			// T29 と同じ登録。計測するときは、同じ priority / errorPolicy で trackImageOwners を包んだ handler にする
			...imageOwnerHooks,
		},
		routes: {
			// アップロードの代わり: ctx.content.create → getVersioned → publish → imageRefs.put(owners は空)
			"spike/create-image": { handler: async (ctx) => { /* … */ } },
		},
	});
}
```

3. REST は `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` の Cookie と `X-EmDash-Request: 1` で呼ぶ。管理画面は Playwright で操作する(最初の画面の「Get Started」を閉じる。入力欄は `getByRole("textbox", { name: "Title", exact: true })`、`"Cover (optional)"`、`"Gallery (optional)"`。JSON を入れたら `blur()`。一覧の行のチェックボックスは `Select <タイトル>`、複製は `Duplicate <タイトル>`、一括公開は選択後に出る「Publish」)。
