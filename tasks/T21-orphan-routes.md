---
id: T21
title: "未使用画像の判定と画像管理ルートを作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T06-decision-trash-permission]]"
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/orphans.ts"
  - "src/server/routes/images-admin.ts"
  - "src/server/hooks/image-deleted.ts"
  - "tests/server/orphans.test.ts"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T21 未使用画像の判定と画像管理ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T06-decision-trash-permission|T06]]、[[T10-spike-after-save|T10]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]

## 目的

仕様書 9 章の判定と、10 章の削除操作のサーバー側を作る。

## 作業内容

- [x] 一覧ルート: `imageRefs` を `createdAt` 順に 10 件程度ずつ取得し、参照元ごとに公開版と下書き(`getRevision`)を確認して状態を判定する(新しい順に最大 10 枚。枚数はクエリ数の見積もりで決まる)
- [x] 状態: 使用中 / 参照元が削除された / 参照元から外された / 参照元なし
- [x] ゴミ箱へ移動するルート([[T06-decision-trash-permission|T06]] で決めた権限)
- [x] `content:afterDelete` で `b64_images` が完全削除されたら、`imageRefs` からも削除する
- [x] 1 回に扱う件数は、固定にせずクエリ数の見積もりで決める([[T10-spike-after-save#結果|T10]]、仕様書 9 章)
  - 1 件あたりのクエリ数: 参照元は 1 / 3 / 6、画像の状態は 2 / 5 / 3
  - 同じ参照元はリクエストの中で 1 回だけ調べる
  - 予算(1 リクエストのクエリ数)の値を決める。上限は 1 呼び出し 1,000 だが、応答時間を抑えるため、十分小さくする
  - 参照元が多い画像(1 枚で予算を超えるもの)は、参照元をページ送りするか上限を設ける
- [x] 画像の状態(ゴミ箱に入っていない / ゴミ箱 / 無い)は、`get` と `getTrashedVersioned` で判定する。`getTrashedVersioned` は `get` が `null` のときだけ呼ぶ。capability `content:restore` を宣言するかを決める(復元の権限も含むため。[[T03-shared-contracts#結果|T03]])
- [x] `content:afterDelete` の `id` は URL に書いた値そのまま(slug のこともある)。`permanent === true` のときだけ `imageRefs` を消す([[T10-spike-after-save#結果|T10]])
- [x] `imageRefs` の記録の読み方([[T20-owner-tracking#T21 への注意(記録を読むとき)|T20]])
  - `owners` は増えるだけ。削除されたエントリや、画像を外したエントリの要素も残る。同じエントリが cover とギャラリーのように 2 回並ぶことがある
  - 記録は保存の応答のあとに書かれるので、保存の直後にはまだ入っていないことがある
  - 壊れた要素がありうる。記録全体を 1 つのスキーマで読むと、壊れた要素 1 つで記録ごと読めなくなるので、要素ごとに読む
  - 参照元のフィールドにまだ画像があるかは、`readReferencedImageIds(value, kind)`(`src/server/hooks/owners.ts`)で読むと、記録と同じ規則になる
- [x] `imageRefs` の記録を書き換えるときは、`getVersioned` → `compareAndSet`(版が変わっていたら読み直す)を使う。`put` で書き直すと、その間に足された参照元が消える。完全削除の `delete` は問題ない([[emdash-plugin-storage-conditional-writes]])(このタスクは記録を書き換えない。書くのは完全削除のあとの `delete` だけ)
- [x] 複数の画像 ID の記録を `getMany` で読むときは、`getManyInBatches`(`src/server/image-refs.ts`。50 件ずつ)を使う([[T16-2-image-refs-batches|T16-2]])(`getMany` は使わない。一覧は `query`、ゴミ箱は `exists` で読む)
- [x] ゴミ箱に入った画像を `imageRefs` に記録するかを決める([[T17-admin-data-routes#結果|T17]] の未解決)→ 記録しない([[#決めたこと]] の 7)
  - 今の `thumbnails` ルートは、ゴミ箱に入った画像を区別できない(`imageRefs` は完全削除まで残る)。そのため、一覧の列([[T24-list-column|T24]])はゴミ箱の画像にもサムネイルを出す
  - `content:afterDelete` の `permanent: false` で記録し、ゴミ箱から戻したときに消す必要がある。戻したときに呼ばれる hook が 0.39.1 にあるかを確かめる
  - 記録するなら、T03 の `imageRefsRecordSchema` を変える(サブタスクにする)

## 完了条件

- [x] 単体テスト(偽の ctx で各状態を再現する)

## 変更してよいファイル

- `src/server/orphans.ts`
- `src/server/routes/images-admin.ts`
- `src/server/hooks/image-deleted.ts`
- `tests/server/orphans.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/orphans.ts` に判定とページ送り(`listImagesPage`)、`src/server/routes/images-admin.ts` に一覧(`imagesListRoute`)とゴミ箱への移動(`imagesTrashRoute`)のルート、`src/server/hooks/image-deleted.ts` に完全削除のあとで `imageRefs` の記録を消す `content:afterDelete`(`imageDeletedHooks`)を作った。登録は T29 が行う([[#T29 への引き継ぎ]])。
> - 予算は 1 リクエスト 100 クエリ。最悪の見積もりが収まるだけ画像を載せ、1 枚で予算を超える画像は、その画像だけを扱うリクエストを続けて調べる。
> - 使い捨てのサイト(`spikes/orphan-routes/`、git 管理外)で、仕様書 9 章の 4 つの状態と画像エントリの 3 つの状態をすべて再現し、ロールごとの権限、ページごとのクエリ数(`Server-Timing` の `db.count`)、完全削除のあとの記録の削除、T18 の後始末で残る画像の完全削除を確かめた。見積もりを実際のクエリ数が超えたページは無かった。
> - `tests/server/orphans.test.ts` に 88 件のテストを書いた。`src` に 49 種類の誤りを 1 つずつ入れ、どれでもテストが失敗することを確かめた(最初に残った 3 つは、テストを足して失敗するようにした)。
> - 知見ノート: [[image-management-routes]](判定・予算・ページ送り・ゴミ箱と完全削除・T25 と T29 向けの使い方・実測)
> - 仕様書は 9 章の「判定」と 10 章を直した([[#仕様書・他のタスクへの影響]])。

### 主な export

| export | 内容 |
|---|---|
| `imagesListRoute` / `handleImagesList` | 一覧のルート(`permission: "content:read_drafts"`、POST、body 3,085 バイトまで)とハンドラー |
| `imagesTrashRoute` / `handleImagesTrash` | ゴミ箱への移動のルート(`permission: "content:create"`、POST、body 1,161 バイトまで)とハンドラー |
| `imageDeletedHooks` / `removeImageRefsAfterDelete` / `removeImageRefs` | `{ "content:afterDelete": { priority: 50, errorPolicy: "continue", handler } }` と本体。`removeImageRefs` は結果(`ignored` / `removed` / `not-found` / `failed`)を返す |
| `listImagesPage(deps, cursor)` | 判定とページ送りの本体。応答のほかに、見積もりのクエリ数(`reservedQueries`)などを返す |
| `encodeImagesListCursor` / `decodeImagesListCursor` | カーソル(読めなければ `ok === false`) |
| `IMAGES_LIST_QUERY_BUDGET`(100)/ `IMAGES_LIST_MAX_ITEMS`(10)/ `IMAGES_LIST_MAX_OWNERS`(20)/ `LIST_QUERY_COSTS` | 予算・1 ページの上限・1 枚に載せる参照元の上限・見積もり |
| 型 `ImagesListRouteContext` / `ImagesTrashRouteContext` / `ImageDeletedContext` ほか | EmDash の型のうち使う部分。`RouteContext<…>` / `PluginContext` をそのまま渡せる(型のテスト) |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 予算は 1 リクエスト 100 クエリ(ルートの固定費を含む) | 上限(1 呼び出し 1,000)の 1 割で、D1 で SQLite より増える分の余裕を残す。アップロード(75)や EmDash の保存(55〜62)と同じ程度に抑える。参照元が 1 件ずつの画像でも 1 ページ 8 枚になる | 公式ドキュメントのみ(上限)、実測のみ(ページの枚数)、推測のみ(余裕の大きさ) |
| 2 | 見積もりは最悪の値: 画像 5、まだ読んでいない参照元のエントリ 6、参照元があればコレクションの一覧 2(1 回)。新しい順に 1 枚ずつ足し、超える画像の手前で止める。1 ページは最大 10 枚 | 実際の数を超えない(spike の全ページで見積もり以下。最悪のページは見積もり 92 に対して 90)。10 枚は、画像エントリの `get` が本体(最大 500,000 バイト)まで読むので、プレビュー取得と同じにした | 実測のみ(SQLite) |
| 3 | 並びは `createdAt` の新しい順(同じ時刻は ID の大きい順)。カーソルは自前で、最後に読んだ記録の `createdAt` と ID を持つ | EmDash のストレージのカーソルは、カーソルの記録が消えると先頭から読み直す(画面で最後の画像を完全削除すると重複して出る) | 公式ドキュメントのみ(`core/src/database/repositories/plugin-storage.ts:381-422`)、実測のみ(自前のカーソル。単体テスト) |
| 4 | 1 枚で予算を超える画像(参照元のエントリが 16 件以上)は、ページの先頭のときだけ、その画像だけを扱うリクエストを続けて 15〜16 件ずつ調べる。途中の応答は `items: []` と `nextCursor`。一覧に載せる参照元(先頭から 20 件)の状態が分かり、どれかが使用中なら残りは調べない | すべてのリクエストを予算以下にしたまま、`usage` を正しく出す。参照元 40 件の画像で 2〜3 リクエスト、1 回最大 98 クエリだった | 実測のみ |
| 5 | 参照元は要素ごとに読み、同じエントリは 1 回だけ読む。下書きは、列の値で画像が見つからない組があるときだけ読む。値は `readReferencedImageIds` で、単一画像かギャラリーかは値の形で決める。`collection` / `entryId` / `field` が読めない要素は飛ばしてログに出す | T20 の記録と同じ規則にする。widget が変わっても、値に参照が残っていれば使用中にする(「使われていない」と誤るほうが害が大きい) | 実測のみ |
| 6 | 参照元の `get` が例外を投げたら、コレクションの一覧を読み、無ければ「参照元が削除された」、あれば例外のまま 500。ほかの取得の失敗も 500 にし、途中までの結果は返さない | 消したコレクションは `ERR_SQLITE_ERROR`「no such table」を投げた。データベースの失敗を「削除された」と誤ると、使われている画像を消しうる | 実測+公式ドキュメント |
| 7 | ゴミ箱に入っているかは `imageRefs` に記録しない | 0.39.1 には `content:afterRestore` があり復元で呼ばれるが、プラグインの `ctx.content.delete` では afterDelete が呼ばれない。記録すると、書く場所が 3 つ(ルート・標準 API のゴミ箱・復元)に増え、T03・T17・T24・T29 も変わる。記録はずれうるので、一覧は結局エントリを読む。得られるのは T24 の列の印だけ | 実測+公式ドキュメント(hook の事実)、推測のみ(費用と効果) |
| 8 | 画像エントリの状態は `get` → `null` なら `getTrashedVersioned`。capability `content:restore` を宣言する | 「記録があって `get` が `null` ならゴミ箱」では、記録だけが残った画像(完全削除の hook の失敗など)を `trashed` と誤り、完全削除のボタンが 404 になり、記録も消えない。追加はゴミ箱 +4・無い +2 だけ | 実測+公式ドキュメント(`core/src/plugins/context.ts:1687-1704`) |
| 9 | ゴミ箱のルートは、`imageRefs` に記録のある画像だけを移す。使用中でも移す。もうゴミ箱なら成功、エントリが無ければ 404 `IMAGE_NOT_FOUND`。移したらログに利用者 ID を出す | 一覧に出る画像だけを扱う(seed の画像は標準 API で扱う)。使用中かは画面が一覧の `usage` で確かめて確認を出す(仕様書 10 章。ルートで調べると予算分のクエリが要り、直後に使われることもある)。二度押しを失敗にしない | 実測のみ(動き)、設計判断 |
| 10 | 完全削除の hook は、`collection === "b64_images"` かつ `permanent === true` のときだけ記録を消す。`priority: 50`、`errorPolicy: "continue"`、例外は投げずに `ctx.log.error` に出す | ゴミ箱への移動では記録を残す(戻せるため)。既定の優先度のほかのプラグインの例外で飛ばされないようにする(T20 と同じ) | 実測+公式ドキュメント |
| 11 | 画像エントリの状態と参照元のエントリは、`Promise.all` で並行に読む | D1 では 1 往復ごとに待つので、順に読むと遅い | 推測のみ(D1 では未確認) |

### 実測(スパイク)

環境と手順は [[image-management-routes]]。根拠: どれも実測のみ(SQLite)。

| 項目 | 結果 |
|---|---|
| 判定 | 状態ごとの画像 18 枚(投稿の下書きだけで使用中、消したコレクション・消したフィールドの参照元、T18 の後始末の画像、記録だけの画像、復元した画像など)が、すべて期待どおり |
| ページごとのクエリ数 | 状態ごとの 10 枚: 見積もり 96 / 実際 48。参照元が別々の投稿(下書きなし)の 8 枚: 92 / 42。画像がゴミ箱・参照元は下書きだけの 8 枚: 92 / 90。同じ投稿のギャラリーの画像 4 枚: 30 / 13(参照元のエントリは 1 回だけ読む。2 + 4 × 2 + 3) |
| 参照元の多い画像(40 件) | 公開版で使用中: 2 リクエスト(49、50)。下書きで使用中: 2 リクエスト(94、98)。すべて外された: 3 リクエスト(49、50、29) |
| 応答時間(開発サーバー) | 1 ページ 1〜16ms。本体 500,000 バイトの画像 10 枚でハンドラー中央値 2.7ms |
| ロール | 一覧・ゴミ箱とも、未ログイン 401、Subscriber 403、Contributor 以上 200 |
| ゴミ箱のルート | 移せた 9 クエリ、もうゴミ箱 9、記録なし 2、エントリなし 7。プラグインの `ctx.content.delete` では afterDelete は呼ばれない |
| 完全削除 | Editor 403、Admin 200。afterDelete(`permanent: true`)で記録が消えた。T18 の後始末の画像(公開していない・ゴミ箱・参照元なし)も同じ |
| 復元 | afterRestore が呼ばれた。画像は `status: "draft"`・`liveRevisionId: null` になった(一覧では `active`) |

### T29 への引き継ぎ

```ts
import { imageDeletedHooks } from "./server/hooks/image-deleted";
import { imagesListRoute, imagesTrashRoute } from "./server/routes/images-admin";
import { IMAGE_REFS_STORAGE, ROUTES } from "./shared/constants";

definePlugin({
	// T21 が使う capability: schema:read(消されたコレクションの確認)、content:read(get。hook の登録にも要る)、
	// content:revisions:read(getRevision)、content:restore(getTrashedVersioned。content:read は含まない)、content:write(delete)
	capabilities: ["schema:read", "content:read", "content:write", "content:revisions:read", "content:restore" /* , ほかのタスクの分 */],
	storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
	hooks: { ...imageOwnerHooks, ...imageDeletedHooks /* , … */ },
	routes: { [ROUTES.imagesList]: imagesListRoute, [ROUTES.imagesTrash]: imagesTrashRoute /* , … */ },
});
```

- spike で同じ形の `definePlugin` を動かした。宣言が足りないと、ルートは capability の名前を書いた `Error` を投げる(500)。`content:read` が無いと、afterDelete は登録されない(警告だけ)。

### T25 への引き継ぎ(応答の形とページ送り)

- `listImages({ cursor })`(T14)を、`nextCursor` が無くなるまで呼ぶ。応答は `{ items, nextCursor? }`。並びは新しい順。1 ページの枚数は 0〜10 で変わる(10 枚を前提にしない)。
- **`items: []` で `nextCursor` があるときは、続けて次を読む**(参照元の多い画像を調べている途中。一覧の終わりではない)。
- 項目: `id` / `thumb` / `width` / `height` / `bytes` / `createdAt` / `entryStatus`(`active` / `trashed` / `missing`)/ `usage`(`in_use` / `owner_deleted` / `detached` / `no_owner`)/ `owners`(先頭から 20 件まで。各 `status` 付き。全体の件数は無い)。
- ボタン: ゴミ箱は `entryStatus: "active"` に出し、`usage: "in_use"` なら確認で使用中であることを示す(`trashImage(id)`、Contributor 以上)。完全削除は `entryStatus: "trashed"` にだけ出す(`deleteImagePermanently(id)`、管理者)。`missing` には操作が無い。
- ゴミ箱に移したら、応答でその項目を `trashed` にする。完全削除したら、項目を画面から消す(記録は応答のあとの hook が消すので、すぐ先頭から読み直すと、まれに `missing` として出うる)。
- 400 `INVALID_CURSOR` は最初から読み直す。カーソルは位置を持つので、読んでいる間の完全削除でページはずれない。
- 復元(Editor 以上、標準 API)した画像は下書きになり、公開し直すまでサイトに出ない。一覧の項目では区別できない([[#未解決・サブタスクの候補]] の 1)。

### 仕様書・他のタスクへの影響

- 仕様書 9 章の「判定」: 消されたコレクションの扱い、エントリを 1 回だけ読むこと、状態バッジの順、`content:restore` を使う理由、予算 100・見積もり・並びとカーソル・参照元の多い画像の扱いを書いた。「記録」の部分は変えていない。
- 仕様書 10 章: ゴミ箱のルートの動き、`ctx.content.delete` では hook が呼ばれないこと、復元した画像は下書きになること、完全削除のあとの記録の削除、ゴミ箱の状態を記録しないことを書いた。
- [[T24-list-column|T24]]: ゴミ箱の状態は記録しないので、今のまま(ゴミ箱の画像にもサムネイルを出す。仕様書 11.4)。
- [[T25-images-page|T25]]: [[#T25 への引き継ぎ(応答の形とページ送り)]] のとおり。`items: []` のページを続けて読む処理が要る。
- [[T29-plugin-definition|T29]]: capability に `content:restore` と `content:revisions:read` と `schema:read` が要る。hook に `imageDeletedHooks` を足す。
- [[T18-upload-route|T18]] の後始末で残る画像(公開していない・ゴミ箱・参照元なし)は、一覧に `trashed` / `no_owner` で出て、管理者が完全削除できる(spike で確かめた)。記録の無い画像は一覧に出ない(仕様書 19 章の範囲)。
- [[T32-cloudflare-check|T32]]: D1 での一覧のクエリ数・応答時間(並行に投げたとき)・消したコレクションの例外の形を確かめられる。

### 未解決・サブタスクの候補

1. 一覧の項目に、画像エントリが公開済みかどうかが無い(復元した画像、T18 で公開の前に止まった画像は下書き)。`get` の `status` で追加のクエリなしに分かる。画面で「未公開」や「公開し直す」を出すなら、T03 の `imageListItemSchema` に項目を足し、T21 で埋める(途中の状態のカーソルにも入れる)。
2. 参照元の全体の件数(20 件を超えた分)が応答に無い。画面で「ほか N 件」を出すなら、T03 に項目を足す。
3. `missing`(記録だけが残った画像)を片付けるルートが無い。起きるのは完全削除の hook の失敗などに限られる。
4. ゴミ箱の状態の記録(決定 7 で見送り)。やるなら T03・T17・T21・T24・T29 の変更になる。
5. 開発用ログイン(dev-bypass)は、seed にあるコレクションを消したあと 500(`COLLECTION_EXISTS`)になる(EmDash の動き。[[image-management-routes#再現手順]])。playground の README に書くかはリーダーの判断。

> [!note] 反映済み(リーダー、マージのとき)
> 知見ノートを索引に登録した。T25・T29・T32 への引き継ぎは、後続タスクのノートに書く(サブタスク)。未解決の 1・2(公開済みかどうかと、参照元の全体の件数)は、T25 の前にサブタスクで足す。3 は仕様書 19 章の将来の検討事項にする。4 は決定 7 のとおり見送る。
