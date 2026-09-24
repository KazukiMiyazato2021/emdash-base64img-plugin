---
title: 入力画像の形式の判定とデコード(File.type・先頭のバイト・createImageBitmap・画素数とメモリ)
aliases:
  - 入力画像の判定とデコード
  - T12 の実ブラウザ確認
  - createImageBitmap のメモリと画素数
  - HEIC の判定
tags:
  - docs
  - browser
  - image
  - heic
source_task: "[[T12-input-decode]]"
created: 2026-09-24
updated: 2026-09-24
---

# 入力画像の形式の判定とデコード(File.type・先頭のバイト・createImageBitmap・画素数とメモリ)

> [!summary] 要点
> - **`File.type` は拡張子だけで決まる。** 拡張子が無い・知らない拡張子なら空文字、付け替えれば中身と違う値になる(HEIC を `.jpg` にすると `image/jpeg`)。Chromium 153・Firefox 155(macOS)で同じ。根拠: 実測のみ
> - **`createImageBitmap(Blob)` は Blob の type を見ず、中身で形式を決める。** PNG を `image/jpeg` として渡してもデコードでき、ICO もデコードできる。根拠: 実測のみ
> - → [[T12-input-decode|T12]] の `src/client/input.ts` は、**形式を先頭のバイト(シグネチャ・`ftyp` の brand)で判定する。** `File.type` は、中身で判定できないときに拒否の理由を選ぶためだけに使う。HEIC は名前が `.jpg` でも拡張子が無くても、HEIC の案内で拒否できた。根拠: 実測のみ
> - HEIC / HEIF・SVG・TIFF は、どちらのブラウザも `createImageBitmap` でデコードできない(`InvalidStateError`)。根拠: 実測のみ
> - **デコードは 1 画素あたり約 4 バイトのメモリを使う。** 6,400 万画素で約 +250MB、16384 × 16384(2.7 億画素、ファイルは 300KB の PNG)で約 +1GB。5.4 億画素以上はどのブラウザもすぐに失敗し、メモリは増えなかった。→ **画素数はデコードの前にヘッダーから読んで確かめる**(判定は 1ms 前後)。根拠: 実測のみ
> - Firefox 155 の `createImageBitmap(Blob)` は、**デコードの間、主スレッドを止める**(6,400 万画素の JPEG で 78〜92ms)。その間に押した中断は、デコードが終わってから届く。Chromium は止めない。根拠: 実測のみ
> - Firefox 155 は、途中で切れた JPEG / PNG を、足りない部分を白・透明にしてデコードする(Chromium は失敗する)。libheif で作ったグリッドの AVIF はデコードできない。根拠: 実測のみ
> - EXIF の向きは `imageOrientation: "from-image"` で反映される。GIF・アニメーション WebP・APNG は最初のフレームになる。透過は保持される。根拠: 実測のみ
> - 関連: [[T12-input-decode]]、[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)|仕様書 6.5]]、[[jsdom-browser-api-gaps]]、[[compress-image-browser-check]]、[[webp-data-url-validation]]

## 測定の環境

| 項目 | 内容 |
|---|---|
| マシン | Apple M5 Pro、メモリ 24GB、macOS 26.4(25E246) |
| Node / Playwright | 26.10.0 / `@playwright/test` 1.63.0(headless) |
| Cr-SW | Chromium 153.0.8010.12。`chromium.launch({ headless: true })`(headless shell。ソフトウェア描画) |
| Cr-GPU | Chromium 153.0.8010.12。`chromium.launch({ headless: true, channel: "chromium" })`(new headless。GPU 描画) |
| Fx | Firefox 155.0。`firefox.launch({ headless: true })` |
| サンプルを作ったツール | ImageMagick 7.1.2-31、libheif 1.23.5 の `heif-enc`(x265 4.3 / aom 3.15.1)、macOS の `sips`(sips-316)、cwebp 1.6.0、Node のスクリプト |
| 日付 | 2026-09-24 |

- Firefox の `performance.now()` は 1ms 単位に丸められていた。Firefox の時間は 1ms 刻みで読む。
- スパイクのコードは `spikes/input-decode/`(git 管理外)にある。再現に必要な部分は [[#再現のコード]]。

## サンプル

| ファイル | 内容 | 作り方 |
|---|---|---|
| `jpeg-plain.jpg` / `jpeg-progressive.jpg` | 400 × 200。左上が赤、右上が緑、左下が青、右下が黄 | `magick`(品質 92、プログレッシブは `-interlace JPEG`) |
| `jpeg-orient6.jpg` | 上の JPEG に EXIF の向き 6(時計回りに 90 度)を入れたもの | SOI の直後に APP1(Orientation だけの IFD0)を入れる Node のスクリプト |
| `jpeg-late-sof.jpg` | 向き 6 の EXIF と、60,000 バイトの COM を 3 つ入れ、SOF を 180KB より後ろに置いたもの | 同上 |
| `png-alpha.png` | 300 × 200 の透過(中心が不透明の赤、外側が透明) | `magick ... radial-gradient` |
| `apng-anim.png` / `gif-anim.gif` / `webp-anim.webp` | 120 × 80。赤 → 緑 → 青の 3 フレーム | `magick -delay 50 ... -loop 0` |
| `gif-bigframe.gif` | 論理画面を 10 × 10 に書き換えた `gif-anim.gif`(フレームは 120 × 80) | Node のスクリプト |
| `webp-lossy.webp` / `webp-lossless-alpha.webp` | 非可逆 / 可逆・透過 | `cwebp` |
| `avif-plain.avif` / `avif-alpha.avif` / `avif-irot90.avif` / `avif-grid.avif` | 1 枚 / 透過 / `irot` で 90 度回転 / 512 × 384 を 128px のタイルに分けたグリッド | `heif-enc -A`(`--rotate-cw 90`、`--cut-tiles 128`) |
| `bmp-v3-24.bmp` / `bmp-v5-32.bmp` / `bmp-core.bmp` / `bmp-topdown.bmp` | BITMAPINFOHEADER 24 ビット / BITMAPV5HEADER 32 ビット(透過)/ BITMAPCOREHEADER / 高さが負 | `magick`(`BMP3:` / `BMP:` / `BMP2:`)、高さが負のものは Node のスクリプト |
| `heic-sips.heic` / `heic-x265.heic` | HEIC(`ftyp` は `heix` + `mif1 MiPr MiHA miaf heix` / `heic` + `mif1 heic miaf`) | `sips -s format heic` / `heif-enc` |
| `heic-upper.HEIC` / `heic-as.heif` / `heic-named.jpg` / `heic-noext` | `heic-sips.heic` の名前だけを変えたもの | `cp` |
| `svg-plain.svg` / `svg-prolog.svg` | SVG(XML 宣言・コメント・DOCTYPE 付きのものを含む) | 手書き |
| `tiff-plain.tif` / `.tiff`、`icon.ico` | TIFF、ICO(32 × 16) | `magick` |
| `broken-*` | 空 / 乱数 2,000 バイト / IHDR だけの PNG / SOI の後が乱数 / 先頭 60% で切った JPEG・PNG・WebP | Node のスクリプト |
| `png-named.jpg` / `jpeg-noext` / `jpeg-unknown.xyz` | 中身と拡張子が合わない・拡張子が無い・知らない拡張子 | `cp` |
| `big/png-*.png` | 一色のグレースケール PNG。4000²(16MP)、8000²(64MP)、8000 × 8001、11314²(128MP)、16384²(268MP)、23170²(537MP)、32768²(1.07GP)。ファイルは 21KB〜1.1MB | Node のスクリプト([[#再現のコード]]) |
| `big/png-rgb-64mp.png` / `big/jpeg-64mp.jpg` / `big/jpeg-72mp.jpg` | 8000² の RGB PNG / 8000² の JPEG(3.7MB、`plasma:fractal`)/ 9000 × 8000 の JPEG(281KB) | Node のスクリプト / `magick` |

## 1. input で選んだ File の type

`<input type="file">` に `page.setInputFiles(パス)` でファイルを選び、`File.type` を読んだ。根拠: **実測のみ**

| 拡張子 | Chromium 153(SW / GPU) | Firefox 155 |
|---|---|---|
| `.jpg` / `.png` / `.gif` / `.webp` / `.avif` / `.bmp` | `image/jpeg` / `image/png` / `image/gif` / `image/webp` / `image/avif` / `image/bmp` | 同じ |
| `.heic` / `.HEIC` | `image/heic` | `image/heic` |
| `.heif` | `image/heif` | `image/heif` |
| `.svg` | `image/svg+xml` | `image/svg+xml` |
| `.tif` / `.tiff` | `image/tiff` | `image/tiff` |
| `.ico` | `image/vnd.microsoft.icon` | `image/x-icon` |
| 拡張子なし(`heic-noext`・`jpeg-noext`)・`.xyz` | `""` | `""` |
| HEIC を `.jpg` にしたもの・PNG を `.jpg` にしたもの | `image/jpeg` | `image/jpeg` |

- 中身は見ていない。拡張子だけで決まる。
- ICO の値がブラウザで違うので、type を決めているのは Playwright ではなくブラウザだと考えられる(推測のみ)。
- macOS では `.heic` は `image/heic` になった。Windows など、ほかの OS で空になるかは確かめていない。拡張子が無ければ、どの OS でも空になる(実測は macOS のみ)。

## 2. createImageBitmap の結果(ブラウザそのもの)

`createImageBitmap(file, { imageOrientation: "from-image" })` の結果と、4 つの象限の中心の画素。3 つの構成で、下の表の「Firefox」の列以外は同じだった。根拠: **実測のみ**

| 入力 | 結果 |
|---|---|
| JPEG(ベースライン・プログレッシブ・拡張子なし・`.xyz`) | 400 × 200。画素も正しい |
| JPEG(EXIF の向き 6、SOF が 180KB より後ろのものも) | **200 × 400**。左上が青、右上が赤、左下が黄、右下が緑で、時計回りに 90 度回った向き |
| PNG(透過)・WebP(可逆・透過)・BMP(V5、32 ビット) | 透過を保つ(角は `[0, 0, 0, 0]`、中心は不透明度 102 前後) |
| BMP(24 ビット・COREHEADER・高さが負) | 400 × 200。上下も正しい |
| AVIF(1 枚・透過) | デコードできる |
| AVIF(`irot` で 90 度) | 200 × 400。回転を反映する |
| AVIF のグリッド(`heif-enc --cut-tiles`) | Chromium はデコードできる。**Firefox は `InvalidStateError`**(タイル 128 / 256 / 512px のどれも。同じ大きさの 1 枚の AVIF はデコードできた) |
| GIF(アニメーション)・アニメーション WebP・APNG | **最初のフレーム(赤)** の 120 × 80 |
| GIF(論理画面 10 × 10、フレーム 120 × 80) | **120 × 80**(最初のフレームに合わせて広げる) |
| HEIC(sips・x265、名前を変えたものすべて) | `InvalidStateError` |
| SVG・TIFF | `InvalidStateError` |
| ICO | 32 × 16 でデコードできる |
| 空・乱数・IHDR だけの PNG・SOI の後が乱数・途中で切れた WebP | `InvalidStateError` |
| 途中で切れた JPEG・PNG | Chromium は `InvalidStateError`。**Firefox はデコードする**(JPEG は下半分が白、PNG は下が透明) |

- エラーのメッセージは、Chromium が "The source image could not be decoded."、Firefox が "The image could not be decoded"。どちらも `name` は `InvalidStateError`。
- 時間は、小さなサンプルでは 0.2〜8ms。

### Blob の type と中身が食い違うとき

`fetch` したバイト列から `new File([bytes], name, { type })` を作ってデコードした。3 つの構成で同じ。根拠: **実測のみ**

| 中身 | 渡した type | 結果 |
|---|---|---|
| PNG | `image/jpeg` | デコードできる |
| JPEG | `image/png` / `""` / `image/heic` | デコードできる |
| WebP / AVIF / BMP / GIF / ICO | `""` | デコードできる |
| HEIC | `image/jpeg` / `image/heic` | `InvalidStateError` |
| SVG | `""` / `image/svg+xml` | `InvalidStateError` |
| TIFF | `image/tiff` | `InvalidStateError` |

→ デコーダーは type を見ずに中身で形式を決めている。「デコードできたか」だけで判定すると、ICO のように仕様書 6.5 の一覧に無い形式も通ってしまう。

## 3. 画素数とメモリ

画素数の多い画像を 1 ページに 1 つずつデコードし、ImageBitmap を 0.5 秒保持してから閉じた。ブラウザのプロセスをまとめて(`launchServer` のプロセスとその子孫)、`ps` の RSS を 20ms ごとに足し合わせ、デコードの前との差の最大を記録した。根拠: **実測のみ**

| 画像(ファイルの大きさ) | Cr-SW | Cr-GPU | Fx |
|---|---|---|---|
| PNG 4000²、16MP(21KB) | 9ms、+68MB | 11ms、+70MB | 17ms、+64MB |
| PNG 8000²、64MP(75KB) | 29ms、+251MB | 37ms、+251MB | 72ms、+249MB |
| PNG RGB 8000²、64MP(202KB) | 35ms、+253MB | — | 44ms、+247MB |
| JPEG 8000²、64MP(3.7MB) | 83ms、+269MB | 130ms、+200MB | 81ms、+269MB |
| JPEG 9000 × 8000、72MP(281KB) | 76ms、+282MB | — | 44ms、+278MB |
| PNG 11314²、128MP(150KB) | 64ms、+496MB | 125ms、+447MB | 107ms、+491MB |
| PNG 16384²、268MP(302KB) | 110ms、**+1,032MB** | 286ms、+937MB | 276ms、**+997MB** |
| PNG 23170²、537MP(577KB) | 4ms で失敗、+8MB | 1ms で失敗、+7MB | 0ms で失敗、+5MB |
| PNG 32768²、1.07GP(1.1MB) | 1ms で失敗、+9MB | — | 0ms で失敗、+8MB |

- 増えるメモリは、およそ「画素数 × 4 バイト」。ImageBitmap はページのプロセス(renderer / Web Content)に置かれる(Cr-SW の 268MP では、1 つのプロセスが 1,120MB になった)。`close()` のあとは元に戻った。
- 537MP(4 バイトで 2.1GB)以上は、どのブラウザもメモリを確保する前に失敗した。危ないのは 64MP〜約 500MP の範囲で、300KB 程度のファイルでも 1GB を使う。ファイルの 40MB の上限では防げない。
- このマシン(24GB)では、どのページも落ちなかった。メモリの少ないマシンでタブが落ちるかは確かめていない(推測のみ)。
- `src/client/input.ts` は、これらのファイルをヘッダーの寸法で拒否した。拒否までの時間は Chromium で 0.1〜1.1ms、Firefox で 0〜1ms で、メモリは増えない([[#5. 実装(src/client/input.ts)を通した結果]])。

## 4. デコードの間に主スレッドが止まる時間

`setTimeout(tick, 0)` を続けて呼びながら `createImageBitmap(file)` を待ち、tick の間隔の最大(解決した時刻までを含む)を測った。3 回ずつ。根拠: **実測のみ**

| 画像 | Cr-SW(デコード / 最大の間隔) | Cr-GPU | Fx |
|---|---|---|---|
| PNG 4000² | 6〜7ms / 5ms | 8〜13ms / 5〜6ms | 12〜14ms / **12〜14ms** |
| JPEG 8000²(3.7MB) | 79〜80ms / 6ms | 81〜84ms / 5〜7ms | 78〜92ms / **78〜92ms** |
| PNG RGB 8000² | 31ms / 5〜6ms | 31〜34ms / 6〜8ms | 31〜35ms / **31〜35ms** |
| PNG 8000² | 24〜26ms / 5〜6ms | 29〜47ms / 5〜8ms | 45〜47ms / **45〜47ms** |

- Chromium の間隔は、`setTimeout` の最小の間隔(4ms 前後)と同じ。デコードは主スレッドの外で行われている。
- **Firefox は、デコードの時間だけ主スレッドが止まった。** その間はタイマーもクリックも処理されない。
- そのため Firefox では、デコード中に中断しても、`decodeImage` はデコードが終わってから resolve する(中断のイベントはその後に届く)。[[#5. 実装(src/client/input.ts)を通した結果]] の中断の表を参照。
- 画素数の上限(64MP)があるので、止まるのはこのマシンで 100ms 程度まで。遅いマシンでは長くなる(推測のみ)。Worker でデコードすれば避けられるが、管理画面の CSP(`script-src 'self' 'unsafe-inline'`)では `blob:` の Worker を作れず、TS ソースのまま配布するプラグインで Worker のファイルを用意するのも難しいので、見送った(推測のみ。[[base64-image-plugin-spec#6.1 エンコード方式|仕様書 6.1]] の CSP)。

## 5. 実装(src/client/input.ts)を通した結果

`src/client/input.ts` を esbuild で束ね、全サンプルを `inspectInputFile`(デコードの前の判定)と `decodeImage` に通した。Cr-SW と Cr-GPU は同じ結果。根拠: **実測のみ**

| 入力 | `inspectInputFile` | `decodeImage`(Chromium) | `decodeImage`(Firefox) |
|---|---|---|---|
| JPEG(すべて)・PNG・APNG・WebP・AVIF(1 枚)・BMP(すべて) | 形式と寸法(ヘッダー) | デコードした寸法。`mimeType` は中身の形式 | 同じ |
| `jpeg-orient6.jpg` / `jpeg-late-sof.jpg` | jpeg 400 × 200 | 200 × 400 | 200 × 400 |
| `avif-irot90.avif` | avif 400 × 200(`ispe` は回転の前) | 200 × 400 | 200 × 400 |
| `avif-grid.avif` | avif 512 × 384(全体の `ispe`) | 512 × 384 | `INPUT_DECODE_FAILED` |
| GIF(3 つ) | gif 120 × 80(`gif-bigframe.gif` も) | 120 × 80、`notices` に `GIF_FIRST_FRAME_ONLY` | 同じ |
| `png-named.jpg`(type `image/jpeg`) | png | 300 × 200、`mimeType` は `image/png` | 同じ |
| HEIC(`heic-named.jpg`・`heic-noext` を含む 6 つ) | `INPUT_HEIC_REJECTED` | 同じ(デコードしない) | 同じ |
| SVG / TIFF / ICO | `INPUT_SVG_REJECTED` / `INPUT_FORMAT_REJECTED` / `INPUT_FORMAT_REJECTED` | 同じ | 同じ |
| 空のファイル・乱数(`.jpg`) | `INPUT_DECODE_FAILED` | 同じ(デコードしない) | 同じ |
| IHDR だけの PNG・SOI の後が乱数・切れた WebP | 形式(寸法は読めれば) | `INPUT_DECODE_FAILED`(cause は `InvalidStateError`) | 同じ |
| 切れた JPEG・PNG | 形式と寸法 | `INPUT_DECODE_FAILED` | **デコードできる**(欠けた部分は白・透明) |
| 64MP ちょうど(PNG 2 つ・JPEG) | 8000 × 8000 | デコードできる(24〜114ms) | デコードできる(37〜101ms) |
| 8000 × 8001・72MP 以上のすべて | `INPUT_TOO_MANY_PIXELS`(0.1〜1.1ms) | 同じ(デコードしない) | 同じ(0〜1ms) |

- `close()` を 2 回呼んでも例外にならず、閉じたあとの ImageBitmap は幅 0 になった。
- 中断(`createDecodeImage` に、作った ImageBitmap を記録する `createImageBitmap` を渡した):

| 入力と中断の時刻 | Chromium(SW / GPU) | Firefox |
|---|---|---|
| JPEG 64MP、0ms 後(判定の読み込み中) | `signal.reason` で reject(0.2ms 以内)。デコードは始まらない | 同じ |
| JPEG 64MP、20ms / 40ms 後 | `signal.reason` で reject(0.2ms 以内)。あとで届いた ImageBitmap は閉じられた | **resolve した**(106〜111ms)。主スレッドが止まっていて、中断のイベントが後から届いた |
| PNG RGB 64MP、10ms 後 | 同上 | 同上(60ms で resolve) |

## 6. 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 形式はファイルの先頭のバイトで判定する。JPEG / PNG / GIF / WebP / BMP / TIFF はシグネチャ、AVIF / HEIF は `ftyp` の brand、SVG は先頭 4,096 バイトの `<svg` 要素。拡張子(`File.name`)は使わない | `File.type` は拡張子だけで決まり、空や誤りがありうる(1 章)。ブラウザのデコーダーも中身で形式を決める(2 章) | 実測のみ |
| 2 | `File.type` は、中身で判定できないときに拒否の理由を選ぶためだけに使う。HEIC / HEIF → `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、受け付ける形式の MIME タイプ → `INPUT_DECODE_FAILED`(デコードしない)、それ以外 → `INPUT_FORMAT_REJECTED` | デコーダーは同じシグネチャで形式を決めるので、判定できない中身はデコードできない(壊れている)と考えられる。デコードを試さないので、ICO などを拡張子の付け替えで通さない | 実測のみ(乱数・SOI の後が乱数は失敗した)。「同じシグネチャ」は推測のみ |
| 3 | 受け付けるのは、中身が仕様書 6.5 の 6 形式のものだけ。ICO など、ブラウザがデコードできても一覧に無い形式は `INPUT_FORMAT_REJECTED` | 「デコードできたか」だけでは ICO も通る(2 章) | 実測のみ |
| 4 | AVIF の brand(`avif` / `avis`)があれば AVIF、無くて HEIF の brand(`heic` `heix` `heim` `heis` `hevc` `hevx` `hevm` `hevs` `mif1` `msf1` `mif2` `miaf`)があれば HEIF | AVIF も `mif1` / `miaf` を持つ(heif-enc の AVIF は `avif` + `mif1 avif miaf`)。sips の HEIC は major brand が `heix` | 実測のみ |
| 5 | 画素数はデコードの前にヘッダーから読む。JPEG は SOF、PNG は IHDR、GIF は論理画面と最初のフレームの右端・下端の大きいほう、WebP は `VP8 ` / `VP8L` / `VP8X`、BMP は DIB ヘッダー(高さは絶対値)、AVIF は `ispe` の面積が最大のもの。読めなければ、デコードしてから確かめる | デコードすると画素数 × 約 4 バイトを使い、300KB で 1GB になる(3 章)。ヘッダーなら 1ms 前後で判定できる | 実測のみ |
| 6 | WebP の寸法は、T04 の `parseWebp` ではなく、先頭 30 バイトから読む(libwebp の `WebPGetInfo` と同じ欄) | `parseWebp` は RIFF の大きさとデータの長さの一致を確かめるので、ファイル全体(最大 40MB)を読む必要がある。単体テストで、T04 のフィクスチャ 6 つの寸法が `parseWebp` と一致することを確かめた | 実測のみ |
| 7 | 判定の順番は、空のファイル → 形式 → ファイルのバイト数(40MB)→ 画素数。読むのは先頭の 64KiB と、ヘッダーのある場所だけ | 40MB を超える HEIC にも変換の案内を出すため | 設計判断 |
| 8 | 空のファイルは `INPUT_DECODE_FAILED`(`File.type` に関係なく) | 壊れたファイルとして扱う | 設計判断 |
| 9 | GIF には、アニメーションかどうかに関係なく `GIF_FIRST_FRAME_ONLY` を付ける | T14 の文言は静止画の GIF にも当てはまる。フレームを数えるには、最初のフレームの画像データをすべてたどる必要がある | 設計判断 |
| 10 | `DecodedImage` の `width` / `height` は ImageBitmap のもの(EXIF の向き・`irot` を反映したあと)。`mimeType` は中身の形式の MIME タイプ(`File.type` ではない)。`filename` / `fileBytes` は File のまま | 仕様書 6.3 の縮小は向きを反映した寸法で行う | 実測のみ(向き 6 の JPEG は 200 × 400) |
| 11 | ヘッダーを探すときに読み飛ばすセグメント・ブロック・ボックスは、合わせて 10,000 個まで。超えたら寸法は分からないとして、デコード後に確かめる | 1 つずつ `await` で読むので、細かいブロックを大量に並べたファイルでも時間が掛からないように | 設計判断 |
| 12 | 中断は、入口・読み込み・デコードの待ちで `signal.reason` で reject する(T13 の `abortable` を使う)。中断のあとに届いた ImageBitmap は閉じる | Chromium では 0.2ms 以内に reject した。Firefox では主スレッドが止まるので、デコード中の中断はデコードの後になる(4 章) | 実測のみ |
| 13 | 途中で切れたファイルは検出しない(Firefox では、欠けた部分が白・透明の画像になる) | JPEG の末尾の EOI を確かめると、JPEG の後ろに別のデータを付けたファイル(動画付きの写真など)を拒否してしまう | 推測のみ |

## 後続タスクへの申し送り

- [[T23-upload-hook|T23]]: `decodeImage(file, { signal })` の結果は、`try { … } finally { decoded.close(); }` で必ず閉じる。Firefox ではデコード中の中断が間に合わず resolve することがあるので、その後の `compressImage` が中断で reject したときも `finally` で閉じる。ギャラリーで複数のファイルを受け取ったら、`inspectInputFile` で先にまとめて判定すると、HEIC などを最初に知らせられる(判定は 1 件 1ms 前後)。テストでは `createDecodeImage({ createImageBitmap: 偽物 })` に、ヘッダーだけの本物のバイト列(PNG の IHDR など)の File を渡す。
- [[T27-image-widget|T27]] / [[T28-gallery-widget|T28]]: Firefox では、デコードの間(64MP で 100ms 前後)は画面が止まる。「デコード中…」の表示は、デコードを始める前に描画しておく。
- [[T31-e2e|T31]]: `page.setInputFiles(パス)` で、実際のブラウザの `File.type` になる。HEIC は `sips -s format heic` か `heif-enc` で作れる。

## 再現のコード

スパイクのコードは `spikes/input-decode/`(git 管理外)にある。

### 画素数の多い PNG(ファイルは小さい)

```js
// 一色のグレースケール 8 ビット。行ごとに deflate に流す(1.07GP でも 1.1MB になる)
import { Readable } from "node:stream";
import { crc32, createDeflate } from "node:zlib";

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td) >>> 0);
	return Buffer.concat([len, td, crc]);
}

async function makePng(width, height) {
	const row = Buffer.alloc(1 + width, 0x80);
	row[0] = 0; // フィルター: なし
	let y = 0;
	const rows = new Readable({
		read() {
			for (let i = 0; i < 64 && y < height; i++, y++) this.push(row);
			if (y >= height) this.push(null);
		},
	});
	const parts = [];
	for await (const part of rows.pipe(createDeflate({ level: 9 }))) parts.push(part);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // ビット深度。色の種類は 0(グレースケール)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", Buffer.concat(parts)), // 実際には 1MiB ずつに分けた
		chunk("IEND", Buffer.alloc(0)),
	]);
}
```

### メモリの測り方(Node 側)

```js
import { chromium } from "@playwright/test";

const server = await chromium.launchServer({ headless: true });
const rootPid = server.process().pid; // この pid とその子孫の RSS を ps -A -o pid=,ppid=,rss= で足し合わせる
const browser = await chromium.connect(server.wsEndpoint());
// 20ms ごとに RSS を取りながら、ページで createImageBitmap(file, { imageOrientation: "from-image" }) を待つ
```

### 主スレッドが止まる時間(ページ側)

```js
const ticks = [];
let running = true;
const tick = () => {
	ticks.push(performance.now());
	if (running) setTimeout(tick, 0);
};
tick();
const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
const resolvedAt = performance.now();
running = false;
// 解決した時刻も含めて、隣り合う時刻の差の最大を取る(主スレッドが止まると、次の tick より先に解決が届く)
const points = [...ticks, resolvedAt];
const maxGap = Math.max(...points.slice(1).map((t, i) => t - points[i]));
bitmap.close();
```

### EXIF の向き 6 の JPEG

```js
// SOI の直後に、IFD0 に Orientation(0x0112)= 6 だけを持つ APP1 を入れる
const tiff = Buffer.alloc(26);
tiff.write("MM", 0, "latin1");
tiff.writeUInt16BE(42, 2);
tiff.writeUInt32BE(8, 4);
tiff.writeUInt16BE(1, 8); // エントリの数
tiff.writeUInt16BE(0x0112, 10); // Orientation
tiff.writeUInt16BE(3, 12); // SHORT
tiff.writeUInt32BE(1, 14);
tiff.writeUInt16BE(6, 18);
const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, payload.length + 2]), payload]);
const oriented = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
```
