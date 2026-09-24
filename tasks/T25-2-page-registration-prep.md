---
id: T25-2
title: "画像管理ページを、一覧の列と登録(T29・T30)につなぐ準備をする"
type: 実装
status: done
wave: 3
parent: "[[T25-images-page]]"
depends_on:
  - "[[T25-images-page]]"
  - "[[T24-list-column]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
files:
  - "src/shared/constants.ts(ページの定数だけ)"
  - "src/admin/ImagesPage.tsx"
  - "tests/admin/ImagesPage.test.tsx"
  - "docs/emdash-admin-plugin-pages.md"
  - "tasks/T25-2-page-registration-prep.md"
  - "tasks/T25-images-page.md(T29・T30 への登録のしかた)"
spec:
  - "[[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)]]"
  - "[[base64-image-plugin-spec#11.5 画像管理ページ]]"
tags:
  - task
  - impl
  - subtask
created: 2026-09-24
---

# T25-2 画像管理ページを、一覧の列と登録(T29・T30)につなぐ準備をする

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-25-2`
> - 親タスク: [[T25-images-page|T25]]
> - 着手の条件(依存): [[T25-images-page|T25]]、[[T24-list-column|T24]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.4 コンテンツ一覧のサムネイル列(Q10)|仕様書 11.4]]、[[base64-image-plugin-spec#11.5 画像管理ページ|仕様書 11.5]]

## 目的

1. 画像管理ページのパス・ラベル・アイコンを 1 か所に置き、[[T29-plugin-definition|T29]](`src/index.ts` の `admin.pages`)と [[T30-admin-entry|T30]](`src/admin.tsx` の `pages` のキー)が同じ値を使えるようにする。
2. 画像管理ページで画像を完全に削除したあと、コンテンツ一覧のサムネイル列([[T24-list-column|T24]])が古いサムネイルを出さないようにする。

## 発生した理由

- [[T25-images-page|T25]] は、登録の値(`/images`・`an5hVd`・`image`)をノートに書いただけだった。2 か所に書き写すと、片方だけ変えたときにサイドバーの項目が消える(サイドバーは、`pages` に部品のあるパスだけを出す。[[emdash-admin-plugin-pages#登録の形]])。T25 の「影響・サブタスクの候補」に挙げた。
- T24 の列は、取得したサムネイルとマニフェストをモジュールの中に 1 分覚える。T25 は、並行して作られていた T24 の `clearThumbnailColumnCache()` を呼ばなかった(リーダーの指示)。両方が phase/3 に入ったので、つなぐ。

## 作業内容

- [x] `src/shared/constants.ts` に、ページのパス・ラベル・アイコンの定数を置く。`src/index.ts`(T29 のファイル)は変更せず、使い方をノートに書く
- [x] ラベルの ID が管理画面の辞書にあることを確かめる既存のテストを、定数を使う形にする
- [x] どの操作のあとで一覧の列の覚え書きを消すかを、コードと実際の管理画面で確かめて決め、画像管理ページから呼ぶ
- [x] `src/admin/ThumbnailColumn.tsx` を読み込んでも、実行時に `@emdash-cms/admin` を読み込まない(T24 の決まり)ことを確かめる
- [x] テストを足し、わざと壊して失敗することを確かめる
- [x] T25 のノートの「T29・T30 への登録のしかた」を、定数を使う形に直す。知見ノート [[emdash-admin-plugin-pages]] の登録の例を合わせる

## 完了条件

- [x] `npm run verify` が通る(3 つの型チェックを含む)
- [x] わざと入れた不具合をテストが見つける
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。`src/admin/ThumbnailColumn.tsx`(T24)・`src/index.ts`(T29)・`tests/admin/hooks.test.ts`(同時に動いていたリーダーのサブタスク)・`tasks/00-index.md`・`docs/00-index.md` は変更しない。

## 結果

> [!success] まとめ(2026-09-24)
> - `src/shared/constants.ts` に `IMAGES_PAGE = { path: "/images", label: "an5hVd", icon: "image" }` を置いた。T29 は `pages: [IMAGES_PAGE]`、T30 は `{ [IMAGES_PAGE.path]: ImagesPage }` と書く([[#T29・T30 での使い方]])。
> - 画像管理ページは、**完全削除が成功したときだけ**、一覧の列の覚え書きを消し(`clearThumbnailColumnCache()`)、すぐにマニフェストを読み直す(`preloadThumbnailColumn()`)。ゴミ箱への移動と公開では消さない。
> - 実際の管理画面(開発サーバーと本番のビルド)で、完全削除のあとに SPA で一覧へ移ると、列はすぐに警告アイコンになった。このプラグインのフィールドの無いコレクションには、一覧を開く順を変えても列が出なかった。
> - テスト: `tests/admin/ImagesPage.test.tsx` 70 件(T25 の 64 件のうち、登録の型とラベルの 3 件を「ページの定数」の 5 件に置き換え、一覧の列の覚え書きの 4 件を足した)。わざと 12 か所を壊し、12 か所ともテストが失敗した。
> - `src/admin/ThumbnailColumn.tsx` は変更していない。

### 決めたこと

| 項目 | 決めたこと | 根拠 |
|---|---|---|
| 定数の名前と形 | `IMAGES_PAGE`。`{ path, label, icon }` の 1 つのオブジェクトで、EmDash の `PluginAdminPage`(`{ path: string; label: string; icon?: string }`)の形そのまま。T29 はそのまま配列に入れられる。`as const satisfies` で、`path` が `/` から始まる文字列であることを型で確かめる(テンプレートリテラル型)。`src/shared/` はどこからでも読み込めるように、`emdash` の型を読み込まない | 実測+公式ドキュメント(型のテストで `emdash` の `PluginAdminConfig` の `pages` に入った。`references/emdash/packages/core/src/plugins/types.ts:1826-1830`、`:1981-1987`)。型を読み込まないのは推測のみ(設計の判断) |
| パスの形 | `/images`(`/` から始める)。サイドバーは `admin.pages` の `path` を `normalizePluginPagePath` で `/` 付きにしてリンクにし、描画は `"/" + splat` をキーにして部品を探す。`/` から始めれば、2 つが同じ文字列になる | 実測+公式ドキュメント(テストで `isSafePluginPagePath` と `normalizePluginPagePath` を通した。定数で登録したページが、実際の管理画面のサイドバーのリンクから開けた。`references/emdash/packages/blocks/src/validation.ts:128-139`、`references/emdash/packages/admin/src/components/Sidebar.tsx:496-499`、`references/emdash/packages/admin/src/router.tsx:2729-2747`) |
| 覚え書きを消す操作 | 完全削除が成功したときだけ。完全削除は `imageRefs` の記録を消す(`content:afterDelete`、`permanent: true` のときだけ。`src/server/hooks/image-deleted.ts:65`)ので、列はサムネイルから警告アイコンに変わる。ゴミ箱への移動(`ctx.content.delete`。`src/server/routes/images-admin.ts:194`)と公開は記録を変えず(`b64_images` の保存・公開では参照元の hook が何もしない。`src/server/hooks/owners.ts:207`)、サムネイルのルートは `imageRefs` だけを読む(`src/server/routes/admin-data.ts:183-192`)ので、列の表示は変わらない | 実測のみ(実際の管理画面で、ゴミ箱に移した画像はサムネイルのまま、完全に削除した画像は警告アイコンになった)。公開は実際の管理画面では確かめず、単体テスト(`tests/server/owners.test.ts:275-285`。`b64_images` の公開で、参照元の hook は何も読み書きしない)とソースから判断した |
| 消したあと | すぐに `preloadThumbnailColumn()` でマニフェストを読み直す(2 つを `refreshThumbnailColumn()` にまとめた)。`clearThumbnailColumnCache()` はマニフェストの覚え書きも消し、消したままだと、次に開いた一覧がフィールドの無いコレクションでも空の列を出すため([[T24-list-column\|T24]] の先読みと同じ理由) | 実測のみ(下の表) |
| 呼ぶところ | `deleteImagePermanently(item.id)` が成功したすぐあと。失敗(例外)では呼ばない | 実測のみ(単体テスト) |
| 読み込み方 | `ImagesPage.tsx` から `./ThumbnailColumn` を直接読み込む。T24 の列のモジュールは `@emdash-cms/admin` を型だけで読み込み(`import type`。`verbatimModuleSyntax: true` で実行時には消える)、ページから読み込んでも変わらない。ページ自身は T25 のとおり `useCurrentUser` を実行時に読み込む | 実測のみ(`@emdash-cms/admin` を読み込むと失敗するモックで、列のモジュールは読み込め、ページは読み込めなかった。列のモジュールに実行時の読み込みを足すと、テストが失敗した) |

### 実際の管理画面で確かめたこと

使い捨てのサイト(`spikes/images-page/site/`、git 管理外。T25 のものに、Pages のコレクションと一覧の列を足した)で、T30 の代わりに入口へ `thumbnailColumn`・`preloadThumbnailColumn()`・`{ [IMAGES_PAGE.path]: ImagesPage }` を、定義の `admin.pages` に `[IMAGES_PAGE]` を登録した。投稿のカバーの画像をゴミ箱に移し、ダッシュボード → Posts の一覧 → 画像管理ページでその画像を完全に削除 → Posts と Pages の一覧(サイドバーのリンク。SPA)と操作した。手順は [[emdash-admin-plugin-pages#再現手順]] の 7。根拠: **実測のみ**(Chromium 153.0.8010.12、Playwright 1.63.0、macOS 26.4、Node 26.10.0、`emdash` / `@emdash-cms/admin` 0.39.1。ポート 4425。確かめたあと止め、`lsof -nP -iTCP:4425 -sTCP:LISTEN` で何も出ないことを確かめた)

| 完全削除のあと、ページがすること | 一覧を開く順 | Posts(フィールドあり)の列 | Pages(フィールドなし) | 確かめた環境 |
|---|---|---|---|---|
| 何もしない(T25 のまま) | Posts → Pages | **サムネイルのまま**(取り直さない) | 列なし | 開発サーバー |
| 消すだけ | Posts → Pages | 警告アイコン | 列なし | 開発サーバー |
| 消すだけ | Pages → Posts | 警告アイコン | **空の列** | 開発サーバー |
| 消して、すぐにマニフェストを読み直す(採用) | Posts → Pages、Pages → Posts | 警告アイコン | 列なし | 開発サーバー、本番のビルド |

- 採用した形の要求の順は、どれも「マニフェスト 2 回(ダッシュボード)→ サムネイル(Posts)→ `DELETE …/permanent` → マニフェスト(読み直し)→ サムネイル(Posts に戻ったとき)」だった。console の警告・エラーは無かった。
- 定数で登録すると、サイドバーに項目(リンクは `/_emdash/admin/plugins/base64-image/images`)が出て、そこから画像管理ページが開いた(開発サーバーと本番のビルド)。項目の文字は、日本語の画面で「画像」だった(開発サーバーで読んだ)。
- 完全削除の `content:afterDelete` は応答のあとに実行される。この計測では、一覧に戻ったときには記録が消えていた。応答の直後(hook が終わる前)に一覧を開くと、古いサムネイルをもう一度 1 分覚えることがありうる。根拠: 推測のみ

### テスト

`tests/admin/ImagesPage.test.tsx`(70 件)。一覧の列のモジュールは差し替えず、このページと同じモジュールの覚え書きを調べる。`beforeEach` で、偽のサーバーにマニフェスト(Posts はこのプラグインのフィールドあり、Pages はなし)とサムネイルのルートを足し、`clearThumbnailColumnCache()` で覚え書きを消す。

- 一覧のサムネイル列(T24)の覚え書き(4 件): 先に列の覚え書きを作っておき(マニフェストとサムネイルを 1 回ずつ取得)、ページを操作する。
  - 完全に削除したら、`DELETE` のあとでマニフェストを読み直し、Pages は最初の判定から列を出さず(読み込み中の `true` にならない)、Posts は出す。サムネイルは取り直す。
  - ゴミ箱への移動と公開では、マニフェストもサムネイルも取り直さない。
  - 完全削除に失敗(404)したら、取り直さない。
  - `vi.resetModules()` と、読み込むと例外を投げる `@emdash-cms/admin` のモックで、列のモジュールは読み込め、ページは読み込めない(確かめ方が働いていることの比較)。最後にファイルの先頭と同じモックに戻す。
- ページの定数(5 件): `PluginAdminConfig` の `pages` に入る(型)、`PluginAdminModule["pages"]` のキーに使える(型)、`isSafePluginPagePath` と `normalizePluginPagePath` を通る、ラベルが「Images」の Lingui の ID と同じ、管理画面が使えるすべての言語の辞書に訳がある(ja は「画像」、en は「Images」。T25 のテストを定数を使う形にした)。

### ミューテーションテスト

実装を 1 か所ずつ壊し、テストが失敗するかを確かめた(使い捨てのスクリプト。壊したファイルは毎回元に戻し、最後に元のファイルと一致することを確かめた)。根拠: **実測のみ**

| 壊したところ | 結果 |
|---|---|
| 完全削除のあとで覚え書きを消さない | 失敗した(1 件) |
| 消したあとでマニフェストを読み直さない | 失敗した(1 件) |
| 読み直しを始めてから消す(順が逆) | 失敗した(1 件) |
| 消さずに読み直しだけ | 失敗した(1 件) |
| ゴミ箱への移動でも消す | 失敗した(1 件) |
| 公開でも消す | 失敗した(1 件) |
| 完全削除などの失敗でも消す | 失敗した(1 件) |
| パスを `/` から始めない(`"images"`) | 失敗した(2 件) |
| ラベルを文字列の `"Images"` にする | 失敗した(3 件) |
| ラベルを「Image」の ID(`hG89Ed`)にする | 失敗した(3 件) |
| 一覧の列のモジュールが、実行時に `@emdash-cms/admin` から値を読み込む | 失敗した(1 件) |
| 一覧の列のモジュールが、`@emdash-cms/admin` を副作用だけで読み込む(`import "@emdash-cms/admin"`) | 失敗した(1 件) |

- 12 か所のすべてで失敗した。一覧の列のモジュール(T24 のファイル)を壊した 2 か所は、確かめ方を試すためだけで、ファイルは元に戻した。

### T29・T30 での使い方

```ts
// T29: src/index.ts(抜粋)
import { IMAGES_PAGE } from "./shared/constants";

definePlugin({
	// …
	admin: {
		entry: ADMIN_ENTRY,
		pages: [IMAGES_PAGE],
	},
});
```

```tsx
// T30: src/admin.tsx(抜粋)
import { ImagesPage } from "./admin/ImagesPage";
import { preloadThumbnailColumn, thumbnailColumn } from "./admin/ThumbnailColumn";
import { IMAGES_PAGE } from "./shared/constants";

preloadThumbnailColumn(); // T24 のとおり

export const contentListColumns = [thumbnailColumn];
export const pages = { [IMAGES_PAGE.path]: ImagesPage };
```

- `IMAGES_PAGE` の値を書き写さない。`label` を文字列にしない(訳されず、本番のビルドで警告が出る。[[T25-images-page#サイドバーのラベルの比べ方(リーダーからの依頼)|T25]])。
- ページと一覧の列は、同じ入口から読み込むので、覚え書きを共有する。T30 に、つなぐための作業は無い。
- `src/shared/constants.ts` は依存の無い定数だけなので、T29 のサーバーの入口から読み込んでよい(`src/admin/ImagesPage.tsx` は読み込まない)。

### 影響・サブタスクの候補

- **一覧の列に、指定した画像のサムネイルだけを忘れさせる関数**(例: `forgetThumbnails(ids)`)が `src/admin/ThumbnailColumn.tsx` にあれば、完全削除のたびにマニフェストを読み直さずに済む(いまは完全削除 1 回ごとに `GET /_emdash/api/manifest` が 1 回増える)。T24 のファイルなので変更していない。
- **仕様書**: 11.4 または 11.5 に「画像管理ページで完全に削除したら、一覧の列の覚え書きを消し、マニフェストを読み直す」を書くかは、リーダーが決める(このサブタスクでは仕様書を変更していない)。
- **T29・T30 のノート**: 登録に `IMAGES_PAGE` を使うこと([[#T29・T30 での使い方]])を、後続タスクのノートに反映する必要がある(このサブタスクでは変更していない)。
- **`docs/00-index.md`**: [[emdash-admin-plugin-pages]] に「ページから一覧の列の覚え書きを消す」の節を足した。索引の説明に足すかは、リーダーが決める。
- `tests/admin/ImagesPage.test.tsx` は、`@emdash-cms/blocks/server`(`emdash` と `@emdash-cms/admin` の依存。このプラグインの package.json には無い)を直接読み込むようにした。T25 の `@tanstack/react-query`・`@lingui/core` と同じく、npm の巻き上げが変わって読めなくなったら、devDependencies に入れる(package.json の変更)。
- 完全削除の直後に一覧を開くと、hook が終わる前に古いサムネイルを覚えることがありうる(推測のみ。[[#実際の管理画面で確かめたこと]])。起きても 1 分で取り直す。
