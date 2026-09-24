---
id: T12
title: "入力画像の判定とデコードを作る"
type: 実装
status: done
wave: 2
depends_on:
  - "[[T03-shared-contracts]]"
soft_depends_on: []
blocks:
  - "[[T23-upload-hook]]"
files:
  - "src/client/input.ts"
  - "tests/client/input.test.ts"
spec:
  - "[[base64-image-plugin-spec#6.5 入力形式と上限(Q8)]]"
tags:
  - task
  - impl
  - client
created: 2026-09-23
---

# T12 入力画像の判定とデコードを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 2
> - 着手の条件(依存): [[T03-shared-contracts|T03]]
> - このタスクを待つもの: [[T23-upload-hook|T23]]
> - 仕様: [[base64-image-plugin-spec#6.5 入力形式と上限(Q8)|仕様書 6.5]]

## 目的

仕様書 6.5 のとおりに、受け付ける形式と上限を判定し、画像をデコードする。

## 作業内容

- [x] 形式の判定(MIME タイプと、実際にデコードできたか): JPEG / PNG / WebP / AVIF / BMP は受け付ける。GIF は静止画にする注意を返す。HEIC / HEIF・SVG・TIFF などは拒否する
  - MIME タイプではなく、ファイルの先頭のバイトで判定する方法にした([[#決めたこと]] の 1・2)。
- [x] 上限: ファイル 40MB、6,400万画素
  - 画素数は、デコードの前にヘッダーから読んで確かめる([[#決めたこと]] の 5)。
- [x] `createImageBitmap(file, { imageOrientation: "from-image" })` でデコードする
- [x] 拒否の理由ごとのエラーコード(HEIC の案内文を含む)
  - コードは T03 の `INPUT_*`、文言は T14 の `ERROR_MESSAGES`。どちらも変更していない。

## 完了条件

- [x] 単体テスト(jsdom では画像をデコードできないので、判定ロジックとデコードの呼び出しを分けてテストする)

## 変更してよいファイル

- `src/client/input.ts`
- `tests/client/input.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] まとめ(2026-09-24)
> - `src/client/input.ts` を作った。[[T03-shared-contracts|T03]] の `pipeline.ts` の `DecodeImage` / `DecodedImage` の形をそのまま使い、T03・T13・T14 のファイルは変更していない(T13 の `abortable` を使う)。
> - 形式はファイルの先頭のバイトで判定し、画素数はデコードの前にヘッダーから読んで確かめる。どちらも、Chromium 153・Firefox 155 での実測で決めた([[input-image-decode]])。
> - 単体テストは `tests/client/input.test.ts` の 267 件。わざと入れた不具合 116 種類がすべてテストで見つかった。
> - 実ブラウザで、42 個のサンプルと画素数の多い 9 個のファイルを判定とデコードに通した。HEIC は `.jpg` という名前でも拡張子が無くても HEIC の案内で拒否でき、6,400 万画素を超えるもの(8000 × 8001 から 10 億画素まで)はデコードせずに 1ms 前後で拒否できた。
> - 仕様書 6.5 を実測に合わせて直した([[#仕様書の変更]])。

### T23 が使う export

すべて `src/client/input.ts`。

| export | 内容 |
|---|---|
| `decodeImage` | `DecodeImage` の実装。`(file: File, options?: DecodeOptions) => Promise<DecodedImage>`。`createDecodeImage()` で作ったもの |
| `createDecodeImage(environment?)` | `createImageBitmap` を差し替えた `DecodeImage` を作る(テスト用)。型 `DecodeImageEnvironment`(`{ createImageBitmap?: (image, options) => Promise<ImageBitmap> }`) |
| `inspectInputFile(file, signal?)` | デコードの前の判定だけを行う(空・形式・40MB・ヘッダーの画素数)。`Promise<InputInspection>`(`format` / `mimeType` / `dimensions`(読めなければ null)/ `notices`)。エラーは `decodeImage` と同じ |
| `ACCEPTED_FORMATS`、`FORMAT_MIME_TYPES`、型 `AcceptedFormat` / `InputFormat` | 受け付ける 6 形式と、その MIME タイプ |
| `sniffImageFormat`、`formatFromMimeType`、`judgeInputFormat`、`readImageDimensions`、`createBlobReader`、型 `ByteReader` / `ImageDimensions` / `InputInspection` / `FormatJudgement` / `InputFormatRejection` | 内部の部品(テストが使う)。T23 は使わなくてよい |

`decodeImage` の結果とエラー:

| 場合 | 結果 |
|---|---|
| 受け付けた | `DecodedImage`。`source` は ImageBitmap、`width` / `height` は EXIF の向きを反映したもの、`mimeType` は中身の形式(`image/jpeg` など。`File.type` ではない)、`filename` は `File.name`(空のこともある)、`fileBytes` は `File.size`、`notices` は GIF なら `["GIF_FIRST_FRAME_ONLY"]` |
| HEIC / HEIF(名前・`File.type` に関係なく) | `INPUT_HEIC_REJECTED` |
| SVG | `INPUT_SVG_REJECTED` |
| TIFF・ICO・中身も `File.type` も分からない | `INPUT_FORMAT_REJECTED` |
| 空・中身が壊れている・ブラウザがデコードできない・読み込めない | `INPUT_DECODE_FAILED`(元のエラーは `cause`) |
| 40,000,000 バイトを超える | `INPUT_FILE_TOO_LARGE` |
| 64,000,000 画素を超える | `INPUT_TOO_MANY_PIXELS`(`details` に `width` / `height` / `maxPixels`) |
| 中断 | `signal.reason`(既定は `name` が `"AbortError"`) |

呼び方の例(T23):

```ts
import { decodeImage } from "../../client/input";
import { compressImage } from "../../client/encode";
import { createThumbnail } from "../../client/thumbnail";
import { getNoticeMessage } from "../../client/error-messages";

const decoded = await decodeImage(file, { signal });
try {
	const notices = decoded.notices.map((code) => getNoticeMessage(code, locale)); // GIF の注意
	const result = await compressImage(decoded, { ...fieldOptions, signal, onProgress });
	const thumb = await createThumbnail(decoded, { signal });
	// アップロード: filename は decoded.filename(空なら省き、255 文字に切り詰める。T03)
} finally {
	// Firefox はデコード中の中断が間に合わず resolve することがある。どの場合も必ず閉じる
	decoded.close();
}
```

テストでは、`createImageBitmap` を偽物にした `DecodeImage` を使う。File は、ヘッダーだけの本物のバイト列で作る(判定は本物のまま動く)。

```ts
const decode = createDecodeImage({
	createImageBitmap: async () => ({ width: 1200, height: 800, close() {} }) as unknown as ImageBitmap,
});
// 1200 × 800 の PNG のシグネチャと IHDR だけのバイト列
const png = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
	0, 0, 0x04, 0xb0, 0, 0, 0x03, 0x20, 8, 6, 0, 0, 0,
]);
const decoded = await decode(new File([png], "a.png", { type: "image/png" }));
```

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 形式はファイルの先頭のバイトで判定する(JPEG / PNG / GIF / WebP / BMP / TIFF はシグネチャ、AVIF / HEIF は `ftyp` の brand、SVG は先頭 4,096 バイトの `<svg` 要素)。拡張子は使わない | `File.type` は拡張子だけで決まり、拡張子が無いと空、付け替えると中身と違う値になる。ブラウザのデコーダーも type を見ずに中身で形式を決める | 実測のみ |
| 2 | `File.type` は、中身で判定できないときに拒否の理由を選ぶためだけに使う。HEIC / HEIF → `INPUT_HEIC_REJECTED`、SVG → `INPUT_SVG_REJECTED`、受け付ける形式の MIME タイプ → `INPUT_DECODE_FAILED`(デコードしない)、それ以外 → `INPUT_FORMAT_REJECTED` | 中身で判定できないものは、デコーダーも読めない(壊れている)と考えられる。拡張子の付け替えで一覧に無い形式を通さない | 実測のみ(乱数の `.jpg` などはデコードに失敗した)。デコーダーのシグネチャが同じことは推測のみ |
| 3 | 受け付けるのは、中身が仕様書 6.5 の 6 形式のものだけ | ブラウザは ICO もデコードできる。「デコードできたか」だけでは一覧に無い形式が通る | 実測のみ |
| 4 | AVIF の brand(`avif` / `avis`)があれば AVIF、無くて HEIF の brand(`heic` `heix` `mif1` `miaf` など 12 個)があれば HEIF | AVIF も `mif1` / `miaf` を持つ。macOS の sips の HEIC は major brand が `heix` | 実測のみ |
| 5 | 画素数はデコードの前にヘッダーから読む(JPEG の SOF、PNG の IHDR、GIF の論理画面と最初のフレーム、WebP の `VP8 ` / `VP8L` / `VP8X`、BMP の DIB ヘッダー、AVIF の `ispe` の最大)。読めなければ、デコードしてから確かめる(超えたら閉じてから拒否) | デコードは 1 画素あたり約 4 バイトのメモリを使う(64MP で +250MB、16384²・300KB の PNG で +1GB)。ヘッダーなら 1ms 前後で判定できる | 実測のみ |
| 6 | WebP は T04 の `parseWebp` ではなく、先頭 30 バイトから寸法を読む | `parseWebp` は RIFF の大きさとデータの長さの一致を確かめるので、ファイル全体(最大 40MB)が要る。T04 のフィクスチャ 6 つで `parseWebp` と同じ寸法になることをテストで確かめた | 実測のみ |
| 7 | GIF の寸法は、論理画面と、最初のフレームの右端・下端の大きいほう | Chromium・Firefox とも、10 × 10 の論理画面に 120 × 80 のフレームの GIF を 120 × 80 にした | 実測のみ |
| 8 | 判定の順番は、空 → 形式 → ファイルのバイト数 → 画素数。読むのは先頭の 64KiB と、ヘッダーのある場所だけ | 40MB を超える HEIC にも変換の案内を出すため | 設計判断 |
| 9 | 空のファイルは `INPUT_DECODE_FAILED` | 壊れたファイルとして扱う | 設計判断 |
| 10 | GIF には、アニメーションかどうかに関係なく `GIF_FIRST_FRAME_ONLY` を付ける | T14 の文言は静止画の GIF にも当てはまる。フレームを数えるには、最初のフレームの画像データをすべてたどる必要がある | 設計判断 |
| 11 | ヘッダーを探すときに読み飛ばすセグメント・ブロック・ボックスは、合わせて 10,000 個まで | 1 つずつ `await` で読むので、細かいブロックを大量に並べたファイルで時間が掛からないように。超えたら、デコードしてから確かめる | 設計判断 |
| 12 | 中断は `signal.reason` で reject する。読み込みとデコードは完了を待たず(T13 の `abortable`)、あとで届いた ImageBitmap は閉じる | Chromium では中断から 0.2ms 以内に reject した。Firefox はデコードの間に主スレッドが止まる(64MP の JPEG で 78〜92ms)ので、デコード中の中断はデコードが終わってから届き、`decodeImage` は resolve する | 実測のみ |
| 13 | 途中で切れたファイルは検出しない | Firefox は欠けた部分を白・透明にしてデコードする(Chromium は失敗する)。JPEG の末尾の EOI を確かめると、JPEG の後ろにデータを付けたファイルを拒否してしまう | 実測のみ(Firefox の挙動)。後半は推測のみ |

### 確かめたこと

- 単体テスト(`tests/client/input.test.ts`、267 件): 先頭のバイトの判定(各形式、sips・x265・aom の実際の `ftyp`、brand 1 つだけ、長さの境界)、MIME タイプの表、判定の表、読み込み(64KiB の窓、末尾、中断)、ヘッダーの寸法(各形式の正常・異常、T04 のフィクスチャと `parseWebp` の一致、探す手間の上限を `read` の回数で確認)、`inspectInputFile`(中身が優先、判定の順番、40MB・64MP の境界、エラーの `details`、読み込みの失敗、中断)、`createDecodeImage`(`createImageBitmap` に渡すもの、結果、`close()`、拒否するときはデコードしない、デコードの失敗、jsdom の既定、デコード後の画素数、中断とあとで届いた ImageBitmap)。根拠: **実測のみ**
- テストが実際の不具合で失敗するか: ソースに不具合を 1 つずつ入れて実行するスクリプト(scratchpad に置いた使い捨てのもの)で、116 種類すべてがテストの失敗になった。はじめは 4 種類が残った(HEIF の brand から `heix` を消す、空の範囲の早期の return を消す、GIF のサブブロックと AVIF の `findBox` で上限を確かめない)。`heix` は sips のファイルが `mif1` も持つので見逃していた。残りの 3 つは読む量だけが変わり、結果は変わらなかった。brand を 1 つだけ持つ `ftyp` のテストと、`read` の回数を数えるテストを足した。途中で、JPEG のセグメントの長さが 2 未満かを確かめる条件は、ほかの条件と重なっていて不要だとわかり、消した。根拠: **実測のみ**
- 実ブラウザ(Chromium 153 のソフトウェア描画・GPU 描画、Firefox 155): 42 個のサンプル(JPEG・PNG・APNG・WebP・AVIF・BMP・GIF・HEIC・SVG・TIFF・ICO・壊れたファイル・名前の違うもの)と、画素数の多い 9 個のファイルを `inspectInputFile` と `decodeImage` に通した(153 行)。最後のソースで作り直した束でも結果は同じだった。表は [[input-image-decode#5. 実装(src/client/input.ts)を通した結果]]。根拠: **実測のみ**
- `npm run verify`: build(3 つの型チェックと playground のビルド)・lint(oxlint・prettier)・test(8 ファイル 817 件)がすべて通った。

### 仕様書の変更

6.5 だけを直した。

- HEIC / HEIF の行に、Chromium 153・Firefox 155 でデコードできないことを実測したと書き足した。
- 画素数は、デコードの前にヘッダーから読んで確かめること(理由はメモリ)と、判定の順番を書いた。
- 「形式は『MIME タイプ』と『実際にデコードできたか』で判定する」を、「ファイルの先頭のバイトと『実際にデコードできたか』で判定する」に変えた。`File.type` の使い方、ICO を受け付けないこと、Firefox が途中で切れた JPEG・PNG をデコードすることを書いた。
- アニメーション WebP・APNG も最初のフレームになり、注意書きは GIF だけに出すことを書いた。

### 後続タスク向けのメモ

| タスク | メモ |
|---|---|
| [[T23-upload-hook\|T23]] | 上の「呼び方の例」のとおり、`decodeImage` の結果は `finally` で必ず閉じる。ギャラリーで複数のファイルを受け取ったら、`inspectInputFile` で先にまとめて判定すると、HEIC などを最初に知らせられる(1 件 1ms 前後)。`inspectInputFile` のあとに `decodeImage` を呼ぶと、判定は 2 回行われる(先頭の 64KiB を読み直すだけなので軽い) |
| [[T27-image-widget\|T27]] / [[T28-gallery-widget\|T28]] | `<input type="file">` の `accept` は `image/*` にする。MIME タイプを並べると、HEIC を選べなくなり、HEIC の案内を出せない(推測のみ)。Firefox では、デコードの間(64MP で 100ms 前後)は画面が止まるので、「読み込み中…」の表示は、デコードを始める前に描画しておく |
| [[T31-e2e\|T31]] | `page.setInputFiles(パス)` で、実際のブラウザの `File.type` になる。HEIC は `sips -s format heic` か `heif-enc` で作れる。途中で切れた JPEG・PNG は、Firefox ではデコードできてしまうので、壊れたファイルの確認には乱数のファイルを使う |

### 未解決・サブタスクの候補

- **アニメーションの注意(サブタスクの候補)**: アニメーション WebP・APNG(AVIF のシーケンスも同じと考えられる)も最初のフレームになるが、注意のコードは `GIF_FIRST_FRAME_ONLY` だけで、文言も GIF のもの。注意を出すなら、`NOTICE_CODES`(T03 の `src/shared/errors.ts`)にコードを足し、T14 の `NOTICE_MESSAGES` に文言を足す必要がある。判定(WebP の `VP8X` のアニメーションのフラグ、APNG の `acTL`、AVIF の `avis`)は `input.ts` に足せる。
- **仕様書 18 章(既知の制約)への追記の候補(リーダー)**: Firefox 155 は、途中で切れた JPEG・PNG を部分的にデコードする。libheif で作ったグリッドの AVIF をデコードできない(`INPUT_DECODE_FAILED` になる)。デコードの間は主スレッドが止まる。
- `docs/00-index.md` に [[input-image-decode]] を追加する(リーダー)。
