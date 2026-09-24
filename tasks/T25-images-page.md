---
id: T25
title: "画像管理ページを作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
  - "[[T06-decision-trash-permission]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ImagesPage.tsx"
  - "tests/admin/ImagesPage.test.tsx"
  - "src/client/api.ts"
  - "tests/client/api.test.ts"
spec:
  - "[[base64-image-plugin-spec#11.5 画像管理ページ]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T25 画像管理ページを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]、[[T06-decision-trash-permission|T06]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11.5 画像管理ページ|仕様書 11.5]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]

## 目的

仕様書 11.5 の画像管理ページを作る。

## 作業内容

- [x] 一覧(サムネイル・寸法・保存サイズ・参照元へのリンク・状態バッジ・作成日時)とページ送り
- [x] 「参照されていない」は「消しても安全」ではない、という注意の表示
- [x] ゴミ箱への移動([[T06-decision-trash-permission|T06]] で決めた権限)と、完全削除(管理者のみ。確認ダイアログ付き)
- [x] 非公開の画像の扱いを決める。標準の編集画面で「Unpublish」した画像は、同じ画面からは公開し直せない(「Publish now」は保存を先に送り、保存 hook が拒否する)。標準の API の `POST /_emdash/api/content/b64_images/{id}/publish` なら公開できる。公開し直す操作をこのページに置くかを決める([[T19-image-entry-hook#未解決・サブタスクの候補|T19]])
- [x] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])
- [x] T22 の部品を使える([[T22-widget-parts#部品と props(T27・T28 向け)|T22]]): エラーは `ErrorMessage`(常に描画し、`error` だけを変える。中断は出さない)、保存サイズの書式は `formatKilobytes`、寸法の表示は `ImageInfo`。アイコンは `src/admin/parts/icons.tsx` の `UploadIcon`・`ImageMissingIcon`・`WarningIcon` を使える(`@phosphor-icons/react` はこのプラグインの peerDependencies に無いので、自前の SVG。飾りとして `aria-hidden`)
  - 使ったのは `ImagePreview`・`ImageInfo`・`WarningIcon`・`isAbortError`。エラーは、このページ用の文言が要るので、`ErrorMessage` と同じ形の自前の表示にした([[#決めたこと]])。
- [x] Kumo 2.6.0 の注意([[emdash-admin-plugin-ui-styling#Kumo 2.6.0 の注意点|知見ノート]]): `Loader` は英語の `aria-label="Loading"` と `role="status"` を持つ(飾りなら `aria-hidden` の要素で包み、伝えるなら訳した `aria-label` を渡す)。`Button` の名前は `title` でなく `aria-label` で付ける(`title` はツールチップで包む)。`Label`(`Input` の `label`)に `required={false}` を渡すと英語の「(optional)」が出る。Kumo の省略できる props に `undefined` になりうる値を渡すと、利用者の厳しい型チェック(`exactOptionalPropertyTypes`)で型エラーになるので、値があるときだけ展開する。読み上げの領域は `role="status"` でなく `<output>`(oxlint の `jsx-a11y/prefer-tag-over-role`)
- [x] アップロードの途中で失敗した画像も一覧に出る([[T18-upload-route#失敗したときの後始末|T18]])。公開に失敗した画像は、ゴミ箱に入った下書き(参照元なし、または `target.entryId` の参照元)として出る。`imageRefs` の保存と公開の間で処理が止まった画像は、ゴミ箱に入っていない下書き(参照元なし)として出る。どちらも完全削除(管理者)の対象にする。非公開(下書き)を状態バッジで区別するかは、[[T21-orphan-routes|T21]] のルートが返す状態に合わせて決める
- [x] `owners` には、ロケールだけが違う同じエントリの参照元が並ぶことがある(widget が `target.locale` を省いたとき。[[T23-upload-hook|T23]] はエントリのロケールを送る)。参照元へのリンクを、そのまま並べるか、同じエントリをまとめるかを決める([[T18-upload-route#参照元の記録(T20)との関係|T18]])
- [x] 一覧は T14 の `listImages({ cursor })` で読む。応答は `{ items, nextCursor? }` で、並びは新しい順。1 ページの枚数は 0〜10 で変わる(10 枚を前提にしない)。**`items: []` で `nextCursor` があるときは、続けて次を読む**(参照元の多い画像を調べている途中で、一覧の終わりではない)。400 `INVALID_CURSOR` なら最初から読み直す([[T21-orphan-routes#T25 への引き継ぎ(応答の形とページ送り)|T21]]、[[image-management-routes#応答の形とページ送り(T25 向け)]])
- [x] ボタンは `entryStatus` で出し分ける。ゴミ箱は `active` の画像に出す(`usage: "in_use"` なら、確認で使用中であることを示す。`trashImage(id)`)。完全削除は `trashed` の画像にだけ出す(管理者。`deleteImagePermanently(id)`)。`missing`(記録だけが残った画像)には操作が無いので、そのことが分かる表示にする。ゴミ箱に移したら、その項目を `trashed` にする。完全削除したら、項目を画面から消す(記録は応答のあとの hook が消すので、すぐ読み直すと残って見えることがある)
- [x] 一覧の項目の `entryPublication`(`published` / `draft` / `scheduled`。ゴミ箱・無い画像は null)で、サイトに出ない画像(`draft` / `scheduled`)を示す。戻した画像と、アップロードの途中で止まった画像は `draft`。`ownersTotal - owners.length` で、載せきれない参照元の「ほか N 件」を出す([[T21-2-list-publish-status#結果|T21-2]])
- [x] 上の「非公開の画像の扱い」の材料は [[T21-2-list-publish-status#公開し直す操作の材料(T25 向け)|T21-2]] にある。標準 API(`POST /_emdash/api/content/b64_images/{id}/publish`)は Editor 以上(プラグインが作った画像は作成者が空なので `content:publish_any`)で、編集ロックを確かめ、45〜47 クエリ。このプラグインのルートにするなら permission を決めて新しく作る(44 クエリ)。どちらでも、公開版の無い画像では本体を写したリビジョンが 1 件増える

## 完了条件

- [x] コンポーネントのテスト

## 変更してよいファイル

- `src/admin/ImagesPage.tsx`
- `tests/admin/ImagesPage.test.tsx`
- `src/client/api.ts`(`publishImage` の 1 関数だけ。リーダーの指示で追加)と `tests/client/api.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ
> - `src/admin/ImagesPage.tsx` の `ImagesPage`(props なし)を作った。一覧・ページ送り・「参照されていない」の注意・ゴミ箱への移動・完全削除・**下書きの画像の公開**を 1 ページで行う。登録は T29・T30([[#T29・T30 への登録のしかた]])。
> - 公開し直す操作は、標準 API(`POST /_emdash/api/content/b64_images/{id}/publish`、Editor 以上)にした。`src/client/api.ts` に `publishImage(id)` を足した(リーダーの指示。プラグインのルートは作っていない)。
> - サイドバーのラベルは、管理画面の辞書にある「Images」の ID **`an5hVd`** にする(日本語は「画像」、英語は「Images」)。実際の管理画面で、文字列・ID の 3 通りを比べた。
> - テスト: `tests/admin/ImagesPage.test.tsx` 64 件(jsdom + Testing Library)、`tests/client/api.test.ts` に `publishImage` の分を足した(全体 168 件)。ミューテーションテストで 47 か所を壊し、46 か所でテストが失敗した(残る 1 か所は同じ動きになる変更。[[#ミューテーションテスト]])。
> - 知見ノート: [[emdash-admin-plugin-pages]]、[[kumo-dialog-confirm-a11y]]、[[react-effect-lint-and-vitest-hooks]]。

### 決めたこと

| 項目 | 決めたこと | 根拠 |
|---|---|---|
| 公開し直す操作 | 下書き(`entryStatus: "active"` で `entryPublication: "draft"`。公開の状態が無いときも下書きとして扱う)の画像に「公開」を出す。Editor 以上(ロール 40)。確認はしない(サイトに出すだけで、元に戻せる)。予約済み(`scheduled`)には出さない(予約の日時に EmDash が公開する。標準 API で公開すると予約が消える) | 実測+公式ドキュメント(使い捨てのサイトで、ゴミ箱から戻した画像を公開した。body なし・`Content-Type` なしの POST で 200。[[T21-2-list-publish-status#公開し直す操作の材料(T25 向け)\|T21-2]])。予約が消えることは公式ドキュメントのみ(公開で `scheduled_at = NULL`。`core/src/database/repositories/content.ts:2334`、`:2450`) |
| 公開の失敗の文言 | 409 `ENTRY_LOCKED`(ほかの利用者が編集画面で開いている)・409 `CONFLICT`・422 `PUBLISH_REJECTED`(ほかのプラグインの規則)・404(ゴミ箱に移された・削除された)は、このページの文言にする。T14 の文言(「予期しない応答」など)では何が起きたか分からないため。元のコードは `details.responseCode` で見分ける | 公式ドキュメントのみ(`ENTRY_LOCKED` は 409、`PUBLISH_REJECTED` は 422。`core/src/api/errors.ts:498-503`、`:510-513`)+実測(単体テスト) |
| ロール | `@emdash-cms/admin` の `useCurrentUser()` の `role`(読み込み中は 0 とみなし、ボタンを出さない)。ゴミ箱は寄稿者(20)以上、公開は編集者(40)以上、完全削除は管理者(50)。表示のためだけで、権限はサーバーが判定する([[T06-decision-trash-permission\|T06]]) | 実測+公式ドキュメント(ロール 50・40・30・20・10 で、画面のボタンが表のとおりになった) |
| 403 の表示 | 一覧の 403(閲覧者)は「画像の一覧を見る権限がありません。画像の管理は、寄稿者以上のロールで行えます。」。操作の 403 は「…ロールが変更された可能性があるため、ページを再読み込みしてください。」(ボタンはロールで出しているので、403 はロールが変わったとき) | 実測のみ(閲覧者で一覧が 403 になり、文言が出た。操作の 403 は単体テストだけで確かめた) |
| 参照元の並べ方 | 記録(`owners`)を 1 件ずつそのまま並べ、フィールド・ロケール・状態を添える。ロケールだけが違う同じエントリはまとめない(状態が記録ごとに違い、まとめると「どのフィールドで使っているか」が消える)。リンクは `/_emdash/admin/content/<collection>/<エントリ ID>?locale=<ロケール>`。削除された参照元(`owner_deleted`)はリンクにしない。載せきれない分は `ownersTotal - owners.length` で「ほか N 件」 | 実測(リンクで投稿の編集画面が開いた)+公式ドキュメント([[emdash-admin-content-editor-url]]) |
| 確認 | ゴミ箱への移動は、使用中かどうかに関係なく必ず確認し、使用中なら最初にそのことを書く。完全削除も必ず確認し、使用中なら「参照している投稿が保存できなくなる」、そうでなければ「参照されていないと判定された画像でも…まだ参照されている可能性がある」を書く。確認にはサムネイル・寸法・保存サイズ・ID を出す。Kumo の `Dialog`(`role="alertdialog"`)。最初のフォーカスは「キャンセル」、Escape で閉じる(処理中は閉じない)、外側を押しても閉じない。失敗はダイアログの中に出し、開いたままにする | 実測(Chromium 153 と jsdom。[[kumo-dialog-confirm-a11y]]) |
| 操作のあとの表示 | ゴミ箱に移したら、その行を「ゴミ箱」にする(読み直さない)。完全に削除したら、行を画面から消す(記録は応答のあとの hook が消すので、すぐに読み直すと残って見えることがある。[[T21-orphan-routes\|T21]])。公開したら「公開済み」にする。ボタンが消えるので、フォーカスは行の見出しのセル(完全削除では次の行、最後の行なら前の行、無ければページの見出し)に移し、結果を `<output aria-live>` で読み上げる | 実測(Chromium 153 で、フォーカスの移る先と、読み直したあとに消した画像が出ないことを確かめた) |
| 一覧の読み方 | `listImages` を `nextCursor` で読み進める。`items: []` で `nextCursor` がある応答は続けて読み、画像が 1 枚以上届くか最後のページまで読む。1 回の読み込みで送る要求は 20 回まで(空のページが返り続けたときの安全弁。残りは「さらに読み込む」)。400 `INVALID_CURSOR` なら最初から 1 回だけ読み直し、一覧を置き換えて知らせる(もう一度 `INVALID_CURSOR` ならエラー)。重複した画像は足さない。「さらに読み込む」で足したら、最初に足した画像の行にフォーカスを移す | 実測(本番のビルドで 11 枚目が「さらに読み込む」で足された)+テスト |
| ボタンの名前 | 見える文字から始め、どの画像かを足す(「ゴミ箱に移動: 1280×853、2026/09/24 16:40 作成の画像」)。寸法と作成日時(分まで)が同じ画像がほかにも表示されているときは、行に出している ID を足す(ギャラリーに同じ寸法の画像をまとめて上げると、実際に重なった) | 実測のみ |
| エラーの表示 | T22 の `ErrorMessage` と同じ形(`role="alert"` の領域を常に置き、中身だけを変える)の自前の部品にした。`ErrorMessage` はエラーコードの文言しか出せず、このページの文言(上の表の 403・公開の失敗など)を渡せないため | 推測のみ(設計の判断) |
| サイドバーのラベル | `an5hVd`(「Images」の ID)。[[#T29・T30 への登録のしかた]] | 実測+公式ドキュメント(下の表) |

### サイドバーのラベルの比べ方(リーダーからの依頼)

使い捨てのサイト(`spikes/images-page/site/`、git 管理外)に、同じ部品を 3 つのパスに、3 通りのラベルで登録し、Chromium 153 で開発サーバーと本番のビルドを開いた。根拠: **実測+公式ドキュメント**(手順と環境は [[emdash-admin-plugin-pages#再現手順]])

| `label` | 日本語 | 英語 | 本番のビルドの「Uncompiled message detected!」 |
|---|---|---|---|
| `"an5hVd"`(「Images」の ID) | 画像 | Images | 0 回 |
| `"Images"`(文字列) | **Images(訳されない)** | Images | **7 回**(ページを開き、コマンドパレットで検索し、ほかのページへ移って戻る操作で。開発サーバーでは 0 回) |
| `"hG89Ed"`(「Image」の ID) | 画像 | Image | 0 回 |

- ページのラベルも、一覧の列([[T24-list-column|T24]])と同じく `i18n._(label)` を通る(`admin/src/components/Sidebar.tsx:333-341`、`:497`、`AdminCommandPalette.tsx:259`)。T24 の推測(ページのラベルも同じ)は、実測で確かめられた。
- `an5hVd` は、0.39.1 の 29 の辞書のすべてにある。テスト(「サイドバーのラベル」)で、管理画面が使えるすべての言語に訳があることを確かめている。
- 単数の「Image」(`hG89Ed`)より、複数の画像を並べるページには「Images」が合う。EmDash のメディアの項目は「メディア」(Media)なので、日本語の「画像」とは重ならない。項目は「プラグイン」のグループに出る。
- 文字列にした場合の見え方: 日本語の画面でも英語の「Images」のまま出て、本番のビルドでは描き直しのたびに console に警告が出る。

### 実際の管理画面で確かめたこと

使い捨てのサイト(開発サーバーと本番のビルド。ポート 4425。確かめたあと止め、`lsof -nP -iTCP:4425 -sTCP:LISTEN` で何も出ないことを確かめた)で、`playground/scripts/create-sample-posts.ts` で作った 12 枚の画像を使った。根拠: **実測のみ**(Chromium 153.0.8010.12、Playwright 1.63.0、macOS 26.4、Node 26.10.0)

| 確かめたこと | 結果 |
|---|---|
| 一覧の表示 | 10 枚(1 ページ目)。サムネイル・寸法・保存サイズ・ID・状態・参照元・作成日時。console の警告・エラーなし(文字列のラベルの警告を除く) |
| ロール(`useCurrentUser`) | 管理者: ゴミ箱の画像に「完全に削除」、下書きに「公開」「ゴミ箱に移動」。編集者: 「完全に削除」なし。投稿者・寄稿者: 「ゴミ箱に移動」だけ。閲覧者: 一覧が 403 で、権限の文言。`GET /_emdash/api/auth/me` は読み込みごとに 1 回(管理画面と共有) |
| ゴミ箱への移動(キーボード) | Enter で確認が開き、フォーカスは「キャンセル」。Tab / Shift+Tab は中を回る。Escape で閉じ、ボタンに戻る。移動すると 200、行は「ゴミ箱」になり、フォーカスは行の見出し、読み上げは「…をゴミ箱に移動しました。」 |
| 読み上げ | 確認は `alertdialog`、名前は見出し、説明は本文の段落。開いている間、見出し・表・サイドバーは隠れ、読み上げの領域だけが残る |
| 完全削除 | `DELETE …/permanent` が 200、行が消え、フォーカスは次の行の見出し。「最初から読み込み直す」でも出ない(hook が記録を消した) |
| 公開 | ゴミ箱から戻した画像が「下書き」「サイトに表示されません。」になり、「公開」で `POST …/publish`(body なし)が 200、「公開済み」になった |
| さらに読み込む(本番のビルド) | `{ cursor }` で 11 枚目が足され、ボタンが消え、フォーカスは足した行の見出し、読み上げは「さらに 1 枚の画像を読み込みました。」 |
| 参照元のリンク | `/_emdash/admin/content/posts/<ID>?locale=en` で投稿の編集画面(「Postsを編集」)が開いた |
| 英語 | cookie `emdash-locale=en` で、見出し「Manage images」、ボタン「Move to trash」など |

### テスト

`tests/admin/ImagesPage.test.tsx`(64 件)。fetch を偽のサーバーに差し替え、本物の `src/client/api.ts` を通して、送る要求と画面を確かめる。`useCurrentUser` はモックにし、最後の 1 件だけ本物(`QueryClientProvider` と Lingui の中)を使う。`console.error` を見張り、呼ばれたら失敗にする(先に `cleanup()` する。[[react-effect-lint-and-vitest-hooks]])。

- 一覧の読み方: 最初のページの表示、状態ごとのバッジと説明、空の一覧、読み込み中(Kumo の `Loader` の英語を隠す)、さらに読み込む(フォーカス・読み上げ・ボタンが消える)、重複、`items: []` の続き、要求の上限、`INVALID_CURSOR`(読み直しと、2 回目のエラー)、最初の読み込みの失敗(403・401・500)、さらに読み込むの失敗、読み込み直し(処理中は送らない)、中断(StrictMode・アンマウント)、言語の切り替え
- ボタンの出し分け: ロール(不明・10・20・30・40・50)× 状態(公開済み・下書き・予約済み・ゴミ箱・エントリなし)、ボタンの名前、同じ名前の区別、ロールが後から分かったとき
- ゴミ箱・完全削除・公開: 確認の文言、最初のフォーカス、キャンセル・Escape、外側を押したとき、キーボードだけの操作、成功したあとの行・フォーカス・読み上げ、失敗(404・403・409・422・500)、処理中の二度押しと Escape、前の失敗の表示を消す
- 見た目のクラス(`findMissingClasses`)、`admin.pages` に登録できる型、ラベルの ID が辞書にあること、本物の `useCurrentUser`

### ミューテーションテスト

実装を 1 か所ずつ壊し、テストが失敗するかを確かめた(使い捨てのスクリプト。壊したファイルは毎回元に戻し、最後に元のファイルと一致することを確かめた)。根拠: **実測のみ**

| 壊したところ | 結果 |
|---|---|
| 一覧の読み方(空のページで止める・上限を 1 回増やす・`INVALID_CURSOR` で読み直さない・読み直しで置き換えない・重複を除かない・読み込み直しでカーソルを送る・中断した結果を捨てない・アンマウントで中断しない) | すべて失敗した |
| ボタンの出し分け(公開を寄稿者に・`missing` にゴミ箱・完全削除を編集者に・公開の状態が無いとき公開済みにする) | すべて失敗した |
| 参照元(`?locale=` なし・削除された参照元をリンクに・「ほか N 件」の数) | すべて失敗した |
| 確認(使用中を示さない 2 か所・処理中でも閉じる・二度押し・キャンセルで操作する・`alertdialog` を `dialog` に・ID を出さない) | すべて失敗した |
| 操作のあと(行を変えない 2 か所・公開の失敗を消さない・フォーカスを移さない 3 か所・読み上げない・知らせを消さない・同じ名前に ID を足さない・続きがあるのに「まだありません」・読み込み中の読み込み直しを防がない・公開の二度押し) | すべて失敗した |
| 文言(`ENTRY_LOCKED`・`PUBLISH_REJECTED`・`CONFLICT`・公開の 404・完全削除の 404・操作の 403・一覧の 403) | すべて失敗した |
| `publishImage`(URL・body を送る・応答の `status`・ID の確認) | すべて失敗した |
| `publishImage` の最初の `signal.throwIfAborted()` を消す | **失敗しなかった**。`requestJson` も最初に同じ確認をするので、動きが変わらない(ID も不正なときに、どちらのエラーになるかだけが変わる) |

- 合計 47 か所のうち 46 か所で失敗した。
- 重複を除く処理を壊したとき、最初は関係の無いテストまで失敗した。`console.error` で投げる `afterEach` が `tests/setup/dom.ts` の `cleanup()` を止めていたため。先に `cleanup()` を呼ぶようにした([[react-effect-lint-and-vitest-hooks#afterEach で例外を投げると、ほかの afterEach が呼ばれない]])。

## T29・T30 への登録のしかた

- T29(`src/index.ts` の `definePlugin`): `admin` に `pages: [{ path: "/images", label: "an5hVd", icon: "image" }]` を足す(`entry` はそのまま)。
  - `label` は、管理画面の辞書にある「Images」の ID。文字列("Images" など)にしない(訳されず、本番のビルドで警告が出る)。
  - `icon: "image"` は管理画面のアイコンの名前(Phosphor の Image)。
  - ページは閲覧者を含む全員のサイドバーに出る(ロールで絞られない)。権限の無い利用者には、ページが 403 の文言を出す。
- T30(`src/admin.tsx`): `import { ImagesPage } from "./admin/ImagesPage";` と `export const pages = { "/images": ImagesPage };`。キーは T29 の `path` と同じ文字列(`/` から始める)。
- 開く URL は `/_emdash/admin/plugins/base64-image/images`。
- `ImagesPage` は `@emdash-cms/admin` の `useCurrentUser` を使うので、管理画面の中でだけ描ける(管理画面の `QueryClientProvider` が要る)。
- T29 の `src/index.ts` から `src/admin/ImagesPage.tsx` を読み込まない(サーバーの入口に React と Kumo が入る)。パス・ラベル・アイコンを 2 か所で揃えるなら、`src/shared/constants.ts` に置く(サブタスクの候補)。
- 一覧の列の覚え書き(T24 の `clearThumbnailColumnCache()`)は、T25 では呼んでいない(リーダーの指示)。画像をゴミ箱に移した・完全に削除した・公開したあとに消すなら、両方のマージのあとでつなぐ。

## 影響・サブタスクの候補

- **ゴミ箱から戻す操作**(Editor 以上。標準 API の `POST /_emdash/api/content/b64_images/{id}/restore`)は置いていない。`src/client/api.ts` に足してよい関数が 1 つ(`publishImage`)だけだったため。いまは、戻すには EmDash の `b64_images` の画面(1 ページ 100 件の base64 を読む。仕様書 10 章で使わないとしたもの)しか無い。ページの「ゴミ箱から戻せるのは編集者以上です。」の文は、戻す操作を置いたら見直す。
- **T22 の `ErrorMessage` に、文言を渡せる props**(例: `message`)があれば、このページの自前のエラー表示(`AlertMessage`)を置き換えられる。
- **記録だけが残った画像(`missing`)を消す手段**が無い(ルートが無い。[[T21-orphan-routes#未解決・サブタスクの候補|T21]])。ページでは「このページからは操作できません」と出している。
- **ページのパス・ラベル・アイコンの定数**を `src/shared/constants.ts` に置くと、T29 と T30 で食い違わない。
- `tests/admin/hooks.test.ts`(T23)の `afterEach` も、`console.error` で投げる前に `cleanup()` を呼んでいない。失敗したときに、次のテストまで失敗しうる。`docs/react-hook-testing-pitfalls.md` の例も同じ。
- 管理画面のコマンドパレットで「Images」と入力すると、非表示のコレクション `b64_images`(「Base64 Images」)が出る。選ぶと、仕様書 10 章で使わないとした標準の一覧(1 ページ 100 件の base64 を読む)が開くとみられる(推測のみ。開いていない。仕様書 18 章の候補)。
- `tests/admin/ImagesPage.test.tsx` の本物の `useCurrentUser` のテストは、`@tanstack/react-query` と `@lingui/core`(`@emdash-cms/admin` の依存。このプラグインの package.json には無い)を直接読む。npm の巻き上げが変わって読めなくなったら、devDependencies に入れる(package.json の変更)。
- 仕様書 11.5 を更新した(ラベル・操作・公開・参照元の並べ方)。ほかの章は変えていない。

> [!note] 反映済み(リーダー、マージのとき)
> 知見ノート 3 つを索引に登録した。コマンドパレットの件と、ページがロールで絞られないことは、仕様書 18 章に書いた。T29・T30 への登録のしかたと、ほかの影響は後続タスクのノートに書き、一覧の列の覚え書きのつなぎ込みとページの定数、`hooks.test.ts` の後片付けはサブタスクで扱う。
