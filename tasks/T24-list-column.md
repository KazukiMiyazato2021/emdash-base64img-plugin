---
id: T24
title: "コンテンツ一覧のサムネイル列を作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ThumbnailColumn.tsx"
  - "tests/admin/ThumbnailColumn.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T24 コンテンツ一覧のサムネイル列を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 11.4 のコンテンツ一覧の列を作る。

## 作業内容

- [x] `contentListColumns` の拡張を定義する
- [x] `fetchManifest` で、コレクションごとにこのプラグインの widget のフィールドを特定する(単一画像を優先し、なければギャラリー)
  - `fetchManifest` は、入口の読み込み時(管理画面の Lingui が有効になる前)に毎回失敗したので使わず、同じ要求(`GET /_emdash/api/manifest`)を `emdash/plugin-utils` の `apiFetch` / `parseApiResponse` で送った(下の決定 2)。
- [x] `collections`(同期関数)での判定方法を決める(仕様書 17 章の未決事項)
- [x] `visibleItems` の分のサムネイルを、1回のリクエストでまとめて取得する
- [x] 表示: サムネイル、「+N」、「—」、警告アイコン
- [x] サムネイルは [[T14-admin-i18n-api|T14]] の `fetchThumbnails`(100 件ずつ)で取得する。`thumbnail: null` は `imageRefs` に無い画像(完全削除した・記録が無い)で、警告アイコンを出す。ゴミ箱に入った画像はサムネイルが返る(仕様書 11.4。[[T17-admin-data-routes#結果|T17]])。[[T21-orphan-routes|T21]] がゴミ箱の状態を記録することにしたら、それに合わせる
  - [[T21-orphan-routes|T21]] は記録しないことにした(T21 の決定 7)。仕様書 11.4 のまま、ゴミ箱に入った画像にもサムネイルを出す。
- [x] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])
- [x] アイコンは `src/admin/parts/icons.tsx` の `UploadIcon`・`ImageMissingIcon`・`WarningIcon` を使える(`@phosphor-icons/react` はこのプラグインの peerDependencies に無いので、自前の SVG。飾りとして `aria-hidden`)。Kumo 2.6.0 の注意([[emdash-admin-plugin-ui-styling#Kumo 2.6.0 の注意点|知見ノート]]): `Loader` は英語の `aria-label="Loading"` と `role="status"` を持つ(飾りなら `aria-hidden` の要素で包み、伝えるなら訳した `aria-label` を渡す)。`Button` の名前は `title` でなく `aria-label` で付ける(`title` はツールチップで包む)。`Label`(`Input` の `label`)に `required={false}` を渡すと英語の「(optional)」が出る。Kumo の省略できる props に `undefined` になりうる値を渡すと、利用者の厳しい型チェック(`exactOptionalPropertyTypes`)で型エラーになるので、値があるときだけ展開する。読み上げの領域は `role="status"` でなく `<output>`(oxlint の `jsx-a11y/prefer-tag-over-role`)
  - 使ったアイコンは `WarningIcon` だけ。Kumo の部品は使っていない(読み込み中は `Loader` でなく、灰色の枠と読み上げ用の文字にした。行ごとに `role="status"` を出さないため)。読み上げの領域も作っていない。

## 完了条件

- [x] コンポーネントのテスト
- [x] 未決事項の結果を仕様書 17 章に反映した

## 変更してよいファイル

- `src/admin/ThumbnailColumn.tsx`
- `tests/admin/ThumbnailColumn.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/admin/ThumbnailColumn.tsx` に、一覧の列の定義 `thumbnailColumn`(`contentListColumns` の要素)と、セル `ThumbnailCell` を作った。登録は [[T30-admin-entry|T30]] が行う(下の「T30 が登録するもの」)。
> - 列を出すコレクションは、管理画面のマニフェストで決める。`collections` は同期関数で、一覧の画面はコレクションや利用者のロールが変わったときにしか呼び直さないので、**入口の読み込み時にマニフェストの取得を始める**(`preloadThumbnailColumn()`)。取得の前は列を出し、フィールドが無いと分かったコレクションではセルが何も描かない(仕様書 17 章の未決事項)。
> - `@emdash-cms/admin` の `fetchManifest` は、入口の読み込み時(管理画面の Lingui が有効になる前)に毎回失敗した。同じ要求を `emdash/plugin-utils` の `apiFetch` / `parseApiResponse`(プラグインの管理画面向け。Lingui を使わない)で送る。
> - 列の見出しは、管理画面の辞書にある「Image」のメッセージ ID(`hG89Ed`)を `label` にした。文字列の "Image" は日本語の画面でも訳されず、本番のビルドでは描画のたびに Lingui の警告が出た。
> - サムネイルは、表示中のページの画像 ID を、画像 ID ごとの覚え書きで 1 回の要求にまとめて取得する。1 分間覚えておき、ページを戻っても要求し直さない。
> - 実際の管理画面(開発サーバーと本番のビルド)で、1 ページ目(20 行・画像 8 枚)の要求が 1 回・8 件であること、先読みでフィールドの無いコレクションに列が出ないこと、ゴミ箱に入った画像にサムネイルが出ることなどを確かめた。
> - `tests/admin/ThumbnailColumn.test.tsx` に 37 件のテスト。ソースを 34 種類壊して、すべてでテストが失敗することを確かめた。
> - 知見ノート: [[emdash-admin-content-list-columns]](`collections` の呼ばれ方、`fetchManifest` と Lingui、列の見出しの訳し方)

### T30 が登録するもの

`src/admin.tsx` に次のように書く(T24 では `src/admin.tsx` を変えていない)。

```tsx
import type { ContentListColumnExtension } from "@emdash-cms/admin";

import { preloadThumbnailColumn, thumbnailColumn } from "./admin/ThumbnailColumn";

// 入口の読み込み時にマニフェストの取得を始める(一覧の列を出すコレクションの判定に使う)
preloadThumbnailColumn();

export const contentListColumns: readonly ContentListColumnExtension[] = [thumbnailColumn];
```

- `preloadThumbnailColumn()` を呼ばないと、ダッシュボードなどから最初に SPA で開いた一覧が、このプラグインのフィールドの無いコレクション(Pages など)でも空の列を出す(3/3)。読み込み直して直接開いた一覧は、2 回目の判定(利用者のロールが届いたとき)で列が消える。根拠: 実測のみ
- `thumbnailColumn` の項目(`label` など)は上書きしない。`label` は管理画面の辞書の ID で、文字列にすると訳されない(決定 5)。
- 入口の読み込み時に 1 回、`GET /_emdash/api/manifest` を送る(管理画面自身の 1 回とは別。開発サーバーで 7 クエリ)。ログイン画面でも入口は読み込まれ、先読みは 401 で失敗するが、ログインに成功すると管理画面を読み込み直すので、そこで取り直す(`references/emdash/packages/admin/src/components/LoginPage.tsx:186`)。失敗しても、次に `collections` が呼ばれたときに取り直す。
- `ThumbnailColumn.tsx` は、実行時に `@emdash-cms/admin` を読み込まない(型だけ)。jsdom で読み込むと 115ms。入口を読み込むテストでは、先読みが `fetch` を呼ぶ(`fetch` を差し替えていなければ失敗するだけで、例外は外に出ない)。

### export

| export | 種類 | 内容 |
|---|---|---|
| `thumbnailColumn` | 列の定義 | `{ id: "thumbnail", label: THUMBNAIL_COLUMN_LABEL, cell: ThumbnailCell, collections: showsThumbnailColumn }`。`contentListColumns` に入れる |
| `preloadThumbnailColumn()` | 関数 | マニフェストの取得を始める。入口の読み込み時に呼ぶ |
| `ThumbnailCell` | 部品 | 列のセル(`ContentListColumnCellContext` を受け取る) |
| `showsThumbnailColumn(collection)` | 関数 | 列を出すコレクションか(`collections` に渡す同期関数) |
| `clearThumbnailColumnCache()` | 関数 | 覚えているマニフェストとサムネイルを消す。消す前に始めた要求の結果は、届いても覚えない |
| `selectThumbnailField` / `getRowImage` / `collectThumbnailIds` / `requestThumbnails` | 関数 | 中身の部品(テストでも使う) |
| `THUMBNAIL_COLUMN_LABEL` / `MANIFEST_STALE_MS` / `THUMBNAIL_STALE_MS` / `MAX_CACHED_THUMBNAILS` | 定数 | `"hG89Ed"` / 60,000ms / 60,000ms / 200 件 |
| 型 | — | `ThumbnailField`・`RowImage`・`FieldLookup`・`ThumbnailEntry` |

### 表示

文言は日本語と英語(`<html lang>` で切り替える。[[T14-admin-i18n-api|T14]] の `useMessages`)。

| 行の状態 | 表示 | 読み上げ(ja) |
|---|---|---|
| 画像あり | 40px の正方形のサムネイル | `alt` は参照の代替テキスト。空なら「画像」 |
| ギャラリー(2 枚以上) | 1 枚目と「+N」 | 「ほか N 枚」 |
| 未設定(値が無い・空のギャラリー) | 「—」 | 「画像なし」 |
| `imageRefs` に無い(`thumbnail: null`。完全削除した・記録が無い) | 警告アイコン | 「画像が見つかりません(完全に削除されたか、記録がありません)」(マウスを重ねても出る) |
| 参照の形でない値(seed・手での書き換え) | 警告アイコン | 「画像の値が正しくありません」 |
| ゴミ箱に入った画像 | サムネイル | — |
| 取得中 | 灰色の枠 | 「サムネイルを読み込み中」 |
| 取得の失敗(通信・サーバーのエラー、応答にその画像が無い) | 警告アイコン | 「サムネイルを読み込めませんでした」。マウスを重ねると理由([[T14-admin-i18n-api\|T14]] の `useErrorMessage`) |
| マニフェストの取得中 / 取得の失敗 | 灰色の枠 / 警告アイコン | 「サムネイルを読み込み中」/「サムネイルを読み込めませんでした」 |
| このプラグインのフィールドが無いコレクション(判定の前に列が選ばれたとき) | 何も描かない | — |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 列を出すコレクションの判定(仕様書 17 章): `collections` は、モジュールに覚えたマニフェストで判定する。入口の読み込み時に取得を始める(`preloadThumbnailColumn`)。取得の前と、取得に失敗したときは `true`(列を出す)。フィールドが無いと分かったコレクションでは、セルが何も描かない | `collections` は同期関数で、一覧の画面の `useMemo`(依存はコレクション・`pluginAdmins`・`pluginStates`・`userRole`)の中で呼ばれ、非同期の結果を待って呼び直させる方法が無い。`false` から始めると、フィールドのあるコレクションで列が出ないまま残る。空の列は、列が出ないより害が小さい | 実測+公式ドキュメント(`references/emdash/packages/admin/src/components/ContentList.tsx:382-385`、`references/emdash/packages/admin/src/lib/content-list-columns.tsx:122-141`。[[emdash-admin-content-list-columns#collections が呼ばれる時]]) |
| 2 | マニフェストは `emdash/plugin-utils` の `apiFetch` / `parseApiResponse` で取得する(`fetchManifest` は使わない) | `fetchManifest` は応答のあとで `i18n._` を呼び、入口の読み込み時は Lingui が有効でないので毎回失敗した(5/5)。`emdash/plugin-utils` は EmDash がプラグインの管理画面向けに用意した関数で、Lingui を使わない。実行時に `@emdash-cms/admin` を読み込まずに済む | 実測+公式ドキュメント(`references/emdash/packages/admin/src/lib/api/client.ts:341-344`、`references/emdash/packages/core/src/plugin-utils.ts:27-31`・`:62-71`、`references/emdash/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx:386`) |
| 3 | 表示するフィールドは、マニフェストの `collections[slug].fields` を順に見て、`kind: "json"` で widget が `base64-image:image` の最初のもの、無ければ `base64-image:gallery` の最初のもの | 仕様書 11.4。フィールドのキーの順はスキーマの順。サーバーの `getFieldWidgetKind` と同じく、json 型だけを対象にする | 実測+公式ドキュメント(`references/emdash/packages/core/src/api/handlers/manifest.ts:37-54`、`references/emdash/packages/core/src/schema/registry.ts:362-364`) |
| 4 | マニフェストは 1 分で古いとみなし、次の判定やセルを作るときに取り直す(取り直す間は前の結果を使う) | 管理画面の TanStack Query の `staleTime`(1 分)に合わせる。フィールドを足したときなどに、管理画面を読み込み直さなくても反映される | 公式ドキュメントのみ(`references/emdash/packages/admin/src/App.tsx:30`)。取り直しはテストで確かめた |
| 5 | 列の `label` は、管理画面の辞書にある「Image」の ID(`hG89Ed`)にする | 管理画面は `i18n._(label)` で訳すが、辞書のキーは ID なので、文字列の "Image" は日本語の画面でも訳されなかった。本番のビルドでは、描画のたびに「Uncompiled message detected!」が出た(6 回)。ID なら「画像」で、警告は 0 回。インストールした `@emdash-cms/admin` の辞書に ID があることを単体テストで確かめる | 実測+公式ドキュメント(`references/emdash/packages/admin/src/components/ContentList.tsx:1149`。[[emdash-admin-content-list-columns#列の見出し(label)と Lingui の ID]]) |
| 6 | サムネイルは、画像 ID ごとの覚え書き(モジュールの中の `Map`)で取得を 1 回にまとめる。各セルが表示中のページの ID を渡し、まだ無いもの・失敗したもの・古いもの(1 分)だけを 1 回の要求で送る。取得中のものは送らない。古いものは取り直す間も表示する | セルは行ごとに作られ、どのセルも同じ `visibleItems` を受け取る。1 分は一覧のデータの `staleTime` と同じ | 実測+公式ドキュメント(`references/emdash/packages/admin/src/components/ContentList.tsx:1296-1321`)。1 ページ目で要求 1 回・8 件、戻っても要求なし |
| 7 | 覚えるサムネイルは 200 件まで。表示に使った順が古いものから捨てる(取得中のものは捨てない) | 1 件は最大 8,000 バイトで、最大約 1.6MB。一覧を何ページ見ても増え続けない | 設計判断 |
| 8 | 応答に無い画像は「見つからない」(`thumbnail: null`)でなく、取得の失敗(`UNEXPECTED_RESPONSE`)にする | ルートは要求したすべての ID を返し、`imageRefs` に無い画像は `thumbnail: null` にする(`src/server/routes/admin-data.ts:195-196`)。応答に無いのは想定外の応答なので、「完全に削除されたか、記録がありません」とは伝えない | 公式ドキュメントのみ([[T17-admin-data-routes#結果\|T17]])。テストで確かめた |
| 9 | 参照の形でない値は、警告アイコンを出し、要求しない | seed や手での書き換えで起きる。ID を取り出せない | 設計判断 |
| 10 | 代替テキストが空の画像は、`alt` を「画像」にする | 装飾画像でも、一覧では行に画像があることを伝える | 設計判断 |
| 11 | ゴミ箱に入った画像にもサムネイルを出す | [[T21-orphan-routes\|T21]] は、ゴミ箱に入っているかどうかを `imageRefs` に記録しないことにした(T21 の決定 7)。仕様書 11.4 のまま | 実測のみ(実際の管理画面の Post 09) |
| 12 | 見た目は、EmDash のメディアライブラリの一覧のサムネイルと同じクラス。管理画面の CSS にあるクラスだけを使う | 管理画面の見た目に合わせる | 公式ドキュメントのみ(`references/emdash/packages/admin/src/components/MediaLibrary.tsx:1763-1775`)。`findMissingClasses` で確かめた |

### 実際の管理画面での確認

playground を複製した使い捨てのサイト(`spikes/list-column/`、git 管理外)に、本物と同じプラグイン ID で列を登録し、Playwright(Chromium 153)で操作した。開発サーバーと本番のビルド(`astro build` + `astro preview`)の両方で、ポートは 4424。手順と全データは [[emdash-admin-content-list-columns]]。根拠: 実測のみ

- Posts(単一画像 `cover` とギャラリー `gallery` を持つ)の 1 ページ目(20 行・画像 8 枚): `thumbnails` の要求は 1 回・8 件(`db.count` 2)。同じページに戻る・2 ページ目(取得済みの画像だけ)・1 ページ目に戻る: 要求なし。
- マニフェストの要求は、管理画面の 1 回とこのプラグインの 1 回(どちらも `db.count` 7)。
- ゴミ箱に入った画像はサムネイル、`imageRefs` の記録を消した画像と参照の形でない値は警告アイコン、未設定とギャラリーだけの行(`cover` が優先)は「—」。
- Albums(ギャラリーだけ): 1 枚目と「+3」(読み上げは「ほか 3 枚」)、空のギャラリーは「—」。
- Pages(フィールドなし): 先読みありでは、ダッシュボードから SPA で開いても(3/3)、直接開いても(5/5)列が出ない。先読みなしでは、SPA で最初に開くと空の列が出た(3/3)。
- 見出しは、日本語で「画像」、英語で「Image」。console の警告・エラーは無し(本番のビルドを含む)。
- マニフェストの取得を `@emdash-cms/admin` の関数から `emdash/plugin-utils` に切り替えたあとで測り直し、同じ結果だった。

### テスト

- `tests/admin/ThumbnailColumn.test.tsx`: 37 件。フィールドの選び方(単一画像の優先・json 以外・形の崩れ)、行の値(未設定・不正・ギャラリーの枚数)、ID の集め方、`showsThumbnailColumn`(読み込み前は `true`・取得は 1 回・CSRF のヘッダー・Lingui が有効でない状態での取得と `fetchManifest` の失敗・失敗のあとの取り直し・1 分での取り直し・描画中に呼ばれても React の警告が出ない・先読み)、`ThumbnailCell`(1 回の要求にまとめる・各表示・読み込み中・「+N」・単一画像の優先・フィールドの無いコレクション・マニフェストの読み込み中と失敗・描き直し・次のページと戻り・1 分での取り直し・失敗と理由・応答に無い画像・言語の切り替え・CSS のクラス)、`requestThumbnails`(200 件・取得中・消したあとの結果)、`label`(ID の計算と、ja・en の辞書)。
- モジュールは差し替えず、`fetch` だけを `vi.stubGlobal` で偽物にした。一覧の画面の代わりに、各行のセルに同じ `visibleItems` を渡す表と、描画中に `collections` を呼ぶ画面をテストの中で作った。描画中の判定のテストは `console.error` を見張る。
- ソースに不具合を 1 つずつ入れて、34 種類すべてでテストが失敗することを確かめた(スクリプトは scratchpad に置いた使い捨て)。最初の版では「描画中の判定で購読者に知らせる」が見つからなかった(判定を別の React の root で呼んでいた)ので、一覧の画面と同じく、セルと同じ root の描画中に判定するテストに直した。根拠: 実測のみ
  - フィールドと行の値: 単一画像を優先しない・json 型を確かめない・「+N」を枚数そのものにする・不正な単一画像を未設定にする・空のギャラリーを不正にする・ID の重複を除かない
  - 判定とマニフェスト: 読み込み前は列を出さない・フィールドの無いコレクションにも列を出す・古いマニフェストを読み直さない・失敗したマニフェストを読み直さない・`fetchManifest` で取得する・`@emdash-cms/admin` の `parseApiResponse` を文言なしで使う・CSRF のヘッダーを付けない・描画中の判定で購読者に知らせる
  - サムネイルの取得: 毎回すべての画像を要求する・取得中の画像も送る・1 分たっても取り直さない・取り直す間は前のサムネイルを消す・失敗した画像を取り直さない・古いものを捨てない・表示中の画像を新しい側に移さない・消したあとに届いた結果を覚える・消すときに世代を進めない・応答に無い画像を「見つからない」にする・行ごとに要求する
  - 表示: 空の `alt` をそのまま使う・「+N」の読み上げを消す・記録の無い画像を「—」にする・未設定の読み上げを消す・失敗の理由を出さない・管理画面の CSS に無いクラスを使う・`label` を "Image" にする・英語の文言を日本語のままにする・マニフェストの読み込み中に何も描かない

### 仕様書の変更

- 11.4: 「`@emdash-cms/admin` の `fetchManifest` で判別する」を、マニフェストを `emdash/plugin-utils` の関数で取得する形に直し、`collections` の判定と先読み、列の見出し(`label`)、1 ページ 20 行と 1 分の覚え書きを書いた。
- 17 章: 「一覧の列を出すコレクションの判定方法」を決定済みにした。

### 他のタスクへの影響

1. [[T30-admin-entry|T30]]: 上の「T30 が登録するもの」。`preloadThumbnailColumn()` を入口の読み込み時に呼ぶ。
2. 画像管理ページのラベル(`src/index.ts` の `admin.pages` の `label`)を決めるタスク([[T25-images-page|T25]] か [[T30-admin-entry|T30]]): ページのラベルも、管理画面が `i18n._(label)` で訳す(`references/emdash/packages/admin/src/components/Sidebar.tsx:333-341`、`:497`)。文字列のラベルは訳されず、本番のビルドでは描画のたびに Lingui の警告が出るとみられる。根拠: 推測のみ(列の `label` と同じ呼び方。ページのラベルでは確かめていない)
3. [[T25-images-page|T25]]: 画像管理ページで画像を完全に削除しても、一覧の列は覚えたサムネイルを最大 1 分表示する(そのあと取り直して警告アイコンになる)。すぐに反映するなら、完全に削除したあとで `clearThumbnailColumnCache()` を呼ぶ。根拠: 推測のみ(覚え書きの仕組みから)
4. [[T31-e2e|T31]]: 実際の管理画面で、列の表示(1 回の要求・フィールドの無いコレクションに列が出ない・見出しの言語)を確かめる。

### 未解決・サブタスクの候補

1. `docs/00-index.md` に [[emdash-admin-content-list-columns]] を登録する(リーダー)。
2. スキーマを変えた(フィールドを足した・消した)ときの列の出方は、最大 1 分と、別のコレクションへの移動を待つ(決定 4)。管理画面を読み込み直せばすぐに反映される。
3. EmDash への提案の候補: `collections` が非同期の結果で呼び直されない。判定に使うデータ(マニフェストなど)を渡すか、判定を非同期にできると、先読みが要らなくなる。
4. EmDash への報告の候補: ドキュメント(`references/emdash/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx:225`)と `Sidebar.tsx:321-331` のコメントは、「Settings」のような文字列のラベルに管理画面の訳が使われるとしているが、0.39.1 では、列の `label` の文字列は訳されなかった(辞書のキーが ID のため)。
