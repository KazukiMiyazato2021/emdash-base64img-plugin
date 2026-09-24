---
id: T27
title: "単一画像の widget を作る"
type: 実装
status: done
wave: 4
depends_on:
  - "[[T22-widget-parts]]"
  - "[[T23-upload-hook]]"
soft_depends_on: []
blocks:
  - "[[T30-admin-entry]]"
files:
  - "src/admin/ImageField.tsx"
  - "tests/admin/ImageField.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T27 単一画像の widget を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 4
> - 着手の条件(依存): [[T22-widget-parts|T22]]、[[T23-upload-hook|T23]]
> - このタスクを待つもの: [[T30-admin-entry|T30]]
> - 仕様: [[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

仕様書 11.2 の単一画像 widget(`base64-image:image`)を作る。

## 作業内容

- [x] 状態: 空・処理中・設定済み・画像が見つからない(加えて、値が参照の形でないとき)
- [x] 差し替え・削除・代替テキストの入力
- [x] `onChange` に参照(`{ v, id, locale, width, height, alt }`)を渡す
- [x] 失敗したときは、フィールドの値を変えない
- [x] `<input type="file">` の `accept` は `image/*` にする。MIME タイプを並べると HEIC を選べなくなり、HEIC の案内を出せない。Firefox はデコードの間(6,400 万画素で 100ms 前後)画面を止めるので、「読み込み中…」はデコードを始める前に描画しておく([[T12-input-decode#後続タスク向けのメモ|T12]])
- [x] 保存済みの画像のプレビューは `fetchPreviews`([[T14-admin-i18n-api|T14]]・[[T17-admin-data-routes|T17]])。`image: null` は「画像が見つかりません」。プレビューは `b64_images` を読むので、`imageRefs` に記録が無い画像(seed など)も表示されるが、保存は拒否される([[T16-reference-hook#他のタスクへの影響|T16]])。保存の前に気付けるよう、`fetchThumbnails` で `imageRefs` にあるかも確かめるかを決める → 確かめない(下の「決めたこと」3)
- [x] 部品は `src/admin/parts/` から import する。props と使い方の例は [[T22-widget-parts#部品と props(T27・T28 向け)|T22 の表]] と [[T22-widget-parts#使い方の例|使い方の例]]。部品は表示と操作だけを受け持ち、アップロードの処理([[T23-upload-hook|T23]])や API の呼び出しは持たない
- [x] `UploadProgress`・`ErrorMessage`・`UploadNotices` は、処理の有無にかかわらず常に描画する(読み上げの領域を先に DOM に置くため)。フォーカスは、処理を始めたらキャンセルボタンへ(`cancelButtonRef`)、キャンセル・失敗のあとはドロップゾーンへ(`buttonRef`)移す(押したボタンが消えるとフォーカスが失われるため) → 画像があるときは差し替えのボタンへ(決めたこと 5)
- [x] 「差し替え」「削除」などの文字は、自分の辞書(`defineMessages`)に持つ。部品は持たない。「差し替え」は `FileSelectButton`、削除は Kumo の `Button`(`secondary-destructive`)
- [x] 空のときの `ImageDropZone` は `multiple` なし。複数のファイルがドロップ・貼り付けされたら、部品が「画像は 1 枚ずつ追加してください。」と出して `onFiles` を呼ばない(仕様書 11.2)。形式は部品では確かめないので、`onFiles` のファイルを T23 のフックに渡す
- [x] 見た目のクラスは、管理画面の CSS にあるものだけを使う(管理画面の CSS はビルド済みで、プラグインのファイルを読まない)。無いクラスと枠の色は style で書く。テストでは `tests/admin/admin-css.ts` の `findMissingClasses(container, sourceTokens("<自分のソース>"))` で、使うクラスが CSS にあることを確かめる([[T22-1-admin-css-test-helper|T22-1]]、[[emdash-admin-plugin-ui-styling]])
- [x] アップロードの応答の `ref`(`{ v, id, locale, width, height, alt: "" }`)は、そのままフィールドの値にする。`ref.locale` は画像エントリのロケール(サイトの既定)で、編集中のエントリのロケールではないので書き換えない。代替テキストは、入力欄の値を `alt` に入れる([[T18-upload-route#T23 が使う応答|T18]])
- [x] アップロードのエラーは、T14 の `useErrorMessage` でコードごとの文言を出す。`UPLOAD_FAILED`(500)は、作った画像エントリをルートがゴミ箱に移したあとのエラー、`IMAGE_ENTRY_INVALID`(400)は保存 hook が作成を拒否したもの。どちらもフィールドの値は変えない
- [x] 処理と状態は `src/admin/hooks/` のフックを使う([[T23-upload-hook#T27・T28 が使うもの|T23 の表]]、[[T23-upload-hook#使い方の例|使い方の例]])。保存先は `useUploadTarget(id)`(props の `id` を渡す)の結果をそのまま `target` に渡す。フックは表示を持たないので、段階(`state.status`)を T22 の `UploadProgress` の `stage` にそのまま渡す。単一画像は `useImageUpload({ target, options })`。`upload(file)` は reject せず、結果が `done` のときだけ `onChange` する(`error` は `state` に残り、`cancelled` は何もしない)
- [x] 保存済みの画像は `usePreviewImages(ids)` で取得する(10 件ずつ並行。状態は `loading` / `loaded` / `missing` / `error`。`missing` は「画像が見つかりません」、`error` は `retry()`)。追加したばかりの画像は `prime(ref.id, entry)` で手元の data URL を表示し、取得しない

## 完了条件

- [x] コンポーネントのテスト

## 変更してよいファイル

- `src/admin/ImageField.tsx`
- `tests/admin/ImageField.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/admin/ImageField.tsx` に単一画像の widget `ImageField` を作った。処理と状態は T23 のフック、表示は T22 の部品だけを使い、部品とフックは変えていない。
> - 値は任意の JSON として読む。`null` / `undefined` は画像なし、`isBase64ImageRef` に合えば画像あり、それ以外は「画像の値が正しくありません」と表示して削除ボタンだけを出す。
> - `tests/admin/ImageField.test.tsx` に 70 件のテスト(jsdom + Testing Library。フックと部品と API クライアントは本物で、偽物は `createImageBitmap`・canvas・`fetch` だけ)。実装を 1 か所ずつ壊す 59 種類のうち、55 種類でテストが失敗した。残る 4 種類は jsdom で観測できないもので、ブラウザで確かめた(下の「テスト」)。
> - 実際の管理画面(`spikes/` の使い捨てのサイト。ルート・hook・widget を仮に登録)で、Chromium 153 と Firefox 155 を使い、選択・ドロップ・貼り付け・差し替え・削除・代替テキスト・キャンセル・エラー・「画像が見つかりません」・正しくない値・編集ロック・保存を確かめた。Firefox のヘッドレスで貼り付けの画像を読めないこと([[admin-image-input-browser-behavior|T22 の知見]]と同じ)のほかは、同じ結果だった。
> - 知見ノート: [[emdash-plugin-field-widget]](plugin widget の props・編集ロック・作り直しの時期・`?field=`・フィールドの間隔・フォーカスの戻し方・実際の管理画面での確認の結果)

### T30 への登録のしかた

```tsx
// src/admin.tsx(T30)
import { ImageField } from "./admin/ImageField";

// 型の注釈(`PluginAdminModule["fields"]` や `satisfies`)を付けない
export const fields = { image: ImageField /* , gallery: …(T28) */ };
```

- キー `image` は、`WIDGET_IDS.image`(`base64-image:image`)の `:` の後ろ。EmDash は `fields[<名前>]` を探す(`references/emdash/packages/admin/src/components/ContentEditor.tsx:1818`)。
- `PluginAdminModule` の `fields` は `Record<string, React.ComponentType>`(props 無し)なので、必須の props を持つ `ImageField` は代入できない(TS2322。テストの `@ts-expect-error` で確かめた)。公式の field-kit と同じく、注釈を付けずに export する。根拠: 公式ドキュメントのみ+型チェックの実測
- export しているもの: `ImageField`(部品)、`ImageFieldProps`(EmDash が渡す props の型)、`readImageFieldValue` / `ImageFieldValue`(値の読み方。`empty` / `image` / `invalid`)。
- 実際の管理画面では、spike の管理画面の入口で `export const fields = { image: ImageField };` として動いた(両方のブラウザ)。

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 参照の形でない値(空文字・ID の文字列・`{}`・キーの足りない参照など)は、警告の枠と説明と削除ボタンだけを出す。削除で `null` にする。T22 の `ImageNotFound` は使わない | 保存 hook ③ は参照の形でない値を拒否し、管理画面は保存のたびにすべてのフィールドを送るので、外さないと投稿が保存できない。`ImageNotFound` の文言(ゴミ箱・削除)は当たらない | 実測+公式ドキュメント(実際の管理画面で、値が `{}` の投稿の保存が 422 `SAVE_REJECTED` になり、削除すると保存できた) |
| 2 | 差し替えた画像の代替テキストは空にする(応答の `alt: ""` のまま) | 前の画像の説明を、新しい画像に黙って残さない。空欄なら「装飾画像として扱われます」の注意が出て、入力を促せる。EmDash 標準の画像フィールドも、選び直すと新しいメディアの代替テキストになる | 公式ドキュメントのみ(`references/emdash/packages/admin/src/components/ImageFieldRenderer.tsx:224-227`、`:91`)。空になることは実測 |
| 3 | 開いたときに `fetchThumbnails` で `imageRefs` に記録があるかを確かめない | 記録の無い画像は seed で作ったものなどに限られ、仕様では画像はアップロードで作る(仕様書 13.1)。開くたびに要求が 1 回増える。保存のときに hook ③ が日英の理由と直し方を返し、管理画面のトーストに出る | 実測+公式ドキュメント(トーストは実測。値が正しくないときの拒否で確かめた) |
| 4 | 処理中は主な表示(ドロップゾーン・画像)を消し、進捗の行とキャンセルボタンだけにする。キャンセル・失敗のあとは処理の前の表示に戻す | 仕様書 11.2 の図(「処理中」の行)と、T23 の「キャンセルは処理の前の表示に戻す」 | 設計判断 |
| 5 | フォーカス: 最後にフォーカスを受けた要素(fieldset の `focusin` で覚える)が表示の切り替えで消え、フォーカスが body に戻ったときだけ、今の表示の主な要素へ移す。処理中はキャンセル、追加したら代替テキスト、キャンセル・失敗・エラーを閉じたあとは差し替え(画像なしならドロップゾーン)、見つからない・正しくない値は削除 | 押したボタンが消えるとフォーカスが失われる。ほかのフィールドにフォーカスがあるとき、利用者が自分で外したときは奪わない。要素が消えたときの `blur` / `focusout` はブラウザで違いうる | 実測のみ(jsdom のテストと、実際の管理画面の両方のブラウザ) |
| 6 | 編集ロック中は、ファイルを受け取っても処理しない(自分の fieldset が `:disabled` なら無視) | plugin widget に `readOnly` は渡らないが、EmDash がフィールドを `<fieldset disabled>` で包むので、ボタンと入力欄は無効になる。枠(`div`)へのドロップだけは届き、確認を外すとロック中でもアップロードが始まった | 実測+公式ドキュメント(`ContentEditor.tsx:1336`、[[emdash-plugin-field-widget#編集ロックの確認を外したとき]]) |
| 7 | 根を `<fieldset>` と `<legend>` にし、props の `id` を fieldset に付ける | 中のボタンと入力欄を表示名でまとめる(`role="group"` は oxlint の `prefer-tag-over-role` が fieldset を求める)。`id` は保存先の計算と `?field=` の対象。標準の画像フィールドも `id` を包みの div に付ける | 実測+公式ドキュメント(`ImageFieldRenderer.tsx:506`) |
| 8 | 根に余白のクラスを付けない。進捗・注意・エラーの領域は gap で並べず、見えるものがあるときだけ上に `mt-2` を付ける | フィールドの間隔は詳細度 0 の `space-y-6`。空の領域(高さ 0)にも grid の gap が付き、フィールドの下に余白が残った | 実測のみ(直したあと、Title → Cover・Cover → Gallery がどちらも 24px) |
| 9 | `required`・`validation`・`minimal` は受け取るが使わない | 必須の確認は EmDash の保存の検証が行う(`references/emdash/packages/core/src/api/handlers/validation.ts:7`、`:196-221`)。`minimal` はフィールドの並びからは渡らない(`ContentEditor.tsx:1379-1400`)。必須のときの表示は未解決 7 | 公式ドキュメントのみ |
| 10 | 単一画像のエラー・注意には見出し(ファイル名)を付けない。ファイル名は処理中の行に出す | 1 枚しか扱わないので、どのファイルのエラーかは明らか | 設計判断 |
| 11 | 削除では、値を `null` にするのと同時にアップロードの状態も消す(`reset`) | 前の画像の注意(GIF)や「画像を追加しました。」が、画像なしの表示に残らないようにする | 設計判断(テストで確かめた) |
| 12 | プレビューの取得の失敗は、見出し「プレビューを読み込めませんでした」の `ErrorMessage` と「再読み込み」(`retry()`)を出す。寸法・代替テキスト・差し替え・削除はそのまま使える | 取得の失敗は一時的なことが多い。値は参照として正しいので、編集は止めない | 設計判断 |

### テスト

- `tests/admin/ImageField.test.tsx`: 70 件。値の読み方(正しくない値 13 種)、空のとき、アップロード(段階の表示と読み上げ・送る値と `target`・応答の参照をそのまま値にすること・ドロップと貼り付け・複数のドロップ・`options`・GIF の注意・新規作成・保存先を求められないとき)、失敗(HEIC・`UPLOAD_FAILED`・`IMAGE_ENTRY_INVALID`・エラーを閉じる)、キャンセル(読み込み中・アップロード中)、保存済みの画像(プレビュー・代替テキスト・削除・差し替え・見つからない・取得の失敗)、正しくない値、キーボードとフォーカス、編集ロック中、英語、StrictMode と登録の型、使うクラスが管理画面の CSS にあること。`onChange` は成功・代替テキスト・削除のときだけ呼ばれることを、各テストで確かめた。
- 偽物は `createImageBitmap`(`vi.stubGlobal`)・`HTMLCanvasElement.prototype.getContext` / `toBlob`・`fetch` だけ。フック・部品・API クライアント・デコードと圧縮の処理は本物を使った。テストの後に `console.error` が出ていれば失敗にした。
- 実装を 1 か所ずつ壊して、テストが失敗するかを確かめた(59 種類、scratchpad の使い捨てのスクリプト)。55 種類でテストが失敗した。根拠: 実測のみ
  - 例: 失敗・中断でも値を変える / `prime` しない / `locale` を書き換える / 差し替えで前の代替テキストを残す / 編集ロックの確認を外す・fieldset 自身の `disabled` だけで判定する / 削除で状態を消さない・`undefined` にする / 代替テキストで他のキーを落とす / 空文字を画像なしとみなす / 正しくない値を画像なしとみなす / 見つからない画像を画像ありにする / 処理中も前の表示を出す / フォーカスまわり(移さない・ほかの要素から奪う・消えていない要素でも動かす・覚えない・移す先を変える 6 種) / `multiple` にする / 表示名を渡さない / 読み上げの領域・エラーの領域を処理中だけ置く / 完了を読み上げない / 注意を出さない / 圧縮の途中経過・ファイル名・保存サイズ・画質を渡さない / 再読み込みしない / エラーを閉じられない / キャンセルボタンを出さない / fieldset と legend を div にする / `id` を付けない / `options` を渡さない / 保存先を別の `id` で求める / プレビューを取得しない / 管理画面の CSS に無いクラス / 英語の文言を日本語にする / 削除ボタンの説明を外す / 削除で値を変えない / 差し替えのファイルを処理しない / 寸法を固定する
  - テストが通ったもの(4 種類): `useLayoutEffect` を `useEffect` にする(jsdom は描画しないので差が出ない)、`focusin` の登録を解除しない(fieldset は部品と同じだけ生きるので、観測できる差が無い)、注意・エラーの領域に常に `mt-2` を付ける(2 種。jsdom はレイアウトを計算しない。実際の管理画面で間隔を計測した)。
- `npm run verify`: build・lint・test が通った(テスト 22 ファイル・1,762 件)。

### 実際の管理画面での確認

手順と表は [[emdash-plugin-field-widget#7. 実際の管理画面での確認の結果]]。`playground/` を `spikes/t27-image-widget/site/`(git 管理外)に写し、プラグインを記述子で登録した。ルートと hook を登録する定義(T29 の代わり)と、`fields = { image: ImageField }` の管理画面の入口(T30 の代わり)は spike の中に置いた。Playwright 1.63.0(ヘッドレス)で操作した。根拠: 実測のみ

- 新規作成: Enter でファイルの選択が開く(`accept="image/*"`、`multiple` なし)。処理中はキャンセルボタンにフォーカスがあり、「読み込み中…」→「圧縮中… 1600px / 画質 0.60」…「サムネイルを作成中…」→「アップロード中…」。「読み込み中…」のコミットのあとのフレームは、デコードの開始より先だった。追加すると代替テキストにフォーカスが移り、「画像を追加しました。」を読み上げる。送った `target` は `{ collection: "posts", field: "cover" }`。
- 保存: 201。URL は `/_emdash/admin/content/posts/<ID>?locale=en` になり、widget は作り直された(プレビューを取得し直した)。保存した値は応答の参照に代替テキストを入れたもの(`locale: "en"`)。
- 一覧から開いた画面での差し替え: `target` に `entryId` と `locale: "en"` が入り、代替テキストは空になった。キャンセルでは前の画像のままで、フォーカスは差し替えのボタン。
- HEIC は送らずに案内を出し、値は変わらない。GIF は最初のフレームだけの注意を出す。削除するとドロップゾーンにフォーカスが移り、保存した値は `null`。
- ドロップ(1 枚は追加、2 枚は「1 枚ずつ」)と、Chromium の貼り付けで追加できた。Firefox(ヘッドレス)の貼り付けは「読み取れませんでした」。
- 画像エントリをゴミ箱に移すと「画像が見つかりません」。ゴミ箱に入っただけなら、参照したままでも保存できた。値が `{}` の投稿は「画像の値が正しくありません」で、保存は 422 で拒否され、削除すると保存できた。
- 編集ロック中(偽の lock API)は、ボタン・入力欄が無効で、ドロップも処理しない。
- 英語の表示、Tab の順(Title → 代替テキスト → 差し替え → 削除 → Gallery)、フィールドの間隔(24px)を確かめた。コンソールのエラーは、拒否された保存の 422 の 1 件だけ(Chromium)。

### 仕様書の変更

- 11.2 に加えた: 差し替えた画像の代替テキストは空にする / 値が参照の形でないときの表示と削除 / 開いたときに `imageRefs` の記録を確かめない理由 / フォーカスの移し方 / 編集ロック中の扱い。
- 8 章の「ゴミ箱に入った画像を参照する保存は通る」は、実際の管理画面でも同じだった(変更なし)。

### 11.1 の変更の依頼(リーダーへ)

11.1 の最後の項目「plugin widget には `readOnly` が渡されない(`ContentEditor.tsx:1833`)。そのため、編集ロック中でも widget は操作できてしまう。これは EmDash 側の制約。」は、EmDash 0.39.1 では当たらない。T27 の範囲外なので変えていない。次の文への置き換えを提案する。

> plugin widget には `readOnly` が渡されない(`packages/admin/src/components/ContentEditor.tsx:1833-1842`)。ただし、フィールドの並びは `<fieldset disabled={readOnly}>` の中にあり(`:1336`)、編集ロック中は widget の中のボタンと入力欄もブラウザが無効にする。`div` で受けるドロップだけは届くので、widget は自分の fieldset が `:disabled` のときにファイルを受け付けない。根拠: 実測+公式ドキュメント([[emdash-plugin-field-widget]])

### 他のタスクへの影響

1. [[T30-admin-entry|T30]]: 上の「T30 への登録のしかた」。`fields` に型の注釈を付けない。
2. [[T28-gallery-widget|T28]]: 揃えると良いもの。
   - 編集ロック: ファイルを受け取ったときに自分の fieldset(または根の要素)が `:disabled` なら処理しない(ドロップは届く)。並べ替えの ↑↓ などのボタンは fieldset で無効になる。
   - 値が配列でない・参照の形でない要素があるときの扱い(T27 は値の全体を「正しくない値」として外させる)。
   - 開いたときに `imageRefs` の記録を確かめない(決めたこと 3)。
   - 空の読み上げの領域を grid の gap で並べない(決めたこと 8)。フォーカスの戻し方(決めたこと 5)。
   - 新規作成を保存すると widget は作り直され、キューの state は消える([[emdash-plugin-field-widget#3. 新規作成を保存すると widget は作り直される]])。
3. [[T23-upload-hook|T23]] の未解決 3(URL と widget の作り直しの時期): 新規作成の保存のあと、URL は `/_emdash/admin/content/posts/<ID>?locale=en` になり、widget は作り直された(フィールドの `key` にエントリ ID が入るため)。翻訳の切り替えは、spike のサイトが多言語でないので確かめていない。
4. [[T31-e2e|T31]]: ほかの利用者のロックは、lock の API を `page.route` で差し替えると再現できる。ダイアログ(「Open read-only」)を閉じてから操作する。処理中の表示は、アップロードの要求を `page.route` で止めておくと確かめられる。貼り付けは Chromium だけで試す。
5. [[T22-widget-parts|T22]]: 部品は変えていない。下の未解決 1 を参照。

### 未解決・サブタスクの候補

1. T22 の `ImageNotFound` に見出しと説明の props を足せば、正しくない値の表示にも使える(今は T27 が同じ見た目の枠を自分で作っている)。部品の変更なので T27 では行っていない。
2. `?field=cover` で開いても、fieldset はフォーカスできないので、フォーカスは body のまま(標準の画像フィールドも div で同じとみられる。推測のみ)。fieldset に `tabIndex={-1}` を付ければグループにフォーカスできる(推測のみ)。今は付けていない。
3. 完全削除した画像を参照したままの保存(hook ③ の拒否)は、実際の管理画面では確かめていない。ゴミ箱に入っただけなら保存できることは確かめた。
4. OS からの本物のドラッグと、ヘッドレスでない Firefox の貼り付けは確かめていない(ヘッドレスでは合成のイベントだけを送れる。利用者のクリップボードを書き換えないため)。
5. EmDash の編集ロックのダイアログと帯(「This entry is open somewhere else」「Read-only」)は、日本語の画面でも英語だった(EmDash 側)。
6. `docs/00-index.md` に [[emdash-plugin-field-widget]] を登録する(リーダー)。
7. EmDash 標準の画像フィールドは、`required` で画像が無いとき「This field is required」を赤で出す(`references/emdash/packages/admin/src/components/ImageFieldRenderer.tsx:596-598`)。単一画像の widget は `required` を使っておらず、この表示が無い(保存の検証は EmDash が行う)。揃えるなら、辞書に文言を足して空の表示の下に出す(仕様書に無いので行っていない)。

> [!note] 反映済み(リーダー、マージのとき)
> 知見ノートを索引に登録した。仕様書 11.1 の編集ロックの項目を、上の提案の文に置き換え、18 章の「編集ロック」の行も直した。[[emdash-dependency-versions#EmDash を上げるときに先に確かめること]] に、編集ロックの伝わり方と `fields` の型の 2 行を足した。T28 に揃えてほしい点(他のタスクへの影響 2)は、T28 の作業中に送った。「他のタスクへの影響」と「未解決・サブタスクの候補」は、後続タスクのノートに書いた([[T27-1-handoff-image-widget|T27-1]])。編集ロックのダイアログが日本語の画面でも英語だった件(未解決 5)は EmDash への報告の候補で、利用者の判断が要るので、今は行わない。
