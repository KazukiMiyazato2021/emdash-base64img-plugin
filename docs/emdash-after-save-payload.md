---
title: EmDash 0.39.1 の content:afterSave に渡る内容と、操作ごとに呼ばれる hook
aliases:
  - afterSave に渡る内容
  - content hook の呼ばれ方
  - afterDelete の event の形
tags:
  - docs
  - emdash
  - plugin
  - hooks
source_task: "[[T10-spike-after-save]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の content:afterSave に渡る内容と、操作ごとに呼ばれる hook

> [!summary] 要点
> - `content:afterSave` の `event.content.data` は、**保存した直後の編集中の版**。drafts / revisions に対応したコレクション(`posts`)では下書きで、公開版ではない。更新のときは、content テーブルの列の値(公開済みなら公開版)が `event.content.liveData` に別に入る。
> - `isNew` は、作成(REST の POST、プラグインの `ctx.content.create`)で `true`、更新(保存・自動保存・メタデータだけの更新)で `false`。
> - afterSave が呼ばれるのは**作成と更新だけ**。公開・ゴミ箱への移動・復元・完全削除・複製・リビジョンの復元・下書きの破棄では呼ばれない。管理画面の「公開」は保存(PUT)と公開(POST)の 2 リクエストなので、保存の側で呼ばれる。
> - **複製はどの hook も呼ばない。** 複製先は、元の列の値(公開版)を持つ下書きになる。保存されるまで、参照元の記録から漏れる。
> - afterSave は `after()` で実行され、**応答を待たせない**。hook の中で 2 秒待っても、保存の応答は 15ms で返った。hook は保存の直後に始まり、応答とほぼ同時か後に終わる。
> - hook の既定の `errorPolicy` は `"abort"`。afterSave が例外を投げても保存は成功したままだが、**後に続くプラグインの afterSave が呼ばれなくなる**。
> - `content:afterDelete` の event は `{ id, collection, permanent }`。ゴミ箱への移動は `permanent: false`、完全削除は `true`。`id` は URL で指定した値そのもの(slug で完全削除すると slug が入る)。
> - プラグインの `ctx.content.create` は保存 hook を通るが、**呼んだプラグイン自身の afterSave は呼ばれない**(他のプラグインには `isNew: true` で届く)。`ctx.content.publish` は afterSave を呼ばず、afterPublish は呼んだプラグインにも届く。`ctx.content.update` / `delete` はどの hook も呼ばない。
> - 関連: [[T10-spike-after-save]]、[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9 章]]、[[emdash-plugin-content-query-counts]](読み出しのクエリ数)、[[emdash-plugin-content-api-constraints]]、[[T20-owner-tracking]]、[[T21-orphan-routes]]

> [!info] 確かめた方法と環境
> - playground を複製した使い捨てのサイト(`spikes/after-save/site/`、git 管理外)に、受け取った event をそのまま JSONL に書く native プラグイン 2 つ(`spike-recorder`、`spike-observer`)を入れた。操作は、管理画面が送るのと同じ REST のリクエストと、Playwright で動かした実際の管理画面の両方で行った。[[#再現手順]]
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`)、Playwright 1.63.0(Chromium 153.0.8010.12、headless)。開発サーバーはポート 4410。2026-09-24 に計測。
> - インストールされた `node_modules/emdash/src` の `emdash-runtime.ts` / `plugins/hooks.ts` / `plugins/content-access.ts` / `after.ts` は、`references/emdash/`(タグ `emdash@0.39.1`)と同一だった(`diff`)。以下の行番号は `references/emdash/packages/` 以下。
> - Cloudflare Workers(workerd + D1)では、[[T32-cloudflare-check|T32]] が `wrangler dev`(ローカルの D1)で参照元の記録の hook(afterSave・afterPublish)を動かし、クエリ数と記録の結果が Node と同じだった([[workerd-d1-plugin-behavior]])。event の中身を記録して比べてはいない。本番の Workers では確かめていない。

## 操作ごとに呼ばれる hook

`posts`(`supports: ["drafts", "revisions", "search", "seo"]`)で記録した。根拠の「(REST と管理画面)」は、REST で送ったリクエストと、Playwright で実際の管理画面を操作したとき(送られたリクエストと hook を突き合わせた)の両方で確かめたもの。

| 操作 | リクエスト | 呼ばれる hook | `isNew` | `content.data` | `content.liveData` | 根拠 |
|---|---|---|---|---|---|---|
| 新規作成 | `POST /content/posts` | beforeSave → afterSave | `true` | 送ったデータ | 無い | 実測+公式ドキュメント(REST と管理画面) |
| 下書きの保存 | `PUT /content/posts/{id}` | beforeSave → afterSave | `false` | 保存した下書き | 列の値(未公開なら作成時の値) | 実測+公式ドキュメント(REST と管理画面) |
| 自動保存 | `PUT`(`skipRevision: true`) | beforeSave → afterSave | `false` | 保存した下書き | 列の値 | 実測+公式ドキュメント(REST と管理画面) |
| 公開(管理画面のボタン) | `PUT` → `POST …/publish` | PUT で beforeSave → afterSave、publish で afterPublish だけ | `false` | 公開する直前の下書き(`status` は `draft`) | 列の値 | 実測+公式ドキュメント(REST と管理画面) |
| 公開(API だけ) | `POST …/publish` | afterPublish だけ | — | — | — | 実測+公式ドキュメント |
| 公開済みの投稿の下書きの編集 | `PUT` | beforeSave → afterSave | `false` | 保存した下書き(`status` は `published`) | 公開版 | 実測+公式ドキュメント(REST と管理画面) |
| メタデータだけの更新(SEO・著者など) | `PUT`(`data` なし) | afterSave だけ(beforeSave は呼ばれない) | `false` | 今の下書き全体 | 列の値 | 実測+公式ドキュメント |
| 複製 | `POST …/duplicate` | **なし** | — | — | — | 実測+公式ドキュメント(REST と管理画面) |
| ゴミ箱への移動 | `DELETE /content/posts/{id}` | afterDelete(`permanent: false`) | — | — | — | 実測+公式ドキュメント(REST と管理画面) |
| 復元 | `POST …/restore` | afterRestore だけ | — | — | — | 実測+公式ドキュメント |
| 完全削除 | `DELETE …/permanent` | afterDelete(`permanent: true`) | — | — | — | 実測+公式ドキュメント |
| リビジョンの復元 | `POST /revisions/{id}/restore` | **なし** | — | — | — | 実測+公式ドキュメント |
| 下書きの破棄 | `POST …/discard-draft` | **なし** | — | — | — | 実測+公式ドキュメント |

- `liveData` は、保存のあとに下書きのリビジョンがあるときだけ入る。revisions に対応していないコレクションでは入らない(`hydrateDraftData` は `draftRevisionId` が無ければ何もしない。`core/src/emdash-runtime.ts:3213-3216`)。根拠: 実測(`posts`)+公式ドキュメント
- 作成の afterSave は `core/src/emdash-runtime.ts:3392-3401`(`isNew: true`)、更新は `:3642-3671`(下書きを読み込んでから `isNew: false`)。公開は `:4224-4232`(afterPublish)、ゴミ箱は `:3703-3706`、完全削除は `:3757-3760`、復元は `:3736-3744`(afterRestore)。複製 `:3769-3775`、リビジョンの復元 `:4684-4781`、下書きの破棄 `:4349-4355` には hook の呼び出しが無い。
- 管理画面の自動保存は、最後の変更から 2 秒後に、フォームの全フィールドと `skipRevision: true` を送る(`admin/src/components/ContentEditor.tsx:77`、`:765-808`、`admin/src/router.tsx:1164-1171`)。新規作成の画面では自動保存しない。実測で、2 秒後に `PUT`(`skipRevision: true`)が 1 回送られた。
- 管理画面の「Publish now」は確認のダイアログを出し、保存してから公開する(`admin/src/router.tsx:1483-1497`)。実測で `PUT` → `POST …/publish` の順に送られた。
- 管理画面の複製は、一覧の行の「Duplicate」ボタンで行い、一覧に留まる(複製先の編集画面は開かない。`admin/src/router.tsx:504-516`)。
- 公開の afterPublish の `content` は公開後のエントリ(`status: "published"`、`draftRevisionId: null`、`data` は公開したデータ)。復元の afterRestore の `content` は、`status: "draft"`、`liveRevisionId: null` のエントリ(`core/src/database/repositories/content.ts:1513-1544`)。根拠: 実測+公式ドキュメント

## afterSave の event の形

- event のキーは `content` / `collection` / `isNew` / `actor`。`actor` は `{ id, role }` で、REST と管理画面からの保存にはあり、プラグインの `ctx.content.create` には無い。根拠: 実測+公式ドキュメント(`core/src/plugins/hooks.ts:603-645`)
- `content` はエントリ全体(`contentItemToRecord` は `{ ...item }`。`core/src/emdash-runtime.ts:545-547`)。キーは `id` / `type` / `slug` / `status` / `data` / `authorId` / `primaryBylineId` / `createdAt` / `updatedAt` / `publishedAt` / `scheduledAt` / `liveRevisionId` / `draftRevisionId` / `version` / `locale` / `translationGroup` / `seo` / `bylines` / `byline`、更新のときはさらに `liveData`。根拠: 実測のみ
- 更新のときの `data` は、下書きのリビジョンを列の値に重ねたもの(`{ ...列の値, ...下書き }`)。`_slug` など `_` で始まる内部のキーは除かれる(`core/src/emdash-runtime.ts:3203-3267` の `hydrateDraftData`)。`liveData` は列の値そのもの。根拠: 実測+公式ドキュメント
- 列の値は「公開版」とは限らない。一度も公開していないエントリでは、作成したときの値のまま残る(下書きの保存はリビジョンにだけ書く。`core/src/emdash-runtime.ts:3515-3517`)。公開すると、下書きの値が列に移る。根拠: 実測+公式ドキュメント
- `PUT` で一部のフィールドだけを送ると、**beforeSave には送ったフィールドだけ**が渡り、afterSave には合わせた全体が渡る(`data: { cover }` だけの PUT で確かめた)。管理画面は毎回すべてのフィールドを送る。根拠: 実測のみ

```jsonc
// 公開済みの投稿で、cover を差し替えて保存したときの afterSave(抜粋)
{
  "collection": "posts",
  "isNew": false,
  "actor": { "id": "01M…", "role": 50 },
  "content": {
    "id": "01M…", "status": "published", "locale": "en",
    "liveRevisionId": "01M…", "draftRevisionId": "01M…",
    "data": { "title": "T10 A", "cover": { "v": 1, "id": "<img4>", … }, "gallery": [ { "id": "<img3>", … } ] },
    "liveData": { "title": "T10 A", "cover": { "v": 1, "id": "<img2>", … }, "gallery": [ { "id": "<img3>", … } ] }
  }
}
```

## 呼ばれる時機

- afterSave と afterDelete は `after()` に渡される(`core/src/emdash-runtime.ts:5560-5590`)。`after()` は `Promise.resolve().then(fn)` で次のマイクロタスクに実行を回し、workerd では `waitUntil` に渡す(`core/src/after.ts:50-66`)。根拠: 公式ドキュメントのみ
- **応答を待たせない。** afterSave の中で 2 秒待つと、hook の終わりは 2,003ms 後だったが、保存の応答は 14.9ms で返った。根拠: 実測のみ(Node + SQLite)
- hook は保存の処理の直後に始まる。どの保存でも、hook の開始はクライアントが応答を受け取る 1〜8ms 前だった。Node では、hook の中の短い処理(プラグインストレージの読み書き)は応答とほぼ同時に終わる。ただし応答が hook の終わりを待つわけではないので、保存の応答を受け取った直後に記録を読むと、まだ書かれていないことがありうる。根拠: 実測のみ(最後の一文は推測のみ)
- hook のクエリは、保存したリクエストと同じリクエストの文脈で数えられる。`Server-Timing` の `db.count` はヘッダーを作った時点の数なので、hook のクエリは一部しか入らない。ボディを送り終えた時点の数(`EMDASH_QUERY_LOG=1` の `[emdash-stream-end]`)には、hook の `getMany` などが入っていた。根拠: 実測+公式ドキュメント(`core/src/astro/middleware.ts:1053-1063`)
- Cloudflare Workers では、hook は `waitUntil` で応答の後も続く。D1 の場合、リクエスト単位の DB(`createRequestScopedDb`)に `close` が無いので、`after()` の作業は `waitUntil` だけで保たれる(`core/src/astro/middleware/scoped-db.ts` の `coordinateScopedDbLifecycle`)。応答後の hook のクエリも、同じ呼び出し(invocation)のクエリ数に入る見込み。根拠: 公式ドキュメントのみ(実測は [[T32-cloudflare-check|T32]])
- 同じ hook のプラグインは、優先度(`priority`、既定 100、小さいほど先)の順に **1 つずつ** 実行される。前のプラグインの afterSave が 2 秒待つと、次のプラグインの afterSave も 2 秒遅れた。根拠: 実測+公式ドキュメント(`core/src/plugins/hooks.ts:389-419`、`:613-642`)
- 各 hook の既定のタイムアウトは 5,000ms(`core/src/plugins/define-plugin.ts:258-290`)。根拠: 公式ドキュメントのみ

### afterSave が例外を投げたとき

| 確かめたこと | 結果 | 根拠 |
|---|---|---|
| 保存の応答 | 成功のまま(作成 201、更新 200) | 実測のみ |
| ログ | `EmDash afterSave hook error: Error: …` がサーバーのログに出る | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:5572-5574`) |
| 後に続くプラグインの afterSave | **呼ばれない**(`spike-observer` の afterSave が呼ばれなかった) | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:638-640`。既定の `errorPolicy` は `"abort"`) |

- `errorPolicy: "continue"` にすると、例外は結果に残るだけで次のプラグインに進む(`core/src/plugins/hooks.ts:630-641`)。根拠: 公式ドキュメントのみ
- 裏返すと、自分より先に実行される他のプラグインの afterSave が例外を投げると、自分の afterSave が呼ばれない(上の実測の `spike-observer` がこの立場)。根拠: 実測+公式ドキュメント

## afterDelete の event

- event のキーは `id` / `collection` / `permanent` の 3 つ(0.39.1 で実測。`core/src/plugins/types.ts:1333-1338`)。`skills/creating-plugins/references/hooks.md` の説明には `permanent` が書かれていないが、実際には入る。根拠: 実測+公式ドキュメント
- ゴミ箱への移動は `permanent: false`、完全削除は `permanent: true`。`b64_images` でも同じだった。根拠: 実測のみ
- 完全削除の `id` は、URL で指定した値そのもの(`core/src/emdash-runtime.ts:3749-3760` が引数の `id` を渡す)。slug(`t10-e`)で完全削除すると、event の `id` は `"t10-e"` だった。ゴミ箱への移動では、ルートが ID に解決してから渡す。`b64_images` は slug が無いので、ID で呼ぶしかない。根拠: 実測+公式ドキュメント
- afterDelete は、プラグインの `ctx.content.delete` では呼ばれない(`b64_images` で確かめた)。根拠: 実測+公式ドキュメント(`core/src/plugins/context.ts:897-908`)

## プラグインからの書き込み

`spike-recorder` のルートから `ctx.content.*` を呼び、`spike-recorder`(呼んだプラグイン)と `spike-observer`(他のプラグイン)に届いた hook を比べた。

| 呼び出し | 呼んだプラグイン | 他のプラグイン | 根拠 |
|---|---|---|---|
| `ctx.content.create("b64_images" / "posts", …)` | beforeSave は呼ばれる。**afterSave は呼ばれない** | afterSave が `isNew: true`、`status: "draft"` で届く | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:2128-2157` の `excludeAfterSavePluginId`、`core/src/plugins/hooks.ts:614`) |
| `ctx.content.publish(…)` | afterSave は呼ばれない。afterPublish は呼ばれる | afterPublish が届く | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:3894-3918`) |
| `ctx.content.update(…)` | どの hook も呼ばれない | どの hook も届かない | 実測+公式ドキュメント(`core/src/plugins/context.ts:836-895`。`updateDraftAware` を直接呼ぶ) |
| `ctx.content.delete(…)` | どの hook も呼ばれない | どの hook も届かない | 実測+公式ドキュメント(`core/src/plugins/context.ts:897-908`) |

- `ctx.content.update` は、revisions に対応したコレクションでは下書きのリビジョンを作る(列の値は変えない)。根拠: 実測のみ
- 保存 hook の中から `ctx.content.create` を呼んだときは、保存 hook そのものが飛ばされる(`skipSaveHooks`)。ルートから呼んだときは飛ばされない。根拠: 公式ドキュメントのみ(`core/src/emdash-runtime.ts:2144-2146`)

## 参照元の記録から漏れる経路

「参照を含むデータが、afterSave を通らずにエントリに入る」経路。記録を追記だけにしているので、同じエントリの過去の値から戻るものは漏れない。

| 経路 | 入る値 | afterSave | 記録への影響 | 根拠 |
|---|---|---|---|---|
| 複製 | 元の**列の値**(公開版。元の未公開の下書きは入らない) | 呼ばれない | 複製先が保存されるまで、複製先は参照元に入らない。元が画像を外すと「参照元から外された」と判定されるが、複製先はまだ使っている | 実測+公式ドキュメント(`core/src/database/repositories/content.ts:518-556`) |
| リビジョンの復元 | 同じエントリの過去のリビジョン | 呼ばれない | そのリビジョンを保存したときに記録済みなので漏れない | 実測+公式ドキュメント |
| 下書きの破棄 | 列の値に戻る | 呼ばれない | 列の値は記録済みなので漏れない | 実測+公式ドキュメント |
| ゴミ箱からの復元 | 列の値のまま | 呼ばれない(afterRestore) | ゴミ箱に入れても記録を消さないので漏れない | 実測+公式ドキュメント |
| seed | seed の値 | 呼ばれない | 記録されない([[emdash-plugin-content-api-constraints#seed のエントリ ID]]) | 公式ドキュメントのみ |
| 他のプラグインの `ctx.content.update` | そのプラグインが書いた値 | 呼ばれない | 記録されない | 実測+公式ドキュメント |
| 他のプラグインの `ctx.content.create` | そのプラグインが書いた値 | 呼ばれる(`isNew: true`) | 記録される | 実測+公式ドキュメント |

## 再現手順

1. playground の `astro.config.mjs` / `seed/seed.json` / `src/` を `spikes/after-save/site/` に複製し、`plugins` を spike のプラグインに差し替える。依存は worktree のルートの `node_modules` から解決される。
2. `spikes/after-save/site/` で `EMDASH_QUERY_LOG=1 node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4410` を実行する(エージェントから実行するとバックグラウンドになる。止めるのは同じディレクトリで `… astro.mjs dev stop`。[[astro-dev-background-for-agents]])。
3. `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` の `Set-Cookie` を使い、`X-EmDash-Request: 1` を付けて REST とプラグインのルートを呼ぶ。

> [!warning] 複製したサイトの `package.json` にも依存を書く
> spike のサイトの `package.json` に `dependencies` が無いと、`astro dev` のあとの最初のリクエストが `Failed to create the dev server app: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'astro:'` で止まった。`emdash` が Vite の SSR で外部モジュール扱いになり、Node が `astro:content` を読もうとするため(Astro は、サイトの `package.json` の依存から、バンドルするパッケージを決める)。playground と同じ `dependencies`(`astro`、`emdash`、`@astrojs/node`、`@astrojs/react`、`react`、`react-dom`)を書くと動いた。インストールは要らない(ルートの `node_modules` から解決される)。根拠: 実測のみ(原因は推測のみ)

プラグインの登録(descriptor の `entrypoint` はサイトのルートからの `/` 始まりのパスでよい):

```js
// spikes/after-save/site/astro.config.mjs(抜粋)
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [
		{ id: "spike-recorder", version: "0.0.0", entrypoint: "/plugins/recorder.ts", options: {} },
		{ id: "spike-observer", version: "0.0.0", entrypoint: "/plugins/observer.ts", options: {} },
	],
	fonts: false,
}),
```

受け取った event を書き出す hook(`spike-recorder` の抜粋):

```ts
import { appendFileSync } from "node:fs";
import { definePlugin } from "emdash";

const OUT = new URL("../../out/events.jsonl", import.meta.url).pathname;
const record = (e: Record<string, unknown>) =>
	appendFileSync(OUT, `${JSON.stringify({ t: Date.now(), plugin: "spike-recorder", ...e })}\n`);

export function createPlugin() {
	return definePlugin({
		id: "spike-recorder",
		version: "0.0.0",
		// afterSave / afterDelete などは content:read が無いと登録されない(core/src/plugins/hooks.ts:315-348)
		capabilities: ["content:read", "content:write", "content:publish", "content:revisions:read", "content:restore"],
		hooks: {
			"content:afterSave": {
				handler: async (event) => {
					record({ hook: "content:afterSave", phase: "start", eventKeys: Object.keys(event), ...event });
					const title = (event.content.data as { title?: string } | undefined)?.title ?? "";
					if (title.includes("[slow]")) await new Promise((r) => setTimeout(r, 2000)); // 応答を待たせるかの確認
					if (title.includes("[throw]")) throw new Error("spike: afterSave throws"); // errorPolicy の確認
					record({ hook: "content:afterSave", phase: "end", id: event.content.id });
				},
			},
			"content:afterDelete": { handler: async (event) => record({ hook: "content:afterDelete", eventKeys: Object.keys(event), event }) },
			"content:afterPublish": { handler: async (event) => record({ hook: "content:afterPublish", ...event }) },
			"content:afterRestore": { handler: async (event) => record({ hook: "content:afterRestore", ...event }) },
		},
	});
}
```

- 管理画面の操作は Playwright(Chromium)で行った。dev-bypass のあと、最初に開いた画面で「Welcome to EmDash, Dev!」のダイアログが出るので「Get Started」を押す。同じタイトルの投稿は slug が重なって作成に失敗するので、タイトルに時刻を入れる。フィールド名で探すときは `getByRole("textbox", { name: "Title", exact: true })` とする(「SEO Title」と重なる)。根拠: 実測のみ
- `json` のフィールド(widget が無いもの)は textarea で、フォーカスを外したときに値が反映される。値を入れたら `blur()` する。根拠: 実測のみ([[emdash-seed-and-b64-images#widget が見つからないフィールドの表示]])
