---
id: T04
title: "WebP と data URL の低レベル処理を作る"
type: 実装
status: done
wave: 1
depends_on:
  - "[[T01-scaffold]]"
soft_depends_on: []
blocks:
  - "[[T11-server-validation]]"
  - "[[T13-encode-search]]"
files:
  - "src/shared/webp.ts"
  - "src/shared/data-url.ts"
  - "tests/shared/webp.test.ts"
  - "tests/fixtures/webp/**"
spec:
  - "[[base64-image-plugin-spec#6.2 サイズ予算(Q6)]]"
  - "[[base64-image-plugin-spec#8. サーバー側の検証]]"
tags:
  - task
  - impl
  - shared
created: 2026-09-23
---

# T04 WebP と data URL の低レベル処理を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 1
> - 着手の条件(依存): [[T01-scaffold|T01]]
> - このタスクを待つもの: [[T11-server-validation|T11]]、[[T13-encode-search|T13]]
> - 仕様: [[base64-image-plugin-spec#6.2 サイズ予算(Q6)|仕様書 6.2]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8章]]

## 目的

サーバー側の検証と、ブラウザ側の圧縮処理の両方が使う低レベルの処理を用意する。

## 作業内容

- [x] data URL の分解(`data:image/webp;base64,` で始まるか、base64 の文字種)
- [x] base64 のデコード(`Uint8Array.fromBase64` があれば使い、なければ `atob`)
- [x] WebP ヘッダーの解析(RIFF / WEBP、`VP8 ` / `VP8L` / `VP8X`)による寸法の取得
- [x] 保存サイズの計算(`23 + 4 × ceil(B / 3)`)と、その逆算(予算から WebP 本体の上限を求める)
- [x] テスト用 WebP の作成(cwebp で非可逆・可逆・透過つきを作り、`tests/fixtures/webp/` に置く)

## 完了条件

- [x] 単体テスト: 3種類のチャンク、壊れたデータ、境界値(WebP 本体 74,982 / 74,983 バイト)
- [x] 約 100KB の data URL の処理が 1ms 未満(仕様書 付録 A.4 と同程度)

## 変更してよいファイル

- `src/shared/webp.ts`
- `src/shared/data-url.ts`
- `tests/shared/webp.test.ts`
- `tests/fixtures/webp/**`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!summary] まとめ
> - `src/shared/data-url.ts` と `src/shared/webp.ts` を作った。単体テストは `tests/shared/webp.test.ts` の 191 件。テスト用の WebP 6 個と、作り直すスクリプト・README を `tests/fixtures/webp/` に置いた。
> - 詳しい知見(デコーダーの挙動、libwebp との比較、canvas の出力、処理時間の手順)は [[webp-data-url-validation]] に書いた。

### 後続タスク(T11・T13)が使う export

| export | ファイル | 内容 |
|---|---|---|
| `WEBP_DATA_URL_PREFIX` | `data-url.ts` | `"data:image/webp;base64,"`(23 文字) |
| `storedBytesForWebp(webpByteLength)` | `data-url.ts` | 保存サイズ `23 + 4 × ceil(B / 3)` |
| `maxWebpBytesForBudget(maxStoredBytes)` | `data-url.ts` | 逆算。100,000 → 74,982 |
| `parseWebpDataUrl(dataUrl)` | `data-url.ts` | 接頭辞・base64・WebP ヘッダーをまとめて確かめ、`{ ok: true, bytes, info }` か `{ ok: false, reason }` を返す(T11 の入口) |
| `decodeWebpDataUrl(dataUrl)` | `data-url.ts` | 接頭辞と base64 だけを確かめて、WebP 本体のバイト列を返す |
| `toWebpDataUrl(bytes)` / `encodeBase64(bytes)` / `decodeBase64(base64)` | `data-url.ts` | data URL・base64 の組み立てと分解 |
| `parseWebp(bytes)` | `webp.ts` | WebP のバイト列から `{ format, width, height, hasAlpha, animated }` を読む |
| 型 `WebpInfo` / `WebpFormat` / `WebpErrorReason` / `WebpParseResult` | `webp.ts` | 結果の型と、拒否の理由(10 種類) |
| 型 `DataUrlErrorReason` / `Base64DecodeResult` / `WebpDataUrlDecodeResult` / `WebpDataUrlParseResult` | `data-url.ts` | 結果の型と、拒否の理由(`NOT_WEBP_DATA_URL` / `INVALID_BASE64`) |

### 決めたこと

- エラーは例外ではなく `{ ok: false, reason }` で返す。理由のコードは T04 の中だけのもので、[[T11-server-validation|T11]] が [[T03-shared-contracts|T03]] のエラーコードに対応づける。T03 のファイルは import していない(リーダーの指定どおり)。例外を投げるのは、サイズ計算の関数に不正な数を渡したとき(`RangeError`)だけ。
- 接頭辞は `data:image/webp;base64,` と完全に一致すること(大文字・小文字も区別する)。Chromium・Firefox の `FileReader.readAsDataURL` の出力は、この形だった。根拠: **実測のみ**
- base64 は、詰め物ありの正規の形だけを受け付ける。空白・URL 用の文字・詰め物の省略・使われないビットが 0 でない形を拒否する。`atob` と `fromBase64` は空白を読み飛ばすので、デコード後のバイト数で検出する(正規表現の検査は 0.043〜0.181ms かかり、デコード本体の 0.012ms より重い)。根拠: **実測のみ**
- WebP は、libwebp と同じ条件に加えて、RIFF のサイズ欄とデータ長の一致、チャンクの並びが末尾でちょうど終わること、単純形式のチャンクが 1 つだけであることを求める。どれも dwebp はデコードできるデータだが、canvas の出力(Chromium・Firefox の 8 通り)はすべて満たした。根拠: **実測+公式ドキュメント**(dwebp 1.6.0、RFC 9649、libwebp のソース)
- アニメーションの WebP は拒否せず、`animated: true` とキャンバスの寸法を返す(libwebp の `WebPGetFeatures` と同じ)。受け付けるかは T11 が決める。静止画しか作らない前提なので、拒否してよい見込み。根拠: **推測のみ**
- タスクの作業内容に無い `encodeBase64` / `toWebpDataUrl` も作った。T13 が Blob から同期で data URL を作れるようにするためと、境界値のテストで「計算した保存サイズ = 実際の data URL の長さ」を確かめるため。

### 確かめたこと

- 3 種類のチャンク: cwebp・img2webp・webpmux で作った 6 個(`VP8 `、`VP8L`、`VP8X` + `ALPH` + `VP8 `、`VP8L` の透過、`VP8X` + `VP8L` + `XMP `、アニメーション)の寸法・透過が、webpinfo の出力と一致した。組み立てたヘッダーで、14 ビット・24 ビットの最大値も読めた。根拠: **実測のみ**
- 壊れたデータ: 10 種類の理由それぞれを返すケースと、どこで切っても・ランダムに書き換えても例外を投げないことをテストした。根拠: **実測のみ**
- 境界値: WebP 本体 74,982 バイトは保存 99,999、74,983 バイトは 100,003。実際の data URL の長さとも一致した。根拠: **実測のみ**
- テストが実際の不具合で失敗するか: ソースに 23 通りの不具合を 1 つずつ入れて実行した。21 通りでテストが失敗した。失敗しなかった 2 通り(長さが 4 の倍数かの確認を外す、`fromBase64` を loose で使う)は、ほかの確認が同じものを拒否するので、結果が変わらない変更だった。根拠: **実測のみ**
- 処理時間: 約 100KB の data URL(p4 を 1024px・画質 77 にした WebP 74,668 B、data URL 99,583 文字)の `parseWebpDataUrl` は、Node 26.10.0 で中央値 0.009ms(`fromBase64`)/ 0.062ms(`atob`)、Chromium 153 で平均 0.014 / 0.089ms、Firefox 155 で平均 0.026 / 0.146ms。どれも 1ms 未満。計測はテストに入れていない。手順は [[webp-data-url-validation#処理時間]]。根拠: **実測のみ**

### 仕様書・他のタスクへの影響

- 仕様書は変更していない(仕様 8 章の検証内容を細かくしただけで、食い違いは無い)。
- [[T03-shared-contracts|T03]] / [[T11-server-validation|T11]] / [[T13-encode-search|T13]]: サムネイルの「8,000 バイト以下」が data URL の長さか WebP 本体か、仕様書の中で書き方が揃っていない(5.3 は data URL、6.4・8 章は WebP)。data URL なら WebP 本体は 5,982 バイトまで。決める必要がある。
- [[T11-server-validation|T11]]: `parseWebpDataUrl` の前に `dataUrl.length` を上限と比べる(巨大な文字列をデコードしないため)。アニメーションを受け付けるかを決める。
- [[T05-spike-canvas-webp|T05]] / [[T13-encode-search|T13]]: Chromium 153 の canvas の WebP には、不透明でも `VP8X` + `ICCP` が付き、cwebp より 1 枚あたり 482 バイト大きい。仕様書 付録 A.2 の見積もりには入っていない。根拠: **実測のみ**
