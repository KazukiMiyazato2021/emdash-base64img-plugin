---
id: T26
title: "playground に E2E 用のページとデータを用意する"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T02-playground]]"
  - "[[T15-site-resolve]]"
soft_depends_on: []
blocks:
  - "[[T31-e2e]]"
  - "[[T32-cloudflare-check]]"
files:
  - "playground/src/pages/**"
  - "playground/seed/**"
  - "e2e/fixtures/**"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - playground
created: 2026-09-23
---

# T26 playground に E2E 用のページとデータを用意する

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T02-playground|T02]]、[[T15-site-resolve|T15]]
> - このタスクを待つもの: [[T31-e2e|T31]]、[[T32-cloudflare-check|T32]]
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

E2E と手動確認のために、サイト側のページとテストデータを用意する。

## 作業内容

- [x] 記事一覧ページ(カード表示。表示するエントリの参照を `resolveBase64Images` で1回で解決する)
- [x] 表示用の画像は、アップロードのルートで作る(seed の `b64_images` には `imageRefs` の記録が無く、それを参照する投稿は保存 hook で拒否され、管理画面で保存できない。[[T16-reference-hook#seed の画像の扱い|T16]])。作り方(スクリプトか手順)を `playground/README.md` に書く
  - スクリプト `playground/scripts/create-sample-posts.ts` を作った。ルートはまだ登録されていない(T29)ので、ルートと hook を一時的に登録した使い捨てのサイトで確かめた([[#アップロードのルートで作るサンプルの投稿]])
- [x] サイト側の API は `images.get(ref)`(参照を渡す。[[T15-site-resolve#結果|T15]])
- [x] 記事詳細ページ(カバーとギャラリー。LCP の画像に `priority`)
- [x] E2E 用の画像ファイルを作るスクリプト(形式ごとの画像、巨大な画像。HEIC は MIME タイプを偽ったファイルで代用する)
  - HEIC は、MIME タイプを偽ったファイルではなく、`sips` で作った本物の HEIC にした。中身が JPEG で拡張子が `.heic` のファイルは、JPEG として受け付けられるため([[#E2E の入力画像]])

## 完了条件

- [x] ページが表示され、`<img>` に width / height が出力される

## 変更してよいファイル

- `playground/src/pages/**`
- `playground/seed/**`
- `e2e/fixtures/**`
- リーダーの指示で追加: `playground/README.md`、`playground/scripts/**`(新規)、`plans/base64-image-plugin-spec.md`(12 章と 15 章のうち、このタスクに関わる箇所)

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - サイト側のページ: 投稿の一覧 `/posts/`(カード、10 件ずつ)と詳細 `/posts/<slug か ID>/`(カバーとギャラリー)。どちらも参照を集めて `resolveBase64Images` を 1 回だけ呼び、`images.get(ref)` の値を `emdash/ui` の `Image` に渡す。LCP の対象の画像に `priority` を付ける。
> - Chromium 153・Firefox 155 で、すべての `<img>` に data URL・width・height が出て、デコードした寸法と表示の縦横比が属性と一致した。Chromium では LCP の要素が `priority` の画像で、Layout Shift は 0 回。ページのクエリは 2 本(投稿 1、画像 1)。
> - seed には画像と投稿を入れない。表示用の画像は、アップロードのルートで作るスクリプトで作る。
> - E2E の入力画像 28 個を作るスクリプト `e2e/fixtures/make-images.ts` を作った。生成物は git に入れない。本番の判定・デコード・圧縮に通し、両方のブラウザで想定どおりの結果になることを確かめた。
> - 知見ノート: [[playground-site-pages]](ページの描画・LCP・クエリ数・`getEmDashEntry` の `LiveEntryNotFoundError`・サンプルの投稿)、[[e2e-input-image-fixtures]](入力画像の作り方と結果・`sips` で書ける形式・HEIC の代わりのファイル)

### 作ったもの

| ファイル | 内容 |
|---|---|
| `playground/src/pages/posts/index.astro` | 一覧。`getEmDashCollection("posts", { limit: 10, cursor, orderBy: { published_at: "desc" } })`、カバーの参照をまとめて解決、`?cursor=` で次のページ |
| `playground/src/pages/posts/[slug].astro` | 詳細。`getEmDashEntry("posts", decodeSlug(slug))`、カバーとギャラリーをまとめて解決、代替テキストを表示。見つからなければ 404 |
| `playground/src/pages/_components/Layout.astro`・`PostImage.astro` | 共通の枠と、参照 1 つ分の画像(見つからなければ「画像が見つかりません」の枠)。`_` から始まるのでルートにならない |
| `playground/src/pages/index.astro` | トップ(ページと管理画面へのリンク) |
| `playground/scripts/create-sample-posts.ts` | アップロードのルートで画像を作り、投稿を作って公開する |
| `e2e/fixtures/make-images.ts`・`.gitignore`・`README.md` | E2E の入力画像を `e2e/fixtures/images/` に作る。一覧と結果は README |
| `playground/README.md` | ページ、表示用のデータの作り方、seed に画像を入れない理由を追記 |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | seed には `b64_images` の画像も、それを参照する投稿も入れない。seed は今のまま(コレクションだけ) | seed の画像は `imageRefs` に記録が無く、T29 で保存 hook が登録されると、それを参照する投稿は管理画面でタイトルだけを変えても保存できない。画像管理ページ(T25)にも一覧のサムネイル(T24)にも出ない。E2E と手動の確認に「保存できない投稿」が混ざると、不具合と区別しにくい。開発用ログインは既定で seed の内容も入れるので、E2E のデータにも混ざる | 保存できないことは実測+公式ドキュメント(T16 の実測)。T24・T25 での見え方は推測のみ |
| 2 | 表示用の画像は、アップロードのルートで作る。スクリプト `playground/scripts/create-sample-posts.ts`(開発用ログイン → Chromium の canvas で WebP → ルートに 1 枚ずつ → REST で投稿を作って公開)と、widget ができたあとの管理画面の手順を README に書いた | ルートが `imageRefs` に記録するので、作った投稿は管理画面でも保存できる。スクリプトなら、一覧のページ送りやギャラリー 10 枚など、確認に要るデータをすぐ作れる | 実測のみ(使い捨てのサイト) |
| 3 | スクリプトの確認は、T18 と同じく、ルートと hook(T16・T19・T20、プレビュー・サムネイルのルート)を一時的に登録した使い捨てのサイト(`spikes/t26-pages/site/`)で行った。本物の playground では、T29 の登録のあとに確かめる(T29・T31 への引き継ぎ) | `src/index.ts` は T29 が組み立てる。本物の playground では、今はルートが 404 になる(スクリプトは T29 を確かめるよう案内して止まる。これは確かめた) | 実測のみ |
| 4 | 一覧の `priority` は、描画できる最初のカバーに付ける。詳細は、カバーの参照があればカバーだけ、カバーの無い投稿では描画できる最初のギャラリーの画像 | 仕様書 12 章の例(`priority={i === 0}`)では、最初のカードの画像がゴミ箱にあると、どの画像にも付かない。詳細では、見つからないカバーの代わりの枠が上部を占め、ギャラリーは画面の外になる(LCP は見出しだった) | 実測のみ(Chromium の LCP、1280 × 800) |
| 5 | 画像が見つからないときは、参照の寸法(`aspect-ratio`)で場所を取った「画像が見つかりません」の枠を出す | 描画を止めず(仕様書 12 章)、Layout Shift も起こさない。手動の確認と E2E で見分けられる | 設計判断 |
| 6 | 詳細ページは、`getEmDashEntry` の `error` が `LiveEntryNotFoundError` なら 404、ほかは 500 | 見つからないときも `error` が返る(EmDash の型の説明と違う)。`error` だけで 500 にすると、存在しない URL が 500 になった | 実測+公式ドキュメント |
| 7 | ギャラリーは 1 枚ずつ `isBase64ImageRef` で確かめ、形の正しいものだけを並べる | `isBase64ImageGallery` は 1 枚の不正で全体を拒否する。保存 hook を通らない値(seed・手での書き換え)でも、正しい画像は出す | 設計判断 |
| 8 | E2E で探せるよう、`data-testid`(`post-card` / `post` / `image-missing` / `no-posts`)と、画像に `data-field`・`data-image-id` を付ける | `Image` は残りの属性を `<img>` に付ける(`EmDashImage.astro:258`) | 実測+公式ドキュメント |
| 9 | 共通の部品は `src/pages/_components/` に置く | 変更してよいのが `src/pages/**` だけのため。`_` から始まるディレクトリはルートにならない(ビルドのマニフェストに登録されたページは 3 つだけだった) | 実測+公式ドキュメント(Astro の規則) |
| 10 | E2E の入力画像は、スクリプトで作り、git に入れない。PNG・GIF・SVG・乱数は Node の標準機能、JPEG・AVIF・BMP・TIFF・ICO・HEIC は `sips`、WebP は Chromium の canvas | 40MB を超えるファイルを含む(合計 43.8MB)。作り直しは約 1.5 秒で、同じマシンでは SHA-256 まで同じ。新しいパッケージを入れずに作れる(`sips` は WebP を書けない) | 実測のみ |
| 11 | HEIC は `sips` で作った本物を使う(タスクノートの「MIME タイプを偽ったファイル」から変えた) | 中身が JPEG で拡張子が `.heic` のファイルは、`File.type` が `image/heic` でも JPEG として受け付けられた。中身が乱数なら `INPUT_HEIC_REJECTED` になるが、中身での判定を確かめられない | 実測のみ |
| 12 | 生成のスクリプトは macOS でだけ動く(最初に止まる) | `sips` の出力を使うファイルが 8 個ある。E2E は macOS で実行する前提(利用者の環境) | 設計判断 |

### ページの確認

- 環境: macOS 26.4(Apple M5 Pro)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、Playwright 1.63.0(Chromium 153.0.8010.12、Firefox 155.0)。
- 本物の playground(ルートが無い)でも、確認のためだけに標準の REST API で画像エントリを作り(保存 hook が無いので通る)、一覧と詳細が Chromium・Firefox で同じように描画されることを確かめた。データベースは確認のあとで消した。根拠: 実測のみ
- 使い捨てのサイトで、スクリプトで作った 12 件(10 件はギャラリー 10 枚、1 件はカバーをゴミ箱へ、1 件はカバーなし)の一覧・次のページ・詳細を、両方のブラウザで調べた。すべての `<img>` の `src` が `data:image/webp;base64,` で始まり、`naturalWidth` × `naturalHeight` が width / height 属性と一致し、表示の縦横比も 1px 以内で一致した。根拠: 実測のみ
- Chromium の LCP の要素は、一覧で `priority` のカバー、詳細でカバー(カバーなしの投稿ではギャラリーの 1 枚目)。Layout Shift は、すべてのページで 0 回。根拠: 実測のみ
- クエリ数(`db.count`): 一覧(カバー 10 件)も詳細(11 枚)も 2 本。プロセスで最初の取得だけ `_emdash_taxonomy_defs` が 1 本増え、書き込みのあとや 30 秒ごとに `_emdash_redirects` が 1 本増える。根拠: 実測+公式ドキュメント(`loader.ts:370-399`・`:1273`、`redirects/cache.ts:47`)
- HTML の大きさ: 一覧 10 件で約 21〜23 万文字(サンプルのカバーは約 2.1 万文字)。
- 詳しくは [[playground-site-pages]]。

### アップロードのルートで作るサンプルの投稿

- `node playground/scripts/create-sample-posts.ts --base <URL> [--posts N] [--gallery N] [--trash-cover]`。使い方は [[playground/README#表示用のデータの作り方|playground の README]]。
- 使い捨てのサイトでの結果: 10 件・ギャラリー 10 枚(110 回のアップロード)で約 3.5 秒。画像エントリ 114 件がすべて公開済みで `imageRefs` があり、参照元が 1 件ずつ記録された(T20 の hook)。管理画面(JSON の入力欄)でタイトルを変えて保存すると、カバーをゴミ箱に移した投稿・カバーなしの投稿も含めて 200。根拠: 実測のみ
- `npm run typecheck` の対象外(`tsconfig.json` の `include` に無い)なので、ルートの設定と厳しい設定(`exactOptionalPropertyTypes` など)で一度だけ `tsc` を通した。エラーは 0 件。

### E2E の入力画像

- `node e2e/fixtures/make-images.ts` で `e2e/fixtures/images/` に 28 個を作る。一覧は [[e2e/fixtures/README|e2e/fixtures/README.md]]、測定の詳細は [[e2e-input-image-fixtures]]。
- 本番の `inspectInputFile` → `decodeImage` → `compressImage`(既定の options)→ `createThumbnail` に `setInputFiles` で通した結果(Chromium 153 / Firefox 155)。根拠: 実測のみ
  - 写真の代わり(2400 × 1600 の JPEG): 1600 × 1067 に縮小、画質 0.64 / 0.63、保存 97,991 / 99,071 B(7 回のエンコード)
  - EXIF の向き 6: 1600 × 2400 にデコード
  - 透過の PNG: 角が透明のまま。GIF: 注意 `GIF_FIRST_FRAME_ONLY`、1 フレーム目の赤
  - WebP・AVIF・BMP・ギャラリー 12 枚: どれも画質 0.92 で収まる
  - 拒否: HEIC(`.heic` と `.jpg`)→ `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、TIFF・ICO → `INPUT_FORMAT_REJECTED`、乱数・壊れた JPEG → `INPUT_DECODE_FAILED`、40,017,958 B → `INPUT_FILE_TOO_LARGE`、8000 × 8001 → `INPUT_TOO_MANY_PIXELS`

### テスト

- 新しい単体テストは書いていない。変更してよいファイルに `tests/**` が無く、vitest の対象は `tests/**/*.test.{ts,tsx}` だけのため。代わりに、ページ・スクリプト・生成物を実ブラウザと実サーバーで確かめた(上記)。`e2e/fixtures/make-images.ts` は `npm run typecheck` の対象(`tsconfig.json` の `include` の `e2e`)。
- `npm run verify`: build(3 つの型チェックと playground のビルド)・lint(oxlint・prettier)・test(16 ファイル 1,296 件)がすべて通った。

### 仕様書の変更

- 12 章: LCP の対象の画像が見つからないときの扱いと、playground のページのクエリ数(2 本、最初の取得だけ +1)を足した。
- 15 章: T26 で用意したページ・サンプルの投稿のスクリプト・E2E の入力画像のスクリプトを足した。

### 他のタスクへの影響

| タスク | 影響 |
|---|---|
| [[T29-plugin-definition\|T29]] | 完了条件の「playground で各ルートと hook が動く」は、`node playground/scripts/create-sample-posts.ts --base http://localhost:<ポート>` で、アップロードのルート・保存 hook(T16・T19)・参照元の記録(T20)をまとめて動かせる。そのあと `/posts/` で表示を確かめられる。一時的な登録の形は [[playground-site-pages#再現手順]] |
| [[T31-e2e\|T31]] | 入力画像は、テストの前に `node e2e/fixtures/make-images.ts` で作る(`globalSetup` など)。ファイルと期待する結果は [[e2e/fixtures/README\|e2e/fixtures/README.md]]。HEIC は本物(`heic-640x480.heic`、`heic-named-as-jpeg.jpg`)を使う。ページには `data-testid` と `data-image-id` がある。開発サーバーでは、初めてブラウザが接続したときに Vite が 1 回読み直すことがあるので、`networkidle` を待ってから操作する。歓迎ダイアログは少し遅れて出るので、`waitFor` で待ってから閉じる |
| [[T32-cloudflare-check\|T32]] | ページはそのまま使える。スクリプトは開発用ログイン(開発サーバーだけ)を使うので、`wrangler dev`(ビルドしたもの)では別のログインの方法(API トークンなど)が要る。スクリプトはトークンに対応していない(確かめていない) |
| [[T15-site-resolve\|T15]] / [[T33-readme\|T33]] | サイトの例では、`getEmDashEntry` の `error` が見つからないとき(`LiveEntryNotFoundError`)にも返ることに注意する。`resolveBase64Images` の最初の呼び出しは、`where` のためにタクソノミーの定義の読み出しが 1 本増える([[T09-spike-query-count\|T09]] の数の補足) |

### 未解決・サブタスクの候補

1. `playground/scripts/` は `npm run typecheck` の対象外。ルートの `tsconfig.json` の `include` に `playground/scripts` を足すと検査できる(`tsconfig.json` は T26 で変更してよいファイルではないので、足していない)。
2. ルートの `package.json` に、入力画像とサンプルの投稿を作る script(例: `"e2e:images": "node e2e/fixtures/make-images.ts"`)を足すかは、リーダーの判断(T26 では `package.json` を変更しない)。
3. 本物の playground でのスクリプトの確認(ルートの登録のあと)は、T29・T31 で行う。
4. `sips` の無い環境(Linux の CI など)で E2E を動かすなら、JPEG・AVIF・BMP・TIFF・ICO・HEIC の作り方を替える必要がある(Chromium の canvas は JPEG と WebP を書ける。HEIC と AVIF は書けない)。
