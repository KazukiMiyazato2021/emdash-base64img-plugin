---
title: 圧縮処理(compressImage・createThumbnail)を Chromium・Firefox で動かした結果
aliases:
  - T13 の実ブラウザ確認
  - compressImage の実ブラウザ確認
tags:
  - docs
  - webp
  - canvas
  - browser
source_task: "[[T13-encode-search]]"
created: 2026-09-24
updated: 2026-09-24
---

# 圧縮処理(compressImage・createThumbnail)を Chromium・Firefox で動かした結果

> [!summary] 要点
> - [[T13-encode-search|T13]] の `src/client/encode.ts`・`thumbnail.ts` を、そのまま束ねて Chromium 153(ソフトウェア描画 / GPU 描画)と Firefox 155 で動かした。単体テストは偽のエンコーダーを使うので、canvas のエンコーダー(`createImageBitmap` での縮小と `toBlob`)が実ブラウザで動くことをここで確かめた。
> - **写真 5 枚の結果は、[[canvas-webp-encoding|T05]] の表(`createImageBitmap` の `resizeQuality: "high"` で縮小した列)と、長辺・画質・エンコード回数まで一致した。** 1 枚 137〜473ms。根拠: 実測のみ
> - 保存サイズはすべて 100,000 バイト以下で、data URL を T04 の `parseWebpDataUrl` で解析すると寸法が結果と一致した。サムネイルは 96×64 で保存 1,531〜4,407 バイト(上限 8,000)。根拠: 実測のみ
> - **中断は 0.4ms 以内に reject した**(`signal.reason` の AbortError)。その後、進捗もエンコードも続かなかった。根拠: 実測のみ
> - 透過は保持された(`VP8X` の Alpha フラグ、透明な角の画素は `[0, 0, 0, 0]`)。根拠: 実測のみ
> - 乱数ノイズの画像は、Cr-GPU では `COMPRESSION_OVER_BUDGET`、Cr-SW と Firefox では 655px・画質 0.70 で収まった。縮小でノイズがどれだけ平均化されるかが違う。ファイルからデコードした写真では SW と GPU の結果は同じだった。根拠: 実測のみ(原因は推測のみ)
> - 関連: [[T13-encode-search]]、[[canvas-webp-encoding]]、[[base64-image-plugin-spec#6.3 リサイズと画質の方針(Q7)|仕様書 6.3]]、[[base64-image-plugin-spec#6.4 サムネイル|仕様書 6.4]]

## 測定の環境

| 項目 | 内容 |
|---|---|
| マシン | Apple M5 Pro、macOS 26.4(25E246) |
| Node / Playwright | 26.10.0 / `@playwright/test` 1.63.0(headless) |
| Cr-SW | Chromium 153.0.8010.12。`chromium.launch({ headless: true })`(headless shell。ソフトウェア描画) |
| Cr-GPU | Chromium 153.0.8010.12。`chromium.launch({ headless: true, channel: "chromium" })`(new headless。GPU 描画) |
| Fx | Firefox 155.0。`firefox.launch({ headless: true })` |
| 写真 | [[canvas-webp-encoding\|T05]] と同じ 5 枚(2400×1600 の JPEG)。リポジトリには入れていない |
| 日付 | 2026-09-24 |

## 手順

1. esbuild(0.28.2)で `src/client/encode.ts`・`src/client/thumbnail.ts`・`src/shared/data-url.ts` を 1 つの ES module に束ねる。本番のコードをそのまま使い、エンコーダーは差し替えない(既定の canvas のエンコーダー)。
2. `node:http` の静的サーバー(`127.0.0.1:4413`)でページと写真を配信し、Playwright で 3 つの構成を順に起動して、ページの関数を `page.evaluate` で呼ぶ。
3. 写真: `fetch` → `File` → `createImageBitmap(file, { imageOrientation: "from-image" })` → `compressImage`(options は既定値)→ `createThumbnail`。各写真を 2 回実行し、2 回目の値を使った(1 回目はウォームアップ)。
4. 中断: p3 の圧縮を始めて 30 / 150 / 300ms 後に `controller.abort()` し、reject までの時間と、500ms 後までの進捗の数を記録した。
5. 乱数ノイズ(2400×1600、不透明)と、透過のある画像(1200×800、中心から透明になる放射状のグラデーション)を canvas で作り、`createImageBitmap(canvas)` を入力にした。

コードは `spikes/t13-encode/`(git 管理外)にある。再現に必要な部分は [[#再現のコード]]。

## 結果

### 写真 5 枚(既定の options)

「長辺 / 画質(エンコード回数、圧縮の時間、保存バイト数)」。T05 の列は [[canvas-webp-encoding#6. 仕様書 6.3 の探索を当てはめた結果]] の cibb の列。根拠: **実測のみ**

| 写真 | Cr-SW | Cr-GPU | Fx | T05 の Cr cibb / Fx cibb |
|---|---|---|---|---|
| p1 | 1280 / 0.78(8 回、398ms、99,827) | 1280 / 0.78(8 回、414ms、99,827) | 1280 / 0.77(8 回、391ms、99,583) | 1280 / 78 / 1280 / 77 |
| p2 | 1600 / 0.81(7 回、459ms、93,147) | 1600 / 0.81(7 回、470ms、93,147) | 1600 / 0.80(7 回、473ms、94,151) | 1600 / 81 / 1600 / 80 |
| p3 | 1024 / 0.70(9 回、401ms、99,879) | 1024 / 0.70(9 回、408ms、99,879) | 1024 / 0.60(9 回、390ms、98,495) | 1024 / 70 / 1024 / 60 |
| p4 | 1280 / 0.66(8 回、436ms、97,703) | 1280 / 0.66(8 回、452ms、97,703) | 1024 / 0.77(9 回、379ms、99,751) | 1280 / 66 / 1024 / 77 |
| p5 | 1600 / 0.92(2 回、143ms、96,791) | 1600 / 0.92(2 回、137ms、96,975) | 1600 / 0.91(7 回、388ms、88,783) | 1600 / 92 / 1600 / 91 |

- エンコード回数も T05 の minFirst と同じだった(Chromium 8 / 7 / 9 / 8 / 2 回、Firefox 8 / 7 / 9 / 9 / 7 回)。
- p1 の Cr-SW の 99,827 バイトは、T05 の全データ(1280px・0.78 の Cr-SW)と同じ値。
- data URL を `parseWebpDataUrl` で解析すると、Chromium は `extended`(`VP8X` + `ICCP` + `VP8 `)、Firefox は `lossy`(`VP8 `)で、寸法は結果の `width` / `height` と一致した。`dataUrl.length` は `storedBytes` と一致した。
- デコード(`createImageBitmap(file)`)は 12〜26ms。
- 進捗(`onProgress`)は、長辺と画質の順に「1600/0.6 → 1280/0.6 → 1280/0.92 → 1280/0.76 → …」と届いた(p1、Chromium)。

### サムネイル

すべて 96×64(2 回のエンコードで画質 0.92)。保存バイト数は、Chromium で 2,167〜4,407、Firefox で 1,531〜4,015(上限 8,000)。時間は Chromium 1〜3ms、Firefox 8〜9ms。Chromium の最大 4,407 バイト(WebP 3,288 B)は、T05 の「96px・0.92 で最大 3,288 B」と一致する。根拠: **実測のみ**

### 中断

p3 の圧縮を始めて 30 / 150 / 300ms 後に中断した結果(3 つの構成とも同じ)。根拠: **実測のみ**

| 中断までの時間 | reject | 中断から reject まで | reject までの進捗 | 500ms 後の進捗 |
|---|---|---|---|---|
| 30ms | AbortError(`signal.reason` と同一) | 0〜0.4ms | 1 | 1 |
| 150ms | 同上 | 0ms | 3 | 3 |
| 300ms | 同上 | 0〜0.1ms | 7 | 7 |

- 実行中の `toBlob` や `createImageBitmap` の完了を待たずに reject した(1600px の `toBlob` は 1 回 70ms 前後かかる)。
- reject のあとに進捗が増えないので、次のエンコードも始めていない。

### 乱数ノイズ

2400×1600 の乱数(RGB、不透明)を canvas に描き、`createImageBitmap(canvas)` を入力にした。根拠: **実測のみ**

| 構成 | 結果 |
|---|---|
| Cr-SW | 655px / 0.70 で収まった(11 回、464ms) |
| Cr-GPU | `COMPRESSION_OVER_BUDGET`。1600 → 1280 → 1024 → 819 → 655 → 524px を画質 0.60 で 1 回ずつ試し、524px で保存 112,647 バイト(6 回、358ms)。`details` は `{ maxStoredBytes: 100000, minEdge: 480, minQuality: 0.6, lastEdge: 524, lastStoredBytes: 112647, attempts: 6 }` |
| Fx | 655px / 0.70 で収まった(11 回、431ms) |

- Cr-SW と Firefox では、縮小した画像をデコードし直した画素が 107〜149 付近に集まっていた(元は 0〜255 の乱数)。縮小で周りの画素と平均され、ノイズの振幅が小さくなったので収まったと考えられる。Cr-GPU は、canvas から作った ImageBitmap(GPU 側にある)を別の方法で縮小していて、ノイズが多く残るのだと考えられる(推測のみ)。
- ファイルからデコードした写真では、Cr-SW と Cr-GPU の結果が 5 枚とも同じだった(上の表)。本番の入力はファイルなので、この違いは現れにくい(推測のみ)。
- 収まらない画像では、長辺ごとに 1 回ずつのエンコードで諦めることを実ブラウザでも確かめた。

### 透過

1200×800 の、中心から透明になる放射状のグラデーション。根拠: **実測のみ**

| 構成 | 結果 |
|---|---|
| Cr-SW | 1200px / 0.82(7 回、保存 99,407) |
| Cr-GPU | 1200px / 0.81(7 回、保存 98,615) |
| Fx | 1200px / 0.91(7 回、保存 97,291) |

- 3 つとも `VP8X`(Alpha フラグあり)になり、サムネイルも透過を持っていた。
- WebP をデコードし直すと、透明な角の画素は `[0, 0, 0, 0]`、中心は `[220, 41, 40, 255]` だった。仕様書 6.5 の「透過は保持される」と合う。

## 再現のコード

ページ側(`spikes/t13-encode/index.html` の一部)。`bundle.js` は `npx esbuild spikes/t13-encode/entry.ts --bundle --format=esm --target=es2022 --outfile=spikes/t13-encode/bundle.js` で作る。`entry.ts` は `compressImage` / `createThumbnail` / `parseWebpDataUrl` / `DEFAULT_FIELD_OPTIONS` を `globalThis.t13` に入れるだけ。

```js
import "./bundle.js";
const { compressImage, createThumbnail, parseWebpDataUrl, DEFAULT_FIELD_OPTIONS } = globalThis.t13;

globalThis.runPhoto = async (name) => {
	const blob = await (await fetch(`/photos/${name}.jpg`)).blob();
	const file = new File([blob], `${name}.jpg`, { type: "image/jpeg" });
	const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	const image = { source: bitmap, width: bitmap.width, height: bitmap.height };
	const progress = [];
	const result = await compressImage(image, {
		...DEFAULT_FIELD_OPTIONS,
		onProgress: (p) => progress.push([Math.max(p.width, p.height), p.quality]),
	});
	const thumb = await createThumbnail(image);
	bitmap.close();
	return { result, progress, webp: parseWebpDataUrl(result.dataUrl), thumb };
};

globalThis.runAbort = async (name, delayMs) => {
	// …同じようにデコードしてから
	const controller = new AbortController();
	const compressing = compressImage(image, { ...DEFAULT_FIELD_OPTIONS, signal: controller.signal });
	setTimeout(() => controller.abort(), delayMs);
	try {
		await compressing;
	} catch (error) {
		return error === controller.signal.reason; // true
	}
};
```

Node 側は [[canvas-webp-encoding#ブラウザの起動(Node 側)]] と同じ起動方法で、ポートは 4413 にした。
