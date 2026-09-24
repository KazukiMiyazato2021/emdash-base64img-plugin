---
id: T28-2
title: "処理中の保存の案内と、代替テキストの入力欄の幅を直す(T22 の部品)"
type: 実装
status: done
wave: 4
parent: "[[T28-gallery-widget]]"
depends_on:
  - "[[T28-gallery-widget]]"
soft_depends_on: []
blocks: []
files:
  - "src/admin/parts/UploadProgress.tsx"
  - "src/admin/parts/AltTextInput.tsx"
  - "tests/admin/parts.test.tsx"
  - "plans/base64-image-plugin-spec.md(11.1 と、18 章の「処理中の保存」の行)"
  - "docs/gallery-widget-reorder-focus.md(4 章・5 章)"
  - "docs/emdash-admin-plugin-ui-styling.md(Kumo の Input の行)"
  - "tasks/T28-2-save-hint-alt-width.md"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - impl
  - admin
  - subtask
created: 2026-09-24
---

# T28-2 処理中の保存の案内と、代替テキストの入力欄の幅を直す(T22 の部品)

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 4 / ブランチ: `phase-4/t-28-2`(`ecec6d6` から)
> - 親タスク: [[T28-gallery-widget|T28]]
> - 着手の条件(依存): [[T28-gallery-widget|T28]]
> - 直す部品: [[T22-widget-parts|T22]] の `UploadProgress` と `AltTextInput`。単一画像([[T27-image-widget|T27]])とギャラリー([[T28-gallery-widget|T28]])の両方が使う
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|18 章]]

## 目的

T22 の部品を 2 か所直す。

- 処理中に「Save」を押さないよう、進捗の行の下に案内を出す。
- 代替テキストの入力欄が、狭い列(幅 390px の Firefox でのギャラリーの行)からはみ出さないようにする。

## 発生した理由

[[T28-gallery-widget#未解決・サブタスクの候補|T28 の未解決]] の 1 と 3 から出た(リーダー)。

- 未解決 1: EmDash は、手動の保存の応答でフォームの値を保存した値に置き換える。処理中に「Save」を押すと、保存の要求のあいだに widget が値に加えた画像が外れる(ギャラリーで 4 枚 → 1〜2 枚)。[[gallery-widget-reorder-focus#4. 処理中に「Save」を押したとき(EmDash の挙動)]]
- 未解決 3: Firefox 155 の幅 390px で、代替テキストの入力欄が行から 10px はみ出した。Kumo の `Input` はラベル付きのとき `grid` で包まれ、その列の最小幅が入力欄の既定の幅(約 215px)になるため。[[gallery-widget-reorder-focus#5. 狭い画面での代替テキストの入力欄(Firefox)]]
- どちらも `src/admin/parts/` の部品を直せば、2 つの widget の両方に当たる。

## 作業内容

- [x] `UploadProgress`: `progress` が `null` でないときだけ、進捗の行の下に案内を出す。読み上げの領域(`aria-live`)には入れず、キャンセルボタンの `aria-describedby` にする。日本語と英語
- [x] `AltTextInput`: Kumo の `Input` に `className="min-w-0"` を渡す。`className` が `<input>` に付くことと、`min-w-0` が管理画面の CSS にあることを確かめる
- [x] `tests/admin/parts.test.tsx` にテストを足し、部品を壊してテストが失敗することを確かめる。ImageField・GalleryField のテストが通ることを確かめる
- [x] spike の管理画面(単一画像の widget も登録する)で、Chromium 153 と Firefox 155 で確かめる
- [x] 仕様書 11.1 に案内を足し、18 章の「処理中の保存」の行の末尾に追記する
- [x] 知見ノート [[gallery-widget-reorder-focus]] の 4 章・5 章に結果を足す。[[emdash-admin-plugin-ui-styling]] の Kumo の注意点に 1 行足す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する
- [x] 開発サーバーを止め、ポート 4428 に LISTEN が無い

## 変更してよいファイル

frontmatter の `files` のとおり。ほかに `spikes/`(git 管理外)。`tests/admin/ImageField.test.tsx` と `tests/admin/GalleryField.test.tsx` は、案内で期待が変わるときだけ変えてよい(変わらなかったので、変えていない)。同時に動いている T28-1(リーダー)のファイル(`tasks/T30`・`T31`・`T33`、`tasks/00-index.md`)と、`docs/00-index.md` は変えない。

## 結果

### 処理中の保存の案内(`UploadProgress`)

- 処理中(`progress` が `null` でない)は、進捗の行の下に「処理が終わってから保存してください。」(英語は「Save after processing finishes.」)と出す。処理していないときは描画しない。文言は案のまま。
- 案内は読み上げの領域の外に置き、キャンセルボタンの `aria-describedby` にした(ID は `useId`)。
  - 領域に入れると、段階が変わるたびに(1 枚につき 4 回)案内も読み上げられる。
  - キーボードで処理を始める(ドロップゾーンのボタンで Enter・貼り付け)と、ボタンが消える・無効になるので、widget はフォーカスをキャンセルボタンへ移す。そのときに、ボタンの説明として読まれる。
  - マウスでドロップしたときは、フォーカスを動かさないので読まれない(見える案内だけ)。
  - キャンセルボタンが無いとき(`onCancel` を省略)も、案内は出す。
- 見た目は `text-xs leading-4 text-kumo-subtle`(12px・行の高さ 16px)。進捗の行との間は、部品の `grid gap-2` の 8px。
- 案内だけで、保存は止めない。案内を出したあとも、処理中に「Save」を押すと画像は外れる(Chromium 153 で 4 枚 → 1 枚、Firefox 155 で 4 枚 → 2 枚。T28 と同じ)。
- 根拠: **実測のみ**(jsdom のテストと両方のブラウザ。Chromium の支援技術のツリーで、キャンセルボタンの説明が案内の文になった。スクリーンリーダーでは確かめていない)

### 代替テキストの入力欄の幅(`AltTextInput`)

- Kumo の `Input` に `className="min-w-0"` を渡した。Kumo 2.6.0 の `Input` は `className` を `<input>` に付け、ラベル・説明を包む Field には付けない。根拠: **実測+公式ドキュメント**(`node_modules/@cloudflare/kumo/dist/chunks/input-f2ct7obgdzypjmp2.js:96-101`、jsdom のテスト、両方のブラウザで `<input>` の計算値の `min-width` が `0px`)
- `.min-w-0{min-width:0}` は管理画面の CSS にある。根拠: **実測のみ**(部品のテストの「管理画面の CSS」と、足したテスト)
- 幅 390px で、ギャラリーの行の入力欄は両方のブラウザで 196px になり、はみ出さない。単一画像の入力欄は 342px。入力欄を `min-width: auto` に戻すと、Firefox だけ 214.7px になり 9.7px はみ出す(T28 の再現)。幅 1280px では、入力欄は列の幅いっぱいのまま(行 458px・単一画像 604px)。根拠: **実測のみ**
- 単一画像は 390px でもはみ出さないが、同じ部品なので付けたままにした。

### テスト

`tests/admin/parts.test.tsx` に 3 件を足した(77 件 → 80 件)。根拠: **実測のみ**

- 「処理中だけ、行の下に保存の案内を出す。読み上げの領域には入れず、キャンセルボタンの説明にする」: 処理していないときは無い。処理中は見えていて、進捗の行(`data-stage`)のすぐ後ろ。`aria-live` の外で、`status` の文に入らない。キャンセルボタンの説明になる。段階が変わっても同じ要素のまま。終わると消え、完了の読み上げにも入らない。キャンセルボタンが無くても出る
- 「保存の案内の英語の文」: 英語の文とキャンセルボタンの説明。言語を切り替えると日本語になる
- 「入力欄(`<input>`)に min-w-0 を付ける」: `<input>` にクラスが付き、ラベルを包む要素には付かない。管理画面の CSS に `.min-w-0` の規則がある
- 部品を 1 か所ずつ壊してテストを実行し、元に戻した。12 通りとも、1 件以上のテストが失敗した(括弧内は失敗した件数。部品・ImageField・GalleryField の 3 ファイルで実行)。
  - 処理していないときも出す(1)/ 出さない(2)/ 進捗の行の上に出す(1)
  - キャンセルボタンの説明にしない(2)/ 案内に `id` を付けない(2)
  - 案内に `aria-live` を付ける(1)/ 読み上げの文に案内を足す(3)
  - 日本語の文を変える(2)/ 英語でも日本語の文(1)/ 別の文を出す(2)
  - `min-w-0` を付けない(1)/ 管理画面の CSS に無いクラスにする(6。ImageField・GalleryField の「管理画面の CSS」のテストも失敗)
- ImageField(70 件)と GalleryField(55 件)のテストは、期待を変えずに通った。

### 実際の管理画面での確認

- spike(`spikes/t28-gallery/`、git 管理外。T28 と同じサイトと DB)の管理画面の入口に、単一画像の widget も登録した(`export const fields = { image: ImageField, gallery: GalleryField }`。T30 と同じ形)。`cover`(単一画像)・`gallery`・`photos` の 3 つの widget が並ぶ。
- 足した場面は 2 つ。`hint`(両方の widget の処理中の案内と、フィールドの間隔)と `narrow`(幅 390px の入力欄)。T28 の場面もすべて実行し直した。
  - Chromium 153: 130 項目すべて通った(T28 の 97 + 33)。
  - Firefox 155: 128 項目すべて通った(T28 の 97 + 31。支援技術のツリーを読む 2 項目は Chromium だけ)。T28 で Firefox だけ通らなかった「390px で widget が横にはみ出さない」も通った。
  - フィールドの間隔は、画像なし・単一画像の処理中・ギャラリーの処理中・画像ありのどれでも、Title → Cover → Gallery → Photos の間が 24px、widget の下の余白は 0。
  - コンソールのエラーは、Chromium で拒否された保存の 422 の 1 件だけ(T28 と同じく、完全削除した画像を参照したままの保存を確かめる場面で、意図したもの)。
- 表は [[gallery-widget-reorder-focus#処理中の案内(T28-2)]] と [[gallery-widget-reorder-focus#T28-2 で直した結果]]。根拠: **実測のみ**
- 開発サーバーを `astro dev stop` で止め、ポート 4428 に LISTEN が無いことを確かめた。

### 仕様書の変更

- 11.1: 進捗の読み上げの項目の下に、処理中の案内(文・読み上げの領域の外・キャンセルボタンの説明)を足した。
- 18 章「処理中の保存」の行の末尾に、両方の widget が案内を出すこと(案内だけで、保存は止めない)を足した。

### 他のタスクへの影響

- [[T31-e2e|T31]]: 処理中は、両方の widget に案内の文が出て、キャンセルボタンに説明が付く。E2E で処理中の表示を確かめるなら、この文も確かめられる。キャンセルボタンの名前は変わらない。
- [[T33-readme|T33]]: README に処理中の保存のことを書くなら、画面の案内と同じ言い方にする。
- [[T30-admin-entry|T30]]: 影響なし(widget の登録の形は変わらない)。

### 未解決・サブタスクの候補

1. 案内だけで、処理中に「Save」を押すと画像が外れることは変わらない。外れた画像を知らせて足し直す案は行っていない。根拠: **実測のみ**
2. スクリーンリーダー(VoiceOver・NVDA)で、キャンセルボタンにフォーカスが移ったときに案内が読まれるかは確かめていない。Firefox の支援技術のツリーも読んでいない。
3. 仕様書 11.2 の図の「処理中」の行には、案内が無い(T27 の章なので変えていない)。
4. 新規作成の最初の保存で処理が止まる件([[T28-gallery-widget#未解決・サブタスクの候補|T28 の未解決]] の 2)は扱っていない。

### 検証

- `npm run verify`: build・lint・test が通った(テスト 24 ファイル・1,856 件)。
- wikilink: すべて解決した。

> [!note] 反映済み(リーダー、マージのとき)
> タスクの索引に登録し、知見の索引の 2 行(並べ替えのノートと、管理画面の部品のクラスのノート)を今の内容に直した。未解決 3 のとおり、仕様書 11.2 の図の「処理中」の行に案内を足した。未解決 5 の 19 章の wikilink(表の外の `\|`)を `|` に直した。T31 と T33 のノートの案内の項目から、このノートにリンクした。未解決 1(外れた画像を知らせて足し直す案)は、[[T28-1-handoff-gallery-widget|T28-1]] のとおり今は作らない。
