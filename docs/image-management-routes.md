---
title: 画像管理のルート(一覧の判定・クエリ数の予算・ページ送り・ゴミ箱・完全削除の後始末)
aliases:
  - 画像管理の一覧ルート
  - images/list と images/trash
  - 未使用画像の判定
  - 一覧のクエリ数の予算
tags:
  - docs
  - emdash
  - plugin
  - route
  - hooks
  - performance
  - base64-image
source_task: "[[T21-orphan-routes]]"
created: 2026-09-24
updated: 2026-09-24
---

# 画像管理のルート(一覧の判定・クエリ数の予算・ページ送り・ゴミ箱・完全削除の後始末)

> [!summary] 要点
> - 一覧(`images/list`)は、`imageRefs` を `createdAt` の新しい順に読み、画像ごとに画像エントリの状態(`entryStatus`)・参照元ごとの状態・状態バッジ(`usage`)を返す。仕様書 9 章の 4 つの状態と、画像エントリの 3 つの状態を、動いているサイトですべて再現して確かめた。根拠: 実測+公式ドキュメント
> - **予算は 1 リクエスト 100 クエリ**(ルートの固定費を含む)。最悪の見積もり(画像 5、新しい参照元のエントリ 6、コレクションの一覧 2 を 1 回)が収まるだけ載せ、1 ページは最大 10 枚。参照元が 1 件ずつの画像は 1 ページ 8 枚で、実際は 42(下書きなし)〜 90(画像がゴミ箱、参照元は下書きだけに画像)クエリだった。見積もりを実際の数が超えたページは無かった。根拠: 実測のみ(SQLite)
> - 参照元のエントリが 16 件以上ある画像は 1 枚で予算を超える。その画像だけを扱うリクエストを続け(応答は `items: []` と `nextCursor`)、1 回に 15〜16 件ずつ調べる。参照元 40 件で 2〜3 リクエスト、1 回最大 98 クエリだった。根拠: 実測のみ
> - カーソルは自前(最後に読んだ記録の `createdAt` と ID)。EmDash のストレージのカーソルは、その記録が消えると先頭から読み直すため。根拠: 公式ドキュメントのみ(EmDash)、実測のみ(自前のカーソル。単体テスト)
> - `getTrashedVersioned`(capability `content:restore`)を使う。記録だけが残った画像(`missing`)を、ゴミ箱と区別できる。根拠: 実測+公式ドキュメント
> - ゴミ箱(`images/trash`)はプラグインの `ctx.content.delete` で移す。**このとき `content:afterDelete` は呼ばれない**。標準 API のゴミ箱・完全削除・復元では hook が呼ばれる。完全削除で `imageRefs` の記録が消えること、T18 の後始末で残る「公開していない・ゴミ箱の・参照元なし」の画像を管理者が完全削除できることを確かめた。根拠: 実測+公式ドキュメント
> - ゴミ箱の状態は `imageRefs` に記録しない。0.39.1 には `content:afterRestore` があり、復元で呼ばれることも確かめたが、書く場所が 3 つに増え、一覧は結局エントリを読むため。根拠: 実測+公式ドキュメント(事実)、推測のみ(費用の見込み)
> - 関連: [[T21-orphan-routes]]、[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9 章]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10 章]]、[[base64-image-plugin-spec#11.5 画像管理ページ|仕様書 11.5]]、[[emdash-plugin-content-query-counts]]、[[emdash-plugin-content-api-constraints]]、[[image-owner-tracking-hooks]]、[[emdash-after-save-payload]]、[[emdash-plugin-route-permissions]]、[[emdash-admin-api-requests]]、[[cloudflare-workers-free-d1-limits]]

> [!info] 確かめた方法と環境
> - playground を複製した使い捨てのサイト(`spikes/orphan-routes/site/`、git 管理外)に、T21 のルートと hook を T29 と同じ形で登録したプラグイン(ID `base64-image`)と、`content:afterDelete` / `content:afterRestore` を記録するだけの別のプラグインを入れた。[[#再現手順]]
> - 画像 52 枚・投稿 156 件を REST で作り(参照元の記録は T20 の hook が書いた)、一覧を最後まで読んで、判定と `Server-Timing` の `db.count` をページごとに記録した。ロールは開発用の管理者の `users.role` を書き換えて変えた。
> - macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0(SQLite 3.53.4)、emdash 0.39.1、Astro 7.3.3(`astro dev`、ポート 4421)、`@astrojs/node` 11.1.6、zod 4.5.4、vitest 4.1.11。2026-09-24 に計測。
> - 行番号は `references/emdash/packages/core/src/` 以下(タグ `emdash@0.39.1`)。Cloudflare Workers(workerd + D1)では確かめていない([[T32-cloudflare-check|T32]])。

## ルートと hook の形(T29 向け)

| export | ファイル | 中身 |
|---|---|---|
| `imagesListRoute` | `src/server/routes/images-admin.ts` | `PluginRoute<ImagesListRequest>`。`permission: "content:read_drafts"`、`methods: ["POST"]`、`request: { body: "json", maxBytes: 3_085 }`、`input: imagesListRequestSchema` |
| `imagesTrashRoute` | 同上 | `PluginRoute<ImagesTrashRequest>`。`permission: "content:create"`、`methods: ["POST"]`、`request: { body: "json", maxBytes: 1_161 }`、`input: imagesTrashRequestSchema` |
| `handleImagesList` / `handleImagesTrash` | 同上 | ハンドラー。ctx は使う部分だけの型で、EmDash の `RouteContext<…>` を代入できる(型のテスト) |
| `imageDeletedHooks` | `src/server/hooks/image-deleted.ts` | `{ "content:afterDelete": { priority: 50, errorPolicy: "continue", handler } }` |
| `removeImageRefs` / `removeImageRefsAfterDelete` | 同上 | hook の本体。前者は結果(`ignored` / `removed` / `not-found` / `failed`)を返す |
| `listImagesPage` / `encodeImagesListCursor` / `decodeImagesListCursor` | `src/server/orphans.ts` | 判定とページ送りの本体、カーソル |
| `IMAGES_LIST_QUERY_BUDGET` / `IMAGES_LIST_MAX_ITEMS` / `IMAGES_LIST_MAX_OWNERS` / `LIST_QUERY_COSTS` | 同上 | 100 / 10 / 20 / `{ route: 1, refsPage: 1, schema: 2, imageEntry: 5, ownerEntry: 6 }` |

spike で、次と同じ形の `definePlugin` を動かした。根拠: **実測+公式ドキュメント**

```ts
// T29(src/index.ts)
import { definePlugin } from "emdash";

import { imageDeletedHooks } from "./server/hooks/image-deleted";
import { imageOwnerHooks } from "./server/hooks/owners";
import { imagesListRoute, imagesTrashRoute } from "./server/routes/images-admin";
import { IMAGE_REFS_STORAGE, ROUTES } from "./shared/constants";

definePlugin({
	// 一覧: schema:read(消されたコレクションの確認)、content:read(get)、content:revisions:read(getRevision)、
	//       content:restore(getTrashedVersioned)。ゴミ箱: content:write(delete)、content:restore。
	// hook の登録には content:read が要る。content:restore は content:read を含まない(plugins/types.ts:84-95)
	capabilities: ["schema:read", "content:read", "content:write", "content:revisions:read", "content:restore" /* , ほかのタスクの分 */],
	storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
	hooks: { ...imageOwnerHooks, ...imageDeletedHooks /* , content:beforeSave など */ },
	routes: { [ROUTES.imagesList]: imagesListRoute, [ROUTES.imagesTrash]: imagesTrashRoute /* , ほか */ },
});
```

- 宣言が足りないと、ハンドラーは「どの capability を宣言するか」を書いた `Error` を投げる(EmDash は 500 `INTERNAL_ERROR` にして、メッセージをサーバーのログに出す)。根拠: 実測のみ(単体テスト)
- `content:afterDelete` の登録には `content:read` が要る(`plugins/hooks.ts:329`)。無いと EmDash は警告を出して hook を登録しない。単体テストで、EmDash の `createHookPipeline` に登録して確かめた。根拠: 実測+公式ドキュメント

## 応答の形とページ送り(T25 向け)

| 項目 | 内容 |
|---|---|
| 呼び方 | `listImages({ cursor? })`(T14 の `src/client/api.ts`)。`POST /_emdash/api/plugins/base64-image/images/list`、body は `{}` か `{ cursor }` |
| 応答 | `{ items: ImageListItem[], nextCursor?: string }`。`nextCursor` が無ければ最後のページ |
| 並び | `imageRefs` の `createdAt` の新しい順。同じ時刻は画像 ID の大きい順 |
| 1 ページの枚数 | 0〜10 枚で変わる(クエリ数の見積もりで決まる)。10 枚を前提にしない |
| `items: []` と `nextCursor` | 参照元の多い画像を調べている途中。**画面は続けて次のページを読む**(一覧の終わりではない)。載せられない記録だけのページの後にも起きる |
| 項目 | `id` / `thumb` / `width` / `height` / `bytes` / `createdAt` / `entryStatus` / `usage` / `owners` |
| `entryStatus` | `active`(ゴミ箱に入っていない)/ `trashed`(ゴミ箱)/ `missing`(`b64_images` にエントリが無く、記録だけがある) |
| `usage` | `in_use` / `owner_deleted` / `detached` / `no_owner`。参照元ごとの状態のうち、この順で最初に見つかったもの |
| `owners` | 記録の順に先頭から 20 件まで(4 つのキーが同じものは 1 件)。`usage` はすべての参照元から決める。全体の件数は応答に無い |
| エラー | 400 `INVALID_CURSOR`(最初から読み直す)、400 `VALIDATION_ERROR`、401、403(Subscriber)、413(body が 3,085 バイトを超える)、500(データベースの失敗。途中までの結果は返さない) |

- ボタンの出し方(仕様書 10 章、[[T06-decision-trash-permission|T06]]): ゴミ箱への移動は `entryStatus: "active"` の画像に出し、`usage: "in_use"` なら確認で使用中であることを示す。完全削除(管理者)は `entryStatus: "trashed"` の画像にだけ出す。`missing` には操作が無い(記録を消すルートは無い。[[#残る課題]])。
- ゴミ箱に移したあとは、応答(`{ id, trashed: true }`)でその項目を `trashed` に変えればよい。完全削除のあとは、項目を画面から消す。記録は `after()` で実行される hook が消すので、直後に先頭から読み直すと、まれに `missing` として出うる(spike では、直後の読み出しで記録はもう無かった)。根拠: 実測のみ(直後に消えていたこと)、推測のみ(まれに残りうること)
- カーソルは位置(`createdAt` と ID)を持つので、読んでいる間に画像が完全削除されても、次のページはずれない。読んでいる間に足された画像は、先頭から読み直すまで出ない。根拠: 実測のみ(単体テスト)

## 判定

spike で、状態ごとに画像を作って一覧を読んだ結果。どれも期待どおりだった。根拠: **実測+公式ドキュメント**(判定の仕組みは `plugins/context.ts` の `get` / `getRevision` / `getTrashedVersioned`)

| 画像 | 作り方 | `entryStatus` | 参照元の状態 | `usage` |
|---|---|---|---|---|
| S01 | 公開した投稿の cover | active | in_use | in_use |
| S02 | 公開した投稿の下書き(PUT)だけに cover | active | in_use(下書きで見つかった) | in_use |
| S03 | cover に入れて公開 → cover を空にして公開 | active | detached | detached |
| S04 | 参照元の投稿をゴミ箱へ | active | owner_deleted | owner_deleted |
| S05 | 参照元の投稿を完全削除 | active | owner_deleted | owner_deleted |
| S06 | 参照元のコレクション(`events`)を消した | active | owner_deleted | owner_deleted |
| S07 | どこにも使っていない | active | — | no_owner |
| S08 | 使用中の画像をルートでゴミ箱へ | trashed | in_use | in_use |
| S09 | 記録だけ(エントリが無い) | missing | — | no_owner |
| S10 | T18 の後始末(作成 → 記録 → 公開せずにゴミ箱へ) | trashed | — | no_owner |
| S11 | T18 の中断(作成 → 記録 → 公開の前で止まった) | active | — | no_owner |
| S12a / S12b | 同じ投稿のギャラリーに 2 枚 | active | in_use | in_use |
| S13 | 投稿 2 件で使い、1 件をゴミ箱へ | active | in_use / owner_deleted | in_use |
| S14 | ルートでゴミ箱へ → 標準 API で復元 | active(`status: draft`) | in_use | in_use |
| S15 | 参照元のフィールド(`hero`)を消した | active | detached | detached |
| S16 | 一度も公開していない投稿の cover | active | in_use(列の値 = 作成時の値) | in_use |
| S17 | 投稿 2 件で使い、1 件は外して公開、1 件はゴミ箱へ | active | detached / owner_deleted | owner_deleted |

- 消したコレクションの `get` は、`name: "Error"`・`code: "ERR_SQLITE_ERROR"`・`message: "no such table: ec_events"` の例外を投げた。失敗した文は `db.count` に数えられなかった(0)。`ctx.schema.listCollections()` は 2 クエリで、消したコレクションは含まれない。判定はメッセージに頼らず、例外のあとでコレクションの一覧を読んで決める(コレクションがあれば例外のまま 500)。根拠: 実測のみ(D1 ではメッセージが違う見込み。推測のみ)
- フィールドを消すと列が消え、`get` の `data` にそのキーが無くなる。値が無いので `detached` になる。根拠: 実測のみ
- 復元した画像は `status: "draft"`・`liveRevisionId: null` になった(下書きのリビジョンも無い)。一覧では `active` と区別しない。サイトの取得(`getEmDashCollection`)は既定で公開済みだけなので(`loader.ts:1233`)、公開し直すまで表示されない。根拠: 実測(下書きになること)+公式ドキュメント(`database/repositories/content.ts:1513-1544`)

## 画像エントリの状態と `getTrashedVersioned`

`get("b64_images", id)` があれば `active`。`null` のときだけ `getTrashedVersioned` を呼び、値があれば `trashed`、無ければ `missing`。

| 方法 | 記録だけが残った画像 | 追加のクエリ | capability |
|---|---|---|---|
| **`getTrashedVersioned`(採用)** | `missing` として区別できる | ゴミ箱 +4、無い +2(`get` が `null` のときだけ) | `content:restore`(`restore` の権限も付く。このプラグインは呼ばない) |
| 「記録があって `get` が `null` ならゴミ箱」 | `trashed` と誤る。完全削除のボタンが出て、押すと 404 `NOT_FOUND`。記録は消えず、ずっと残る | 0 | 不要 |

- 記録だけが残るのは、完全削除の hook が失敗したとき(ストレージの失敗、タイムアウト)、プラグインを外していた間に完全削除したとき、データベースを直接操作したとき。どれも起きにくいが、起きたときに押せないボタンを出し続けることになるので、`getTrashedVersioned` を使う。根拠: 推測のみ(起きやすさ)
- `getTrashedVersioned` と `restore` は、`content:restore` を宣言したときだけ `ctx.content` に付く(`plugins/context.ts:1687-1704`)。`content:restore` は `content:read` を含まない(`plugins/types.ts:84-95`)。根拠: 公式ドキュメントのみ
- spike でのクエリ数: `get`(`b64_images`)は見つかれば 2、ゴミ箱・無い 1。`getTrashedVersioned`(`b64_images`)はゴミ箱 4、ゴミ箱に入っていない 4、無い 2。`posts` のゴミ箱に入っていないエントリ(下書きなし)は 6。根拠: 実測のみ([[emdash-plugin-content-query-counts]] の値と合う)

## クエリ数の予算

### 予算を 100 にした理由

- 上限(Workers Free で Cloudflare のサービスに送れるのは 1 呼び出し 1,000。[[cloudflare-workers-free-d1-limits]])の 1 割。D1 では同じ処理でも SQLite よりクエリが多いことがあるので、十分な余裕を残す。根拠: 公式ドキュメントのみ(上限)、推測のみ(余裕の大きさ)
- アップロード(75)や EmDash の保存(55〜62)と同じ程度の重さに抑える。D1 の往復は 1 回数十〜100ms 台と見込まれ、並行に投げても応答が数秒にならないようにする。根拠: 推測のみ
- 参照元が 1 件ずつの画像でも 1 ページ 8 枚になり、画面の 1 回の読み込みとして実用になる。根拠: 実測のみ

### 見積もり

画像を 1 枚足すたびに、最悪の見積もりが予算に収まるかを確かめ、収まらなければそこで止める(`listImagesPage`)。実際の数は見積もり以下になる。

| 項目 | 見積もり | 実際(SQLite) |
|---|---|---|
| ルートの固定費 | 1 | 1(セッションの利用者) |
| `imageRefs` の `query` | 1(同じ時刻の記録が多いときだけ 2〜3) | 1 |
| 画像エントリの状態 | 5 | 2(active)/ 5(trashed)/ 3(missing) |
| 参照元のエントリ(まだ読んでいないもの) | 6 | 1(ゴミ箱・無い)/ 3(`posts`)/ 6(下書きを読んだ)/ 0(コレクションが無い) |
| コレクションの一覧 | 2(参照元があれば、リクエストに 1 回) | 2(参照元の `get` が例外を投げたときだけ) |

- 下書き(`getRevision`)は、列の値で画像が見つからない組があるときだけ読む。同じエントリを参照元に持つ画像が同じページに並べば、エントリは 1 回だけ読む。根拠: 実測のみ
- コレクションの一覧を読むのは、参照元の `get` が例外を投げたときで、その参照元は 6 のうち 0〜1 しか使わない。見積もりの 2 は実際には超えない余裕だが、1 回分なので残した。根拠: 実測のみ

### ページごとの実測

データを作った直後に、一覧を最後まで読んだ(1 回目)。「見積もり」は `listImagesPage` の `reservedQueries`、「db.count」は本物のルートの応答の値。根拠: **実測のみ**

| ページ | 載った画像 | 枚数 | 見積もり | db.count | 応答時間 |
|---|---|---|---|---|---|
| 1 | S01〜S10(状態ごと。消されたコレクションの参照元を含む) | 10 | 96 | 48 | 10.6ms(最初のリクエスト) |
| 2 | S11〜S17(ギャラリー、参照元 2 件の画像を含む) | 8 | 92 | 38 | 3.0ms |
| 3 | Q0〜Q7(参照元は公開済みの別々の投稿、下書きなし) | 8 | 92 | 42 | 2.7ms |
| 4 | Q8〜Q9、W0〜W5(W: 画像がゴミ箱、参照元は下書きだけに画像) | 8 | 92 | 78 | 5.2ms |
| 5 | W6〜W9、G0〜G5(G: 1 件の投稿のギャラリーに 10 枚) | 10 | 84 | 61 | 4.2ms |
| 6 | G6〜G9 | 4 | 30 | 13 | 2.0ms |
| 7〜8 | H1(参照元 40 件、公開版に画像) | 0 → 1 | 99 / 100 | 49 / 50 | 5.0 / 2.6ms |
| 9〜10 | H2(参照元 40 件、下書きだけに画像) | 0 → 1 | 99 / 100 | 94 / 98 | 3.1 / 3.0ms |
| 11〜13 | H3(参照元 40 件、すべて外された) | 0 → 0 → 1 | 99 / 100 / 58 | 49 / 50 / 29 | 1.9 / 2.6 / 1.7ms |
| 14 | 参照元なし 2 枚 | 2 | 12 | 6 | 1.0ms |

- ページ 6 は、次の H1 が 1 枚で予算を超えるので、ページの途中では扱わずに止めた(次のリクエストで H1 だけを扱う)。
- ゴミ箱とロールの確認のあと(2 回目)、W0〜W7 の 8 枚が 1 ページに並び、**見積もり 92 に対して 90**だった。これが参照元 1 件ずつの画像の最悪(2 + 8 × (5 + 6))。根拠: 実測のみ
- 参照元の多い画像: H1 は、一覧に載せる 20 件の状態が 2 回目で分かり、使用中があったので 31 件で終えた。H2 は同じ 2 回で、下書きを読むので 1 回 94〜98 クエリ。H3 は使用中が無いので 40 件すべてを調べた(3 回)。根拠: 実測のみ

## ページ送りとカーソル

- 1 ページは `imageRefs.query({ where: { createdAt: { gte: "0", lt: ":" } }, orderBy: { createdAt: "desc" }, limit: 11 })` で読む。2 ページ目からは `{ gte: "0", lte: 位置の createdAt }` で読み、位置と同じ時刻で ID が位置以上の記録(読んだもの)を除く。同じ時刻の記録が 1 ページより多ければ上限の 100 件で読み直し、それでも足りなければ残りを飛ばして進む(ログに出す)。根拠: 実測のみ(単体テスト)
- 範囲の条件は、境界が文字列なので `json_extract` の値を文字列として比べる(`plugins/storage-query.ts:232-247`)。SQLite では数値は文字列より小さく、NULL はどの範囲にも入らない。そのため、`createdAt` が数字で始まる文字列の記録だけを読む(無い・数値・英字で始まる記録は、載せられず位置にも使えない)。根拠: 公式ドキュメントのみ(SQL)、実測のみ(単体テスト)
- 並びは、null の順位 → 値 → ID の順で、どれも同じ向き(`database/repositories/plugin-storage.ts:425-437`)。新しい順なら、同じ時刻は ID の大きい順。根拠: 公式ドキュメントのみ
- **EmDash のストレージのカーソル(`cursor`)は使わない。** `orderBy` を付けたときのカーソルは、カーソルの記録の値を ID からその場で読み直す(`plugin-storage.ts:381-422`)。その記録が消えていると値が NULL になり、降順では先頭から読み直す(重複して出る)。画面で最後の画像を完全削除すると起きる。根拠: 公式ドキュメントのみ
- カーソルは `{ v: 1, a: [createdAt, id], h?: 途中の状態 }` の JSON(ASCII 以外は `\uXXXX`)を base64url にした文字列。2,048 文字まで(要求のスキーマと同じ)。読めない・版が違う・形が違うカーソルは 400 `INVALID_CURSOR`(クエリをしない)。根拠: 実測のみ
- カーソルは画面から送られるので、利用者が作り変えられる。変えても、その利用者が読める範囲(一覧)の中で位置や途中の状態がずれるだけで、ほかの利用者には影響しない。途中の状態は、画像の記録の `owners` の数が変わっていれば捨てて最初から調べ直す。根拠: 推測のみ

## ゴミ箱への移動と完全削除

spike での結果(`lifecycle.mjs`)。根拠: **実測+公式ドキュメント**

| 操作 | 結果 | db.count | afterDelete / afterRestore |
|---|---|---|---|
| Contributor がルートで使用中の画像をゴミ箱へ | 200 `{ id, trashed: true }`。記録は残る | 9 | **呼ばれない** |
| もう一度同じ画像 | 200(成功として返す) | 9 | — |
| Editor が標準 API で完全削除 | 403 `FORBIDDEN` | 3 | — |
| Admin が標準 API で完全削除 | 200 `{ deleted: true, id }`。**記録が消えた** | 36 | afterDelete(`b64_images`、`permanent: true`) |
| 完全削除した画像をルートでゴミ箱へ | 404 `IMAGE_NOT_FOUND`(記録が無い) | 2 | — |
| 標準 API でゴミ箱へ | 200。記録は残る | 30 | afterDelete(`permanent: false`) |
| 標準 API で復元 | 200。`status: "draft"`、`liveRevisionId: null` | — | afterRestore(event のキーは `content` と `collection`) |
| T18 の後始末の画像(S10: 公開していない・ゴミ箱・参照元なし)を Admin が完全削除 | 200。記録が消えた | 36 | afterDelete(`permanent: true`) |
| 記録の無い ID をルートでゴミ箱へ | 404 `IMAGE_NOT_FOUND` | 2 | — |
| 記録だけの画像(S09)をルートでゴミ箱へ | 404 `IMAGE_NOT_FOUND`(エントリが無い) | 7 | — |
| 参照元の投稿を完全削除 | 200。画像の記録は変わらない | 36 | afterDelete(`posts`、`permanent: true`) |

- プラグインの `ctx.content.delete` は、リポジトリの `delete` を呼ぶだけで hook を呼ばない(`plugins/context.ts:897-908`)。標準 API のゴミ箱は `emdash-runtime.ts:3705`、完全削除は `:3759` で afterDelete を、復元は `:3738` で afterRestore を呼ぶ。afterDelete は `after()` で応答のあとに実行される(`:5579-5590`)。根拠: 実測+公式ドキュメント
- ルートのクエリ: 固定費 1 + `exists` 1 + `delete` 7(移せた)。移せなかったときは `delete` 3 のあと `getTrashedVersioned`(ゴミ箱 4 / 無い 2)。`delete` の内訳は、書き込みの前の確認 2・更新 1、移せたときはさらにロックの解放とメディアの使用状況の更新(`plugins/context.ts:897-908`)。根拠: 実測のみ(内訳は公式ドキュメントからの推測を含む)
- 使用中の画像もゴミ箱に移す(ルートは使用中かを調べない)。使用中かは画面が一覧の `usage` で確かめて確認を出す(仕様書 10 章)。ルートで調べると予算の分のクエリが要り、調べた直後に使われることもあるため。ゴミ箱からは Editor 以上が戻せる。根拠: 推測のみ(設計判断)

### ロールごとの権限

POST、`X-EmDash-Request: 1` あり、セッション認証。根拠: **実測+公式ドキュメント**([[emdash-plugin-route-permissions]] の表と同じ)

| ルート | 未ログイン | Subscriber | Contributor | Author | Editor | Admin |
|---|---|---|---|---|---|---|
| `images/list`(`content:read_drafts`) | 401 | 403 | 200 | 200 | 200 | 200 |
| `images/trash`(`content:create`) | 401 | 403 | 200 | 200 | 200 | 200 |

- ヘッダーなし: どちらも 403 `CSRF_REJECTED`。`GET`: 405 `METHOD_NOT_ALLOWED`。知らないキー・2,049 文字のカーソル・`../x` の ID: 400 `VALIDATION_ERROR`。形の正しくないカーソル: 400 `INVALID_CURSOR`。4,000 文字のカーソル: 413 `INVALID_PLUGIN_REQUEST`(`Plugin route request body exceeds 3085 bytes`)。根拠: 実測のみ

## ゴミ箱の状態を記録しない理由

| | 記録しない(採用) | 記録する |
|---|---|---|
| 書く場所 | なし | ルートのゴミ箱(hook が呼ばれないので自分で書く)、T18 の後始末(同じ)、標準 API のゴミ箱(afterDelete `permanent: false`)、復元(afterRestore) |
| 書き方 | — | T20 の追記と重なるので `getVersioned` → `compareAndSet`(1 回 2 クエリ + 競合の読み直し) |
| 一覧(T25) | 画像エントリを読んで判定する | 記録がずれうる(hook の失敗、プラグインを外していた間の操作)ので、完全削除のボタンを出すには結局エントリを読む |
| 列(T24) | ゴミ箱の画像にもサムネイルを出す(仕様書 11.4 のまま) | ゴミ箱の画像に印を付けられる |
| 変えるもの | なし | T03(`imageRefsRecordSchema`)、T17(`thumbnails` の応答)、T24、T29(hook の登録)、T21 |

- 事実: 0.39.1 には `content:afterRestore` があり(`plugins/hooks.ts:85`、`:335`。登録には `content:read`)、標準 API の復元で呼ばれた。プラグインの `ctx.content.delete` では afterDelete が呼ばれなかった。根拠: 実測+公式ドキュメント
- 判断: 得られるのは一覧の列の印だけで、変えるタスクが 5 つに増え、ずれたときの扱いも要る。ゴミ箱の画像を参照する投稿は、サイトでは画像が出ない(サイト側の取得がゴミ箱のものを除く)ので、列の印が無くても実害は小さい。記録しないことにした。根拠: 推測のみ(費用と効果の見込み)

## 処理時間

- 上のページごとの応答時間は、開発サーバー(Vite の SSR)で 1〜16ms(最初のリクエストは 10〜16ms)。根拠: 実測のみ
- 本体が固定上限(500,000 バイト)の画像 10 枚(参照元なし)を一覧の先頭に置くと、ハンドラーの時間は中央値 2.7ms(最初 6.3ms)、応答は 3.5ms、db.count は 22、応答の大きさは 2,693 バイトだった。同じ枚数の小さい画像では 1.3ms。画像エントリの状態を読む `get` が本体まで読む(`SELECT *`)ため、枚数に比例して増える。10 枚ならプレビュー取得([[emdash-plugin-preview-thumbnail-routes]])と同じ程度。根拠: 実測のみ(Node。Workers の CPU 時間は [[T32-cloudflare-check|T32]])

## 単体テストと意図的な誤り

- `tests/server/orphans.test.ts`(88 件)。偽の EmDash(`FakeWorld`)は、`get` などのクエリ数を spike の実測に合わせ、`imageRefs.query` は SQLite の `json_extract` の比較と並び(NULL が先、同じ値は ID の大きい順)をまねる。各状態、ページ送り(同じ時刻の記録が 100 件を超える場合を含む)、予算、参照元の多い画像、カーソル、足りない宣言、ゴミ箱、完全削除の hook(EmDash の `createHookPipeline` で実行)を確かめる。根拠: 実測のみ
- `src` に 49 種類の誤りを 1 つずつ入れ、どれでもテストが失敗することを確かめた(予算・見積もりの値、下書きを見ない・常に読む、例外の扱い、`usage` の順、同じ時刻の除き方、範囲の上限、位置の取り方、途中の状態の捨て方、カーソルの長さ、ルートの permission・body の上限・404 の条件、hook の条件・優先度・`errorPolicy` など)。最初の実行で残った 3 つ(コレクションの一覧の見積もり、範囲の上限、カーソルの長さ)は、テストを足して失敗するようにした。根拠: 実測のみ

## 残る課題

- 一覧の項目は、画像エントリが公開済みか下書きか(復元した画像、T18 で公開の前に止まった画像)を持たない。`get` の `status` で追加のクエリなしに分かるが、応答のスキーマ(T03)に項目が要る。画面で「公開し直す」を出すなら要る。
- 参照元の全体の件数(20 件を超えた分)が応答に無い。画面で「ほか N 件」を出すなら、T03 に項目が要る。
- `missing`(記録だけが残った画像)を片付けるルートが無い。
- D1 での実際のクエリ数・並行に投げたときの応答時間・消えたコレクションの例外の形は、[[T32-cloudflare-check|T32]] で確かめる。

## 再現手順

1. `playground/src` と `tsconfig.json` を `spikes/orphan-routes/site/` に複製し、`package.json`(playground と同じ `dependencies`)、`astro.config.mjs`、`seed/seed.json`(`b64_images`、`posts`(`cover` / `gallery` / `hero`)、`events`(`cover`))を置く。依存はインストールせず、worktree の `node_modules` を使った。
2. サイトのディレクトリで起動する。プラグインを変えたら起動し直す。

```sh
node <worktree>/node_modules/astro/bin/astro.mjs dev --port 4421
node <worktree>/node_modules/astro/bin/astro.mjs dev stop
```

```js
// spikes/orphan-routes/site/astro.config.mjs(抜粋)
emdash({
	database: sqlite({ url: "file:./data.db" }),
	plugins: [
		{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/spike-orphans.ts", options: {} },
		{ id: "spike-observer", version: "0.0.0", entrypoint: "/plugins/spike-observer.ts", options: {} },
	],
	fonts: false,
}),
```

```ts
// spikes/orphan-routes/site/plugins/spike-orphans.ts(抜粋)
import { definePlugin, getRequestContext, type RouteContext } from "emdash";
import { imageDeletedHooks } from "../../../../src/server/hooks/image-deleted.ts";
import { imageOwnerHooks } from "../../../../src/server/hooks/owners.ts";
import { validateReferencesBeforeSave } from "../../../../src/server/hooks/references.ts";
import { decodeImagesListCursor, listImagesPage } from "../../../../src/server/orphans.ts";
import { imagesListRoute, imagesTrashRoute } from "../../../../src/server/routes/images-admin.ts";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: "0.0.0",
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read", "content:restore"],
		storage: { imageRefs: { indexes: ["createdAt"] } },
		hooks: {
			...imageOwnerHooks,
			...imageDeletedHooks,
			"content:beforeSave": { handler: async (event, ctx) => validateReferencesBeforeSave(event, ctx) },
		},
		routes: {
			"images/list": imagesListRoute,
			"images/trash": imagesTrashRoute,
			// アップロードの代わり: create → imageRefs.put(createdAt と owners を指定できる)→ getVersioned → publish。
			// { publish: false } で公開の前に止まった画像、{ trash: true } で T18 の後始末(公開せずに ctx.content.delete)
			"spike/create-image": { handler: async (ctx: RouteContext) => { /* … */ } },
			// 記録だけを作る(missing)
			"spike/put-record": { handler: async (ctx: RouteContext) => { /* imageRefs.put(id, { owners: [], … }) */ } },
			// 同じカーソルで listImagesPage を直接呼び、見積もりと実際のクエリ数を返す
			"spike/measure-list": {
				handler: async (ctx: RouteContext) => {
					const decoded = decodeImagesListCursor((ctx.input as { cursor?: string }).cursor);
					if (decoded.ok === false) return { error: decoded.message };
					const before = getRequestContext()?.metrics?.dbCount;
					const page = await listImagesPage(
						{ content: ctx.content as never, schema: ctx.schema as never, imageRefs: ctx.storage.imageRefs as never, log: ctx.log },
						decoded.cursor,
					);
					const after = getRequestContext()?.metrics?.dbCount;
					return { ...page, dbDelta: before === undefined || after === undefined ? null : after - before };
				},
			},
		},
	});
}
```

```ts
// spikes/orphan-routes/site/plugins/spike-observer.ts(抜粋)。hook がいつ呼ばれたかをストレージに残す
hooks: {
	"content:afterDelete": { handler: async (event, ctx) => { await ctx.storage.events.put(key(), { hook: "afterDelete", ...event }); } },
	"content:afterRestore": { handler: async (event, ctx) => { await ctx.storage.events.put(key(), { hook: "afterRestore", collection: event.collection, keys: Object.keys(event) }); } },
},
```

3. REST で操作する。`GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` の cookie と `X-EmDash-Request: 1` を付け、投稿は `POST /_emdash/api/content/posts`(`{ data, slug }`)・`PUT …/{id}`(`{ data }`)・`POST …/{id}/publish`・`DELETE …/{id}`・`DELETE …/{id}/permanent`・`POST …/{id}/restore`、スキーマは `DELETE /_emdash/api/schema/collections/posts/fields/hero`・`DELETE /_emdash/api/schema/collections/events?force=true`。ロールは `node:sqlite` で `UPDATE users SET role = ? WHERE email = 'dev@emdash.local'`(EmDash はリクエストのたびに読み直す)。
4. 一覧は `nextCursor` が無くなるまで `images/list` を呼び、同じカーソルで `spike/measure-list` も呼んで、応答が同じこと・`db.count` が見積もり以下であることを確かめる。

> [!warning] seed のコレクションを消すと、開発用ログインが 500 になる
> dev-bypass は呼ぶたびに seed を適用し直す。seed にあるコレクションを `force=true` で消したあとは、`SchemaError: Collection "events" already exists`(`COLLECTION_EXISTS`)で 500 になった(メディアの使用状況が、消したコレクションの slug を「削除中」として残すため。`schema/registry.ts:557-558`)。seed からそのコレクションを外して起動し直すか、先にログインした cookie を使い回す。根拠: 実測+公式ドキュメント
