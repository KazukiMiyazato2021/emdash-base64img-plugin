---
title: 画像の入力(ファイルの選択・ドロップ・貼り付け)の、Chromium 153 と Firefox 155 での挙動
aliases:
  - 貼り付けのイベントが届く要素
  - ドロップゾーンのブラウザでの確認
  - paste event target
tags:
  - docs
  - browser
  - a11y
  - admin
  - playwright
source_task: "[[T22-widget-parts]]"
created: 2026-09-24
updated: 2026-09-24
---

# 画像の入力(ファイルの選択・ドロップ・貼り付け)の、Chromium 153 と Firefox 155 での挙動

> [!summary] 要点
> - T22 のドロップゾーン(`src/admin/parts/DropZone.tsx`)を、部品だけのページに描いて Playwright で操作した(ヘッドレス)。
> - キーボードだけで、Tab でボタンに移り、Enter / Space でファイルの選択を開けた(両方のブラウザ)。ギャラリーでは複数を選べる。
> - **貼り付けのイベントが届く要素がブラウザで違う**。Chromium はフォーカスのあるボタンに、Firefox は body(または選択範囲のある要素)に届ける。どちらでも `document.activeElement` はボタンのまま。そのため、`document` で受けて、イベントの対象かフォーカスのある要素で判定する。
> - Chromium はキーボードの貼り付け(⌘V)で画像のファイルを受け取れた。Firefox(ヘッドレス)は、`types` が `Files` で `items` に項目があるのに、`getAsFile()` が `null` で、textarea や contenteditable でも同じだった。ヘッドレスのクリップボードの制約とみられ(推測のみ)、実際の Firefox では確かめていない。
> - 合成した `new ClipboardEvent("paste", { clipboardData })` は、Chromium では中身が届き、Firefox では空になる。E2E で Firefox の貼り付けを合成のイベントで試すことはできない。
> - ドロップ(本物の `DataTransfer` を `dispatchEvent` で渡す)は両方で受け取れた。
> - 関連: [[T22-widget-parts]]、[[emdash-admin-plugin-ui-styling]]、[[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]、[[T31-e2e]]、[[input-image-decode]]

## 結果

根拠は、特に断りがなければ **実測のみ**(下の計測環境)。

| 確かめたこと | Chromium 153 | Firefox 155 |
|---|---|---|
| Tab で最初に移る要素 | ドロップゾーンのボタン(名前「カバー: ファイルを選択」) | 同じ |
| Enter / Space でファイルの選択が開く | 開く(`filechooser`)。単一画像は `isMultiple()` が `false`、ギャラリーは `true` | 同じ |
| 選んだファイル | `onFiles` に `File` が届く(名前・type・大きさがそのまま) | 同じ |
| キーボードの貼り付け(⌘V)が届く要素 | フォーカスのあるボタン(`event.target` がボタン) | **body**(`event.target` が body。`document.activeElement` はボタン) |
| そのときの `clipboardData` | `types: ["Files"]`、`files` 1 件(`image.png`、`image/png`)、`items` 1 件(`getAsFile()` で読める) | `types: ["Files"]`、`files` 0 件、`items` 1 件(`file:image/png`)だが **`getAsFile()` が `null`** |
| 部品の結果 | `onFiles([image.png])` | 「クリップボードの画像を読み取れませんでした」と表示 |
| textarea・contenteditable にフォーカスして貼り付け | 届く要素はその要素。ファイルを読める | 届く要素はその要素。**ファイルは読めない**(`getAsFile()` が `null`) |
| tabindex のある div にフォーカスして貼り付け | その div に届く | **直前に選択範囲があった contenteditable の div** に届いた |
| 合成した `ClipboardEvent("paste", { clipboardData })` | 中身(`files` 1 件)がそのまま届く | `clipboardData` はあるが空(`types` も `items` も 0 件) |
| ドロップ(`DataTransfer` に `items.add(File)`) | `dragenter` の `types` は `["Files"]`。ドラッグ中の表示になり、`drop` で `onFiles` に届く | 同じ |
| 文字列のドラッグ(`setData("text/plain")`) | `types` は `["text/plain"]`。ドラッグ中にならない | 同じ |
| 単一画像に 2 つのファイルをドロップ | 「画像は 1 枚ずつ追加してください。」 | 同じ |
| ギャラリーに 3 つのファイルをドロップ | 3 つまとめて届く | 同じ |
| `dragover` のあとの `dropEffect`(合成のイベントの後で読む) | `"none"`(イベントの後で戻る) | `"copy"` |
| キーボードでフォーカスしたときの見た目 | `:focus-visible` が一致し、2px の青い ring(box-shadow) | 同じ |
| ドラッグ中の枠の色(style で付けた後) | `oklch(0.5772 0.2324 260)`(ブランドの青) | 同じ |
| クリックしたボタンのフォーカス | ボタンに移る | ボタンに移る(下の注意) |

- 画面の大きさ(`getBoundingClientRect`): 261×173 の画像のプレビューは 261×173.7(拡大しない)、1280×853 の読み込み中の枠は 288×191.9(高さ 192px に収まる幅)、ギャラリーの小さなプレビューは 96×64.3、ドロップゾーンのボタンは幅 604 × 高さ 128(`min-h-32`)。読み込み中の枠と、読み込んだ後の画像が同じ大きさになり、ずれない。
- 画面のエラー・警告(`pageerror` とコンソールの error・warning)は、両方のブラウザで 0 件。

### Firefox の貼り付けの届き先

- Clipboard API の仕様(「fire a clipboard event」)は、編集できる文脈では選択範囲かカーソルのある要素(無ければ body)に、編集できない文脈ではフォーカスのある要素(無ければ body)に届けるとしている(2026-09-24 に確認)。Chromium はそのとおりだった。Firefox 155 は、フォーカスのあるボタンではなく、body か選択範囲のある要素に届けた(編集できる文脈と同じ選び方)。根拠: 仕様は外部ドキュメントのみ、ブラウザの挙動は実測のみ
- 部品の対処: `paste` を `document` で受け、`event.target` か `document.activeElement` がドロップゾーンの中なら扱う。ファイルを取り出せないのに `types` に `Files` があるときは、何もしないのではなく「読み取れませんでした」と知らせる(既定の動作は止める。Firefox では、選択範囲の残った別の編集欄に何かが入るのを防ぐ)。
- 実際の(ヘッドレスでない)Firefox で、画像を貼り付けて `getAsFile()` で読めるかは確かめていない。ヘッドレスでない起動は、利用者の macOS のクリップボードを書き換えるので行わなかった。Firefox の実物での確認は、手で行うか、[[T31-e2e|T31]] で Chromium だけを対象にする。

### クリックとフォーカス

- Playwright のクリックでは、Chromium も Firefox もボタンにフォーカスが移った。根拠: 実測のみ
- MDN の `<button>` の「Clicking and focus」は、クリックでボタンにフォーカスが移るかはブラウザと OS で違い、ほとんどのブラウザは移すが Safari は移さない、としている(2026-09-24 に確認)。根拠: 外部ドキュメントのみ
- 部品の対処: どのブラウザでも同じになるよう、ドロップゾーンのボタンは押されたときに自分で `focus()` する。ファイルの選択を閉じたあとで ⌘V を押すと、貼り付けを受け取れる。jsdom の `fireEvent.click`(フォーカスを動かさない)で確かめた。

## 後続タスクへの影響

| タスク | 内容 |
|---|---|
| [[T27-image-widget\|T27]] / [[T28-gallery-widget\|T28]] | 貼り付けは、ドロップゾーンのボタンにフォーカスがあるとき(またはイベントの対象が枠の中のとき)だけ受け取る。ページのどこでも受け取る形にはしていない(画像のフィールドが複数あると、どこに入るか分からないため) |
| [[T31-e2e\|T31]] | Firefox では、合成した `ClipboardEvent` の `clipboardData` が空になり、ヘッドレスのクリップボードの画像も読めない。貼り付けの E2E は Chromium で行う(`context.grantPermissions(["clipboard-read", "clipboard-write"])` と、クリックの中での `navigator.clipboard.write` で画像を入れ、ボタンにフォーカスして `ControlOrMeta+V`)。ドロップは両方のブラウザで `dispatchEvent("drop", { dataTransfer })` で試せる |

## 再現手順

1. `spikes/widget-parts/`(git 管理外)に、部品を並べて描く `harness.tsx` と `index.html` を置く。`index.html` は管理画面と同じく `<html lang="ja" data-theme="classic" data-mode="light">` にし、`node_modules/@emdash-cms/admin/dist/styles.css` を写したものを読む。
2. worktree のルートでまとめる(Kumo は `process.env.NODE_ENV` を読むので定義する。テスト用の WebP は data URL にする)。

```sh
./node_modules/.bin/esbuild spikes/widget-parts/harness.tsx --bundle --format=iife --platform=browser \
  --jsx=automatic --loader:.webp=dataurl '--define:process.env.NODE_ENV="development"' \
  --outfile=spikes/widget-parts/harness.js
```

3. `127.0.0.1:4422` で配る小さな静的サーバー(`node:http`)を起動し、Playwright(`@playwright/test` の `chromium` / `firefox`)で開く。クリップボードの読み書きは `localhost` / `127.0.0.1` の安全な文脈で行う。
4. 貼り付けの確かめ方。画像は、ページを開いたときに canvas で PNG の Blob を作っておき、ボタンのクリック(利用者の操作)の中で書く。

```js
// harness.tsx(抜粋): クリックの中でクリップボードに画像を入れる
navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
// window の capture で、届いた要素と中身を記録する
window.addEventListener("paste", (event) => {
	const data = event.clipboardData;
	log.push({
		target: event.target.tagName,
		active: document.activeElement?.tagName,
		files: data.files.length,
		items: Array.from(data.items).map((item) => `${item.kind}:${item.type}:${item.getAsFile()?.size ?? null}`),
	});
}, true);
```

```js
// check.mjs(抜粋)
if (name === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
await page.click("#copy-image");
await page.focus("#zone-single");
await page.keyboard.press("ControlOrMeta+V");
// ドロップ: 本物の DataTransfer を作って渡す
const dt = await page.evaluateHandle(() => {
	const transfer = new DataTransfer();
	transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "drop.png", { type: "image/png" }));
	return transfer;
});
await page.locator("#zone-single").locator("..").dispatchEvent("drop", { dataTransfer: dt });
// キーボードでファイルの選択を開く
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
await chooser.setFiles({ name: "enter.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
```

5. Chromium のアクセシビリティツリーは、CDP の `Accessibility.getFullAXTree` で読む(`context.newCDPSession(page)`)。
6. 終わったらサーバーを止め、`lsof -nP -iTCP:4422 -sTCP:LISTEN` で何も出ないことを確かめる。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、Playwright 1.63.0(Chromium 153.0.8010.12・Firefox 155.0、どちらもヘッドレス)、esbuild 0.28.2、React 19.2.4、`@cloudflare/kumo` 2.6.0、`@emdash-cms/admin` 0.39.1。2026-09-24 に計測。
