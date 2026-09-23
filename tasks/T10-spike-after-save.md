---
id: T10
title: "調査: afterSave に渡される内容を確かめる"
type: スパイク
status: done
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T20-owner-tracking]]"
  - "[[T21-orphan-routes]]"
files:
  - "spikes/after-save/**(使い捨て)"
  - "このノートの「結果」"
  - "plans/base64-image-plugin-spec.md(9 章、17 章の afterSave の項目。リーダーの指定)"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T10 調査: afterSave に渡される内容を確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T20-owner-tracking|T20]]、[[T21-orphan-routes|T21]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 17 章の未決事項。下書きを保存したとき、`content:afterSave` に下書きのデータが渡るのか、公開版のデータが渡るのかを確かめる(`references/emdash/packages/core/src/emdash-runtime.ts:3670`)。

## 作業内容

- [x] 使い捨ての hook で、新規作成・下書き保存・公開・自動保存・複製のときに渡される内容を記録する
- [x] `ctx.content.get` と `getRevision` で、公開版と下書きをそれぞれ取得できることを確認する
- [x] (リーダーの追加の指定)公開済みの投稿の下書きの編集・ゴミ箱への移動・完全削除・復元も記録し、呼ばれる時機と `content:afterDelete` の event の形を確かめる
- [x] (リーダーの追加の指定)プラグインの `ctx.content.create` / `publish` で afterSave が呼ばれるかを確かめる
- [x] (リーダーの追加の指定)取り出し 1 件あたりのクエリ数を数え、`getTrashedVersioned` でゴミ箱と「無い」を区別できるかを確かめる

## 完了条件

- [x] 結果を記録し、[[T20-owner-tracking|T20]] と [[T21-orphan-routes|T21]] の前提を確定した

## 変更してよいファイル

- `spikes/after-save/**`(使い捨て)
- このノートの「結果」
- `plans/base64-image-plugin-spec.md` の 9 章と、17 章の afterSave の項目(リーダーの指定で追加)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 結論(2026-09-24、EmDash 0.39.1、Node + SQLite で実測)
> - `content:afterSave` の `event.content.data` は**保存した下書き**で、公開版ではない。更新のときは、content テーブルの列の値(公開済みなら公開版、未公開なら作成したときの値)が `event.content.liveData` に別に入る。根拠: 実測+公式ドキュメント
> - `isNew` は作成で `true`、更新(保存・自動保存・メタデータだけの更新)で `false`。根拠: 実測+公式ドキュメント
> - afterSave が呼ばれるのは作成と更新だけ。公開・複製・ゴミ箱・復元・完全削除・リビジョンの復元・下書きの破棄では呼ばれない。管理画面の「公開」は保存(PUT)と公開(POST)の 2 リクエストなので、保存の側で呼ばれる。根拠: 実測+公式ドキュメント(REST と、Playwright で動かした管理画面の両方)
> - afterSave は `after()` で実行され、応答を待たせない(hook の中で 2 秒待っても応答は 14.9ms)。根拠: 実測+公式ドキュメント
> - `content:afterDelete` の event は `{ id, collection, permanent }`。根拠: 実測+公式ドキュメント
> - 詳細: [[emdash-after-save-payload]](渡る内容・時機・操作ごとの hook)、[[emdash-plugin-content-query-counts]](取り出しのクエリ数)

### 場面ごとの結果

| 場面 | 呼ばれる hook | `isNew` | `content.data` | `content.liveData` | 根拠 |
|---|---|---|---|---|---|
| 新規作成 | afterSave | `true` | 送ったデータ | 無い | 実測+公式ドキュメント |
| 下書きの保存 | afterSave | `false` | 下書き | 列の値 | 実測+公式ドキュメント |
| 自動保存(`skipRevision: true`、最後の変更から 2 秒後) | afterSave | `false` | 下書き | 列の値 | 実測+公式ドキュメント |
| 公開(管理画面) | PUT で afterSave、publish で afterPublish | `false` | 公開する下書き(`status: "draft"`) | 列の値 | 実測+公式ドキュメント |
| 公開済みの投稿の下書きの編集 | afterSave | `false` | 下書き(`status: "published"`) | 公開版 | 実測+公式ドキュメント |
| 複製 | **なし**(複製先は元の列の値=公開版を持つ下書き) | — | — | — | 実測+公式ドキュメント |
| ゴミ箱への移動 | afterDelete(`permanent: false`) | — | — | — | 実測+公式ドキュメント |
| 完全削除 | afterDelete(`permanent: true`) | — | — | — | 実測+公式ドキュメント |
| 復元 | afterRestore だけ(`status: "draft"` に戻る) | — | — | — | 実測+公式ドキュメント |
| プラグインの `ctx.content.create` | 他のプラグインに afterSave(`isNew: true`)。**呼んだプラグイン自身には届かない** | `true` | 作ったデータ | 無い | 実測+公式ドキュメント |
| プラグインの `ctx.content.publish` | afterPublish だけ(呼んだプラグインにも届く) | — | — | — | 実測+公式ドキュメント |
| プラグインの `ctx.content.update` / `delete` | なし | — | — | — | 実測+公式ドキュメント |

- 取り出し: `ctx.content.get` は列の値(公開済みなら公開版)と `draftRevisionId` を返し、`getRevision(collection, id, draftRevisionId)` で下書きを取れた。`listRevisions` は新しい順で、下書き・公開版・過去の版を含む。ゴミ箱に入ったエントリでは、リビジョンが残っていても `listRevisions` / `getRevision` は何も返さない(リビジョン 6 件のエントリで確かめた)。根拠: 実測+公式ドキュメント
- `getTrashedVersioned` は、ゴミ箱に入った画像(標準 API でも `ctx.content.delete` でも)に `{ item, _rev }`、ゴミ箱に入っていない画像・完全削除した画像・存在しない ID に `null` を返した。`get` と組み合わせて active / trashed / missing を区別できた([[T03-shared-contracts|T03]] の `imageEntryStatusSchema` の前提は成り立つ)。根拠: 実測+公式ドキュメント

### [[T20-owner-tracking|T20]] の前提(確定)

| 項目 | 前提 | 根拠 |
|---|---|---|
| 読むデータ | `event.content.data`(下書き)と、あれば `event.content.liveData`(列の値)の両方から参照を集める。T21 の判定が「列の値 ∪ 下書き」を見るので、それと揃える。複製で入った値も、複製先が一度保存されれば記録される | 実測+公式ドキュメント |
| 呼ばれる場面 | 作成・保存・自動保存・メタデータだけの更新(SEO や著者だけの PUT でも、今の下書き全体が渡る)。公開では呼ばれない | 実測+公式ドキュメント |
| afterPublish | 同じ処理を `content:afterPublish` にも付ける(`event.content.data` は公開したデータ)。一覧の一括公開のように API だけで公開すると afterSave が呼ばれず、複製したまま公開すると記録から漏れるため | 実測+公式ドキュメント(一括公開が `publishContent` だけを呼ぶのは公式ドキュメントのみ: `admin/src/router.tsx:524-530`) |
| 参照元の値 | `{ collection: event.collection, entryId: event.content.id, locale: event.content.locale, field }`。`content` には `id` / `locale` がある | 実測のみ |
| 対象のコレクション | `b64_images` の保存でも呼ばれる(他の経路で作られたとき)ので読み飛ばす。このプラグインのアップロード用ルートの `create` では、このプラグインの afterSave は呼ばれない | 実測+公式ドキュメント |
| フィールドの見分け方 | `ctx.schema.getCollection` で widget を読む(2 クエリ)か、値の形(参照のスキーマ)で見分ける(0 クエリ)。どちらにするかは T20 で決める | 公式ドキュメントのみ |
| クエリ数 | `getMany` 1 + 参照元が増えた画像の数(`putMany` は 1 件 1 クエリ。SQLite では `begin` / `commit` も数える)。参照元がすでにある画像は書かない。保存のリクエスト(SQLite で 55〜62 クエリ)と同じ呼び出しに入る | 実測+公式ドキュメント |
| 時機 | `after()` で実行され、保存の応答を待たせない。保存の応答の直後に記録を読むと、まだ書かれていないことがありうる | 実測(後半は推測のみ) |
| 例外 | 例外を投げると、保存は成功のまま、後に続く他のプラグインの afterSave が呼ばれなくなる(既定の `errorPolicy` は `"abort"`)。hook の中で受け止めて `ctx.log` に出し、`errorPolicy: "continue"` を指定する。他のプラグインの例外で自分が飛ばされないよう、`priority` を既定の 100 より小さくすることも考える | 実測+公式ドキュメント |
| タイムアウト | 既定 5,000ms | 公式ドキュメントのみ |
| 記録から漏れる経路 | 複製したまま保存も公開もしていないエントリ、seed、他のプラグインの `ctx.content.update`。リビジョンの復元・下書きの破棄・ゴミ箱からの復元は、過去に記録した値に戻るだけなので漏れない | 実測+公式ドキュメント |

### [[T21-orphan-routes|T21]] の前提(確定)

| 項目 | 前提 | 根拠 |
|---|---|---|
| 参照元 1 件の判定 | `get(collection, entryId)` が `null` → 参照元が削除された(ゴミ箱・完全削除のどちらも。1 クエリ)。あれば、列の値(`item.data`)と、`item.draftRevisionId` があれば `getRevision(collection, entryId, item.draftRevisionId)` の `data` で、参照元の `field` に画像 ID があるかを見る(3 / 6 クエリ)。`listRevisions` は使わない | 実測+公式ドキュメント |
| 下書きの `data` | 管理画面から保存したリビジョンには内部のキー `_slug` が入る。フィールド名で読む | 実測のみ |
| 画像エントリの状態 | `get("b64_images", id)` があれば active(2 クエリ)。`null` のときだけ `getTrashedVersioned` → あれば trashed(計 5)、無ければ missing(計 3)。ゴミ箱に入っていないエントリへの `getTrashedVersioned` は 9 クエリ(posts)と重い | 実測+公式ドキュメント |
| 1 回に扱う件数 | ルートの固定費 1 + `imageRefs` の query 1 + 画像ごとの状態 + 参照元ごと(同じエントリはリクエストの中で 1 回だけ)。参照元がそれぞれ別の投稿だと、10 件で 52(下書きなし)〜82(下書きあり)になり、仕様書 9 章にあった「10 件程度」では 50 を超える。件数は、最悪の見積もり(状態 5 + 未確認の参照元 × 6)が予算内に収まるところで止め、`nextCursor` で続ける | 実測のみ(式は推測のみ) |
| 参照元が多い画像 | 参照元が 8 件以上あると、1 枚だけでも 50 を超える(2 + 5 + 8 × 6 = 55)。参照元の上限か、参照元のページ送りが要る | 推測のみ |
| D1 との差 | 表の数は SQLite の値。D1 では同じ処理でも多いことがある(EmDash の計測で `GET /` が 6 → 10)。予算に余裕を残し、[[T32-cloudflare-check|T32]] で確かめる | 公式ドキュメントのみ |
| 完全削除の検知 | `content:afterDelete` の event は `{ id, collection, permanent }`。`collection === "b64_images"` かつ `permanent === true` のときだけ `imageRefs` から消す。`b64_images` は slug が無いので `id` は必ず ID(slug で完全削除すると `id` に slug が入る)。afterDelete も `after()` で実行され、前のプラグインの例外で飛ばされうるので、`imageRefs` だけが残った画像は missing として扱う | 実測+公式ドキュメント |
| ゴミ箱への移動(自分のルート) | `ctx.content.delete` では afterDelete が呼ばれない。T06 の前提のまま | 実測+公式ドキュメント |

### 決めたこと

- 参照元の記録は、afterSave に加えて afterPublish でも行う(一括公開と複製の組み合わせで記録から漏れるのを防ぐ)。読むデータは `data` と `liveData` の両方。仕様書 9 章に書いた。根拠: 上の実測からの判断
- 画像管理の一覧で 1 回に扱う件数は、固定の 10 件ではなく、クエリ数の見積もりで決める。仕様書 9 章に書いた。

### 仕様書・他のタスクへの影響

- 仕様書: 9 章(記録と判定)と、17 章の afterSave の項目を更新した。
- [[T18-upload-route|T18]]: `create` → `getVersioned` → `publish` は、ルート全体で 72 クエリ(SQLite。固定費 1 + create 30 + getVersioned 3 + publish 38。うち 28 は EmDash 本体のメディアの使用状況の索引の更新)。仕様書 7 章の「1 リクエスト 50 本に収める」は、D1 の上限が 50 なら満たせない。また、このプラグインの afterSave は自分の `create` では呼ばれないので、最初の参照元はルートで記録する(仕様書 9 章のまま)。自分の `publish` では、このプラグインの afterPublish が呼ばれる(`b64_images` なので読み飛ばす)。根拠: 実測のみ
- 仕様書 2.2: 「D1 のクエリ数(Free) 50 / リクエスト」について、Cloudflare のドキュメントが食い違う(D1 のページは 50、Workers のページは内部サービスへのサブリクエストが Free で 1,000)。EmDash 本体の保存も SQLite で 55〜62 クエリ使う。[[emdash-plugin-content-query-counts#D1 のクエリ数の上限(ドキュメントの食い違い)]]。根拠: 公式ドキュメントのみ
- [[T16-reference-hook|T16]]: 一部のフィールドだけの `PUT` では、`content:beforeSave` に送ったフィールドだけが渡る(管理画面は全フィールドを送る)。メタデータだけの `PUT` では beforeSave が呼ばれない。根拠: 実測のみ

### 環境と手順

- macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite、Playwright 1.63.0(Chromium 153.0.8010.12)。開発サーバーはポート 4410(使い捨てのサイト `spikes/after-save/site/`)。2026-09-24 に計測。
- 手順と再現用のコードは [[emdash-after-save-payload#再現手順]]、クエリ数の計り方は [[emdash-plugin-content-query-counts#計り方]]。
- Cloudflare Workers(workerd + D1)では確かめていない([[T32-cloudflare-check|T32]])。
