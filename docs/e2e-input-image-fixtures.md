---
title: E2E の入力画像を Node・sips・Chromium で作る方法と、本番の判定・圧縮に通した結果
aliases:
  - E2E の入力画像の作り方
  - sips で書ける形式
  - HEIC の代わりのファイル
tags:
  - docs
  - e2e
  - image
  - heic
  - browser
source_task: "[[T26-playground-pages]]"
created: 2026-09-24
updated: 2026-09-24
---

# E2E の入力画像を Node・sips・Chromium で作る方法と、本番の判定・圧縮に通した結果

> [!summary] 要点
> - E2E([[T31-e2e|T31]])の入力画像 28 個を、新しいパッケージを入れずに作れた。PNG・GIF・SVG・乱数は Node の標準機能(`node:zlib` の `deflateSync` と `crc32`)、JPEG・AVIF・BMP・TIFF・ICO・HEIC は macOS の `sips`、WebP は Playwright の Chromium の canvas で作る。全部で約 1.5 秒。根拠: 実測のみ
> - **macOS 26.4 の `sips`(sips-316)は WebP を書けない**(`sips --formats` で WebP は読み込みだけ)。JPEG・HEIC・AVIF・BMP・TIFF・ICO・GIF・PNG は書ける。根拠: 実測のみ
> - 本番の `inspectInputFile` → `decodeImage` → `compressImage` → `createThumbnail` に、`setInputFiles` で選んだファイルを通すと、Chromium 153・Firefox 155 で、受け付ける 19 個はすべて WebP にでき、拒否する 9 個はすべて想定のコードで拒否された。根拠: 実測のみ
> - **HEIC の拒否は、本物の HEIC で確かめる。** 中身が JPEG で拡張子が `.heic` のファイルは、`File.type` が `image/heic` でも JPEG として受け付けられた(中身で形式を決めるため。[[T12-input-decode|T12]])。タスクノートの「MIME タイプを偽ったファイルで代用する」は、中身が画像でないとき(乱数)にだけ HEIC の拒否になる。根拠: 実測のみ
> - 作ったファイルは git に入れない(40MB を超えるファイルを含み、どれも数秒で作り直せる)。同じマシンで 2 回作ると、`sips` と Chromium の出力も含めて SHA-256 まで同じだった。根拠: 実測のみ
> - 関連: [[T26-playground-pages]]、[[e2e/fixtures/README|e2e/fixtures/README.md]](ファイルの一覧)、[[input-image-decode]]、[[compress-image-browser-check]]、[[T12-input-decode]]、[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)|仕様書 6.5]]

> [!info] 測定の環境
> - macOS 26.4(25E246、Apple M5 Pro)、Node 26.10.0、`sips`(sips-316)、Playwright 1.63.0(Chromium 153.0.8010.12 の headless shell、Firefox 155.0)、esbuild 0.28.2。2026-09-24 に計測。
> - 生成は `node e2e/fixtures/make-images.ts`。確かめたときのコードは `spikes/t26-pages/fixtures-check/`(git 管理外)。再現に必要な部分は [[#再現のコード]]。

## 作り方

| 形式 | 道具 | 注意 |
|---|---|---|
| PNG(RGB・RGBA・グレースケール) | Node(`deflateSync` と `crc32`) | IDAT は 1MiB ずつに分けた。40MB を超えるファイルは、黒一色を無圧縮(`level: 0`)で入れる。8000 × 8001 の一色は `level: 9` で 76,396 B |
| JPEG | Node の PNG → `sips -s format jpeg -s formatOptions 90` | EXIF の向きは、SOI の直後に Orientation だけの APP1 を入れる([[input-image-decode#EXIF の向き 6 の JPEG]] と同じコード) |
| AVIF・HEIC・BMP・TIFF・ICO | Node の PNG → `sips -s format <形式>` | `ftyp` は HEIC が `heic` + `mif1 MiPr miaf MiHB heic`、AVIF が `avif` + `MiPr avif miaf mif1`。BMP は BITMAPINFOHEADER の 24 ビットで高さが負(上から下)。TIFF はビッグエンディアン(`MM\0*`)。ICO は 32 × 32 の 32 ビット(PNG を埋め込まない形) |
| WebP | Node の PNG を Chromium で `createImageBitmap` → `OffscreenCanvas#convertToBlob({ type: "image/webp", quality: 0.9 })` | Chromium の WebP は `VP8X` + `ICCP` になる([[webp-data-url-validation]]) |
| GIF(アニメーション) | Node(LZW を自前で書いた) | 3 フレーム、8 色の表、NETSCAPE2.0 で無限に繰り返す |
| SVG・乱数 | Node | 乱数は種を固定(mulberry32) |

- `sips --formats` の「Writable」: `jpeg`・`heic`・`heics`・`avif`・`png`・`gif`・`bmp`・`tiff`・`ico`・`jp2`・`pdf`・`psd`・`icns`・`exr`・`dds`・`tga`・`astc`・`ktx`・`ktx2`・`pbm`・`pvr`。WebP・`heif`・SVG・JPEG XL は読み込みだけ。根拠: 実測のみ
- GIF の LZW は、次に割り当てるコードが今のビット数に収まらなくなる時点(`nextCode >= 1 << codeSize`)で、表に足す前にビット数を増やす(復号側と同じ時点。omggif などと同じ)。表が 4,096 になったらクリアコードを出す。2 つのブラウザで 1 フレーム目がデコードできたことで確かめた(フレームは一色なので、4,096 に届く前に終わる)。根拠: 実測のみ(クリアコードの分岐は、このファイルでは通らない)
- 時間: 全部で約 1.5 秒(28 個、40MB の PNG を含む)。根拠: 実測のみ

## 本番の処理に通した結果

`src/client/input.ts`・`encode.ts`・`thumbnail.ts` を esbuild で束ね、ページの `<input type="file">` に `page.setInputFiles(パス)` でファイルを選び、`inspectInputFile` → `decodeImage` → `compressImage`(既定の options: `maxStoredBytes` 100,000・`maxEdge` 1,600・`minQuality` 0.6・`minEdge` 480)→ `createThumbnail` の順に呼んだ。根拠: 実測のみ

### 受け付けるもの

「長辺 × 短辺・画質・保存バイト数(エンコード回数)」。左が Chromium 153、右が Firefox 155。

| ファイル | デコード | 圧縮の結果 | サムネイル |
|---|---|---|---|
| `photo-2400x1600.jpg` | 2400 × 1600(10 / 14ms) | 1600 × 1067・0.64・97,991 B(7 回、471ms)/ 1600 × 1067・0.63・99,071 B(7 回、487ms) | 96 × 64・3,667 B / 3,251 B |
| `photo-exif-orientation-6.jpg` | **1600 × 2400**(ヘッダーは 2400 × 1600) | 1067 × 1600・0.68・99,967 B / 1067 × 1600・0.64・97,607 B(どちらも 7 回) | 64 × 96 |
| `png-alpha-640x480.png` | 640 × 480 | 0.92・55,727 B / 52,259 B(2 回)。角の画素は `[0, 0, 0, 0]`、中心は `[220, 41, 40, 255]` | 96 × 72 |
| `webp-640x480.webp` | 640 × 480 | 0.92・42,415 B / 41,887 B | 96 × 72 |
| `avif-640x480.avif` | 640 × 480 | 0.92・45,259 B / 46,655 B | 96 × 72 |
| `bmp-640x480.bmp` | 640 × 480 | 0.92・47,719 B / 47,263 B | 96 × 72 |
| `gif-animated-320x240.gif` | 320 × 240、注意 `GIF_FIRST_FRAME_ONLY` | 0.92・1,499 B / 855 B。左上の画素は 1 フレーム目の赤(`[220, 41, 40, 255]`) | 96 × 72 |
| `gallery-01.png` 〜 `12.png` | 800 × 600 | 0.92・4,019〜5,927 B / 3,391〜5,271 B(2 回) | 96 × 72 |

- 写真の代わりの風景は、長辺 1600 で画質の二分探索になり、上限の 100,000 B の近くに収まった。実際の写真([[compress-image-browser-check]] の p2: 1600px・0.81)より細部が多く、画質は下限(0.60)に近い。E2E で「保存が 100,000 B 以下」を確かめるのに向く。
- Firefox の AVIF のデコードは問題なかった(`sips` の AVIF は 640 × 480 の 1 枚で、[[input-image-decode]] で Firefox が失敗したグリッドの AVIF ではない)。

### 拒否するもの

両方のブラウザで同じ結果だった。

| ファイル | `File.type`(Chromium / Firefox) | 形式の判定(中身) | 結果 |
|---|---|---|---|
| `heic-640x480.heic` | `image/heic` | heif | `INPUT_HEIC_REJECTED` |
| `heic-named-as-jpeg.jpg` | `image/jpeg` | heif | `INPUT_HEIC_REJECTED` |
| `vector.svg` | `image/svg+xml` | svg | `INPUT_SVG_REJECTED` |
| `tiff-640x480.tiff` | `image/tiff` | tiff | `INPUT_FORMAT_REJECTED` |
| `icon-32x32.ico` | `image/vnd.microsoft.icon` / `image/x-icon` | なし | `INPUT_FORMAT_REJECTED` |
| `random-bytes.jpg` | `image/jpeg` | なし | `INPUT_DECODE_FAILED`(デコードしない) |
| `jpeg-broken-after-signature.jpg` | `image/jpeg` | jpeg(寸法は読めない) | `INPUT_DECODE_FAILED`(デコードに失敗) |
| `too-large-file-4000x3334.png` | `image/png` | png | `INPUT_FILE_TOO_LARGE`(40,017,958 B) |
| `too-many-pixels-8000x8001.png` | `image/png` | png(8000 × 8001) | `INPUT_TOO_MANY_PIXELS` |

- `random-bytes.jpg` と `jpeg-broken-after-signature.jpg` は、同じ `INPUT_DECODE_FAILED` でも通る道が違う。前者は中身で形式が決まらず、`File.type` が受け付ける形式なので、デコードせずに壊れたファイルとする。後者は JPEG と判定され、`createImageBitmap` が失敗する。途中で切れた JPEG・PNG は、Firefox 155 がデコードしてしまうので使わない([[input-image-decode]])。
- `too-large-file-…png` は、形式の判定のあとのバイト数の確認で拒否され、デコードはしない。中身は正しい PNG なので、確認が無ければデコードと圧縮ができてしまい、E2E が「拒否されない」ことに気付ける。

### HEIC の代わりのファイル

タスクノートの「HEIC は MIME タイプを偽ったファイルで代用する」を確かめた。使い捨てのファイルで、E2E の画像には入れていない。

| ファイル | `File.type` | 結果 |
|---|---|---|
| 中身は `photo-2400x1600.jpg`、名前は `.heic` | `image/heic` | **受け付けられた**(JPEG として 1600 × 1067 に圧縮) |
| 中身は乱数 2,000 B、名前は `.heic` | `image/heic` | `INPUT_HEIC_REJECTED` |

- `src/client/input.ts` は、先頭のバイトで形式が決まればそれだけで判定し、`File.type` は中身で判定できないときにだけ使う([[T12-input-decode#決めたこと|T12 の決定 1・2]])。そのため、MIME タイプだけを偽った画像は、中身の形式として扱われる。
- HEIC の拒否(案内文の表示)は、`sips` で作った本物の HEIC(`heic-640x480.heic`)と、拡張子を `.jpg` にしたもの(`heic-named-as-jpeg.jpg`)で確かめる。`sips` の無い環境では、乱数を `.heic` という名前にしたファイルで `File.type` の経路だけを確かめられる。

## git に入れない理由

- `too-large-file-4000x3334.png` は 40MB を超える。28 個の合計は 43,814,885 B。
- 作り直しは約 1.5 秒で、中身も同じ(同じマシンで SHA-256 まで同じ)。
- 小さいファイルだけを入れると、ファイルの出どころがスクリプトとリポジトリの 2 か所になる。すべてスクリプトから作る形にそろえた。
- 代わりに、生成に `sips`(macOS)が要る。ほかの OS では、`sips` の出力を使う 8 個(JPEG 2 個・AVIF・BMP・TIFF・ICO・HEIC 2 個)が作れない。スクリプトは macOS 以外では最初に止まる。

## 再現のコード

ページ側(`index.html` の `<input type="file" id="f">` と、束ねた `bundle.js`)。`bundle.js` は `node_modules/.bin/esbuild spikes/t26-pages/fixtures-check/entry.ts --bundle --format=esm --target=es2022 --outfile=spikes/t26-pages/fixtures-check/bundle.js` で作る。`entry.ts` は `compressImage` / `createThumbnail` / `decodeImage` / `inspectInputFile` / `DEFAULT_FIELD_OPTIONS` を `globalThis.t26` に入れるだけ。

```js
// Node 側: node:http で index.html と bundle.js を配信し、ブラウザごとに次を繰り返す
await page.setInputFiles("#f", file); // 実際のブラウザの File.type になる
const result = await page.evaluate(async () => {
	const file = document.querySelector("#f").files[0];
	const t = globalThis.t26;
	const out = { name: file.name, type: file.type, size: file.size };
	try {
		const inspection = await t.inspectInputFile(file);
		out.format = inspection.format;
	} catch (error) {
		out.rejected = error.code; // INPUT_*
		return out;
	}
	let decoded;
	try {
		decoded = await t.decodeImage(file);
	} catch (error) {
		out.rejected = error.code;
		return out;
	}
	try {
		out.decoded = `${decoded.width}x${decoded.height}`;
		out.notices = decoded.notices;
		const result = await t.compressImage(decoded, { ...t.DEFAULT_FIELD_OPTIONS });
		out.compressed = `${result.width}x${result.height} q${result.quality} ${result.storedBytes}B`;
		const thumb = await t.createThumbnail(decoded);
		out.thumb = `${thumb.width}x${thumb.height} ${thumb.storedBytes}B`;
	} finally {
		decoded.close();
	}
	return out;
});
```
