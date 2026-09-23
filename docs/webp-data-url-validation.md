---
title: WebP の data URL の検証(base64 のデコードとヘッダーの解析)
aliases:
  - WebP ヘッダーの解析
  - base64 デコーダーの挙動
  - data URL の処理時間
tags:
  - docs
  - webp
  - base64
source_task: "[[T04-webp-utils]]"
created: 2026-09-24
updated: 2026-09-24
---

# WebP の data URL の検証(base64 のデコードとヘッダーの解析)

> [!summary] 要点
> - `atob` と `Uint8Array.fromBase64` は、どちらも ASCII の空白を黙って読み飛ばす(`lastChunkHandling: "strict"` でも)。`atob` は詰め物の省略や、使われないビットが 0 でない形(`QR==`)も受け付ける。そのままでは不正な文字を拒否できない。根拠: **実測のみ**
> - 1 文字ずつ調べる正規表現は、デコード本体より重い(約 100KB で 0.043〜0.181ms。`fromBase64` は 0.012ms)。そこで、長さ・詰め物・最後の文字を O(1) で確かめ、デコード後のバイト数が文字数から求めた値と合うかで空白を見つける。根拠: **実測のみ**
> - `parseWebp` は libwebp と同じ条件でヘッダーを確かめ、さらに「後ろの余計なデータ」「単純形式の余計なチャンク」「最後の詰め物の欠落」も拒否する(dwebp 1.6.0 はデコードできる)。根拠: **実測+公式ドキュメント**(RFC 9649、libwebp のソース)
> - Chromium 153 の canvas の WebP は、不透明でも `VP8X` + `ICCP`(ICC プロファイル)付きの拡張形式になる(1 枚あたり 482 バイト増える)。Firefox 155 は、不透明なら `VP8 ` だけの単純形式。どちらも画質 1.0 は可逆(`VP8L`)になる。`parseWebpDataUrl` は 8 通りの出力をすべて受け付けた。根拠: **実測のみ**
> - 約 100KB の data URL(p4、WebP 74,668 B)の `parseWebpDataUrl` は、Node 26 で中央値 0.009ms(`fromBase64`)/ 0.062ms(`atob`)。Chromium・Firefox でも 0.15ms 以下で、1ms 未満を満たす。根拠: **実測のみ**
> - 関連: [[T04-webp-utils]]、[[base64-image-plugin-spec#6.2 サイズ予算(Q6)|仕様書 6.2]]、[[base64-image-plugin-spec#8. サーバー側の検証|仕様書 8 章]]、[[base64-image-plugin-spec#A.4 サーバー側の検証処理の重さ|仕様書 付録 A.4]]、テスト用の WebP は `tests/fixtures/webp/README.md`

## 作ったもの

| ファイル | 主な export | 用途 |
|---|---|---|
| `src/shared/data-url.ts` | `WEBP_DATA_URL_PREFIX`、`storedBytesForWebp`、`maxWebpBytesForBudget`、`decodeBase64`、`encodeBase64`、`toWebpDataUrl`、`decodeWebpDataUrl`、`parseWebpDataUrl`、型 `DataUrlErrorReason` / `Base64DecodeResult` / `WebpDataUrlDecodeResult` / `WebpDataUrlParseResult` | 保存サイズの計算、data URL の分解と組み立て、検証の入口 |
| `src/shared/webp.ts` | `parseWebp`、型 `WebpInfo` / `WebpFormat` / `WebpErrorReason` / `WebpParseResult` | RIFF / WEBP と `VP8 ` / `VP8L` / `VP8X` の解析 |

- どの関数も、不正な入力には例外を投げず `{ ok: false, reason }` を返す。例外を投げるのは、`storedBytesForWebp` / `maxWebpBytesForBudget` に不正な数を渡したとき(呼び出し側の誤り。`RangeError`)だけ。
- 理由のコードは T04 の中だけのもの。[[T11-server-validation|T11]] が [[T03-shared-contracts|T03]] のエラーコードに対応づける。

| 理由 | 意味 |
|---|---|
| `NOT_WEBP_DATA_URL` | `data:image/webp;base64,` で始まらない(大文字・小文字も区別する) |
| `INVALID_BASE64` | 接頭辞より後が、正しい base64 でない |
| `TOO_SHORT` | 20 バイト(RIFF ヘッダー + 最初のチャンクヘッダー)に満たない |
| `NOT_WEBP` | `RIFF` / `WEBP` のシグネチャが無い |
| `RIFF_SIZE_MISMATCH` | RIFF のサイズ欄 + 8 がデータ長と違う(途中で切れている、後ろに余計なデータがある) |
| `MALFORMED_CHUNK` | チャンクがデータの範囲を超える、末尾でちょうど終わらない、単純形式に余計なチャンクがある |
| `UNSUPPORTED_FORMAT` | 最初のチャンクが `VP8 ` / `VP8L` / `VP8X` のどれでもない |
| `INVALID_VP8_HEADER` / `INVALID_VP8L_HEADER` / `INVALID_VP8X_HEADER` | 各チャンクのヘッダーが不正 |
| `MISSING_IMAGE_DATA` | `VP8X` の後に画像データのチャンクが無い |
| `CANVAS_SIZE_MISMATCH` | `VP8X` のキャンバスの寸法と、画像データの寸法が違う |

## 保存サイズの計算(仕様書 6.2)

- 保存サイズ = `23 + 4 × ceil(B / 3)`(`storedBytesForWebp`)。B は WebP 本体のバイト数。
- 逆算 = `3 × floor((予算 - 23) / 4)`(`maxWebpBytesForBudget`)。予算に入る 4 文字の組の数 × 3 バイト。

| 予算(保存サイズの上限) | WebP 本体の上限 | そのときの保存サイズ |
|---|---|---|
| 8,000 | 5,982 | 7,999 |
| 100,000(既定) | 74,982 | 99,999 |
| 500,000(固定上限) | 374,982 | 499,999 |

- 境界: WebP 本体 74,982 バイトは保存 99,999 で予算内、74,983 バイトは 100,003 で予算外。テストで固定した。実際に `toWebpDataUrl` で作った data URL の長さとも一致する。根拠: **実測のみ**(単体テスト)
- 予算 23〜3,000 のすべてと主な値で、「逆算した上限の保存サイズは予算以内、1 バイト増やすと予算を超える」ことをテストで確かめた。根拠: **実測のみ**

> [!question] サムネイルの 8,000 バイトはどちらの長さか
> 仕様書 5.3 は `thumb`(data URL)に「8,000 バイト以下」、6.4 と 8 章は「WebP(8,000 バイト以下)」と書いている。data URL の長さなら WebP 本体は 5,982 バイトまで、WebP 本体なら data URL は最大 10,691 文字になる。[[T03-shared-contracts|T03]] の定数と [[T11-server-validation|T11]] / [[T13-encode-search|T13]] の実装で揃える必要がある(未決)。

## base64 のデコード

### デコーダーの挙動(Node 26.10.0)

| 入力 | `fromBase64`(strict) | `fromBase64`(既定の loose) | `atob` |
|---|---|---|---|
| `QUJD` | `ABC` | `ABC` | `ABC` |
| `QR==`(使われないビットが 0 でない) | SyntaxError | `A` | `A` |
| `QUJ=`(同上) | SyntaxError | `AB` | `AB` |
| `QQ`(詰め物の省略) | SyntaxError | `A` | `A` |
| `QU JD`(スペース) | `ABC` | `ABC` | `ABC` |
| 改行・タブ・復帰・改ページ | 読み飛ばす | 読み飛ばす | 読み飛ばす |
| 垂直タブ・ノーブレークスペース | SyntaxError | SyntaxError | DOMException |
| `-` / `_`(URL 用の文字)、`!`、ASCII 以外 | SyntaxError | SyntaxError | DOMException |
| 途中の `=`、`Q===` | SyntaxError | SyntaxError | DOMException |

- 根拠: **実測のみ**(Node 26.10.0)。読み飛ばしたのはタブ・改行・改ページ・復帰・スペースの 5 つで、垂直タブとノーブレークスペースは拒否した。
- Chromium 153 と Firefox 155 にも `Uint8Array.fromBase64` / `toBase64` がある。根拠: **実測のみ**
- TypeScript 6.0.3 では、型が `lib.esnext.typedarrays.d.ts` にある([[test-lint-setup#TypeScript]])。

### 検証の方法

`decodeBase64` は、次の順に確かめる。どちらのデコーダーを使っても同じ結果になる。

1. 長さが 4 の倍数(詰め物の省略を拒否する)。
2. 末尾の `=` は 2 つまで。詰め物の直前の文字の、使われない下位ビット(`=` 1 つなら 2 ビット、2 つなら 4 ビット)が 0。
3. `Uint8Array.fromBase64(s, { lastChunkHandling: "strict" })`、無ければ `atob` + `charCodeAt` のループでデコードする。SyntaxError と DOMException(`InvalidCharacterError`)は不正として扱い、それ以外の例外はそのまま投げる。
4. デコードしたバイト数が `長さ / 4 × 3 - 詰め物の数` と一致する。デコーダーが空白を読み飛ばすと、バイト数がこれより少なくなるので拒否できる。

- 空白を含む 8 件と、そのほかの不正な文字・詰め物の 15 件で、両方のデコーダーが `INVALID_BASE64` を返すことをテストで確かめた。根拠: **実測のみ**
- ソースに不具合を 1 つずつ入れてテストを実行したところ、手順 4 を外すと 9 件、手順 2 を外すと 2 件のテストが失敗した。手順 1 と `strict` は、ほかの手順と同じものを拒否するので、外してもテストは失敗しなかった(早めに打ち切るためと、念のために残している)。根拠: **実測のみ**

### 検査の重さ

p4 の WebP(74,668 B)を base64 にした 99,560 文字で、200 回の中央値を測った。

| 方法 | 中央値 |
|---|---|
| 正規表現 `^[A-Za-z0-9+/]*={0,2}$` で全体を照合する | 0.181ms |
| 正規表現 `[^A-Za-z0-9+/=]` で不正な文字を探す | 0.043ms |
| `Uint8Array.fromBase64`(strict) | 0.012ms |
| `atob` + `charCodeAt` のループ | 0.073ms |

- 正規表現の検査は、`fromBase64` のデコードより 3.6〜15 倍重い。上の手順 4 なら、追加の費用は O(1)。根拠: **実測のみ**

## WebP ヘッダーの解析

### 形式(RFC 9649)

- RIFF ヘッダー(12 バイト): `RIFF`、File Size(uint32、リトルエンディアン。オフセット 8 以降のバイト数)、`WEBP`(2.4)。
  - 「The file SHOULD NOT contain any data after the data specified by File Size. Readers MAY parse such files, ignoring the trailing data.」(2.4)
- チャンク: FourCC(4)+ サイズ(uint32)+ 中身。サイズが奇数なら、値が 0 の詰め物が 1 バイト付く(2.3)。
- 単純形式: RIFF ヘッダー + `VP8 ` チャンク(2.5)、または + `VP8L` チャンク(2.6)。
- 拡張形式: `VP8X` + 任意の `ICCP` / `ANIM` + 画像データ + 任意の `EXIF` / `XMP ` + 未知のチャンク(2.7)。未知のチャンクは読み飛ばすべき(2.7.1.6)。
  - `VP8X` の中身は 10 バイト。1 バイト目のフラグは上位から Rsv(2)・ICC・Alpha・EXIF・XMP・Animation・Rsv。キャンバスの「幅 - 1」「高さ - 1」は 24 ビット。幅 × 高さは 2^32 - 1 以下(2.7)。
- `VP8L` のヘッダー: シグネチャ 0x2f、「幅 - 1」(14 ビット)、「高さ - 1」(14 ビット)、alpha_is_used(1 ビット)、版(3 ビット、0 であること)(3.4)。
- `VP8 ` のフレームヘッダー: フレームタグ 3 バイト(キーフレーム・版・表示・最初のパーティションの大きさ)、開始コード `9d 01 2a`、幅・高さ(各 14 ビット + 拡大の指定 2 ビット)(RFC 6386 9.1)。
- 根拠: **公式ドキュメントのみ**(RFC 9649 は WebP の仕様、RFC 6386 は VP8 の仕様)

### libwebp と同じ条件

libwebp(GitHub の `webmproject/libwebp` の main、2026-09-24 に読んだ)と同じ条件で拒否する。

| 条件 | libwebp | 理由のコード |
|---|---|---|
| キーフレームでない、版が 3 より大きい、表示しないフレーム、最初のパーティション ≥ チャンクの大きさ、開始コードが違う、幅か高さが 0 | `VP8GetInfo`(`src/dec/vp8_dec.c`) | `INVALID_VP8_HEADER` |
| シグネチャが 0x2f でない、版が 0 でない | `VP8LCheckSignature` / `ReadImageInfo`(`src/dec/vp8l_dec.c`) | `INVALID_VP8L_HEADER` |
| `VP8X` の中身が 10 バイトでない、幅 × 高さ ≥ 2^32 | `ParseVP8X`(`src/dec/webp_dec.c`)、`MAX_IMAGE_AREA (1ULL << 32)`(`src/webp/format_constants.h`) | `INVALID_VP8X_HEADER` |
| 静止画で、キャンバスと画像データの寸法が違う | `ParseHeadersInternal` の「Validates image size coherency」 | `CANVAS_SIZE_MISMATCH` |

- アニメーション(`VP8X` の Animation フラグ)は、libwebp の `ParseHeadersInternal` と同じく、フレームを読まずにキャンバスの寸法を返す(`animated: true`)。
- 根拠: **公式ドキュメントのみ**(libwebp は WebP の参照実装。ソースを読んだだけで、この節の条件ごとには実行していない。キャンバスの寸法の違いと途中で切れたデータは、次の節で dwebp を実行して確かめた)
- 透過(`hasAlpha`)は、`VP8X` の Alpha フラグ、画像データより前の `ALPH` チャンク、`VP8L` の alpha_is_used のどれかが立っていれば true にした。フィクスチャと canvas の出力では、webpinfo の Alpha の値と一致した。フラグとビットが食い違うファイルでの libwebp との違いは確かめていない(このプラグインの検証には使わない)。根拠: **実測のみ**

### libwebp より厳しくしたこと

加工したファイルを、libwebp 1.6.0 の `dwebp` と `parseWebp` の両方に通した。

| データ | dwebp 1.6.0 | parseWebp |
|---|---|---|
| 正常な `lossy.webp` | デコードできる | 受け付ける |
| 後ろに余計な 4 バイト(RIFF のサイズ欄はそのまま) | デコードできる | `RIFF_SIZE_MISMATCH` |
| 単純形式の後ろに `JUNK` チャンク(サイズ欄は合わせた) | デコードできる | `MALFORMED_CHUNK` |
| 最後の奇数バイトのチャンク(`XMP `)の詰め物が無い(サイズ欄は合わせた) | デコードできる | `MALFORMED_CHUNK` |
| `VP8X` のキャンバスの幅が画像より 1 大きい | 失敗(`BITSTREAM_ERROR`) | `CANVAS_SIZE_MISMATCH` |
| 末尾が 10 バイト欠けている(サイズ欄はそのまま) | 失敗(`NOT_ENOUGH_DATA`) | `RIFF_SIZE_MISMATCH` |
| 末尾が 10 バイト欠けている(サイズ欄は合わせた) | 失敗(`BITSTREAM_ERROR`) | `MALFORMED_CHUNK` |

- 根拠: **実測のみ**
- 厳しくした理由: ブラウザの canvas の出力は、どれも条件を満たす(次の節)。後ろの余計なデータや余計なチャンクは、画像と関係ないデータを DB に入れ、保存サイズを増やすだけ。RFC 9649 も、File Size より後のデータを「SHOULD NOT」としている。根拠: **推測のみ**(方針の判断)
- 確かめないもの: 圧縮データそのもの(デコードしないと分からない)、詰め物の値(0 であること)、予約ビット(RFC では読み手が無視する)、`VP8X` の ICC / EXIF / XMP のフラグと実際のチャンクの対応。

### どこで切っても、書き換えても例外を投げない

- 単体テストで、次を確かめた。根拠: **実測のみ**
  - 画像データのチャンクが最後にある 4 つのフィクスチャは、途中で切ったものを、RIFF のサイズ欄を合わせても合わせなくても、すべての長さで拒否する。
  - 6 つのフィクスチャで、すべての長さで切ったもの(サイズ欄を合わせたもの)と、1〜3 バイトをランダムに書き換えたもの 500 通りで、例外を投げない。
- `DataView` で読むので、範囲の確認に漏れがあれば `RangeError` になる(値を取り違えずに不具合が表に出る)。`Uint8Array` のビュー(`byteOffset` が 0 でない)にも対応している。

## ブラウザの canvas の出力

301 × 203 の canvas(赤から青のグラデーション。透過は半透明の円だけ)を `toBlob("image/webp", 画質)` で出力し、`FileReader.readAsDataURL` で data URL にした。

| ブラウザ | 内容・画質 | Blob の type | バイト数 | チャンクの並び | parseWebpDataUrl |
|---|---|---|---|---|---|
| Chromium 153 | 不透明・0.8 | image/webp | 1,248 | `VP8X` + `ICCP` + `VP8 ` | extended、透過なし |
| Chromium 153 | 半透明・0.8 | image/webp | 2,824 | `VP8X` + `ICCP` + `ALPH` + `VP8 ` | extended、透過あり |
| Chromium 153 | 不透明・1.0 | image/webp | 4,568 | `VP8X` + `ICCP` + `VP8L` | extended、透過なし |
| Chromium 153 | 半透明・1.0 | image/webp | 11,062 | `VP8X` + `ICCP` + `VP8L` | extended、透過あり |
| Firefox 155 | 不透明・0.8 | image/webp | 812 | `VP8 ` | lossy、透過なし |
| Firefox 155 | 半透明・0.8 | image/webp | 1,974 | `VP8X` + `ALPH` + `VP8 ` | extended、透過あり |
| Firefox 155 | 不透明・1.0 | image/webp | 922 | `VP8L` | lossless、透過なし |
| Firefox 155 | 半透明・1.0 | image/webp | 3,018 | `VP8L` | lossless、透過あり |

- 8 通りとも、data URL は `data:image/webp;base64,` で始まり、`toWebpDataUrl(new Uint8Array(await blob.arrayBuffer()))` と一致した。寸法は 301 × 203 と読めた。根拠: **実測のみ**
- Chromium の `ICCP` チャンクは 464 バイト(ヘッダーを含む)。`VP8X`(18 バイト)と合わせて、cwebp の単純形式より 1 枚あたり 482 バイト(base64 で約 643 文字)大きい。仕様書 付録 A.2 の cwebp での見積もりには、この分が入っていない。予算 100,000 の約 0.6% なので、画質の探索への影響は小さい見込み([[T05-spike-canvas-webp|T05]]・[[T13-encode-search|T13]] で確かめる)。根拠: **実測のみ**(バイト数)/ **推測のみ**(影響)
- 画質 1.0 は、どちらのブラウザでも可逆(`VP8L`)になった。仕様書 6.3 の画質の範囲(0.60〜0.92)には入らない。根拠: **実測のみ**
- 環境: Playwright 1.63.0(headless)、`about:blank` のページに、esbuild でまとめた `src/shared/data-url.ts` を読み込んで実行した。

## 処理時間

### 手順

1. 入力を作る(仕様書 付録 A.4 と同じ手順。WebP 74,668 B、data URL 99,583 文字になった)。
   ```sh
   magick p4.jpg -filter Lanczos -resize '1024x1024>' -quality 100 p4-1024.png
   cwebp -quiet -q 77 p4-1024.png -o p4-1024-q77.webp
   ```
2. 実際のコードを測るため、`src/shared/data-url.ts` を esbuild でまとめる(Node 用は ESM、ブラウザ用は IIFE)。
   ```sh
   npx esbuild src/shared/data-url.ts --bundle --format=esm --platform=neutral --target=es2024 --outfile=bundle/data-url.mjs
   npx esbuild src/shared/data-url.ts --bundle --format=iife --global-name=T04 --platform=browser --target=es2024 --outfile=bundle/data-url.iife.js
   ```
3. Node: 500 回の空回しの後、2,000 回を 1 回ずつ `performance.now()` で測り、中央値・p95・最大を出す。続けて 2,000 回をまとめて測り、平均を出す。`atob` の経路は、`Object.defineProperty(Uint8Array, "fromBase64", { value: undefined, configurable: true })` で `fromBase64` を隠して測る。
4. ブラウザ: Playwright で IIFE を読み込み、300 回の空回しの後、2,000 回をまとめて測った平均を出す(ブラウザの `performance.now()` は精度が粗いので、1 回ごとには測らない)。

```js
// 手順 3 の計測(Node)。dataUrl は手順 1 の WebP から作った data URL
import { parseWebpDataUrl } from "./bundle/data-url.mjs";

function measure(fn, warmup = 500, rounds = 2000) {
	for (let i = 0; i < warmup; i++) fn();
	const times = [];
	for (let i = 0; i < rounds; i++) {
		const t0 = performance.now();
		fn();
		times.push(performance.now() - t0);
	}
	times.sort((a, b) => a - b);
	return { median: times[rounds >> 1], p95: times[Math.floor(rounds * 0.95)], max: times.at(-1) };
}

console.log(measure(() => parseWebpDataUrl(dataUrl)));
```

### 結果

`parseWebpDataUrl`(接頭辞の確認・base64 の検証とデコード・WebP ヘッダーの解析)の時間。単位は ms。

| 環境 | デコーダー | 中央値 | p95 | 最大 | 平均(2,000 回まとめて) |
|---|---|---|---|---|---|
| Node 26.10.0 | `fromBase64` | 0.0090 | 0.0137 | 0.1303 | 0.0100 |
| Node 26.10.0 | `atob` | 0.0615 | 0.0667 | 0.1172 | 0.0629 |
| Chromium 153 | `fromBase64` | — | — | — | 0.0144 |
| Chromium 153 | `atob` | — | — | — | 0.0892 |
| Firefox 155 | `fromBase64` | — | — | — | 0.0255 |
| Firefox 155 | `atob` | — | — | — | 0.1455 |

- どの環境でも 1ms 未満。根拠: **実測のみ**
- Node でデコードだけ(`decodeWebpDataUrl`)を測ると、中央値は 0.0085ms(`fromBase64`)/ 0.0612ms(`atob`)。WebP ヘッダーの解析は約 0.0005ms で、ほぼデコードの時間。根拠: **実測のみ**
- 仕様書 付録 A.4(`fromBase64` 0.011ms、`atob` 0.149ms)と比べると、`fromBase64` は同程度で、`atob` は速かった。A.4 の「`atob` + ループ」の書き方が分からないので、差の理由は確かめていない。根拠: **実測のみ**(数値)/ **推測のみ**(理由)
- 時間の計測は単体テストに入れていない(CI で結果が揺れるのを避けるため)。
- Workers(workerd)では測っていない。同じ V8 なので Node と同程度の見込み。根拠: **推測のみ**。wrangler dev での確認は [[T32-cloudflare-check|T32]] で行える。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64、Apple M5 Pro)、Node 26.10.0、Playwright 1.63.0(Chromium 153.0.8010.12 headless、Firefox 155.0 headless)、cwebp / dwebp / webpinfo 1.6.0、ImageMagick 7.1.2-31、esbuild 0.28.2。2026-09-24 に計測。

## 後続タスクへのメモ

- [[T11-server-validation|T11]]
  - `parseWebpDataUrl` の前に、`dataUrl.length <= maxStoredBytes`(と固定上限 500,000)を確かめる。巨大な文字列をデコードしないため。
  - 寸法の一致(`info.width` / `info.height`)と長辺 ≤ `maxEdge` は、`parseWebpDataUrl` の結果で確かめる。
  - `info.animated` のファイルを受け付けるかを決める。このプラグインの圧縮処理は静止画しか作らない(GIF も最初のフレームだけにする。仕様書 6.5)ので、拒否してよい見込み。根拠: **推測のみ**
  - `meta.bytes`(WebP 本体のバイト数)は `bytes.length` と照合できる。
- [[T13-encode-search|T13]]
  - Blob の大きさの上限は `maxWebpBytesForBudget(maxStoredBytes)`。
  - data URL は `FileReader.readAsDataURL` でも `toWebpDataUrl` でも同じ文字列になる(8 通りで一致)。`toWebpDataUrl` は同期で呼べる。
  - Chromium の出力には `ICCP` が付く(上の節)。
