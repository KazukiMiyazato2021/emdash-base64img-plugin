---
title: jsdom でブラウザ側の画像処理をテストするときの注意(canvas・createImageBitmap・AbortSignal・Blob)
aliases:
  - jsdom のブラウザ API の抜け
  - jsdom で canvas を使う処理のテスト
tags:
  - docs
  - test
  - vitest
  - jsdom
source_task: "[[T13-encode-search]]"
created: 2026-09-24
updated: 2026-09-24
---

# jsdom でブラウザ側の画像処理をテストするときの注意(canvas・createImageBitmap・AbortSignal・Blob)

> [!summary] 要点
> - vitest 4.1.11 + jsdom 30.1.0(`tests/admin/**`・`tests/client/**`)には、`createImageBitmap`・`ImageBitmap`・`OffscreenCanvas` が無い。`HTMLCanvasElement` の `getContext` は `null`、`toBlob` はコールバックを呼ばない(どちらも "Not implemented" を出す)。**canvas を使う部分は、関数を差し替えられるように作り、偽物でテストする。** 根拠: 実測のみ
> - `Blob` は jsdom のもので、`arrayBuffer()` / `text()` がある。`type` は小文字になる。根拠: 実測のみ
> - `AbortController` / `AbortSignal` は Node のもの。`abort()` の既定の `reason` は Node の `DOMException` なので、jsdom の `DOMException` に対する `instanceof` は `false` になる。**比べるときは `toBe(signal.reason)` か `name === "AbortError"` を使う。** 根拠: 実測のみ
> - [[T13-encode-search|T13]] の単体テストは、偽のエンコーダーで探索の結果・縮小の回数・エラー・キャンセル・サイズの逆転を確かめた。わざと入れた不具合 45 種類がすべてテストで見つかった。根拠: 実測のみ
> - 関連: [[test-lint-setup]]、[[T12-input-decode|T12]]、[[T23-upload-hook|T23]]、[[compress-image-browser-check]]

## jsdom の環境で使える API

`tests/client/` の中でテストを 1 つ動かして調べた(vitest 4.1.11、jsdom 30.1.0、Node 26.10.0)。根拠: **実測のみ**

| API | 結果 | テストでの扱い |
|---|---|---|
| `createImageBitmap` / `ImageBitmap` / `OffscreenCanvas` | 無い(`typeof` が `"undefined"`) | 関数を引数などで差し替える。呼ぶと `ReferenceError` になる |
| `HTMLCanvasElement#getContext("2d")` | `null` を返し、"Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package" を出す | canvas を作る関数を差し替える |
| `HTMLCanvasElement#toBlob` | 関数はあるが、コールバックを呼ばない("Not implemented" を出す) | そのまま待つと終わらない。canvas ごと偽物にする |
| `Blob` | jsdom の実装。`arrayBuffer()` / `text()` がある。`new Blob([…], { type: "IMAGE/WebP" }).type` は `"image/webp"` | 偽のエンコーダーの戻り値に使える |
| `AbortController` / `AbortSignal` | Node の実装。`throwIfAborted()`・`AbortSignal.any()`・`AbortSignal.timeout()` がある | そのまま使える |
| `abort()` の既定の `reason` | `name` は `"AbortError"`。ただし `reason instanceof DOMException`(jsdom の `DOMException`)は `false` | `toBe(signal.reason)` か `toMatchObject({ name: "AbortError" })` で比べる |
| `Uint8Array.prototype.toBase64` / `Uint8Array.fromBase64` | ある(Node 26) | `src/shared/data-url.ts` はそのまま動く |
| `FileReader` / `Response` | ある | — |

- canvas の npm パッケージ(`canvas`)を入れると `getContext` が使えるようになるが、ネイティブのビルドが要り、利用者の `~/.npmrc` の `ignore-scripts=true` と合わない。入れていない(推測のみ)。

## T13 のテストで使った方法

`tests/client/encode.test.ts` の方法。[[T12-input-decode|T12]]・[[T23-upload-hook|T23]] など、ブラウザ側の処理をテストするタスクでも使える。

### ブラウザに依存する部分を薄くして、差し替える

- 探索と縮小の判断(`searchWithinBudget`)は、エンコーダー(`WebpEncoder`)を受け取る純粋なロジックにした。`compressImage` / `createThumbnail` は `options.encoder` で偽物に差し替えられる。T23 のフックのテストでも、`encoder` を渡せば jsdom で動く。
- canvas のエンコーダー(`createCanvasWebpEncoder`)は、`createImageBitmap` と canvas を作る関数を引数で受け取る。テストでは偽物を渡し、`resizeQuality: "high"` で縮小すること、`drawImage(resized, 0, 0)` で 1:1 に描くこと、`toBlob` に `"image/webp"` と画質を明示することを確かめた。
- `encoder` を省略して jsdom で呼ぶと、`createImageBitmap` が無いので `ENCODE_FAILED` になる(`ReferenceError` を `cause` に持つ)。

### 偽のエンコーダーで「エンコードし直さない」ことを確かめる

偽のエンコーダーが返す Blob の先頭 4 バイトに、呼び出しの番号を入れた。結果の data URL をデコードして番号を読めば、採用された Blob が何回目のエンコードのものかがわかる。「収まった Blob を保持し、最後にエンコードし直さない」ことを、呼び出しの回数と合わせて確かめられる。

```ts
const encoder: WebpEncoder = async ({ width, height, quality }) => {
	calls.push({ width, height, quality });
	const bytes = new Uint8Array(sizeOf({ width, height, quality }));
	new DataView(bytes.buffer).setUint32(0, calls.length, true);
	return new Blob([bytes], { type: "image/webp" });
};
// 結果の data URL から番号を読む
const decoded = decodeWebpDataUrl(result.dataUrl);
const callNumber = new DataView(decoded.bytes.buffer, decoded.bytes.byteOffset).getUint32(0, true);
```

### サイズの逆転と、ランダムなケース

- 実際のエンコーダーは、画質を 0.01 上げてもサイズが減ることがある(T05 で最大 158 B)。偽のエンコーダーに逆転を入れて、収まらない Blob を採用しないこと、逆転で二分探索が真の最高画質を見逃しても収まった画質を返すことを確かめた。
- 種を決めた乱数(mulberry32)で、画像の寸法・options・サイズのモデルを 200 通りずつ作った。サイズを ±4% 揺らしたケースでは、画質の範囲・長辺の順番・長辺ごとの回数・採用した Blob が収まっていることを確かめた。揺らさないケースでは、全探索の答えと一致することを確かめた。大きな Blob を同時に作らないよう、1 件ずつ実行した(200 通りで 42〜57ms)。

### キャンセルの確かめ方

| 段階 | 方法 |
|---|---|
| 始める前 | 中断済みの signal を渡す。エンコーダーも進捗も呼ばれない |
| エンコードの途中 | 終わらない Promise を返すエンコーダーにして、呼ばれたあとで中断する。完了を待たずに reject する |
| 進捗の中 | `onProgress` の中で中断する。そのエンコードは始まらない |
| 結果を見ている間 | 偽の Blob の `size` を、読むと中断する getter にする(`Object.defineProperty`)。次の進捗もエンコードも無い |
| data URL の読み込み | 偽の Blob の `arrayBuffer()` を終わらない Promise にして、`setTimeout` で中断する |
| canvas の縮小・`toBlob` | 偽の `createImageBitmap` を `Promise.withResolvers()` で止めておき、中断してから値を渡す。あとで届いた ImageBitmap が `close()` されることも確かめる |

### テストが実際の不具合で失敗するかを確かめる

ソースに不具合を 1 つずつ入れてテストを実行するスクリプト(scratchpad に置いた使い捨てのもの)で、45 種類すべてがテストの失敗になった。例: 下限で収まらなくても探索を続ける / 最後に試した Blob を採用する / 予算の比較を `<` にする / 縮小を切り捨てにする / 拡大する / `resizeQuality` を `medium` にする / canvas に縮めて描く / 縮小した ImageBitmap を閉じない / Blob の type を確かめない / 各段階の中断の確認を外す / サムネイルを縮めない。根拠: **実測のみ**

- はじめは「エンコーダーの後の中断の確認」が生き残った。調べると、`abortable`(待たずに reject する)と次の段階の確認があるので冗長だった。消して、確認は意味のある場所だけにした。
- 利用者の中断(ボタンのクリック)は別のタスクで届くので、`await` の間(マイクロタスク)には割り込まない。待っている非同期処理(`toBlob`・`createImageBitmap`・`Blob#arrayBuffer`)で中断に応えれば足りる(推測のみ。HTML のイベントループの仕組みからの推論)。
