---
title: E2E(Playwright)の組み立てと、EmDash 0.39.1 の管理画面を自動で操作して分かったこと
aliases:
  - E2E の組み立て
  - Playwright の E2E
  - E2E のデータベースの扱い
  - ロールの利用者のログインの状態
  - 処理中の保存の実測
  - 編集画面の開き方とアップロードの保存先の実測
  - E2E で手で確かめる項目
tags:
  - docs
  - testing
  - e2e
  - playwright
  - emdash
  - admin
source_task: "[[T31-e2e]]"
created: 2026-09-24
updated: 2026-09-24
---

# E2E(Playwright)の組み立てと、EmDash 0.39.1 の管理画面を自動で操作して分かったこと

> [!summary] 要点
> - `npm run test:e2e` で、playground の開発サーバー(ポート 4431)を空のデータベースで起動し、Chromium 153 と Firefox 155 で同じ 66 件を、ブラウザを使わない API のテストを 20 件動かす。終わるとサーバーは止まる。根拠: 実測のみ
> - データベースは、E2E がサーバーを起動するときは空にする(利用者のデータベースは日時の付いた名前で残し、E2E が作ったものは消す)。サーバーがすでに動いていれば、そのサーバーとデータベースを使う。テストは自分で作ったデータ(テストごとの目印 `token`)だけを見るので、データが残っていても通る。根拠: 実測のみ
> - 仕上げのあと、全体を 3 回続けて実行し、3 回とも失敗 0(Chromium 66 通過、Firefox 65 通過・1 スキップ、API 20 通過。1 回 1.6〜1.7 分)。途中で出た失敗 2 件は原因を直した。根拠: 実測のみ
> - プラグイン(`src/**`)の不具合は見つからなかった。仕様書 18 章の推測「新規作成の画面で処理中に保存すると、残りの処理が止まる」は、両方のブラウザで確かめた(処理中のアップロードは中断され、残りのファイルは処理されず、知らせも出ない)。根拠: 実測のみ
> - Playwright と EmDash の組み合わせで気を付けること: `toBeDisabled` は fieldset を対象にしない、`playwright.request.newContext` にも `use.storageState` が当たる、Desktop Chrome / Desktop Firefox の UA は Windows なので EmDash の `mod+k` は Ctrl になる、コンテンツ一覧は 20 件ずつなので検索で絞る、など([[#4. Playwright と EmDash 0.39.1 の管理画面で気を付けること]])。
> - 自動にしなかった項目(スクリーンリーダー・OS からの本物のドラッグ・ヘッドレスでない Firefox の貼り付け・翻訳の切り替え・Safari の実機)は [[#7. 手で確かめる項目]]。
> - 関連: [[T31-e2e]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15 章]]、[[e2e-input-image-fixtures]]、[[emdash-admin-console-noise]]、[[emdash-plugin-field-widget]]、[[gallery-widget-reorder-focus]]、[[emdash-admin-content-editor-url]]、[[emdash-admin-entry-assembly]]、[[playground-site-pages]]、[[astro-dev-background-for-agents]]、[[admin-image-input-browser-behavior]]

> [!info] 環境
> - Apple M5 Pro、macOS 26.4(25E246、arm64)、Node 26.10.0。`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、Playwright 1.63.0(ヘッドレス。Chromium 153.0.8010.12、Firefox 155.0)。2026-09-24 に計測。
> - playground の開発サーバー(`astro dev`、Node + SQLite)。ポート 4431。データベースは worktree の中の `playground/data.db`。本番のビルド(`astro preview`)と `wrangler dev` では動かしていない。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 1. 構成

| ファイル | 役割 |
|---|---|
| `playwright.config.ts` | project は `chromium`・`firefox`(`*.spec.ts`。同じテスト)と `api`(`*.api.spec.ts`。ブラウザなし)。4 並列、再試行なし、1 件 60 秒。画面は 1280 × 900 |
| `e2e/support/start-dev-server.ts` | `webServer.command`。データベースを空にして、`astro dev --port 4431 --ignore-lock` を前面で起動する([[#2. データベースの扱い]]) |
| `e2e/global-setup.ts` | 入力画像(無ければ作る)・管理者のログイン・ロールの利用者・テスト用のコレクション・API で上げる画像・暖機 |
| `e2e/support/test.ts` | `test` と `expect`。フィクスチャ `api`(管理者の API)・`consoleGuard`(console の見張り)・`token`(テストごとの目印) |
| `e2e/support/admin.ts` | 管理画面の操作(widget の見つけ方、保存・公開、アップロードや保存の要求を止める、一覧の検索、コマンドパレット) |
| `e2e/support/api.ts` | データの準備と確認(アップロードのルートで画像を作る、標準の REST API で投稿を作る、画像管理の一覧を読む) |
| `e2e/support/pages.ts` | サイトの `<img>` の確認と、画像管理ページの補助 |
| `e2e/support/images.ts` | 入力画像の名前と、ドロップ用の `DataTransfer` |
| `e2e/support/console-guard.ts` | console の警告・エラーを見張る([[#5. console の見張り]]) |

| テストのファイル | 件数(ブラウザごと) | 内容 |
|---|---|---|
| `flow.spec.ts` | 1 | 圧縮 → アップロード → 保存 → 公開 → サイトの `<img>`(width / height、100,000 バイト以下、priority)→ 一覧のサムネイル → 画像管理ページ → 参照元のリンク |
| `image-field.spec.ts` | 8 | 単一画像: キーボード(Tab・Enter で `filechooser`)、処理中の表示とキャンセル、差し替え・削除とフォーカス、ドロップ、貼り付け(Chromium だけ)、受け付ける形式、英語 |
| `gallery-field.spec.ts` | 8 | ギャラリー: 順の処理、↑↓、ドラッグ(`page.mouse`)、削除のフォーカス、上限、HEIC の混在、差し替え、ドロップ |
| `content-list.spec.ts` | 5 | 一覧の列: 要求 1 回、「—」、警告、Albums の「+N」、Notes に列なし(SPA)、英語、一括公開で参照元が記録される |
| `images-page.spec.ts` | 8 | 状態の表示、ゴミ箱(キーボード)、完全削除と保存の拒否、公開、さらに読み込む、`items: []` の続き、`INVALID_CURSOR`、英語 |
| `roles.spec.ts` | 6 | 管理者・編集者・投稿者・寄稿者のボタン、寄稿者のゴミ箱、閲覧者の 403 |
| `errors.spec.ts` | 11 | 受け付けない 9 個、Safari 相当、標準の編集画面からの `b64_images` の保存 |
| `edit-lock.spec.ts` | 2 | 編集ロック中は無効、ドロップ・ドラッグを受け付けない |
| `save-while-processing.spec.ts` | 3 | 処理中の保存([[#6. テストで確かめた挙動]]) |
| `upload-target.spec.ts` | 4 | 開き方ごとの `target` と、新規作成の保存のあとの作り直し |
| `admin-entry.spec.ts` | 4 | サイドバー・コマンドパレット・プラグインの管理画面から画像管理ページ、widget が textarea でない |
| `site.spec.ts` | 4 | 一覧のカードと priority、「画像が見つかりません」の枠、カバーなしの priority、404 |
| `narrow-screen.spec.ts` | 2 | 390 × 844 で横にはみ出さない |
| `server-validation.api.spec.ts`(api) | 20 | アップロードのルートの検証、保存 hook ②③ の拒否、参照元の記録(複製と公開) |

- 入力画像(28 個)は global setup が無ければ作る(`node e2e/fixtures/make-images.ts`、macOS の `sips` が要る。[[e2e-input-image-fixtures]])。入力画像を作るだけの script はルートの `package.json` に足さなかった。E2E を実行すれば作られるため。
- サンプルの投稿のスクリプト(`playground/scripts/create-sample-posts.ts`)は使わない。テストは自分のデータを API で作る。

## 2. データベースの扱い

**決めたこと: E2E がサーバーを起動するときは、空のデータベースから始める。** 根拠: 実測のみ

- `start-dev-server.ts` は、起動の前に `playground/data.db` を次のようにする。
  - E2E が作ったデータベース(目印 `e2e/.cache/playground-database-by-e2e` があるとき)は消す。
  - それ以外は、利用者が playground で使っていたものとみなし、`playground/data.e2e-backup-<日時>.db` に移す(`-wal` / `-shm` / `-journal` も同じ名前で移す)。何度 E2E を実行しても、控えは上書きされない。
  - 起動したら目印を書く。空のデータベースには、開発用ログインが seed の適用と管理者の作成を行う。
- 同じ playground で別の開発サーバー(`npm run dev -w playground`)が動いていたら(`playground/.astro/dev.json` の pid が生きている)、起動をやめて「先に `npm run dev -w playground -- stop`」と出す。そのサーバーのデータベースを消さないため。
- ポートに応答があれば、Playwright は起動しない(`reuseExistingServer: true`)。そのときは、そのサーバーのデータベースをそのまま使う。
- テストは、データベースが空であることに頼らない。投稿のタイトルと slug にはテストごとの目印(`token`。project・worker・連番・乱数)を入れ、行は ID・タイトル・目印で探す。一覧は検索で絞る([[#4. Playwright と EmDash 0.39.1 の管理画面で気を付けること]])。
- 確かめたこと: 空のデータベース(E2E が起動)で 7 回、前の実行のデータが残ったデータベース(先に起動したサーバーを使う)で 1 回、全体が通った。空のデータベースで最初に 1 件失敗した(画像が 1 枚も無いと画像管理ページに表が出ない)ので、そのテストは先に画像を 1 枚上げるようにした。

> [!note] 採らなかった案: 毎回データを作り直す(seed を入れ直す)
> seed には画像も投稿も無い([[playground-site-pages#seed の画像を使わない理由]])。作り直す対象はテストが作るデータだけで、テストが自分で作るほうが、並列に動かしても互いに影響しない。

## 3. ログインとロールの利用者

- 管理者: `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` を `maxRedirects: 0` で呼ぶ(200)。空のデータベースなら seed の適用と管理者 `dev@emdash.local` の作成も行われる。歓迎のダイアログは `POST /_emdash/api/auth/me`(`{ action: "dismissWelcome" }`)で閉じた状態にする(管理画面の「はじめる」と同じ)。管理画面の言語は cookie `emdash-locale=ja`(Path `/_emdash`)。根拠: 実測のみ
- 編集者・投稿者・寄稿者・閲覧者: 開発用ログイン(`/_emdash/api/auth/dev-bypass`)は `dev@emdash.local` の利用者にしかログインしない。パスキーを使わずにほかの利用者のセッションを作る API は無い。そこで、playground の SQLite(`node:sqlite`)に `e2e-<ロール>@example.test` の利用者を足し、管理者とメールアドレスを一時的に入れ替えてから開発用ログインを呼ぶ。EmDash は要求のたびに、セッションの利用者 ID から利用者を読み直す(`core/src/astro/middleware/auth.ts:437-447`)ので、入れ替えを戻したあとも、セッションはその利用者のまま使える。`/auth/me` のロールで確かめてから、ログインの状態を `e2e/.cache/auth/<ロール>.json` に書く。根拠: 実測+公式ドキュメント
- 入れ替えの途中で止まったとき(管理者のメールアドレスが仮の値のまま)は、次の global setup が戻す。

## 4. Playwright と EmDash 0.39.1 の管理画面で気を付けること

| 気を付けること | 対処 | 根拠 |
|---|---|---|
| Playwright の `toBeDisabled` は `fieldset` を対象にしない(`disabled` を持てる要素は button・input・select・textarea・option・optgroup)。編集ロックで無効になった widget の根の fieldset も「enabled」になる | `element.matches(":disabled")` を直接見る。中のボタン・入力欄は `toBeDisabled` で見られる(祖先の無効な fieldset も見る) | 実測+公式ドキュメント |
| Playwright Test の `playwright.request.newContext()` にも、`use` の `storageState`(管理者)が当たる。ログインしていない要求のつもりが 200 になった | `storageState: { cookies: [], origins: [] }` を明示する | 実測のみ |
| `devices["Desktop Chrome"]` / `devices["Desktop Firefox"]` の UA は Windows(`Windows NT 10.0; Win64; x64`)。EmDash のコマンドパレットは react-hotkeys-hook の `mod+k` で、`mod` は UA に「Mac」があれば ⌘、無ければ Ctrl。Playwright の `ControlOrMeta` は実行している OS で決まるので、macOS では ⌘K を押してしまい開かない | UA から押すキーを決める(`openCommandPalette`) | 実測+公式ドキュメント(`react-hotkeys-hook` の `dist/index.js`) |
| 編集画面の「Publish now」は、確認のダイアログ「Publish now?」を出す | ダイアログの「Publish now」も押す(`publishFromEditor`) | 実測のみ |
| コンテンツ一覧は更新日時の新しい順に 20 件ずつ(`ContentList.tsx` の `PAGE_SIZE`)。並列のテストが投稿を作ると、目当ての行が 1 ページ目から外れうる | 一覧の検索欄(「postsを検索」)にテストの目印を入れて絞る。検索はサーバー側で、検索を有効にしたコレクションでは FTS のトークンの前方一致、ほかは部分一致(`core/src/database/repositories/content.ts` の `applySearchFilter`) | 実測+公式ドキュメント |
| 一覧の行には、タイトルのリンクと「<タイトル>を編集」のリンクの 2 つがある | `getByRole("link", { name: title, exact: true })` | 実測のみ |
| ダッシュボードの「最近の更新」は、全コレクション(非表示の `b64_images` を含む)で新しい順に 10 件(`core/src/api/handlers/dashboard.ts` の `fetchRecentItems`)。ほかのテストのアップロードで押し出される | 投稿を更新し直してから読み込み直す(`toPass`) | 実測+公式ドキュメント |
| コマンドパレットの検索(`GET /_emdash/api/search?q=`)は、公開済みのエントリだけを返し(`status` の既定値が `published`。`core/src/astro/routes/api/search/index.ts:23-44`)、検索を有効にしたコレクションだけが対象。playground の seed は検索を有効にしていない | global setup で posts の title を検索の対象にし、検索を有効にする。テストでは投稿を公開してから探す | 実測+公式ドキュメント |
| Chromium は、4xx の応答(API の 403・422、404 の文書)ごとに console に「Failed to load resource: the server responded with a status of …」を出す | その応答を確かめるテストだけ `consoleGuard.allow(failedResourcePattern(status))` で除く | 実測のみ |
| Firefox は、Playwright の `evaluate` がページの読み込みの途中でレイアウトを読むと「Layout was forced before the page was fully loaded … debugger eval code」の警告を出す | Playwright が原因なので、見張りから除く | 実測のみ |
| クリップボードへの書き込み(`navigator.clipboard.write`)は非同期で、終わる前に貼り付けると空のまま貼り付けることがある | 書き込みが終わったことをページの属性で知らせ、待ってから貼り付ける | 実測のみ(1 回失敗した。同じ失敗は再現できなかった) |
| ヘッドレスの Chromium のクリップボードは、OS のクリップボードと別。貼り付けのテストを 20 回続けても、macOS のクリップボードの中身(`osascript -e 'clipboard info'`)は変わらなかった | 利用者のクリップボードを書き換える心配は無い | 実測のみ |
| 編集ロックは、lock の API(`POST /_emdash/api/content/posts/<ID>/lock`)を `page.route` で差し替え、ほかの利用者の応答を返すと再現できる(ダイアログ「This entry is open somewhere else」→「Open read-only」→ 帯「Read-only」) | `edit-lock.spec.ts` の `lockedByAnotherUser` | 実測のみ([[emdash-plugin-field-widget#2. 編集ロック中の widget]]) |
| 手動の保存と自動保存は同じ `PUT`。自動保存は body に `skipRevision` がある | `isManualSave` で分ける([[gallery-widget-reorder-focus#4. 処理中に「Save」を押したとき(EmDash の挙動)]]) | 実測のみ |
| Playwright のフィクスチャの 2 つ目の引数を `use` と書くと、oxlint の react の規則(rules-of-hooks)が React の `use` の呼び出しと見なしてエラーにする | 引数の名前を `provide` にした(`.oxlintrc.json` は変えない) | 実測のみ |

## 5. console の見張り

- すべてのテストで、ページの console の `error` / `warning` と、ページの例外(`pageerror`)を集め、テストの終わりに 0 件であることを確かめる(`consoleGuard`)。
- 除くもの: EmDash 側の 3 つ([[emdash-admin-console-noise]]。本番のビルドの Lingui の警告、Firefox の本番のビルドの CSP の eval、Firefox のサイドバーのスクロールの警告)と、Playwright が原因の Firefox のレイアウトの警告([[#4. Playwright と EmDash 0.39.1 の管理画面で気を付けること]])。
- 開発サーバーで全体を動かしたとき、これ以外の警告・エラーは出なかった(両方のブラウザ)。根拠: 実測のみ

## 6. テストで確かめた挙動

### 処理中の保存

アップロードの要求と手動の保存の要求を `page.route` で止め、順番を決めて進めた(時間に頼らない)。Chromium 153・Firefox 155 で同じ結果。根拠: 実測のみ

| 場面 | 結果 |
|---|---|
| 既存の投稿: ギャラリーに 4 枚を選び、1 枚目が値に入ったところで保存(2 枚目のアップロードを止めておく) | 保存の要求の `gallery` は 1 件。要求のあいだに残り 3 枚が追加され(行 4)、応答でフォームは 1 行に戻る。知らせは出ない。保存された値も 1 件 |
| 同上、外れた画像 | 画像のエントリは残る。アップロードの `target` にエントリ ID があるので、参照元(この投稿)が記録され、画像管理ページでは「参照元から外された」(`detached`)になる。`no_owner` にはならない |
| 既存の投稿: 単一画像のアップロード中に保存(ほかの欄を変えて保存できるようにする) | 保存の要求の `cover` は無し。要求のあいだに画像が入り(「画像を追加しました。」)、応答で画像なしに戻る |
| 新規作成: ギャラリーに 3 枚を選び、1 枚目が値に入ったところで最初の保存 | 201 のあと URL が `/_emdash/admin/content/posts/<ID>?locale=en` になり、widget が作り直される。止めていた 2 枚目の要求は中断され(`requestfailed`)、3 枚目は始まらない。行は 1、処理中の表示・キャンセル・エラーは無く、知らせも出ない。保存された値は 1 件 |
| 処理中の案内 | 単一画像・ギャラリーのどちらも「処理が終わってから保存してください。」が出て、キャンセルボタンの説明(`aria-describedby`)になる。処理が終わると消える |

- 新規作成の行は、仕様書 18 章で「推測のみ」だったもの。ギャラリーの widget は、作り直しのときに処理中の要求を中断する(`use-upload-queue.ts` のアンマウントの処理)。

### 編集画面の開き方とアップロードの保存先(`target`)

| 開き方 | URL | 送った `target` |
|---|---|---|
| 新規作成 | `/_emdash/admin/content/posts/new` | `{ collection, field }` |
| 新規作成の保存のあと | `/_emdash/admin/content/posts/<ID>?locale=en` | `{ collection, field, entryId: "<ID>", locale: "en" }` |
| コンテンツ一覧の行 | `…/<ID>?locale=en` | `entryId` と `locale: "en"` を含む(単一画像・ギャラリーとも) |
| ダッシュボードの「最近の更新」 | `…/<ID>`(`?locale=` なし) | `{ collection, field }` |
| コマンドパレットの検索結果 | `…/<ID>`(`?locale=` なし) | `{ collection, field }` |

- 根拠: 実測のみ(両方のブラウザ)。付く・付かないの理由は [[emdash-admin-content-editor-url]]。
- 新規作成の保存のあと、widget の根の fieldset に付けた目印の属性は消え、`preview` の要求が送られ、代替テキストは保存した値で出た。読み上げの領域(`<output>`)は空に戻った([[emdash-plugin-field-widget#3. 新規作成を保存すると widget は作り直される]] の推測を実測で確かめた)。

### そのほか

- 編集ロック: 単一画像の差し替え・削除・代替テキスト・`<input type="file">`、ギャラリーのドロップゾーン・↑↓・差し替え・削除・代替テキストが無効で、`focus()` してもフォーカスは移らない。枠への `drop` ではアップロードの要求 0 件、つまみの `page.mouse` のドラッグでは落とす位置の線も薄い表示も出ず、並びは変わらない。根拠: 実測のみ(両方のブラウザ)
- 狭い画面(390 × 844): 画像のある単一画像とギャラリーの要素は、どれも画面の幅に収まり、ページは横にスクロールしない。画像管理ページの表(幅 514px)は、枠(`overflow-x-auto`)の中で横にスクロールし、ページはスクロールしない。EmDash のコンテンツ一覧の表も、枠の中でスクロールした。根拠: 実測のみ(両方のブラウザ)
- 一覧の一括公開は、エントリごとの公開の API(`POST …/<ID>/publish`)を呼ぶ(`admin/src/router.tsx:518-547` の `runBulkAction`)。複製した投稿(参照元の記録なし)を一括公開すると、応答のあとに参照元が記録された。根拠: 実測+公式ドキュメント

## 7. 手で確かめる項目

E2E では確かめられない、または確かめないことにした項目。リリースの前(T34)などに、手で確かめる。

| 項目 | 自動にしない理由 | 手での確かめ方 |
|---|---|---|
| スクリーンリーダーでの読み上げ(進捗・並べ替え・削除・差し替えの `<output>`、キャンセルボタンの説明、エラー、画像管理ページの操作のあと) | ヘッドレスのブラウザに読み上げは無い。E2E は DOM(`<output>` の文、`aria-describedby`、アクセシブルな説明)までを確かめる | macOS の VoiceOver で、単一画像・ギャラリー・画像管理ページを操作する |
| OS からの本物のドラッグ(ファイルのドロップ、行の並べ替え) | ヘッドレスでは合成のイベント(`dispatchEvent` の `drop`、`page.mouse`)しか送れない | Finder からファイルを枠に落とす。行のつまみをマウスで動かす。編集ロック中も試す |
| ヘッドレスでない Firefox での画像の貼り付け | Firefox 155 のヘッドレスは、クリップボードの画像を読めず、合成の `ClipboardEvent` の中身も空になる([[admin-image-input-browser-behavior]])。ヘッドレスでない Firefox で自動にすると、利用者のクリップボードを書き換える | 画像をコピーし、ドロップゾーンのボタンにフォーカスして ⌘V。もう 1 つの画像のフィールドや、ほかの入力欄にフォーカスがあるときに入らないことも見る |
| 翻訳の切り替え(i18n を設定したサイト)での widget の作り直しと `?locale=` | playground に i18n の設定が無い(playground の変更が要る) | i18n を設定したサイトで、翻訳を作り、切り替えてからアップロードし、`target` の `locale` と参照元のロケールを見る |
| Safari(WebKit)の実機 | E2E は Chromium と Firefox だけ。Safari 相当は、canvas の `toBlob` が PNG を返すモックで確かめた | Safari でファイルを選び、「このブラウザは非対応です…」が出てアップロードしないことを見る |
| 本番のビルド(`astro preview`)・`wrangler dev` での E2E | 開発用ログインが 403 になる([[emdash-admin-entry-assembly]])。`wrangler dev` の中継の問題もある([[T32-cloudflare-check|T32]]) | 開発サーバーで保存した `storageState` を使う([[emdash-admin-content-list-columns#再現手順]]) |

## 8. 安定性(繰り返しの結果)

`npm run test:e2e`(4 並列)。件数は「通過 / 失敗 / スキップ」。スキップは Firefox の貼り付けのテスト(理由は上)。根拠: 実測のみ

| 回 | データベース | Chromium | Firefox | API | 時間(Playwright の表示) |
|---|---|---|---|---|---|
| 1 | 空(E2E が起動) | 64 / 1 / 0 | 64 / 0 / 1 | 20 / 0 / 0 | 1.7 分 |
| 2〜3 | 空 | 65 / 0 / 0 | 64 / 0 / 1 | 20 / 0 / 0 | 1.6 分・1.6 分 |
| 4 | 空 | 64 / 1 / 0 | 64 / 0 / 1 | 20 / 0 / 0 | 1.6 分 |
| 5〜7 | 空 | 65 / 0 / 0 | 64 / 0 / 1 | 20 / 0 / 0 | 1.8 分・2.0 分・1.7 分 |
| 8 | 前の実行のデータが残ったもの(先に起動したサーバー) | 65 / 0 / 0 | 64 / 0 / 1 | 20 / 0 / 0 | 1.7 分 |
| 仕上げの 1〜3(テストを 1 件足したあと) | 空 | **66 / 0 / 0** | **65 / 0 / 1** | **20 / 0 / 0** | 1.6 分・1.6 分・1.7 分 |
| ブラウザごと(`--project`) | 空 | 66 / 0 / 0(1.0 分) | 65 / 0 / 1(48.5 秒) | 20 / 0 / 0(11.8 秒) | — |

- 1 回目の失敗: 画像管理ページの表を待つテストが、空のデータベースで先に動くと、表が無い(「画像はありません。」)。先に画像を 1 枚上げるようにした。
- 4 回目の失敗: Chromium の貼り付けのテストで、ギャラリーに行が増えなかった(フォーカスはボタンにあり、エラーも出ていない)。クリップボードへの書き込みを待たずに貼り付けていたので、書き込みの完了を待つようにした。直したあと、このテストだけを 20 回続けて通った。直す前の形でも、単独で 30 回・ほかのテストと並べて 4 回は失敗せず、原因は確かめられていない(推測のみ)。
- 時間は Playwright の表示の値で、開発サーバーの起動と global setup(7〜10 秒)を含む。`npm run test:e2e` のコマンド全体では 94〜121 秒だった。
- 各回の終わりに、`lsof -nP -iTCP:4431 -sTCP:LISTEN` で何も出ないことを確かめた(Playwright がサーバーを止める)。

## 9. 再現手順

```sh
npm ci
npm run dev -w playground -- stop     # 同じ playground の開発サーバーが動いていれば止める
npm run test:e2e                      # 全体(Chromium・Firefox・API)
npx playwright test --project=firefox e2e/gallery-field.spec.ts   # 一部だけ
npx playwright show-report            # 結果(playwright-report/)
lsof -nP -iTCP:4431 -sTCP:LISTEN      # 終わったあと、何も出ないこと
```

- ブラウザは、`~/Library/Caches/ms-playwright` に入っている Playwright 1.63.0 の Chromium 153・Firefox 155 を使う。T31 では入れ直していない(`npx playwright install` は実行していない)。
- 先に `npm run dev -w playground -- --port 4431` で起動しておくと、そのサーバーとデータベースを使う(データベースは空にしない)。終わったら `npm run dev -w playground -- stop`。
- 失敗したテストの trace とスクリーンショットは `test-results/` に残る(`npx playwright show-trace <trace.zip>`)。
