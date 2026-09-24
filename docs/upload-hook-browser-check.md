---
title: アップロードのフック(T23)を Chromium 153・Firefox 155 で動かした結果(描画を待ってからデコードする・デコード中のキャンセル・送る値)
aliases:
  - アップロードのフックのブラウザでの確認
  - 読み込み中の表示を描画してからデコードする方法
  - requestAnimationFrame を 2 回待つ理由
tags:
  - docs
  - browser
  - react
  - firefox
source_task: "[[T23-upload-hook]]"
created: 2026-09-24
updated: 2026-09-24
---

# アップロードのフック(T23)を Chromium 153・Firefox 155 で動かした結果(描画を待ってからデコードする・デコード中のキャンセル・送る値)

> [!summary] 要点
> - 状態を「読み込み中…」(`decoding`)にしてからデコードを始めるまでに、**`requestAnimationFrame` を 2 回重ねて待ち、2 回目の中の `setTimeout(0)` で始める**と、30 回とも「読み込み中…」のコミットのあとのフレームが先に来た。**1 回だけでは 30 回のうち 20 回で、デコードのほうが先に始まった**(React がコミットする前にフレームが来る)。根拠: 実測のみ
> - Firefox 155 は、8000 × 6000 の JPEG のデコード(約 57ms)と、それに続く縮小(`createImageBitmap` の `resizeWidth`。約 60ms)の間、主スレッドを止めた(タイマーの間隔の最大 117〜120ms)。デコードを始めて 20ms 後のキャンセルは、縮小のあとに届いた。それでも結果は `cancelled`、状態は `idle` で、デコードした画像は閉じられた。Chromium 153 は止めず、キャンセルは 1ms 以内に状態に反映された。根拠: 実測のみ
> - 送った要求(3 つの構成で計 36 件)は、どれもサーバーと同じ検証(① `validateUpload`)を通り、結果の画像エントリは ② `validateImageEntry` を通った。`target` には URL の `entryId` と `?locale=ja` が入り、`X-EmDash-Request: 1` が付いた。根拠: 実測のみ
> - ギャラリーに JPEG・HEIC・PNG を渡すと、HEIC は 1〜2ms で `INPUT_HEIC_REJECTED` になり、残りの 2 枚を 1 枚ずつ送った。根拠: 実測のみ
> - 関連: [[T23-upload-hook]]、[[input-image-decode]](Firefox がデコードの間に主スレッドを止めること)、[[compress-image-browser-check]]、[[react-hook-testing-pitfalls]]

## 環境と手順

| 項目 | 値 |
|---|---|
| マシン | Apple M5 Pro、macOS 26.4(Darwin 25.4.0) |
| Node / Playwright | 26.10.0 / 1.63.0(すべてヘッドレス) |
| Cr-SW | Chromium 153.0.8010.12(`chromium.launch()`。headless shell) |
| Cr-GPU | Chromium 153.0.8010.12(`chromium.launch({ channel: "chromium" })`) |
| Fx | Firefox 155.0(`firefox.launch()`)。`performance.now()` は 1ms 単位 |
| React | 19.2.4(esbuild 0.28.2 で本番用にまとめた) |

- `spikes/upload-hook/`(git 管理外)。`src/admin/hooks` の `useUploadTarget`・`useImageUpload`・`useUploadQueue` をそのまま使う部品を、esbuild でまとめて読み込んだ。
- 管理画面とアップロード用ルートは Playwright の `page.route` で偽物にした(サーバーは起動していない)。ページの URL は `http://localhost:4423/_emdash/admin/content/posts/<ULID>?locale=ja`。偽のルートは、送られた body を `uploadRequestSchema` とサーバーと同じ `validateUpload`(`cover` は単一画像、`gallery` はギャラリーの widget のフィールド)で確かめ、`{ success: true, data: { ref } }` を返す。
- 画像はページの中で canvas に描いて作った(グラデーションと、乱数の四角形 3,000 個)。JPEG は画質 0.9。
- `createImageBitmap`(引数が Blob ならデコード、ImageBitmap なら縮小)と `fetch` を包んで時刻を記録した。状態のコミットは `useLayoutEffect` で記録し、`decoding` をコミットしたときに `requestAnimationFrame` で「コミットのあとの最初のフレーム」を記録した。

```tsx
// 状態のコミットと、そのあとの最初のフレームを記録する(spikes/upload-hook/entry.tsx の一部)
const status = upload.state.status;
useLayoutEffect(() => {
	log(`single:${status}`);
	if (status === "decoding") {
		requestAnimationFrame(() => log("frame-after-decoding-commit"));
	}
}, [status]);
```

## 1. 「読み込み中…」を描画してからデコードする

4000 × 3000 の JPEG を 1 枚ずつ、描画の待ち方を変えて 10 回ずつアップロードした(2 回の実行の合計)。「先に描画」は、コミットのあとの最初のフレームがデコードの開始より先だった回数。根拠: **実測のみ**

| 待ち方 | Cr-SW | Cr-GPU | Fx |
|---|---|---|---|
| `requestAnimationFrame` 1 回 → `setTimeout(0)`(T23 の最初の実装) | 先に描画 5 / 10 | 4 / 10 | 1 / 10 |
| `requestAnimationFrame` 2 回 → `setTimeout(0)`(今の `waitForPaint`) | 10 / 10 | 10 / 10 | 10 / 10 |
| 2 回のときの、コミットからデコードの開始まで | 1.9〜31.6ms | 0.8〜34.3ms | 0〜9ms |

- 1 回だけのときに描画が間に合わないのは、`upload(file)` の中で状態を変えた(`setState`)直後に `requestAnimationFrame` を登録し、React のコミットより先にそのフレームが来るため。そのフレームのコールバックの中の `setTimeout(0)` でデコードを始めると、コミットされた「読み込み中…」はまだ描画されていない。
- 2 回にすると、1 回目のフレームのあとに React がコミットし、2 回目のフレームで描画されてからデコードを始める。1 回目のフレームより前にコミットしていても、2 回目のフレームのあとに始めるので同じ。
- Firefox では、このあとのデコードと縮小の間、主スレッドが止まる(下の 2)。先に描画しないと、その間は「読み込み中…」が出ない。
- 1 枚の処理(4000 × 3000 の JPEG → 1600 × 1200 の WebP、送信まで)は、Chromium で 424〜494ms、Firefox で 454〜567ms。

```ts
// src/admin/hooks/process-image.ts の waitForPaint(背景のタブでは 100ms で打ち切る)
requestAnimationFrame(() => {
	requestAnimationFrame(() => {
		setTimeout(finish, 0);
	});
});
```

## 2. デコード中のキャンセル

8000 × 6000 の JPEG(1.3〜3.1MB)で、デコードを始めてから 0ms / 20ms 後に `cancel()` した。「最大の間隔」は、並行して回した `setTimeout(0)` の間隔の最大(主スレッドが止まった時間の目安)。根拠: **実測のみ**

| 構成 | 0ms 後 | 20ms 後 |
|---|---|---|
| Cr-SW | キャンセルはデコードの開始の直後(0.1ms 以内)に届き、0.5ms 後に状態が `idle` になった。デコードはその 47ms 後に終わり、届いた ImageBitmap は閉じられた。最大の間隔 6ms | キャンセルは 20.7ms 後に届いた。デコードの終わりはその 26ms 後。閉じられた。最大の間隔 5ms |
| Cr-GPU | 同じ(デコードは 46ms) | 同じ |
| Fx | キャンセルは、主スレッドが止まる前に届いた。デコード(57ms)の間に 60ms 止まり、届いた ImageBitmap は閉じられた | デコード(57ms)が終わると、すぐ縮小が始まった(キャンセルはまだ届いていない)。縮小の間も止まり、キャンセルはデコードの開始から 120ms 後に届いた。最大の間隔 120ms(1 回目の実行では 117ms)。結果は `cancelled`、デコードした画像は閉じられた |

- どの構成でも、`upload` の結果は `cancelled`、状態は `idle`、デコードした ImageBitmap は幅 0(閉じられた)になった。
- Firefox では、デコードが終わったときの中断の確認(`processImageFile` の `signal.throwIfAborted()`)にも間に合わなかった。デコードの完了から縮小の開始までは Promise の続き(マイクロタスク)で進み、その間にタイマーは動かないため。中断は、縮小のあとの `compressImage` の確認で見つかり、`finally` で画像が閉じられた。
- Firefox で `createImageBitmap(file)` を呼んだ直後は、主スレッドは止まらず、0ms 後のキャンセルは止まる前に届いた。止まるのは、そのあと(ファイルを読み終えて画素を作る間とみられる。推測のみ)。[[input-image-decode]] の「Firefox はデコードの間、主スレッドを止める」と合う。
- Firefox は、[[T13-encode-search|T13]] の縮小(`createImageBitmap(ImageBitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })`)でも、主スレッドを止めた(8000 × 6000 から 1600 × 1200 で約 60ms)。

## 3. 送った値

根拠: **実測のみ**

| 項目 | 結果 |
|---|---|
| `target` | `{ collection: "posts", field: "cover" \| "gallery", entryId: <URL の ULID>, locale: "ja" }` |
| ヘッダー | `X-EmDash-Request: 1` |
| 4000 × 3000 の JPEG | 1600 × 1200、画質 0.78〜0.83、保存サイズ 97,291〜99,699 バイト、WebP 72,950〜74,756 バイト、サムネイル 96 × 72(7,127〜7,447 バイト) |
| 3000 × 2000 の JPEG / 1200 × 900 の PNG(ギャラリー) | 1600 × 1067 / 1200 × 900、サムネイル 96 × 64 / 96 × 72 |
| サーバーと同じ検証 | ① `validateUpload` は 36 件すべて `ok`。② `validateImageEntry`(結果の `entry`)もすべて通った |
| `filename` | ファイル名のまま(`generated-4000x3000.jpg`) |

## 4. ギャラリー(`useUploadQueue`)

JPEG(3000 × 2000)・HEIC(ヘッダーだけ)・PNG(1200 × 900)を 1 回で渡した。根拠: **実測のみ**

- HEIC は 1〜2ms で `error`(`INPUT_HEIC_REJECTED`)になった。1 枚目の JPEG のデコードが始まる前(9〜30ms)だった。
- JPEG の送信が終わってから、PNG のデコードを始めた(同時に処理するのは 1 枚)。
- 終わったときの数は `finishedCount: 2`・`uploadedCount: 2`・`pendingCount: 0`。一覧には HEIC の失敗だけが残った。
- 段階は `decoding → compressing → thumbnail → uploading` の順にコミットされた。`thumbnail` のコミットから `uploading` のコミットまでは 2〜4ms。
