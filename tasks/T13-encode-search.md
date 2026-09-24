---
id: T13
title: "リサイズ・画質探索・サムネイル生成を作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T04-webp-utils]]"
soft_depends_on:
  - "[[T05-spike-canvas-webp]]"
blocks:
  - "[[T23-upload-hook]]"
files:
  - "src/client/encode.ts"
  - "src/client/thumbnail.ts"
  - "tests/client/encode.test.ts"
spec:
  - "[[base64-image-plugin-spec#6.1 エンコード方式]]"
  - "[[base64-image-plugin-spec#6.2 サイズ予算(Q6)]]"
  - "[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)]]"
  - "[[base64-image-plugin-spec#6.4 サムネイル]]"
tags:
  - task
  - impl
  - client
created: 2026-09-23
---

# T13 リサイズ・画質探索・サムネイル生成を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T04-webp-utils|T04]]
> - 結果を後で反映する(着手はブロックしない): [[T05-spike-canvas-webp|T05]]
> - このタスクを待つもの: [[T23-upload-hook|T23]]
> - 仕様: [[base64-image-plugin-spec#6.1 エンコード方式|仕様書 6.1]]、[[base64-image-plugin-spec#6.2 サイズ予算(Q6)|仕様書 6.2]]、[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)|仕様書 6.3]]、[[base64-image-plugin-spec#6.4 サムネイル|仕様書 6.4]]

## 目的

仕様書 6.1〜6.4 のエンコード処理を作る。

## 作業内容

- [x] 長辺を `maxEdge` 以下に縮小する(拡大しない)。縮小は `createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })` で行い、同じ大きさの canvas に 1:1 で描いてから `toBlob` する(仕様書 6.3、[[T05-spike-canvas-webp#結果|T05]])
- [x] 画質 `minQuality`〜0.92 の探索で、`maxStoredBytes` に収まる最高の画質を選ぶ。順番は `minQuality` → 0.92 → 0.01 刻みの二分探索。画質は必ず範囲内の値を明示する。収まった Blob を保持し、最後にエンコードし直さない(仕様書 6.3、[[T05-spike-canvas-webp#結果|T05]])
- [x] 収まらなければ 0.8 倍に縮小して再試行し、長辺が `minEdge` を下回ったらエラーにする
- [x] Blob の type が `image/webp` でなければ、非対応ブラウザとしてエラーにする(Safari)
- [x] サムネイル生成(長辺 96px 程度、data URL の長さで 8,000 バイト以下 = WebP 本体で 5,982 バイト以下。仕様書 6.4、[[T03-shared-contracts#結果|T03]])
- [x] テストのため、エンコーダーを差し替えられるようにする
- [x] キャンセル(`AbortSignal`)に対応する

## 完了条件

- [x] 単体テスト: 偽のエンコーダーで、探索の結果・縮小の回数・エラーになる条件を確認する。偽のエンコーダーには、画質を上げるとサイズがわずかに減る箇所も入れる(実際のエンコーダーは完全には単調でない。[[T05-spike-canvas-webp#結果|T05]])
- [x] [[T05-spike-canvas-webp|T05]] の結果を反映した(既定値は変えない。縮小の方法と探索の順番は上の作業内容のとおり。[[T05-1-spec-browser-results|T05-1]] でノートに反映済み)

## 変更してよいファイル

- `src/client/encode.ts`
- `src/client/thumbnail.ts`
- `tests/client/encode.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ(2026-09-24)
> - `src/client/encode.ts`(縮小・画質の探索・canvas のエンコーダー)と `src/client/thumbnail.ts`(サムネイル)を作った。[[T03-shared-contracts|T03]] の `pipeline.ts` の形(`CompressImage` / `CreateThumbnail` / `WebpEncoder` / `CompressProgress`)をそのまま使い、T03・T04 のファイルは変更していない。
> - 単体テストは `tests/client/encode.test.ts` の 62 件。わざと入れた不具合 45 種類がすべてテストで見つかった。
> - 実ブラウザ(Chromium 153・Firefox 155)でも動かし、写真 5 枚の結果が T05 の表と長辺・画質・エンコード回数まで一致した([[compress-image-browser-check]])。
> - 仕様の未決事項を 3 つ決め、仕様書 6.3・6.4 に書いた([[#仕様書の変更]])。

### T23 が使う export

| ファイル | export | 内容 |
|---|---|---|
| `src/client/encode.ts` | `compressImage` | `CompressImage` の実装。`(image: ImageSource, options: CompressOptions) => Promise<CompressionResult>` |
| `src/client/thumbnail.ts` | `createThumbnail` | `CreateThumbnail` の実装。`(image: ImageSource, options?: ThumbnailOptions) => Promise<ThumbnailResult>` |
| `src/client/encode.ts` | `createCanvasWebpEncoder(environment?)` | 既定の `WebpEncoder`。`compressImage` / `createThumbnail` は `encoder` を省略すると、呼び出しごとにこれを作る。型 `CanvasEncoderEnvironment` / `EncoderCanvas` / `EncoderCanvasContext` |
| `src/client/encode.ts` | `abortable(promise, signal, discard?)` | 止められない Promise を、中断されたら待たずに `signal.reason` で reject する補助 |
| `src/client/thumbnail.ts` | `THUMB_MIN_EDGE`(48)、`THUMB_MIN_QUALITY`(0.6) | サムネイルの縮小の下限と画質の下限 |
| `src/client/encode.ts` | `searchWithinBudget`、`readWebpDataUrl`、`edgeSequence`、`fitLongEdge`、`qualityLadder`、型 `BudgetSearchParams` / `BudgetSearchContext` / `BudgetFit` / `BudgetSearchOutcome` / `QualityLadder` | 内部の部品(thumbnail.ts とテストが使う)。T23 は使わなくてよい |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | `WebpEncoder` には、元の画像(`source`)と目標の寸法を毎回渡す。canvas のエンコーダーは、直前と同じ `source`・寸法なら描いた canvas を使い回し、縮小(`createImageBitmap`)を長辺ごとに 1 回にする | `pipeline.ts` の「`source` 全体を `width` × `height` に縮めて描く」の形を変えずに、同じ長辺で画質だけを変える探索で縮小を繰り返さないため。偽のエンコーダーは寸法と画質だけでサイズを決めればよい | 設計判断。縮小が長辺ごとに 1 回なことは実測のみ(偽物の `createImageBitmap` の呼び出し回数) |
| 2 | `compressImage` は options を `normalizeFieldOptions` で丸めてから使う | サーバーの検証と同じ上限(固定上限 500,000 など)にするため。丸めずに 900,000 を渡すと、サーバーが拒否する 500,003 バイトを作ってしまう(テストで確認) | 実測のみ |
| 3 | 画質の候補は `minQuality` と、それより大きい 0.01 刻みの値(0.92 まで)。`minQuality` が 0.01 刻みでなくても(例: 0.655)、最初はその値を試す。浮動小数点の誤差で同じ画質を 2 回試さない | 仕様書 6.3 の順番(`minQuality` → 0.92 → 0.01 刻みの二分探索)どおり。範囲外の画質は渡さない | 設計判断 |
| 4 | 次の長辺は `round(長辺 × 0.8)`(少なくとも 1px は縮める)。ちょうど `minEdge` の長辺は試す。最初の長辺は `min(maxEdge, 元の長辺)` で、元の長辺が `minEdge` より短い画像も元の大きさで 1 回は試す | 仕様書 6.3 に丸め方と小さい画像の扱いが無かった。T05 の探索と同じ列(1600 → 1280 → 1024 → 819 → 655 → 524)になる。524 の次(419)は試さず、`minEdge` の 480 に切り詰めた長辺も試さない(仕様書の「下回ったらエラー」のとおり) | 設計判断(仕様書 6.3 に追記) |
| 5 | サムネイルは本体と同じ探索を、固定の条件(保存 8,000 バイト、長辺 96px、画質 0.60〜0.92、縮小の下限 48px)で行う。収まらなければ `THUMB_OVER_BUDGET` | 仕様書 6.4 に画質の決め方が無かった。T05 の写真は 96px・0.92 で最大 3,288 B なので、通常は 2 回で 0.92 に決まる。細かい透過のノイズなど 96px で収まらない画像でもアップロードできるよう、縮小して試す。48px は `THUMB_EDGE` の半分(一覧の表示の大きさ程度) | 48px は推測のみ。ほかは実測のみ(実ブラウザで 96×64・1,531〜4,407 バイト) |
| 6 | エラー: `COMPRESSION_OVER_BUDGET` の `details` は `maxStoredBytes` / `minEdge` / `minQuality` / `lastEdge` / `lastStoredBytes` / `attempts`。`THUMB_OVER_BUDGET` は `maxStoredBytes` / `lastEdge` / `lastStoredBytes` / `attempts`。`BROWSER_UNSUPPORTED` は `type`。エンコーダーの失敗・`toBlob` の null・2D コンテキストが無い・寸法が不正・Blob の読み込みの失敗は `ENCODE_FAILED`(元のエラーは `cause`)。エンコーダーが投げた `Base64ImageError` はそのまま | ブラウザ側のエラーは `details` が画面まで届くので、上限の値を文言に入れられる([[T14-admin-i18n-api\|T14]]) | 設計判断 |
| 7 | Blob の type は、エンコードのたびに確かめる。`image/webp` でなければ、1 回目で `BROWSER_UNSUPPORTED` にする | 仕様書 6.1。Safari は PNG を返す | 外部ドキュメントのみ(caniuse)。検出はテストで確認 |
| 8 | 予算の判定は `blob.size`(Chromium の `VP8X` + `ICCP` の 482 B を含む)と `maxWebpBytesForBudget(maxStoredBytes)` で比べる。data URL は採用した Blob から 1 回だけ作る | T05 の申し送り 4・5 | 実測のみ(T05) |
| 9 | 中断: 入口・各回の前(中断のあとは進捗も出さない)・エンコーダーを呼ぶ直前(`onProgress` の中の中断)で確かめる。`toBlob`・`createImageBitmap`・エンコーダー・`Blob#arrayBuffer` は `abortable` で包み、完了を待たずに `signal.reason` で reject する。中断のあとに届いた ImageBitmap は閉じる | 仕様書 11.2 の[キャンセル]にすぐ応えるため。実ブラウザでは中断から 0.4ms 以内に reject した | 実測のみ |
| 10 | 進捗は、エンコードの直前に毎回 `{ width, height, quality, attempt }` を渡す | 画面の「圧縮中… 1280px / 画質 0.74」は、`Math.max(width, height)` と `quality` で作れる | 設計判断 |
| 11 | canvas のエンコーダーは、画質が 0〜1 の有限の数でなければ `RangeError` にする | 省略や範囲外はブラウザの既定値(Chromium 0.80、Firefox 0.92)になる | 実測+公式ドキュメント(T05) |

### 確かめたこと

- 単体テスト(`tests/client/encode.test.ts`、62 件): 探索の順番と結果、0.92 で収まる場合、エンコードし直さないこと(採用した Blob の番号を data URL から読む)、画質の範囲、`minQuality` が 0 / 0.655 / 0.92 の場合、保存サイズの境界(74,982 / 74,983 B、サムネイルは 5,982 / 5,983 B)、縮小の回数と長辺の列、拡大しないこと、縦長、`minEdge` より小さい画像、options の丸め、サイズの逆転(収まらない Blob を採用しない / 見逃しても収まった画質を返す)、ランダムな 400 通り(逆転ありは不変条件、逆転なしは全探索と一致)、エラー(Safari・エンコーダーの失敗・不正な寸法・jsdom での既定のエンコーダー)、キャンセル(始める前・エンコード中・結果を見ている間・`onProgress` の中・data URL の読み込み中・縮小中・`toBlob` 中)、進捗、canvas のエンコーダーの呼び方(偽の `createImageBitmap` と canvas)。根拠: **実測のみ**
- テストが実際の不具合で失敗するか: ソースに不具合を 1 つずつ入れて実行し、45 種類すべてでテストが失敗した(手順と一覧は [[jsdom-browser-api-gaps#テストが実際の不具合で失敗するかを確かめる]])。はじめは「エンコーダーの後の中断の確認」が生き残った。ほかの確認と重なって冗長だったので消した。根拠: **実測のみ**
- 実ブラウザ(Chromium 153 のソフトウェア描画・GPU 描画、Firefox 155): 写真 5 枚の長辺・画質・エンコード回数が T05 の表と一致した。1 枚 137〜473ms、サムネイルは 1〜9ms。中断は 0.4ms 以内に reject した。透過は保持された。詳細は [[compress-image-browser-check]]。根拠: **実測のみ**
- `npm run verify`: build(tsc と playground のビルド)・lint(oxlint・prettier)・test(5 ファイル 369 件)がすべて通った。

### 仕様書の変更

- 6.3 の手順 4: 縮小した長辺は四捨五入すること(既定の長辺の列)を書いた(決定 4)。
- 6.3 の手順 5: 元の長辺が `minEdge` より短い画像は、元の大きさで 1 回だけ探索することを書いた(決定 4)。
- 6.4: サムネイルの画質の決め方と、収まらないときの縮小(48px まで)とエラーを書いた(決定 5)。

### 後続タスク向けのメモ

| タスク | メモ |
|---|---|
| [[T23-upload-hook\|T23]] | `compressImage(decoded, { ...normalizeFieldOptions(field.options), signal, onProgress })` と `createThumbnail(decoded, { signal })` を呼ぶ。`DecodedImage`([[T12-input-decode\|T12]])は `ImageSource` を満たすのでそのまま渡せる。`encoder` を省略すれば 2 つは別々の canvas を使うので、同時に呼んでもよい(`createCanvasWebpEncoder()` で作ったエンコーダーを渡すときは、同時に動く 2 つに同じものを渡さない)。終わったら `decoded.close()`。アップロードには `result.dataUrl` / `thumb.dataUrl` / `result.width` / `result.height` / `result.quality` を入れる。テストでは `encoder` に偽物を渡す(jsdom で `encoder` を省略すると `ENCODE_FAILED`)。中断は `signal.reason`(既定は `name` が `"AbortError"`)で reject するので、エラー表示と区別する |
| [[T14-admin-i18n-api\|T14]] / [[T27-image-widget\|T27]] | 進捗の表示は `Math.max(progress.width, progress.height)` と `progress.quality`(小数第 2 位まで)。`COMPRESSION_OVER_BUDGET` の文言には `details.maxStoredBytes` などを使える |
| [[T31-e2e\|T31]] | 採用される長辺・画質は、ブラウザで変わる(Firefox は p4 が 1024px、Chromium は 1280px)。E2E では値を固定しない(T05 と同じ)。Safari の検出は、単体テストで「PNG を返す偽の `toBlob`」で確かめてある |
| [[T12-input-decode\|T12]] ほか | jsdom の環境で使える API と、テストでの差し替え方は [[jsdom-browser-api-gaps]] |

### 未解決・サブタスクの候補

- なし(T03・T04 の形を変える必要は無かった)。
- 参考: canvas から作った ImageBitmap を縮小すると、Chromium の GPU 描画ではノイズが残りやすく、乱数ノイズの画像が 524px でも収まらなかった(ソフトウェア描画と Firefox は 655px で収まった)。ファイルからデコードした写真では差が無かったので、対応は要らないと考える(推測のみ。[[compress-image-browser-check#乱数ノイズ]])。
