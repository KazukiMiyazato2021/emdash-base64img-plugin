---
id: T33
title: "README と導入手順を書く"
type: ドキュメント
status: done
wave: 6
depends_on:
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "README.md"
spec:
  - "[[base64-image-plugin-spec#13. 設定]]"
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
created: 2026-09-23
---

# T33 README と導入手順を書く

> [!info] 概要
> - 種別: ドキュメント / ウェーブ: 6
> - 着手の条件(依存): [[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#13. 設定|仕様書 13章]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|仕様書 18章]]

## 目的

自分のサイトにこのプラグインを入れるための手順をまとめる。

## 作業内容

- [x] インストール(git 依存でタグを指定する方法。非公開リポジトリの場合のトークン)
- [x] サイトの `.npmrc` に `allow-git=root` を書く(npm 12 は git 依存を既定で拒否する。`npm ci` を実行する CI とビルドの環境でも要る)([[npm12-git-dependency-policy]]、[[T07-1-spec-distribution|T07-1]])
- [x] Cloudflare アダプターで開発するとき: `vite.ssr.optimizeDeps.include` にプラグインを入れると、最初のリクエストでの再読み込みが起きない(任意)([[git-dependency-ts-source#Cloudflare アダプターの astro dev の再最適化]])
- [x] 型チェック: サイトで `tsc --noEmit` を実行すると、プラグインの `src` も検査される(`astro check` は検査しない)。どちらでもエラーが出ないこと([[T04-1-consumer-typecheck|T04-1]])
- [x] マイグレーション: `emdash migrate --from-config` は使えない。既定の `emdash migrate` を使う([[git-dependency-ts-source]])
- [x] `astro.config.mjs` の設定(storage を指定しない)
- [x] seed(`b64_images` とフィールドの定義)と options の一覧
- [x] サイト側の使い方(`resolveBase64Images` と `Image`、一覧ページでまとめて解決する方法)
- [x] 制約(Safari 非対応、HEIC 非対応、容量、バックアップ、標準の `b64_images` の画面を使わないこと)
  - `b64_images` は標準の画面で編集しない。標準の編集画面からは保存も公開もできない(保存 hook が拒否する)。画像を差し替えるときは、新しくアップロードする([[T19-image-entry-hook#他のタスクへの影響|T19]])
  - 標準の新規作成の画面・REST・seed で作った画像は `imageRefs` に記録が無く、投稿から参照すると保存が拒否される。画像は widget からアップロードする([[T16-reference-hook#seed の画像の扱い|T16]])
- [x] サイト側の例: `getEmDashEntry` は、エントリが見つからないときも `error`(Astro の `LiveEntryNotFoundError`)を返す。`error` があるだけで 500 にすると、存在しない URL が 500 になる。playground の詳細ページ(`playground/src/pages/posts/[slug].astro`)の書き方を例にする([[playground-site-pages#getEmDashEntry は見つからないときも error を返す]])
- [x] サイト側の例: LCP の対象の画像に `priority` を付けるとき、対象の画像が見つからないとどの画像にも付かないことがある。描画できる最初の画像を選ぶ(仕様書 12 章、[[playground-site-pages#LCP の対象の選び方]])
- [x] 画像管理ページ(サイドバーの「プラグイン」の「画像」)の使い方: ゴミ箱への移動(寄稿者以上)、完全削除(管理者、ゴミ箱の画像だけ)、公開し直す(編集者以上、下書きの画像だけ)。ページの項目はロールで絞られず、閲覧者にも出る(開くと権限の文言)([[T25-images-page#結果|T25]])
- [x] ゴミ箱から戻す操作は画像管理ページに無い。戻すなら、標準 API の `POST /_emdash/api/content/b64_images/{id}/restore`(編集者以上)を使う。戻した画像は下書きになるので、画像管理ページの「公開」で公開し直す(仕様書 10 章・19 章)。EmDash の標準の画面でも戻せるとみられるが、1 ページ 100 件の base64 を読むので使わない(推測のみ。T33 で確かめて書く)
- [x] 管理画面のコマンドパレットで「Images」などと入力すると、非表示の `b64_images`(Base64 Images)も候補に出る。選ぶと標準の `b64_images` の一覧(`/_emdash/admin/content/b64_images`。1 ページ 100 件の base64 を読み、重い)に移るので、選ばない(仕様書 18 章。移る先は [[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]] の実測)
- [x] `b64_images` は、サイトの seed に入れる(仕様書 13.1 の構成)。無いと、最初の保存と、管理画面でプラグインを有効にしたときに、サーバーのログにエラーが出て、アップロードが 500 `IMAGE_COLLECTION_MISSING` になる。編集者の画面には、ファイルの処理のあとに「画像を保存するコレクション b64_images がありません。サイトの設定を確認してください。」が出るだけで、直し方はサーバーのログにしか出ない。README に seed の例と、このメッセージを見たときの直し方を書く([[T30-admin-entry#b64_images の無いサイト(検討の結果)|T30]])。プラグインはコレクションを作れない([[T29-plugin-definition#決めたこと|T29]]、[[emdash-native-plugin-lifecycle-hooks]])
- [x] 管理画面での widget の使い方: 単一画像(選択・ドロップ・貼り付け、差し替えると代替テキストは空になる、削除)、ギャラリー(複数の追加は 1 枚ずつ処理して値に加える、↑↓ とドラッグでの並べ替え、`maxItems` の上限、差し替え・削除)。値が正しくないとき(配列でない値の「値を空にする」「1 枚目にする」、壊れた要素の削除、同じ画像の重複の注意)は、直すまで保存が拒否される([[T27-image-widget#決めたこと|T27]]、[[T28-gallery-widget#決めたこと|T28]])
- [x] 画像の処理中は保存しない(画面の案内「処理が終わってから保存してください。」と同じ言い方にする。[[T28-2-save-hint-alt-width|T28-2]])。処理中に「Save」を押すと、保存のあいだに加わった画像がフォームから外れる(外れた画像は画像管理ページに使われない画像として出るので、ゴミ箱に移す)。新規作成の画面では、処理が終わってから最初の保存をする(仕様書 18 章「処理中の保存」)
- [x] 必須(`required`)のギャラリーでも、画像を全部消した `[]` のまま保存できる(仕様書 18 章「必須のギャラリー」)

## 完了条件

- [x] README の手順だけで、playground と同じ構成を再現できる

## 変更してよいファイル

- `README.md`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ(2026-09-24)
> - `README.md` を書いた。読み手は、自分の EmDash 0.39 のサイトにこのプラグインを入れる人。構成は、できること / しくみ / 導入(手順 1〜6、型チェックとマイグレーション)/ 管理画面での使い方 / 制約 / 困ったとき / 資料 / 開発。作業内容の 18 項目をすべて入れた(対応は [[#作業内容と README の対応]])。
> - 完了条件: `spikes/t33-readme/site/`(git 管理外)に新しいサイトを作り、README の手順とコードブロックだけで、playground と同じ構成(Node + SQLite、seed の `b64_images` と `posts` の `cover` / `gallery`、一覧と詳細のページ)を作れた。管理画面の widget でアップロード・保存・公開し、サイトの一覧・詳細に画像が出た。根拠: 実測のみ(Chromium 153)。手順と違うことをしたのは 2 か所([[#手順と違うことをしたところ]])。
> - 確かめる中で、README を 9 か所直した(ページの例に `<meta charset>` が無く日本語が文字化けした、など。[[#手順どおりに進まなかったところ(README を直した)]])。
> - 知見ノート: [[readme-install-verification]](README の手順で作ったサイトでの確認の全データと再現手順)。

### 書式と内容の決定

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | README に frontmatter を付けない | GitHub は Markdown の YAML の frontmatter を、本文の上に表として描く。題名より前に `tags`・`aliases`・日付が並び、README の読み手には要らない。Obsidian は frontmatter が無くても読める | 推測のみ(GitHub での表示は確かめていない) |
| 2 | リンクは wikilink でなく、相対パスの Markdown の通常のリンクにし、見出しへのアンカーは付けない。章は「仕様書の 18 章」のように文で示す | GitHub と Obsidian で、日本語の見出しのアンカーの作り方が違う(GitHub は slug、Obsidian は見出しの文字列)。リンク先がすべてあることは、スクリプト(壊したリンク 4 件をすべて検出することも確かめた)で確かめた | 推測のみ(アンカーの違い)/ 実測のみ(リンク先) |
| 3 | コールアウトは `> [!NOTE]` などを 1 行目に単独で書く。種類は NOTE・IMPORTANT・WARNING・CAUTION だけ | GitHub の alert は、1 行目に種類だけがある形を認識する。この種類は Obsidian にもある | 推測のみ(GitHub・Obsidian での表示は確かめていない) |
| 4 | prettier の対象外のまま | `.prettierignore` の `*.md`。`npx prettier --file-info README.md` は `{ "ignored": true }` | 実測のみ |
| 5 | インストールのコマンドは `github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0` | このリポジトリの origin(`git remote -v`)のオーナーとリポジトリ名。タグ `v0.1.0` は [[T34-release\|T34]] が作る。GitHub には接続していない | 実測のみ(remote の値) |
| 6 | 導入の前提は「EmDash 0.39 のサイトがある」 | 読み手は自分のサイトに入れる人。サイトの作り方は EmDash の文書に任せた | — |
| 7 | すでにデータベースがあるサイトに足す手順(REST の schema API)を書いた | seed はコレクションが 0 件のデータベース(と開発用ログイン)でしか適用されず、すでにあるコレクションは変わらない。「b64_images がありません」を見た人の直し方にも要る。管理画面のスキーマの編集画面では widget を指定できない | 実測+公式ドキュメント |
| 8 | `min-release-age` の注意は、日付でなく「サイトの EmDash の版の公開から、設定の日数がたったか」で書き、公開日時の調べ方(`npm view emdash "time[0.39.1]"`)を添えた | 今日の日付に頼らない書き方にする(リーダーの指示) | 実測のみ(コマンドの出力) |
| 9 | ページの例は、画像 1 枚の部品(`Base64Image.astro`)・一覧・詳細の 3 つにし、HTML の骨組み(`<meta charset>`)を含めた | playground のページと同じ形で、コピーしてそのまま動くようにする([[#手順どおりに進まなかったところ(README を直した)]] の 1) | 実測のみ |

### 作業内容と README の対応

| 作業内容 | README の場所 | 根拠(T33 で確かめたか) |
|---|---|---|
| インストール(タグ、非公開リポジトリのトークン) | 導入の手順 2、「非公開のリポジトリから入れるとき」 | git 依存での導入は実測のみ(`git+file://`)。トークンは未確認([[#未確認]]) |
| `.npmrc` の `allow-git=root` | 手順 1 | 実測のみ(`npm ci` は成功、`--allow-git=none` は `EALLOWGIT`) |
| Cloudflare の `vite.ssr.optimizeDeps.include` | 手順 3 | T07 の実測。T33 では確かめていない |
| 型チェック | 「型チェックとマイグレーション」 | 実測のみ(下の表) |
| マイグレーション | 「型チェックとマイグレーション」、困ったとき | 実測のみ |
| `astro.config.mjs`(storage なし) | 手順 3 | Node は実測のみ。Cloudflare は未確認(T32) |
| seed と options | 手順 4 | seed は実測のみ。options の表は仕様書 13.2 と `src/shared/constants.ts` |
| サイト側の使い方 | 手順 5 | 実測のみ |
| 制約・標準の画面を使わないこと | 制約、「使わない画面」 | 仕様書 18 章。標準の画面の読み込み量は実測+公式ドキュメント |
| `getEmDashEntry` の `error` | 手順 5 の例と説明 | 実測のみ(存在しない URL が 404) |
| LCP の `priority` | 手順 5 の例と説明 | 実測のみ(一覧の 1 枚目と詳細のカバーに `fetchpriority="high"`) |
| 画像管理ページ | 「画像管理ページ」 | ゴミ箱に移す・公開は実測のみ(管理者)。ほかのロールと完全削除は T25 の実測 |
| ゴミ箱から戻す | 「ゴミ箱から戻す」 | 実測+公式ドキュメント(下の表) |
| コマンドパレット | 「使わない画面」 | T29 の実測。T33 では確かめていない |
| `b64_images` の seed と、無いときの直し方 | 手順 4、「b64_images が無いとき」 | 実測のみ(下の表) |
| widget の使い方・値が正しくないとき | 「管理画面での使い方」 | 追加(単一・ギャラリー 2 枚)と保存は実測のみ。ほかは T27・T28 の実測 |
| 処理中は保存しない | 「保存するときの注意」 | T28・T28-2 の実測。文言は `src/admin/parts/UploadProgress.tsx` と同じ |
| 必須のギャラリーは `[]` で保存できる | 「保存するときの注意」 | 仕様書 18 章(公式ドキュメントのみ) |

### README の手順で作ったサイトで確かめたこと

全データ・環境・再現手順は [[readme-install-verification]]。macOS 26.4、Node 26.10.0、npm 12.0.2、Astro 7.3.3、EmDash 0.39.1、Playwright 1.63.0(Chromium 153)。ポートは 4433 で、終わったあとサーバーを止め、`lsof -nP -iTCP:4433 -sTCP:LISTEN` で何も出ないことを確かめた。

| 確かめたこと | 結果 | 根拠レベル |
|---|---|---|
| 管理画面の widget でのアップロードと保存 | 新規作成の画面で、カバー(2400×1600 の JPEG → 1600×1067・99.1KB)とギャラリー(PNG 2 枚)を追加し、保存 201。保存した値は参照(代替テキスト付き) | 実測のみ |
| 公開 | 「Publish now」→ 確認のダイアログの「Publish now」で `POST …/publish` 200 | 実測+公式ドキュメント |
| サイトのページでの表示 | `/posts/` と詳細に `<img src="data:image/webp;base64,…">`。width / height 属性と `naturalWidth` × `naturalHeight` が一致、LCP の対象に `fetchpriority="high"`、Layout Shift 0 回、ページのクエリは 2〜4。存在しない URL は 404 | 実測のみ |
| ゴミ箱の画像の表示 | 詳細ページに「画像が見つかりません」の枠(`aspect-ratio` は参照の寸法) | 実測のみ |
| 標準の画面から戻す | `/_emdash/admin/content/b64_images` の「ゴミ箱」のタブの「<ID>を復元」で 200。画面を開くだけで、一覧(`limit=100`。2 件で 194,779 バイト)とゴミ箱(既定 50 件。1 件で 96,779 バイト)の本体を読み込む | 実測+公式ドキュメント |
| API で戻す | README のコマンド(API トークン、スコープ `content:write`)で 200。戻した画像は「下書き」、画像管理ページの「公開」で 200・「公開済み」に戻り、サイトにも出た | 実測のみ |
| `b64_images` の無いサイト | 「画像を保存するコレクション b64_images がありません。…」(約 0.8 秒)、アップロード 500、画像なしの保存は 201。ログはアップロードのたびの `Failed to create the image entry` と、最初の保存の直し方のエラー | 実測のみ |
| API で直す | README の schema API のブロックで `posts` のフィールドと `b64_images` を作れた(201)。再起動せずにアップロード 200・保存 201。もう一度送ると 409(`COLLECTION_EXISTS` / `FIELD_EXISTS`) | 実測のみ |
| API トークン | 作れるのは管理者だけ(`POST /_emdash/api/admin/api-tokens` は `role < ADMIN` で 403) | 実測+公式ドキュメント |
| 型チェック | `astro check` 0 件。`tsc --noEmit` は、テンプレートと同じ `include` ではプラグインを辿らず 0 件。サイトの `.ts` が `/astro` を import すると 7 ファイル、`include` が `**/*` だと `astro.config.mjs` から 19 ファイルを検査し、どれも 0 件 | 実測のみ |
| マイグレーション | `astro build` のあとの `emdash migrate --check` は成功、`--from-config --check` は `Stripping types is currently unsupported for files under node_modules` で終了コード 1 | 実測のみ |

### 手順どおりに進まなかったところ(README を直した)

1. **ページの例に `<meta charset>` が無く、日本語が文字化けした。** Astro の応答は `content-type: text/html`(charset なし)で、例のページは `<!DOCTYPE html><h1>…` の断片だった。一覧・詳細の例に `<html lang="ja">`・`<meta charset="utf-8" />`・`<title>` を入れ、レイアウトで包むことと理由を書いた。根拠: 実測のみ
2. **公開のボタンは「Publish now」で、確認のダイアログでもう一度押す**(EmDash 0.39.1 の日本語の辞書は、この文言の訳が空)。手順 6 に書いた。根拠: 実測+公式ドキュメント(`references/emdash/packages/admin/src/components/ContentSettingsPanel.tsx:463-513`、`references/emdash/packages/admin/src/locales/ja/messages.po` の `msgid "Publish now"`)
3. 戻すコマンドの応答に、画像の本体(約 100KB の base64)を含む JSON がそのまま出た。`-o /dev/null -w "%{http_code}\n"` でステータスだけを出す形にした。根拠: 実測のみ
4. API トークンを作れるのは管理者だけだった。「トークンで戻すのは管理者。編集者は標準の画面の「復元」か、管理者に頼む」と書いた。根拠: 実測+公式ドキュメント
5. 標準の画面のゴミ箱から「復元」できることと、その画面が読み込む量を書いた(作業内容の「推測のみ。T33 で確かめて書く」)。根拠: 実測+公式ドキュメント
6. API の例を、変数の定義・`b64_images`・投稿のフィールドの 3 つのブロックに分け、`201` / `409` の応答を書いた(「b64_images がありません」の直し方で、`b64_images` のブロックだけを使えるように)。根拠: 実測のみ
7. 公開日時の調べ方: `npm view emdash time --json` は全版の表(配列で包まれる)を出すので、`npm view emdash "time[0.39.1]"`(1 行)にした。`time.0.39.1` は何も出ない。根拠: 実測のみ
8. `min-release-age` の注意に、`--force` でも入ること(増えるのはプラグインだけ)を足した。根拠: 実測のみ
9. 「b64_images が無いとき」を、ログの出方(アップロードのたびのログと、最初の保存・有効化のときの直し方のログ)と、直したあと再起動が要らないことに合わせた。根拠: 実測のみ

### 手順と違うことをしたところ

1. **プラグインのインストール**: `min-release-age=3` のままでは `ERESOLVE`(`Found: emdash@undefined`)になった(README の注意のとおり)。README の対処の `--min-release-age=0` は、利用者の了承の範囲(EmDash と `@emdash-cms/*` の 0.39.1 だけ)の外なので実行せず、`--force` で入れた。ロックファイルの差分はプラグインの 1 件だけで、監査で registry の新しい版は 0 個。`--min-release-age=0` で入れても増えるのはプラグインだけなことは、T07 の実測([[npm12-git-dependency-policy#min-release-age と peer の解決]])。`package.json` に手で書いてからの `npm install` も同じ `ERESOLVE`、`--legacy-peer-deps` は peer として入った 4 個(`@types/react` など)を消すので採らなかった。根拠: 実測のみ
2. **`astro.config.mjs` に、管理画面のフォントを `local()` だけで登録する設定を足した**(playground と同じ)。EmDash の既定は、開発サーバーの起動時に Google Fonts に接続するため(外部に接続しない指示)。プラグインとは関係しない。README のコードとの差分はこの設定だけ(`diff` で確かめた)。
- README の前提(EmDash 0.39 のサイト)の土台は、EmDash の公式の手順と playground に合わせて作った。EmDash 0.39.1 は例外のコマンド(`npm install --min-release-age=0 --save-exact emdash@0.39.1`。このコマンドには emdash だけ)で入れた。監査で、EmDash の外に公開から 3 日未満の版が 15 個入っていたので、`overrides` でルートのロックファイルの版に戻し、0 個にした(一覧は [[readme-install-verification#1. 作り方]])。EmDash 系の 9 個は、0.39.1 の 5 個と、`emdash@0.39.1` が版を固定して依存する `@emdash-cms/plugin-types` 0.4.0・`registry-client` 0.6.1・`registry-lexicons` 0.6.0・`registry-verification` 0.3.2(2026-09-23 公開)。後の 4 個は 0.39.1 ではないが、0.39.1 を入れると必ず入る(T07 と同じ扱い)。根拠: 実測のみ
- 利用者の `~/.npmrc` は変えていない。spike で作った API トークンのファイルは消した(トークンは spike のローカルのデータベースのもの)。

### 未確認

- **非公開のリポジトリのトークンでのインストール**(実際の GitHub は使っていない)。README の方法(手元は SSH の鍵、CI は git の `url.<base>.insteadOf` で HTTPS にトークンを付ける)は、npm 12.0.2 の pacote が、HTTPS で読めなければ SSH で読み、ロックファイルの `resolved` があれば先に公開の tarball を試すこと(`pacote/lib/git.js:241-310`)から書いた。根拠: 公式ドキュメントのみ(取得の順)、推測のみ(`x-access-token:<トークン>` の形で読めること、Cloudflare Workers Builds で `npm ci` より前に git を設定できる場所)
- **Cloudflare での構成**([[T32-cloudflare-check|T32]] が並行して確かめている)。README の Cloudflare の例は、仕様書 13.3 の形に T07 の `vite.ssr.optimizeDeps.include` を足したもの。「テンプレートの `storage: r2(…)` と wrangler の `r2_buckets` を外す」と「R2 の無い Cloudflare のサイトでは標準のメディアの機能は使えない」は推測のみ(仕様書 2.3)。T32 の結果は、リーダーが README に反映する。
- `--min-release-age=0` でプラグインを入れる手順(T07 の実測。T33 では例外の範囲の外なので実行していない)。
- GitHub と Obsidian での README の表示(コールアウト・表・コードブロック)。
- Firefox、管理者以外のロール、完全削除、並べ替え・ドラッグ・貼り付け・HEIC・処理中の保存・必須のギャラリー・コマンドパレット(T25・T27・T28・T28-2・T29 の実測と仕様書による)。

### 他のタスクへの影響・サブタスクの候補

1. [[T34-release|T34]]: README のインストールのコマンドは `github:KazukiMiyazato2021/emdash-base64img-plugin#v0.1.0`。タグの名前・リポジトリの公開か非公開かが決まったら、README と合わせる。別のサイトからの確認には、[[readme-install-verification#8. 再現手順]] の手順と `spikes/t33-readme/` のスクリプト(README のコードブロックの取り出し、Playwright での追加・保存・公開・ページの確認)を使える。`min-release-age` の例外が要るかは、EmDash 0.39.1 の公開(2026-09-23 10:19 UTC)からの日数で決まる。
2. [[T32-cloudflare-check|T32]] の結果の反映(リーダー): README の手順 3 の Cloudflare の例と注意、制約の表。
3. リーダー: `docs/00-index.md` に [[readme-install-verification]] を登録する。
4. (候補)画像管理ページに「ゴミ箱から戻す」を置く(仕様書 19 章)。今は、API トークンを作れない編集者は、標準の画面の「復元」(開くだけで画像の本体を最大 150 件読む)か、管理者に頼むしかない。
5. (候補、EmDash 側。利用者の判断)0.39.1 の管理画面の「Publish now」は、日本語の辞書の訳が空で、英語のまま出る。

> [!note] 反映済み(リーダー、マージのとき)
> 知見ノートを索引に登録した。仕様書 19 章のゴミ箱から戻す操作の項目に、API トークンを作れるのは管理者だけであることと、標準の画面での復元の重さを足した。README の確かめ方のスクリプト(`spikes/t33-readme/` の `*.mjs` と設定)は、T34 で使えるよう、メインの作業ディレクトリの `spikes/t33-readme/`(git 管理外)に写した(ログインの状態のファイルとデータベースは写していない)。T32 の結果(Cloudflare の構成)の README への反映と、「影響・サブタスクの候補」は、後続のサブタスクで扱う。「Publish now」が日本語の画面でも英語の件は EmDash への報告の候補で、利用者の判断が要るので、今は行わない。
