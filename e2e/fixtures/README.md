---
title: E2E の入力画像(e2e/fixtures)
aliases:
  - E2E の入力画像
  - E2E のフィクスチャ
tags:
  - test
  - e2e
  - fixture
source_task: "[[T26-playground-pages]]"
created: 2026-09-24
updated: 2026-09-24
---

# E2E の入力画像

> [!summary] 概要
> - [[T31-e2e|T31]] の E2E で、管理画面のファイル選択に渡す画像。`make-images.ts` が `images/` に作る。
> - **作ったファイルは git に入れない**(`.gitignore`)。40MB を超えるファイルがあり、どれも 2 秒ほどで作り直せるため。
> - macOS でだけ作れる(`sips` を使う)。ほかに使うのは Node の標準機能と、Playwright の Chromium。
> - 下の表の「結果」は、本番の `inspectInputFile` → `decodeImage` → `compressImage`(既定の options)→ `createThumbnail` に、`setInputFiles` で選んだファイルを通して確かめたもの(Chromium 153・Firefox 155)。
> - 関連: [[e2e-input-image-fixtures]](作り方の知見と測定の詳細)、[[input-image-decode]]、[[T12-input-decode#後続タスク向けのメモ|T12]]、[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)|仕様書 6.5]]

## 作り方

```sh
node e2e/fixtures/make-images.ts   # リポジトリのルートで。images/ に 28 個のファイルを作る(上書きする)
```

- 中身は毎回同じ(乱数は種を固定)。同じマシンで作り直すと、`sips` と Chromium の出力も含めてバイト列まで同じだった。OS やブラウザの版が変わると、JPEG・AVIF・HEIC・WebP などのバイト列は変わりうる(推測のみ)。
- T31 では、テストの前(Playwright の `globalSetup` など)に実行する。E2E では `page.setInputFiles(パス)` で渡す(実際のブラウザの `File.type` になる)。

## ファイル

### 受け付けるもの

| ファイル | 中身 | 作り方 | 結果(Chromium 153 / Firefox 155) | 使いみち |
|---|---|---|---|---|
| `photo-2400x1600.jpg` | 写真の代わりの風景(797,053 B) | Node の PNG → `sips`(品質 90) | 1600×1067 に縮小。画質 0.64 / 0.63、保存 97,991 / 99,071 B(7 回のエンコード、約 0.5 秒) | 単一画像のアップロード。長辺が `maxEdge`(1600)を超えるので、縮小と画質の探索が起きる。保存が 100,000 B 以下になることの確認 |
| `photo-exif-orientation-6.jpg` | 上と同じ JPEG に EXIF の向き 6(時計回りに 90 度) | Node | ヘッダーは 2400×1600、デコードは **1600×2400**。1067×1600、画質 0.68 / 0.64 | 向きの反映(サイトの `<img>` が縦長になる) |
| `png-alpha-640x480.png` | 中心が赤、外側ほど透明 | Node | 640×480、画質 0.92。圧縮した WebP の角も透明(`[0, 0, 0, 0]`) | 透過の保持 |
| `webp-640x480.webp` | 風景の縮小版 | Chromium の canvas(画質 0.9) | 640×480、画質 0.92 | WebP の入力 |
| `avif-640x480.avif` | 同上 | `sips` | 640×480、画質 0.92 | AVIF の入力 |
| `bmp-640x480.bmp` | 同上 | `sips` | 640×480、画質 0.92 | BMP の入力 |
| `gif-animated-320x240.gif` | 3 フレーム(赤 → 緑 → 青、白い番号) | Node(LZW) | 注意 `GIF_FIRST_FRAME_ONLY`。圧縮した画像は 1 フレーム目(赤) | GIF の注意と、静止画になること |
| `gallery-01.png` 〜 `gallery-12.png` | 色の違う背景に大きな番号(800×600) | Node | 800×600、画質 0.92、保存 3〜6KB | ギャラリーの追加・並べ替え・削除。11・12 枚目は枚数の上限(既定 10)を超える確認用 |

### 拒否するもの

| ファイル | 中身 | 作り方 | 結果(両方のブラウザで同じ) | `File.type` |
|---|---|---|---|---|
| `heic-640x480.heic` | HEIC | `sips` | `INPUT_HEIC_REJECTED` | `image/heic` |
| `heic-named-as-jpeg.jpg` | 上と同じ HEIC(拡張子だけ `.jpg`) | コピー | `INPUT_HEIC_REJECTED`(中身で判定する) | `image/jpeg` |
| `vector.svg` | SVG | Node | `INPUT_SVG_REJECTED` | `image/svg+xml` |
| `tiff-640x480.tiff` | TIFF | `sips` | `INPUT_FORMAT_REJECTED` | `image/tiff` |
| `icon-32x32.ico` | ICO(ブラウザはデコードできる) | `sips` | `INPUT_FORMAT_REJECTED` | Chromium `image/vnd.microsoft.icon`、Firefox `image/x-icon` |
| `random-bytes.jpg` | 乱数 2,000 B | Node | `INPUT_DECODE_FAILED`(形式に当たらないので、デコードしない) | `image/jpeg` |
| `jpeg-broken-after-signature.jpg` | JPEG のシグネチャ(`FF D8 FF`)の後ろが乱数 | Node | `INPUT_DECODE_FAILED`(JPEG と判定し、デコードに失敗する) | `image/jpeg` |
| `too-large-file-4000x3334.png` | 40,017,958 B の PNG(約 1,334 万画素) | Node(無圧縮の deflate) | `INPUT_FILE_TOO_LARGE` | `image/png` |
| `too-many-pixels-8000x8001.png` | 6,400 万 8,000 画素の PNG(76,396 B) | Node | `INPUT_TOO_MANY_PIXELS`(デコードしない) | `image/png` |

> [!warning] HEIC は「MIME タイプを偽ったファイル」では代用できない
> 中身が JPEG で拡張子だけ `.heic` のファイルは、`File.type` が `image/heic` でも **JPEG として受け付けられた**(`src/client/input.ts` は中身で形式を決める。[[T12-input-decode|T12]])。HEIC の拒否は、本物の HEIC(`heic-640x480.heic`)で確かめる。中身が乱数で拡張子が `.heic` のファイルは `INPUT_HEIC_REJECTED` になった(中身で判定できないときだけ `File.type` を使う)。

## 入れていないもの

| もの | 理由 |
|---|---|
| 途中で切れた JPEG・PNG | Firefox 155 は欠けた部分を白・透明にしてデコードする。壊れたファイルの確認には `random-bytes.jpg` と `jpeg-broken-after-signature.jpg` を使う([[T12-input-decode#後続タスク向けのメモ\|T12]]) |
| Safari の代わり | ファイルは要らない。`toBlob` が PNG を返すモックで確かめる([[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト\|仕様書 15 章]]) |
| 6,400 万画素ちょうどの画像 | 境界は単体テスト([[T12-input-decode\|T12]])で確かめている。デコードに約 250MB を使い、圧縮にも時間が掛かる |
