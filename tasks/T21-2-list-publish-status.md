---
id: T21-2
title: "画像管理の一覧に、公開済みかどうかと、参照元の全体の件数を足す"
type: 実装
status: done
wave: 3
parent: "[[T21-orphan-routes]]"
depends_on:
  - "[[T21-orphan-routes]]"
soft_depends_on: []
blocks:
  - "[[T25-images-page]]"
files:
  - "src/shared/schema.ts(一覧の項目だけ)"
  - "src/shared/types.ts(一覧の型だけ)"
  - "src/server/orphans.ts"
  - "tests/server/orphans.test.ts"
  - "tests/shared/schema.test.ts(一覧の項目の例とテストだけ。リーダーの許可)"
  - "tests/client/api.test.ts(一覧の応答の例だけ)"
  - "docs/image-management-routes.md"
  - "plans/base64-image-plugin-spec.md(9 章と 11.5)"
  - "tasks/T21-2-list-publish-status.md"
  - "tasks/T21-orphan-routes.md(未解決の 1・2)"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#11.5 画像管理ページ]]"
tags:
  - task
  - impl
  - subtask
created: 2026-09-24
---

# T21-2 画像管理の一覧に、公開済みかどうかと、参照元の全体の件数を足す

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-21-2`
> - 親タスク: [[T21-orphan-routes|T21]]
> - 着手の条件(依存): [[T21-orphan-routes|T21]]
> - このタスクを待つもの: [[T25-images-page|T25]]

## 目的

[[T25-images-page|T25]](画像管理ページ)が、次の 2 つを画面に出せるようにする。

1. 画像エントリに公開版があるか(サイトに出るか)。
2. 参照元の全体の件数(`owners` は先頭から 20 件なので、「ほか N 件」を出すため)。

## 発生した理由

- [[T21-orphan-routes|T21]] の一覧の項目は、画像エントリがゴミ箱に入っているか(`entryStatus`)は持つが、公開済みかどうかは持たなかった。ゴミ箱から戻した画像と、T18 で公開の前に止まった画像は下書きで、サイトに出ない。標準の編集画面からは公開し直せない([[T19-image-entry-hook#結果|T19]])。
- `owners` は先頭から 20 件で、全体の件数が応答に無かった。
- どちらも T21 の「未解決・サブタスクの候補」の 1・2。リーダーが T25 の前に足すことにした。

## 作業内容

- [x] `src/shared/schema.ts` の `imageListItemSchema` に項目を足す(名前・型・`trashed` / `missing` のときの値・EmDash の `status` との対応を、0.39.1 のソースと実測で決める)。`src/shared/types.ts` に型を足す
- [x] `src/server/orphans.ts` で埋める。追加のクエリは使わない。参照元の多い画像のために、途中の状態のカーソルに入れる
- [x] 予算と見積もりが変わらないことを確かめる(単体テストのクエリ数と、spike のページごとの `db.count`)
- [x] `tests/server/orphans.test.ts` にテストを足し、わざと壊して失敗することを確かめる
- [x] 一覧の項目の例を持つテスト(`tests/shared/schema.test.ts`・`tests/client/api.test.ts`)の例を直す
- [x] 前の spike で、下書きの画像(公開の前に止まったもの、戻したもの)と公開済みの画像の値を確かめる
- [x] 公開し直す操作の材料を調べる(標準 API を呼べるロール、プラグインのルートで `ctx.content.publish` を使う場合との違い)。ルートを足すかは決めない(T25 が決める)
- [x] 仕様書 9 章(判定の結果)と 11.5(一覧に出すもの)を直す
- [x] `docs/image-management-routes.md` の「応答の形とページ送り(T25 向け)」を直す
- [x] T21 のノートの未解決の 1・2 に、T21-2 で扱ったことを書き足す

## 完了条件

- [x] `npm run verify` が通る(3 つの型チェックを含む)
- [x] わざと入れた不具合をテストが見つける

## 変更してよいファイル

frontmatter の `files` のとおり。`tests/shared/schema.test.ts` は、作業中にリーダーの許可を得て足した(一覧の項目の例 `listItem()` と、新しい項目のテストだけ)。実行中の [[T23-upload-hook|T23]]・[[T24-list-column|T24]] は、これらのファイルを変更しない。

## 結果

> [!success] 概要(2026-09-24)
> - 一覧の項目に `entryPublication`(画像エントリの公開の状態)と `ownersTotal`(参照元の全体の件数)を足した。どちらも追加のクエリを使わない。ページごとのクエリ数は、spike で T21 と同じだった。
> - `tests/server/orphans.test.ts` は 102 件(+14)。`tests/shared/schema.test.ts` に 6 件を足し、一覧の例を直した。`tests/client/api.test.ts` の一覧の例に項目を入れた。15 種類の誤りが、どれもテストで失敗することを確かめた。
> - spike で、公開済み・下書き(公開の前に止まった画像、戻した画像)・予約・ゴミ箱・無い画像の値と、公開し直す操作の 2 つの方法(標準 API とプラグインのルート)の権限・hook・クエリ数・リビジョンを確かめた。
> - 知見ノート: [[image-management-routes]] に「公開の状態と参照元の全体の件数(T21-2)」「公開し直す操作の材料(T21-2)」を足し、「応答の形とページ送り(T25 向け)」を直した。

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 項目 `entryPublication: "published" \| "draft" \| "scheduled" \| null`(必須)。値は EmDash の `status` と同じ名前 | 0.39.1 の `status` はこの 3 つ(`core/src/api/schemas/content.ts:340`。書き換えは `core/src/database/repositories/content.ts` の公開 `:2329-2336`・非公開 `:2580-2586`・復元 `:1524-1530`・予約 `:1987`・予約の取り消し `:2037`)。画面が表示の文言に対応させやすく、予約も区別できる | 公式ドキュメントのみ(値)、実測のみ(spike で 3 つとも見た) |
| 2 | `published` だけが「サイトに出る」。知らない値は `draft` にする | サイトの取得は既定で `status = 'published'` だけ(`core/src/loader.ts:1233`)。応答のスキーマは 3 つの値しか受け付けないので、知らない値をそのまま返すと画面が `UNEXPECTED_RESPONSE` にする | 公式ドキュメントのみ |
| 3 | `entryStatus` が `trashed` / `missing` のときは null | ゴミ箱の画像はサイトに出ず(`core/src/loader.ts:1341`)、戻すと必ず下書きになる(`restore` が `status = 'draft'` にする)。ゴミ箱に入る前の値(spike では `published` のまま残る)に意味が無い。無い画像には値が無い | 実測+公式ドキュメント |
| 4 | 項目 `ownersTotal: number`(0 以上の整数、必須)。`owners` と同じ規則(`imageOwnerSchema` に合い、4 つのキーが同じものは 1 件)で、20 件を超えた分も数える | 画面は `ownersTotal - owners.length` で「ほか N 件」を出せる。壊れた要素と `locale` だけが壊れた要素は、一覧に載せられないので数えない | 実測のみ(単体テスト) |
| 5 | 値は、`get` の `status` と記録の `owners` から決める(追加のクエリなし)。参照元の多い画像では、画像エントリの状態と公開の状態をカーソルの途中の状態に持ち越す(1 文字: `p` / `d` / `s` / `t` / `m`)。カーソルの版を 2 にした(版 1 は `INVALID_CURSOR`) | 予算と見積もりを変えない。途中のリクエストで画像エントリを読み直さない | 実測のみ(単体テスト、spike の `db.count`) |
| 6 | スキーマには項目の形だけを書き、「公開の状態は `active` のときだけ」「`ownersTotal` は `owners` の件数以上」の関係は、サーバーの単体テスト(一覧のテストの補助で毎回)で確かめる | `src/shared/schema.ts` は値の形だけを確かめる方針(ファイルの冒頭) | 設計判断 |

### 実測(spike)

環境・手順は T21 と同じ([[image-management-routes]])。`spikes/orphan-routes/scripts/publish.mjs`。根拠: どれも実測のみ(SQLite)。

| 画像 | `entryStatus` | `entryPublication` | `owners` / `ownersTotal` |
|---|---|---|---|
| 公開済み(S01) | active | published | 1 / 1 |
| T18 で公開の前に止まった(S11) | active | draft | 0 / 0 |
| ゴミ箱から戻した(S14) | active | draft | 1 / 1 |
| 下書きを Admin が標準 API で予約した | active | scheduled | 0 / 0 |
| ゴミ箱(S08。データベースの `status` は `published` のまま) | trashed | null | 1 / 1 |
| 記録だけ(S09) | missing | null | 0 / 0 |
| 参照元 40 件(H1〜H3。途中の状態を持ち越す) | active | published | 20 / 40 |
| S11・S14 を公開し直したあと | active | published | — |

- 一覧を最後まで読んだとき、ページごとのクエリ数は T21 と同じだった(参照元の多い画像のページは 49 / 50、94 / 98、49 / 50 / 29)。どのページも見積もり以下。

### 公開し直す操作の材料(T25 向け)

| | 標準 API `POST /_emdash/api/content/b64_images/{id}/publish` | プラグインのルートで `getVersioned` → `publish` |
|---|---|---|
| 呼べる人 | **Editor 以上**(作成者が空なので `content:publish_any`)。実測: 未ログイン 401、Subscriber・Contributor・Author 403、Editor・Admin 200 | ルートの `permission` で決まる(`ctx.content` は利用者を確かめない)。`content:create` なら Contributor 以上(実測: Subscriber 403、Contributor 200)。`content:publish_any` にすれば標準 API と同じ |
| 編集ロック | 確かめる | 確かめない |
| 保存 hook | 呼ばれない | 呼ばれない |
| `content:beforePublish` | 呼ばれる(`origin: api`、`actor` あり) | 呼ばれる(`origin: plugin`、`actor` なし) |
| `content:afterPublish` | すべてのプラグイン | このプラグイン以外 |
| クエリ | 45(公開したことの無い下書き)、47(戻した画像)、38(公開済みをもう一度) | 44 |
| リビジョン | 公開版の無い画像では、本体を丸ごと写したリビジョンが 1 件増える(戻した画像は前のリビジョンも残り 2 件になった) | 同じ |

- 根拠: 実測+公式ドキュメント(`core/src/astro/routes/api/content/[collection]/[id]/publish.ts`、`packages/auth/src/rbac.ts`、`core/src/emdash-runtime.ts:3793-3913`・`:4160-4235`、`core/src/database/repositories/content.ts:2313-2321`)。詳しくは [[image-management-routes#公開し直す操作の材料(T21-2)]]。
- 注意: ゴミ箱に移す → 戻す → 公開し直す、を繰り返すと、1 回ごとに本体と同じ大きさのリビジョンが増え、プラグインからは消せない(仕様書 5.4 の容量の見積もりに入っていない分)。根拠: 実測(件数)、推測のみ(大きさ)

### 仕様書・他のタスクへの影響

- 仕様書 9 章: 画像エントリの状態の次に、公開の状態(`entryPublication`)と参照元の全体の件数(`ownersTotal`)を返すことを書いた。
- 仕様書 11.5: 一覧に出すものに、公開の状態と参照元の全体の件数を足した。公開し直す操作を置くかは T25 で決めることと、材料へのリンクを書いた。
- [[T25-images-page|T25]]: `entryPublication` が `draft` の画像は「未公開(サイトに出ない)」を示せる。`ownersTotal - owners.length` で「ほか N 件」を出せる。公開し直す操作を置くなら、標準 API(Editor 以上)か、このプラグインのルート(新しく作る。permission を決める)のどちらかを選ぶ。
- [[T14-admin-i18n-api|T14]]: `listImages` は共有のスキーマで応答を確かめるので、変更は要らない(新しい項目はそのまま返る。テストの例で確かめた)。標準 API の公開を使うなら、`src/client/api.ts` に関数を足す必要がある(T25 の判断)。

### 未解決・サブタスクの候補

1. 公開し直す操作(T25 が決める)。プラグインのルートにするなら、`src/server/routes/images-admin.ts` にルートを足すサブタスクになる(`getVersioned` → `publish`、44 クエリ、capability `content:publish` は宣言済み)。
2. 戻して公開し直すたびに増えるリビジョンの大きさ(仕様書 5.4 の容量の目安への追記)を、仕様書の担当で扱うか。
