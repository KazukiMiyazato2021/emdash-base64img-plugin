---
title: テスト用の WebP(tests/fixtures/webp)
aliases:
  - WebP のフィクスチャ
tags:
  - test
  - fixture
  - webp
source_task: "[[T04-webp-utils]]"
created: 2026-09-24
updated: 2026-09-24
---

# テスト用の WebP

> [!summary] 概要
> - [[T04-webp-utils|T04]] の単体テスト(`tests/shared/webp.test.ts`)が使う、小さな WebP。libwebp 1.6.0 のコマンドで作った。
> - 元の画像(PAM)は `make-fixtures.ts` が計算で作り、一時ディレクトリに置いて、終わったら消す。リポジトリには WebP だけを入れる。
> - 関連: [[webp-data-url-validation|WebP の data URL の検証]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8 章]]

## ファイル

| ファイル | バイト数 | チャンクの並び | 寸法 | 透過 | 作り方 |
|---|---|---|---|---|---|
| `lossy.webp` | 778 | `VP8 ` | 300 × 199 | なし | `cwebp -q 50` |
| `lossless.webp` | 1,314 | `VP8L` | 257 × 129 | なし | `cwebp -lossless` |
| `lossy-alpha.webp` | 3,936 | `VP8X` + `ALPH` + `VP8 ` | 261 × 173 | あり | `cwebp -q 50`(RGBA の入力) |
| `lossless-alpha.webp` | 3,290 | `VP8L`(alpha_is_used = 1) | 131 × 67 | あり | `cwebp -lossless`(RGBA の入力) |
| `lossless-xmp.webp` | 808 | `VP8X` + `VP8L` + `XMP ` | 63 × 37 | なし | `cwebp -lossless` の後、`webpmux -set xmp` |
| `animated.webp` | 664 | `VP8X` + `ANIM` + `ANMF` × 2 | 97 × 61(キャンバス) | なし | `img2webp -loop 0 -lossy -q 50 -d 100` |

- 3 種類のチャンク(`VP8 ` = 非可逆、`VP8L` = 可逆、`VP8X` = 拡張)を、それぞれ最初のチャンクとして含む。
- 寸法は、幅と高さの取り違えに気付けるよう、縦横で違う値にした。
- `lossy.webp` / `lossless.webp` / `lossy-alpha.webp` は幅が 255 を超えるので、幅の欄が 2 バイト目にかかる。
- `lossless.webp` の幅 257 は、VP8L の「幅 - 1」が 256(9 ビット目だけが 1)になる値。
- `lossless-xmp.webp` の XMP チャンクの中身は 243 バイト(奇数)で、後ろに詰め物の 0 が 1 バイトある。画像データの後ろにチャンクがある拡張形式と、詰め物の読み飛ばしを試すため。
- チャンクの並び・寸法・透過は、`webpinfo`(libwebp 1.6.0)の出力で確かめた。根拠: **実測のみ**

## 作り直す手順

```sh
node tests/fixtures/webp/make-fixtures.ts
```

- Node 26 は `.ts` をそのまま実行できる(型の注釈を取り除いて実行する)。根拠: **実測のみ**
- libwebp のコマンドの場所は、環境変数 `WEBP_BIN_DIR` で変えられる(既定 `/opt/homebrew/bin`)。
- 元の画像(PAM、8 ビット):
  - 不透明: 右に行くほど赤、下に行くほど緑が増えるグラデーション(`TUPLTYPE RGB`)。
  - 透過つき: 同じグラデーションに、中央の楕円の外側ほど透明になるアルファを付けたもの(`TUPLTYPE RGB_ALPHA`。四隅は完全に透明)。
  - アニメーションの 2 枚目は、1 枚目の色を反転したもの。
- 作り直したら、`webpinfo tests/fixtures/webp/*.webp` でチャンクの並びと寸法を確かめ、この表とテストの期待値(`FIXTURES`)を合わせる。

> [!warning] バイト列は環境によって変わることがある
> libwebp の版や CPU(SIMD の実装)が変わると、同じ入力でも圧縮データが変わることがある(推測のみ)。テストはバイト列ではなく、チャンクの並び・寸法・透過を確かめるので、作り直しても通る見込み。バイト数が変わったら、この表を直す。

> [!info] 作った環境
> macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0、cwebp 1.6.0(libsharpyuv 0.4.2)、img2webp / webpmux / webpinfo 1.6.0(Homebrew の webp 1.6.0)。2026-09-24 に作成。

## リポジトリに入れないもの

- 処理時間の計測に使った写真(p4、2400×1600)と、それを変換した WebP(74,668 B)。計測の手順と結果は [[webp-data-url-validation#処理時間|知見ノートの「処理時間」]] に書いた。
