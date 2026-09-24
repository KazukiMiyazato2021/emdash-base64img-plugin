---
id: T30
title: "管理画面のエントリ(src/admin.tsx)を組み立てる"
type: 実装
status: done
wave: 5
depends_on:
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
files:
  - "src/admin.tsx"
  - "tests/admin/admin-entry.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T30 管理画面のエントリ(src/admin.tsx)を組み立てる

> [!info] 概要
> - 種別: 実装 / ウェーブ: 5
> - 着手の条件(依存): [[T24-list-column|T24]]、[[T25-images-page|T25]]、[[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]、[[T33-readme|T33]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

管理画面側の部品を `src/admin.tsx` にまとめる。

## 作業内容

- [x] `fields`(`image` / `gallery`)、`pages`、`contentListColumns` を export する
- [x] 一覧の列は `src/admin/ThumbnailColumn.tsx` の `thumbnailColumn` を `contentListColumns` に入れ、入口の読み込み時に `preloadThumbnailColumn()` を呼ぶ(マニフェストの先読み。呼ばないと、最初に SPA で開いた一覧で、このプラグインのフィールドの無いコレクションにも空の列が出る)。`thumbnailColumn` の項目(`label` など)は上書きしない。`label` は管理画面の辞書の ID で、文字列にすると訳されない([[T24-list-column#T30 が登録するもの|T24]]、[[emdash-admin-content-list-columns]])
- [x] 入口を読み込むテストでは、先読みが `fetch`(`GET /_emdash/api/manifest`)を呼ぶ。`fetch` を差し替えておく(差し替えなくても例外は外に出ないが、失敗の要求が 1 回出る)([[T24-list-column#T30 が登録するもの|T24]])
- [x] 画像管理ページは `export const pages = { [IMAGES_PAGE.path]: ImagesPage }` で登録する(`IMAGES_PAGE` は `src/shared/constants.ts`、`ImagesPage` は `src/admin/ImagesPage.tsx`。キーは T29 の `admin.pages` の `path` と同じ)。`ImagesPage` は `@emdash-cms/admin` の `useCurrentUser` を使うので、管理画面の中でだけ描ける。ページと一覧の列は同じ入口から読み込まれ、覚え書きを共有するので、つなぐための作業は無い([[T25-2-page-registration-prep#T29・T30 での使い方|T25-2]])
- [x] widget は、入口の `fields` の `image` / `gallery`(`src/shared/constants.ts` の `WIDGET_KINDS` の名前)で描かれる。プラグイン定義の `admin.fieldWidgets`(T29)はマニフェストに載るだけで、`fields` に部品が無いと標準の入力(`json` なら textarea)になる。画像管理ページのサイドバーの項目も、入口で `pages` を export して初めて出る(それまでコマンドパレットの項目は 404「Plugin route not found」の画面を開く)。入口を組み立てたら、playground でサイドバーの項目・widget・一覧の列が出ることを確かめる([[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]]、[[emdash-plugin-definition-registration]])
- [x] (検討)`b64_images` が無いサイトで、widget や画像管理ページが「`b64_images` がありません」と知らせるかを決める。マニフェストの `collections` には非表示の `b64_images` も入る(T29 の実測)。いまは、アップロードして初めて 500 `IMAGE_COLLECTION_MISSING` になり、サーバーのログにエラーが出る。作らないなら、理由を結果に書く([[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]])→ 作らない([[#b64_images の無いサイト(検討の結果)]])
- [x] widget は `import { ImageField } from "./admin/ImageField"` と `import { GalleryField } from "./admin/GalleryField"` として、`export const fields = { image: ImageField, gallery: GalleryField }` と書く。`fields` に型の注釈(`PluginAdminModule["fields"]` や `satisfies`)を付けない。`PluginAdminModule` の `fields` は props 無しの `Record<string, React.ComponentType>` なので、props が必須の widget は代入できない(TS2322。公式の field-kit も注釈を付けない)。spike の管理画面の入口で、この形で両方のブラウザで動いた([[T27-image-widget#T30 への登録のしかた|T27]]、[[T28-gallery-widget#T30 への登録のしかた|T28]]、[[emdash-plugin-field-widget]])

## 完了条件

- [x] playground の管理画面に、widget・一覧の列・画像管理ページが表示される(開発サーバーと本番のビルド。Chromium 153 で操作、Firefox 155 で表示。[[#playground で確かめたこと]])

## 変更してよいファイル

- `src/admin.tsx`
- `tests/admin/admin-entry.test.tsx`(新規。リーダーの指示で追加)
- `plans/base64-image-plugin-spec.md`(11 章の、入口の組み立てに関わるところだけ。リーダーの指示で追加)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ(2026-09-24)
> - `src/admin.tsx` を組み立てた。`fields = { image: ImageField, gallery: GalleryField }`(型の注釈なし)、`pages = { [IMAGES_PAGE.path]: ImagesPage }`、`contentListColumns = [thumbnailColumn]`(項目を上書きしない)の 3 つを export し、読み込み時に `preloadThumbnailColumn()` を呼ぶ。`pages` と `contentListColumns` は `satisfies` で `PluginAdminModule` の型に合うことを確かめる。
> - playground の開発サーバーと本番のビルドで、Chromium 153 を使い、widget のアップロードと保存、一覧の列(このプラグインのフィールドの無いコレクションには出ない)、サイドバーの項目、コマンドパレット、プラグインの管理画面の「プラグインページ」を確かめた。Firefox 155 では表示を確かめた。T29 の時点の状態(textarea・サイドバーに項目なし・パレットで 404)は解消した。
> - テスト: `tests/admin/admin-entry.test.tsx` 12 件。入口を 17 通りに壊し、16 通りでテストが失敗した(残る 1 つは動きの変わらない変更)。
> - (検討)`b64_images` の無いサイトで先に知らせる表示は、作らないことにした([[#b64_images の無いサイト(検討の結果)]])。
> - 知見ノート: [[emdash-admin-entry-assembly]](入口の形・テスト・playground での確認・JS の大きさ・`b64_images` の無いサイト)、[[emdash-admin-console-noise]](管理画面の console に出る、EmDash 側の警告・エラー 3 つ)。

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | export は `fields`・`pages`・`contentListColumns` の 3 つだけ。名前とパスは定数(`WIDGET_KINDS` の名前・`IMAGES_PAGE.path`)から取り、部品は各モジュールの export そのものを入れる | 管理画面は入口のモジュール全体を読み、`widgets`・`contentEditorPanels` なども探すので、使わないものは置かない。値を書き写すと、T29 の宣言と食い違いうる | 実測+公式ドキュメント(`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:327-359`、`references/emdash/packages/admin/src/lib/plugin-context.tsx:16-23`) |
| 2 | `fields` に型の注釈を付けない | T27・T28 のとおり(TS2322) | 公式ドキュメントのみ+型チェックの実測 |
| 3 | `pages` と `contentListColumns` は `satisfies NonNullable<PluginAdminModule[…]>` で型を確かめる(推論された型は変えない) | 定義した場所で、EmDash の型に合わなくなったことに気付ける。EmDash のドキュメントも列を `satisfies` で書く。`emdash` の `PluginAdminExports` は値の型が `JSX.Element` で部品に合わない | 公式ドキュメントのみ(`references/emdash/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`、`references/emdash/packages/core/src/plugins/types.ts:2088-2092`)。`npm run typecheck` の 3 つの設定で通ることは実測 |
| 4 | `preloadThumbnailColumn()` はモジュールの最上位で呼ぶ(遅らせない) | 一覧の画面が最初に `collections` を呼ぶ前に取得を始めるため(T24)。ダッシュボードの読み込みで、マニフェストの要求は管理画面の分と合わせて 2 回になる | 実測のみ(playground。開発サーバーと本番のビルド、Chromium・Firefox) |
| 5 | 入口のテストは、`vi.resetModules()` で入口を読み込み直し、部品のモジュールと `toBe` で比べる。`@emdash-cms/admin` は `useCurrentUser` だけのモックにし、ページの探し方だけ本物の `usePluginPage` で確かめる | 読み込み時の副作用(先読み)をテストごとに起こすため。本物の `@emdash-cms/admin` は jsdom で重い(そのテスト 1 件で約 1.9 秒) | 実測のみ |
| 6 | (検討)`b64_images` の無いサイトで、widget や画像管理ページが先に知らせる表示は作らない | [[#b64_images の無いサイト(検討の結果)]] | 実測のみ(理由の 1・2)、推測のみ(理由の 3・4) |

### b64_images の無いサイト(検討の結果)

playground を写し、seed から `b64_images` を外した使い捨てのサイト(`spikes/t30-no-b64/site/`、git 管理外)で、組み立てた入口のまま確かめた(Chromium 153、開発サーバー、ポート 4430)。表は [[emdash-admin-entry-assembly#5. b64_images の無いサイト]]。根拠: 実測のみ

- widget: ファイルを選ぶと、圧縮のあと約 0.6 秒(2400×1600 の JPEG)で「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」が出る(ギャラリーはファイルごと)。値は変わらない。
- サーバーのログ: アップロードのたびに `Failed to create the image entry`(`Collection 'b64_images' not found`)、最初の保存で作り方(seed か schema API)を書いたエラー([[T29-plugin-definition|T29]])。
- 画像管理ページは「画像はありません。」、一覧の列は「—」。画像なしの投稿は保存できる(201)。

作らない理由:

1. 編集者は、最初のアップロードで、その場で原因(`b64_images` が無い)を知る。値は変わらず、失うのは圧縮の待ち時間(1 枚約 0.6 秒)だけ。根拠: 実測のみ
2. サイトを作る人は、サーバーのログで直し方を知る(最初の保存と、アップロードのたび)。`b64_images` が無いのはサイトの設定の誤りで、seed に足せば二度と起きない。根拠: 実測のみ(ログ)
3. 先に知らせるには、widget 2 つ・画像管理ページ・一覧の列のモジュール(マニフェストの覚え書きを外に出す)・文言・テストを変えることになる(T30 の範囲外)。正しく設定したサイトでも、毎回その確認が動く。根拠: 推測のみ(設計の判断)
4. 判定は、マニフェストの `collections` に非表示のコレクションも入ることに頼る。EmDash がそれをやめると、正しく設定したサイトで誤って知らせる。いまの失敗の表示は誤らない。根拠: 推測のみ(0.39.1 で入ることは T29 と T30 で実測)

作る場合の案(記録のため): 一覧の列のモジュールのマニフェストの覚え書きから「`b64_images` があるか」を読む関数を外に出し、widget のドロップゾーンの下と画像管理ページの上に、Kumo の `Banner` で「画像を保存するコレクション b64_images がありません。サイトの設定(seed)を確認してください。」を出す。判定を誤ったときに使えなくならないよう、ドロップゾーンは押せるままにする。

### テスト

`tests/admin/admin-entry.test.tsx`(12 件。jsdom)。方法は [[emdash-admin-entry-assembly#2. 入口のテスト]]。根拠: 実測のみ

- export の中身(5 件): export は 3 つだけ / `fields` のキーは `WIDGET_KINDS` の名前で、値は `ImageField`・`GalleryField` そのもの / `WIDGET_IDS` を管理画面と同じく最初の `:` で分けて探すと、その widget の関数が見つかる / `pages` のキーは `IMAGES_PAGE.path` だけで、値は `ImagesPage` そのもの / `contentListColumns` は `thumbnailColumn` そのもの 1 つ(`label` は辞書の ID のまま)
- サーバー側の宣言との対応(2 件): `createPlugin().admin.fieldWidgets` の名前と `fields` のキーが 1 対 1 / `admin.pages` のパスごとに `pages` に部品がある
- ページの探し方(1 件): 本物の `PluginAdminProvider` と `usePluginPage` で、`/images`・`/images/`・`/`(プラグインページのボタン)で画像管理ページが見つかり、`/missing` は `null`
- 読み込み時の先読み(4 件): 読み込んだだけで `GET /_emdash/api/manifest` を CSRF のヘッダー付きで 1 回送る / 応答が届いてから開いた一覧は、最初の判定からフィールドの無いコレクションに列を出さない(要求は増えない) / 比べるため、入口を通さずに列だけを読み込むと最初の判定は `true` / 先読みが 401 でも入口の読み込みは失敗せず、次の判定で取り直す

### ミューテーションテスト

`src/admin.tsx` を 1 か所ずつ壊し、`tests/admin/admin-entry.test.tsx` を実行した(scratchpad の使い捨てのスクリプト。壊したファイルは毎回元に戻し、最後にハッシュが一致することを確かめた)。根拠: 実測のみ

| ID | 壊したところ | 失敗したテスト |
|---|---|---|
| M01 | 先読みを呼ばない | 3 |
| M02 | 先読みを `setTimeout(…, 0)` で遅らせる | 2 |
| M03 | 先読みを `queueMicrotask` で遅らせる | **0** |
| M04 | `fields` の `image` と `gallery` を入れ替える | 2 |
| M05 | `fields` から `gallery` を外す(別のキーにする) | 3 |
| M06 | `fields` のキーを widget の ID 全体(`base64-image:image`)にする | 3 |
| M07 | widget を `React.memo` で包む(関数でなくなる) | 2 |
| M08 | `fields` に widget を 1 つ足す | 2 |
| M09 | `pages` のキーを `/` なしにする | 3 |
| M10 | `pages` のキーを書き写す(`"/images/"`) | 2 |
| M11 | `pages` に別の部品を入れる | 2 |
| M12 | `pages` を export しない | 4 |
| M13 | 列の `label` を文字列(`"Image"`)にする | 1 |
| M14 | 列の `collections` を外す | 3 |
| M15 | 列を入れない | 3 |
| M16 | 列を 2 つ入れる | 1 |
| M17 | ほかの export(`widgets`)を足す | 1 |

- 17 通りのうち 16 通りで失敗した。M03 は、`import()` が終わる前にマイクロタスクで要求が出るので、テストでも実際の管理画面でも動きが変わらない(一覧の画面が `collections` を呼ぶのは、管理画面を描いたあと)。

### playground で確かめたこと

playground(ポート 4430、データベースは worktree の `playground/data.db`)に、`create-sample-posts.ts` で投稿 3 件(画像 12 枚)と、このプラグインのフィールドの無いコレクション `notes`(`title` だけ。schema API で作成、2 件)を用意し、Playwright 1.63.0(ヘッドレス)で操作した。本番のビルド(`astro build` + `astro preview`)は、開発サーバーで保存したログインのセッションで開いた。全データは [[emdash-admin-entry-assembly#3. playground での確認]]。根拠: 実測のみ

| 確かめたこと | 開発サーバー | 本番のビルド |
|---|---|---|
| 投稿の編集画面に、単一画像(cover)とギャラリー(gallery)の widget(textarea ではない) | Chromium・Firefox | Chromium・Firefox |
| アップロード(カバー 1 枚・ギャラリー 2 枚、すべて 200)と保存(201。値は参照、代替テキストも保存)。読み込み直すと保存した画像が出る | Chromium | Chromium |
| 投稿の一覧にサムネイルの列(ja「画像」/ en「Image」)。1 ページ目の要求は 1 回。保存した投稿の行にも出る | Chromium・Firefox | Chromium・Firefox |
| フィールドの無いコレクションに列が出ない(SPA で最初に開いた Notes、直接開いた Notes、非表示の `b64_images`) | Chromium(Firefox は SPA の Notes) | 同じ |
| サイドバーの「プラグイン」に「画像」(en「Images」)が出て、画像管理ページが開く | Chromium・Firefox | Chromium・Firefox |
| コマンドパレットの「画像」で画像管理ページが開く(404 にならない) | Chromium | Chromium |
| プラグインの管理画面の「プラグインページ」で画像管理ページが開く | Chromium | Chromium |
| Block Kit のページの要求(`/_emdash/api/plugins/base64-image/admin`)と、API の 4xx・5xx | 0 件 | 0 件 |
| console の警告・エラー | Chromium 0 件。Firefox はサイドバーのスクロールの警告だけ | Chromium はパレットで項目を選んだときの Lingui の警告だけ。Firefox は CSP の eval の違反とサイドバーのスクロールの警告(Firefox ではパレットを使っていない) |

- console に出たものは、どれも EmDash 側のもの(このプラグインが無い操作・ビルドでも出た)。[[emdash-admin-console-noise]]
- 確かめたあと、開発サーバー・本番のビルドのサーバー・使い捨てのサイトのサーバーを止め、`lsof -nP -iTCP:4430 -sTCP:LISTEN` で何も出ないことを確かめた。

### 管理画面の JS の大きさ

playground の本番のビルドで比べると、入口を組み立てたことで、管理画面のクライアントの JS は +103,267 B(gzip +32,529 B。全体 12.9MB・gzip 3.6MB の約 0.9%)。増えた分はすべて管理画面の本体と同じチャンクに入り、`@emdash-cms/admin` は重複していない。「Some chunks are larger than 500 kB」の警告は仮実装のときから出ている。根拠: 実測のみ([[emdash-admin-entry-assembly#4. 管理画面の JS の大きさ]])

### 仕様書の変更

- 11.1: 部品は管理画面の入口(`src/admin.tsx`)の `fields`・`pages`・`contentListColumns` で渡すこと、入口が読み込み時に先読みすること、入口に部品が無いときの管理画面の動きを 1 項目で足した。
- 11.5: 「`admin.pages` で登録する」を「`admin.pages` と、管理画面の入口の `pages`(11.1)で登録する」にした。
- ほかの章は変えていない。

### 他のタスクへの影響・サブタスクの候補

1. [[T31-e2e|T31]]:
   - console を見張るときは、EmDash 側の 3 つ(本番のビルドでパレットの項目を選んだときの Lingui の空のメッセージ、Firefox の本番のビルドの CSP の eval の違反、Firefox でサイドバーをスクロールしたときの警告)を除く([[emdash-admin-console-noise]])。
   - 画面の高さ 900px では、サイドバーの「画像」の項目は下にあり、押すとサイドバーがスクロールする。
   - 入口の確かめ方(サイドバーのリンク・一覧の見出しの `aria-label`・`#field-cover` の `input[type=file]`・ギャラリーの `input[type=file][multiple]`・プラグインの管理画面のリンク)は [[emdash-admin-entry-assembly#6. 再現手順]]。
   - 本番のビルドでは dev-bypass が 403 なので、開発サーバーで保存した `storageState` を使える。
2. [[T33-readme|T33]]: `b64_images` を seed に入れないと、編集者には最初のアップロードで「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」が出るだけで、直し方はサーバーのログにしか出ない。README に、seed の例と、このメッセージを見たときの直し方を書く。
3. 仕様書 18 章(リーダーが判断): 「`b64_images` が無いサイトでは、編集者は最初のアップロードで初めて知る(先に知らせる表示は無い)」を既知の制約に足すか。
4. EmDash への報告の候補(利用者の判断が要る): (1) 本番のビルドで、コマンドパレットの項目を選ぶと Lingui の警告が出る(`itemToStringValue` が項目にも呼ばれる。`admin/src/components/AdminCommandPalette.tsx:435`)。(2) 管理画面の CSP の下で、zod の eval の確認が Firefox で違反として出る(`z.config({ jitless: true })` で避けられる)。
5. `docs/00-index.md` に [[emdash-admin-entry-assembly]] と [[emdash-admin-console-noise]] を登録する(リーダー)。

### 未解決

- スクリーンリーダーでの読み上げと、狭い画面の表示は、T30 では確かめていない(部品ごとの確認は T27・T28・T25)。
- 本番のビルドの確認は Chromium の日本語(全部)と英語(表示)、Firefox の日本語(表示)だけ。i18n を設定したサイトと、Cloudflare Workers([[T32-cloudflare-check|T32]])では確かめていない。
