---
title: EmDash Base64 画像プラグイン 仕様書
aliases:
  - base64-image プラグイン仕様
  - emdash-plugin-base64-image
tags:
  - emdash
  - plugin
  - spec
  - webp
status: 合意済み
created: 2026-09-23
updated: 2026-09-24
emdash-version: 0.39.1
plugin-id: base64-image
package: emdash-plugin-base64-image
---

# EmDash Base64 画像プラグイン 仕様書

> [!summary] 概要
> R2 などのオブジェクトストレージを使わずに、EmDash で画像を扱うための native プラグイン。
> - 管理画面でアップロードした画像を、ブラウザで WebP に圧縮する(保存する data URL で 100,000 バイト以下)。
> - base64 の data URL を、D1 に JSON として保存する。
> - width / height を保持し、サイト側では `<img width height>` で描画して Layout Shift を抑える。

> [!info] 根拠レベルと参照パス
> - 事実には根拠レベルを付ける: **実測+公式ドキュメント** / **実測のみ** / **公式ドキュメントのみ** / **外部ドキュメントのみ** / **推測のみ**
> - EmDash のソースコードを読んで確認した事実(実行はしていない)は「公式ドキュメントのみ」に含める。
> - ファイルパスは、特に断りがなければ `references/emdash/` 以下を指す(EmDash 0.39.1 時点。タグ `emdash@0.39.1`)。2026-09-23 に書いた時点では、0.38.0 のあとの未リリースの開発版(`ea275faf`)を読んでいた。0.39.1 との差で行がずれた箇所は直した([[T01-2-emdash-0-39|T01-2]])。

## 目次

- [[#1. 背景と目的]]
- [[#2. 動作環境と制約]]
- [[#3. スコープ]]
- [[#4. アーキテクチャ]]
- [[#5. データモデル]]
- [[#6. 圧縮仕様(ブラウザ)]]
- [[#7. アップロード(書き込み経路)]]
- [[#8. サーバー側の検証]]
- [[#9. 参照元の記録と未使用画像の検出]]
- [[#10. 画像のライフサイクル]]
- [[#11. 管理画面 UI]]
- [[#12. サイト側の描画]]
- [[#13. 設定]]
- [[#14. 配布とバージョン]]
- [[#15. リポジトリ構成・ツール・テスト]]
- [[#16. 実装前の検証(スパイク)]]
- [[#17. 実装時に再確認する事項]]
- [[#18. 既知の制約とリスク]]
- [[#19. 対象外・将来の検討事項]]
- [[#20. 決定ログ]]
- [[#付録 A. 実測データ]]
- [[#付録 B. 参考資料]]

## 用語

| 用語 | 意味 |
|---|---|
| 画像エントリ | 非表示コレクション `b64_images` の1エントリ。画像1枚の本体(data URL)を持つ |
| 参照 | 投稿などのフィールドに保存する値。画像エントリの ID・寸法・alt だけを持つ |
| 参照元 | ある画像を参照しているエントリとフィールド(`collection` / `entryId` / `locale` / `field`) |
| 未使用画像 | 現在のコンテンツ(公開版・下書き)のどこからも参照されていない画像エントリ |

---

## 1. 背景と目的

**目的**
- 画像を base64 で DB に保存できる EmDash プラグインを作る。
- 保存形式は JSON だが、管理画面では画像として表示する。
- アップロード時に WebP に圧縮し、サイズを小さくする。
- 画像の width / height も保存し、表示時の Layout Shift を減らす。

**動機(Q1)**
- R2 を使わずに EmDash を動かしたい。
- R2 を使うには、Workers Paid プランは不要だが、「R2 サブスクリプションのチェックアウト(支払い情報の登録)」が必要になる。無料枠(10GB-month/月)内であれば請求は $0。
  - 根拠: 公式ドキュメントのみ(Cloudflare R2 Get started / Pricing)
- このプラグインは「支払い情報を登録せずに運用する」ことを前提とする。

## 2. 動作環境と制約

### 2.1 想定する環境

- Cloudflare Workers Free + D1 Free。storage(R2)は使わない。
- EmDash 0.39.1(1.0 前のため、マイナーバージョンでも破壊的変更がありうる)。
  - 最初は 0.38.0 を想定していた。npm の 0.38.0 には、このプラグインが使う capability(`schema:read` / `content:publish` / `content:revisions:read`)が無い(実測)。そのため、それらが入った 0.39.x を対象にした(2026-09-24、利用者の判断。[[T01-2-emdash-0-39|T01-2]])。
- 管理画面を操作するブラウザは Chrome / Edge / Firefox。**Safari は対象外。**

### 2.2 プラットフォームの上限

| 項目 | 値 | 根拠 |
|---|---|---|
| Workers Free のリクエスト数 | 100,000 / 日 | 公式ドキュメントのみ |
| Workers Free の CPU 時間 | 10ms / リクエスト | 公式ドキュメントのみ |
| Workers のメモリ | 128MB | 公式ドキュメントのみ |
| Workers Free のサブリクエスト | 外部(fetch)は 50 / 呼び出し、Cloudflare のサービス(D1 など)は 1,000 / 呼び出し。D1 のクエリは後者に入る([[cloudflare-workers-free-d1-limits]]) | 公式ドキュメントのみ |
| D1 の 1 日の行の読み書き(Free) | 読み 500 万行 / 日、書き 10 万行 / 日。2026-09-01 からは、超えると UTC の 0 時までクエリが失敗する | 公式ドキュメントのみ |
| D1 の DB サイズ(Free) | 500MB / DB、5GB / アカウント | 公式ドキュメントのみ |
| D1 の1行・1値のサイズ | 2MB | 公式ドキュメントのみ |
| D1 の SQL 文の長さ | 100KB | 公式ドキュメントのみ |
| D1 のバインド変数 | 100 / クエリ | 公式ドキュメントのみ |
| D1 Time Travel(Free) | 7日 | 公式ドキュメントのみ |
| EmDash API のリクエスト body | 10MB(`packages/core/src/api/parse.ts:13`) | 公式ドキュメントのみ |

### 2.3 storage なしで使えなくなる EmDash の機能

- メディアライブラリへのアップロード。標準の `image` / `file` フィールドや、リッチテキストへの画像アップロードも含む。いずれも `NO_STORAGE` エラーになる(`packages/core/src/astro/routes/api/media.ts:124` ほか)。
- 自動バックアップ(`STORAGE_NOT_CONFIGURED`)。
- 結果として、**このプラグインがサイトで唯一の画像の手段**になる。
- 根拠: 公式ドキュメントのみ

> [!note] 「storage を指定しない」と「storage が無い」は違う(2026-09-24 に確認)
> - EmDash 0.39.1 は、`storage` を省略すると `./.emdash/uploads` の local storage を既定にする(`packages/core/src/astro/integration/index.ts:71-75`、`:335` の `config.storage ?? DEFAULT_STORAGE`)。根拠: 公式ドキュメントのみ
> - Node(playground)では、省略したままでも標準のメディアのアップロードが成功した。`NO_STORAGE` になったのは、型定義に無い `storage: false` を渡したときだけ。根拠: 実測+公式ドキュメント([[T02-playground#結果|T02]])
> - Cloudflare Workers ではファイルシステムに書けないので、省略したときの local storage は動かない見込み(推測のみ)。上の機能が使えなくなることに変わりはない。実際のエラーの形は [[T32-cloudflare-check|T32]] で確かめる([[T02-1-prettier-storage-capacity|T02-1]])。

### 2.4 バックアップ

> [!warning] 復旧手段は D1 Time Travel(直近7日)のみ
> - `wrangler d1 export` は仮想テーブルを含む DB では使えない(公式ドキュメントのみ: Cloudflare D1 Import/Export)。
>   - EmDash の検索機能は FTS5 の仮想テーブルを使う(`packages/core/src/search/fts-manager.ts:111`)。
>   - Cloudflare テンプレートは検索が既定で有効(`templates/blog-cloudflare/seed/seed.json:18`)。
>   - つまり、このプラグインと関係なく SQL ダンプが取れない。
> - 検索を無効にしても、base64 を含む行は SQL 文の 100KB 上限を超える。そのため、ダンプからの復元は失敗する見込み(公式ドキュメントのみ: limits と import のトラブルシュートからの推論、未実測)。
> - 7日より前に戻す必要が出てきたら、プラグインとは別に独自のエクスポート/リストアツールで対応する。

## 3. スコープ

| # | 用途 | 扱い | 理由 |
|---|---|---|---|
| 1 | 専用の画像フィールド(1フィールドに1枚) | **対象** | — |
| 2 | ギャラリー(1フィールドに複数枚) | **対象** | — |
| 3 | リッチテキスト本文中の画像 | 対象外 | 本文ブロックの編集 UI は Block Kit 要素しか使えず、ファイル選択や圧縮の UI を入れられない(`packages/admin/src/components/editor/PluginBlockNode.tsx:41`)。公式ドキュメントのみ |
| 4 | OGP / X カード画像 | 対象外(将来検討) | SNS のクローラーは HTTP(S) の URL が前提と思われる(推測のみ)。対応するには画像を返す公開ルートが必要 |

## 4. アーキテクチャ

### 4.1 構成要素

| 要素 | 役割 |
|---|---|
| native プラグイン `base64-image` | React の field widget、画像管理ページ、一覧の列、アップロード用ルート、保存 hook |
| 非表示コレクション `b64_images` | 画像本体の置き場所(1エントリ1画像) |
| 投稿側の `json` フィールド | 画像への**参照だけ**を持つ |
| プラグインストレージ `imageRefs` | 参照元・サムネイル・サイズなどのメタデータ(base64 本体は持たない) |

**native プラグインにする理由**
- sandboxed プラグインの field widget で使えるのは、Block Kit 要素(`text_input` / `number_input` / `toggle` / `select` / `media_picker`)だけ。ファイル選択、canvas での圧縮、プレビューができない。
- 根拠: `skills/creating-plugins/references/admin-ui.md`、`packages/admin/src/components/ContentEditor.tsx:1806`(公式ドキュメントのみ)

**画像本体を投稿に直接持たせない理由(Q4)**
- 管理画面の一覧は、1ページ100件を全データ込み(`SELECT *`)で取得する(`packages/admin/src/router.tsx:440`、`packages/core/src/database/repositories/content.ts:760`)。
  - カバー1枚+10枚ギャラリーの投稿が100件あると、応答は 146.9MB になり、Workers のメモリ上限 128MB を超える。
  - 根拠: 実測+公式ドキュメント([[#付録 A. 実測データ|付録 A.1]])
- リビジョンは、保存のたびに全データを複製し、最大50件残す(`packages/core/src/cleanup.ts:37`)。

**画像本体をプラグインストレージに置かない理由**
- サイト側のテンプレートからプラグインストレージを読む公開 API がない。`createPluginStorageAccessor` は `index.ts` から export されていない(`packages/core/src/database/repositories/plugin-storage.ts:539`)。
- 根拠: 公式ドキュメントのみ

### 4.2 アップロードの流れ

```mermaid
sequenceDiagram
    autonumber
    actor Editor as 編集者
    participant W as widget(ブラウザ)
    participant R as アップロード用ルート
    participant C as b64_images
    participant S as imageRefs
    participant P as 投稿の保存処理
    Editor->>W: 画像を選択 / ドロップ / 貼り付け
    W->>W: デコード・リサイズ・WebP 圧縮<br/>サムネイル生成
    W->>R: POST(data URL・サムネイル・寸法・保存先)
    R->>R: 検証(形式・サイズ・寸法・保存先フィールド)
    R->>C: create → getVersioned → publish
    R->>S: メタデータを保存(参照元がわかれば記録)
    R-->>W: 参照 { v, id, locale, width, height }
    W->>P: onChange(参照)→ 編集者が保存
    P->>P: beforeSave で参照を検証
    P-->>S: afterSave で参照元を追記
```

### 4.3 描画の流れ

```mermaid
flowchart LR
    A["Astro ページ"] --> B["getEmDashCollection / getEmDashEntry で投稿を取得"]
    B --> C["表示する参照を集める"]
    C --> D["resolveBase64Images"]
    D --> E["b64_images を ID の IN 句でまとめて取得"]
    E --> F["emdash/ui の Image で描画<br/>img に data URL と width・height"]
```

## 5. データモデル

### 5.1 画像エントリ(`b64_images`)

- コレクション設定: `hidden: true` / `routable: false` / `supports: []`(リビジョン・下書き・検索なし)
- フィールド: `image`(`json`、必須)

```jsonc
{
  "src": "data:image/webp;base64,UklGR…",  // 既定で 100,000 バイト以下
  "mimeType": "image/webp",
  "width": 1280,
  "height": 853,
  "filename": "IMG_0001.jpg",              // 元のファイル名(任意)
  "meta": { "v": 1, "bytes": 74668, "quality": 0.77 }  // スキーマのバージョン・WebP 本体のバイト数・圧縮時の画質(任意)
}
```

- `MediaValue` 互換の形。読み出すときにエントリ ID を `id` に入れ、参照の `alt` を加えると `MediaValue` に代入できる。`alt` は使う場所ごとに変えられるよう参照側で持つので、画像エントリには持たせない(Q3 + Q9)。
- `id` は値に持たせない。プラグインの `ctx.content.create` は ID を指定できず(`packages/core/src/emdash-runtime.ts:2135`)、新規作成時の `content:beforeSave` にも ID が渡らない(`:3339`)ため、作成が終わるまで ID が決まらない。根拠: 公式ドキュメントのみ([[T03-shared-contracts#結果|T03]])
- `meta.quality` は、ブラウザが申告した圧縮時の画質。保存済みの画像を開いたときに widget で画質を表示するために持つ([[#11. 管理画面 UI|11.2]])。サーバーは確かめない。
- 作成時のロケールは、サイトの既定ロケールにする(`ctx.content.create` の既定値。`packages/core/src/plugins/types.ts:476`)。
- 画像エントリは、作成したあと変更しない。

### 5.2 参照(投稿側フィールドの値)

```jsonc
// base64-image:image(単一)
{ "v": 1, "id": "01J…", "locale": "ja", "width": 1280, "height": 853, "alt": "説明文" }

// base64-image:gallery(複数)→ 上の参照の配列
[ { "v": 1, "id": "01J…", … }, { "v": 1, "id": "01J…", … } ]
```

- `id`: 画像エントリの ID。英数字で始まり、英数字・`_`・`-` だけからなる 128 文字まで(EmDash が作る ULID は満たす)。seed で slug を省いたエントリは seed の `id` がそのまま ID になるので(`packages/core/src/seed/apply.ts:676`)、`b64_images` を seed で作るときはこの規則に合わせる([[T03-shared-contracts#結果|T03]])。
- `locale`: 画像エントリのロケール。
  - 多言語サイトで取得時に locale を省くと、匿名の閲覧者には既定のロケールが、編集モードとプレビューの編集者にはページのロケールが使われる。見る人によって結果が変わるので、取得時にこの値を明示的に指定する(`packages/core/src/query.ts:769`)。根拠: 実測+公式ドキュメント([[T09-spike-query-count#結果|T09]])
- `alt`: 使う場所やロケールごとに設定できる。1,000 文字以内(Unicode のコードポイントで数える)。空欄は装飾画像として扱う。
- 型: `json` フィールドは、サイト側の型生成で `unknown` になる(`packages/core/src/schema/zod-generator.ts:499`)。プラグインから型定義と type guard を export する。

### 5.3 参照元メタデータ(プラグインストレージ `imageRefs`、キーは画像 ID)

```jsonc
{
  "owners": [
    { "collection": "posts", "entryId": "01J…", "locale": "ja", "field": "cover" }
  ],
  "bytes": 74668,
  "width": 1280,
  "height": 853,
  "thumb": "data:image/webp;base64,…",  // 長辺 96px 程度、data URL の長さで 8,000 バイト以下(WebP 本体で 5,982 バイト以下)
  "createdAt": "2026-09-23T12:00:00.000Z",
  "createdBy": "<userId>"
}
```

- インデックス: `createdAt`
- `owners` には追記だけを行い、保存時に削除はしない([[#9. 参照元の記録と未使用画像の検出]])。

### 5.4 容量の目安

- 画像1枚は最大 100,000 バイト。ただし、公開するとデータを丸ごと複製したリビジョンが 1 件できる(`packages/core/src/database/repositories/content.ts:2309-2318`。`supports: []` でも同じ。実測+公式ドキュメント、[[T02-playground#結果|T02]])。そのため 1 枚で DB を約 2 倍使い、D1 の 500MB で約 2,500 枚(未使用画像を含む。推測のみ)。
  - プラグインが公開するときに、この複製を避けられるかは [[T18-upload-route|T18]] で確かめる([[T02-1-prettier-storage-capacity|T02-1]])。
- 投稿側の行とリビジョンには参照しか入らないため、小さいまま保たれる。

## 6. 圧縮仕様(ブラウザ)

### 6.1 エンコード方式

- canvas の `toBlob("image/webp", quality)` を使う。
  - 対応ブラウザ: Chrome 50 以降 / Edge 79 以降 / Firefox 96 以降(外部ドキュメントのみ: caniuse)
- 生成された Blob の `type` が `image/webp` でなければ、「このブラウザは非対応です」と表示して中断する。
  - Safari はデスクトップ・iOS とも 27.2 時点で未対応。エラーを出さずに PNG を返してしまう(外部ドキュメントのみ: caniuse)。

> [!note] WASM エンコーダーを使わない理由
> - 管理画面の本番 CSP は `script-src 'self' 'unsafe-inline'` で、`'wasm-unsafe-eval'` を含まない。そのため WASM は禁止されている(`packages/core/src/astro/middleware/csp.ts:92`、MDN)。
> - この CSP は本番で無条件に設定され、サイト側から上書きできない(`packages/core/src/astro/middleware/auth.ts:301`, `:322`)。
> - 開発モードでは CSP が付かない。WASM を使うと「開発では動くのに本番で壊れる」ことになる。

### 6.2 サイズ予算(Q6)

- `src`(先頭の `data:image/webp;base64,` を含む data URL 全体)の長さを `maxStoredBytes` 以下にする。既定は 100,000。
- WebP 本体に換算すると 74,982 バイト以下になる。計算式は `23 + 4 × ceil(B / 3) ≤ 100,000`。

### 6.3 リサイズと画質の方針(Q7)

1. EXIF の向きを反映してデコードする(`createImageBitmap(file, { imageOrientation: "from-image" })`)。
2. 長辺を `maxEdge`(既定 1600px)以下に縮小する。拡大はしない。
   - 縮小は `createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: "high" })` で行い、同じ大きさの canvas に 1:1 で描いてからエンコードする。Firefox 155 は `imageSmoothingQuality` を持たず、`drawImage` で 2 倍以上縮小するとエイリアシングが出て、同じ画質で 10〜25% 大きくなるため。この方法なら、Firefox は ImageMagick の Lanczos とほぼ同じ画素になる(PSNR 55〜59 dB)。根拠: 実測のみ([[T05-spike-canvas-webp#結果|T05]])
3. 画質 `minQuality`(既定 0.60)〜 0.92 の範囲で探索し、予算内に収まる最高の画質を採用する。
   - 順番は、`minQuality` を最初に試し、次に 0.92、そのあと 0.01 刻みの二分探索にする。収まらない長辺ではエンコードが 1 回で済み、5 枚で 1 枚あたり 2〜10 回、0.13〜0.51 秒だった(Apple M5 Pro)。根拠: 実測のみ([[T05-spike-canvas-webp#結果|T05]])
   - 画質は必ず範囲内の値を明示して渡す。省略や範囲外はブラウザの既定値(Chromium 0.80、Firefox 0.92)になり、Firefox は 0.995 以上で可逆になる。根拠: 実測+公式ドキュメント(同上)
4. `minQuality` でも収まらなければ、0.8 倍に縮小して手順 3 に戻る。長辺は四捨五入する(既定なら 1600 → 1280 → 1024 → 819 → 655 → 524px。[[T13-encode-search#結果|T13]])。
5. 長辺が `minEdge`(既定 480px)を下回ったら、エラーにする。
   - 元の長辺が `minEdge` より短い画像は、元の大きさで手順 3 を 1 回だけ行う(縮小はしない。収まらなければエラー)([[T13-encode-search#結果|T13]])。

既定値は、ブラウザでの測定(T05)のあとも変えない。この縮小方法なら、Chromium 153・Firefox 155 のどちらでも、5 枚すべてが 1024px 以上・画質 0.60 以上に収まった。ブラウザと cwebp の差は数ポイントで、Q7 の判断を変えるほどではない(実測のみ。[[#A.5 ブラウザの canvas での確認|付録 A.5]])。

写真5枚での結果(cwebp での見積もり。[[#付録 A. 実測データ|付録 A.2]]):

| 写真 | 採用される長辺 / 画質 |
|---|---|
| p1 | 1280px / 77 |
| p2 | 1600px / 80 |
| p3(細部が多い) | 1024px / 60 |
| p4 | 1024px / 77 |
| p5(単純) | 1600px / 92 |

### 6.4 サムネイル

- 本体と同時に、長辺 96px 程度の WebP を、data URL の長さで 8,000 バイト以下(WebP 本体で 5,982 バイト以下)で作る。アップロード時に一緒に送り、`imageRefs.thumb` に保存する。
  - 画質は本体の既定と同じ 0.60〜0.92 の範囲で、6.3 と同じ順に探し、収まる最高の画質にする。96px より小さい画像は拡大しない。96px の画質 0.60 でも収まらなければ 0.8 倍ずつ縮め、長辺が 48px を下回ったらエラー(`THUMB_OVER_BUDGET`)にする([[T13-encode-search#結果|T13]])。
- 用途: コンテンツ一覧の列と、画像管理ページ。

### 6.5 入力形式と上限(Q8)

| 区分 | 形式 | 扱い |
|---|---|---|
| 受け付ける | JPEG / PNG / WebP / AVIF / BMP | そのまま変換する |
| 受け付ける | GIF | 最初のフレームだけの静止画にする。アニメーションが消えることを注意書きで伝える |
| 拒否する | HEIC / HEIF | 「iPhone のカメラ設定を『互換性優先』にするか、JPEG に書き出してください」と案内する。Chrome / Edge / Firefox はデコードできない(外部ドキュメントのみ: caniuse) |
| 拒否する | SVG | ベクター画像を画素に変換すると劣化し、スクリプトを含められる形式でもあるため |
| 拒否する | TIFF など | デコードできないため |

- 入力の上限: ファイル 40MB、または 6,400万画素(64MP)を超えるものは拒否する。ブラウザのタブがメモリ不足で落ちるのを防ぐため。
- 形式は、拡張子ではなく「MIME タイプ」と「実際にデコードできたか」で判定する。
- 変換で自動的に起きること(ヘルプに書く): 位置情報を含む EXIF は削除される。透過は保持される。色は sRGB に変換される。

## 7. アップロード(書き込み経路)

- widget から、プラグインの private ルート(例: `POST /_emdash/api/plugins/base64-image/upload`)を呼ぶ。
- ルートの権限は `content:create`(Contributor 以上。`packages/auth/src/rbac.ts:19`)。
- ルートの宣言: `methods: ["POST"]`、`request: { body: "json", maxBytes: 600_000 }`、`input: uploadRequestSchema`。書き方は [[T08-spike-route-body#結果|T08]] と [[emdash-plugin-route-body-limit]]。
  - body の上限(既定 1 MiB、最大 8 MiB)は、`request` を宣言したルートにだけ掛かる。宣言しないと、EmDash は body を上限なしに読む(12MB の JSON も受け取った)。根拠: 実測+公式ドキュメント(`packages/core/src/plugins/routes.ts:129`、`route-wire.ts:177`)
  - 600,000 バイトは、固定上限の `dataUrl`(500,000)と `thumb`(8,000)を入れた body(正しい入力で最大 509,462 バイト)に余裕を足した値。超えると、読む前か読みながら数えて 413 `INVALID_PLUGIN_REQUEST` になる。入力がスキーマに合わなければ 400 `VALIDATION_ERROR` で、ハンドラーは呼ばれない。根拠: 実測+公式ドキュメント
  - 画面からは `X-EmDash-Request: 1` を付けて呼ぶ(無いと 403 `CSRF_REJECTED`)。根拠: 実測+公式ドキュメント
  - body の parse・スキーマ・WebP の検証の CPU 時間は、固定上限の body でも 0.28ms(新しいプロセスでの 1 回目は 1.1ms)で、Workers Free の 10ms と比べて小さい。根拠: 実測のみ(Node 26、Apple M5 Pro)
- **1リクエストで1枚**だけ扱う。1 リクエストの処理とクエリ数を小さく保つため。
  - アップロード 1 回のクエリ数は、SQLite での実測で 72(ルートの固定費 1、作成 30、取得 3、公開 38。公開の 28 本は EmDash 本体の、メディアの使用状況の索引の更新)。根拠: 実測のみ([[T10-spike-after-save#結果|T10]]、[[emdash-plugin-content-query-counts]])
  - Workers Free で D1 に送れるのは 1 呼び出し 1,000 クエリまでなので、収まる(公式ドキュメントのみ。[[cloudflare-workers-free-d1-limits]])。D1 の limits のページには「Free は 1 呼び出し 50」という記述が残っていて食い違う。EmDash 本体の保存も 55〜62 クエリ使うので、1,000 と読むのが妥当(推測のみ)。実際の D1 での数は [[T32-cloudflare-check|T32]] で確かめる([[T10-1-spec-d1-limits|T10-1]])。
- 入力:

```jsonc
{
  "dataUrl": "data:image/webp;base64,…",
  "thumb": "data:image/webp;base64,…",
  "width": 1280,
  "height": 853,
  "quality": 0.77,   // 圧縮時の画質。画像エントリの meta.quality に保存する
  "filename": "IMG_0001.jpg",
  "target": { "collection": "posts", "field": "cover", "entryId": "01J…", "locale": "ja" }  // entryId・locale は分かるときだけ送る(新規エントリには entryId が無い)
}
```

- 応答: `{ "ref": { "v": 1, "id": "01J…", "locale": "ja", "width": 1280, "height": 853, "alt": "" } }`。widget はこの参照をそのままフィールドの値にできる。
- エラー: ハンドラーは `PluginRouteError(code, message, status)` を投げる。EmDash はこれを HTTP ステータスと `{ "success": false, "error": { "code", "message" } }` に変換する。`details` は応答に含まれないので、画面の文言はコードだけで決める。根拠: 実測+公式ドキュメント(`packages/core/src/plugins/http-route-dispatch.ts:134`。[[emdash-plugin-route-errors]])。コードの一覧は `src/shared/errors.ts`。
- 処理の順番:
  1. 検証する([[#8. サーバー側の検証]] の①)。
  2. `ctx.content.create("b64_images", …)` で作成する。
  3. `getVersioned` で最新の版を取得し、`publish` で公開する。
  4. `imageRefs` にメタデータを保存する。
  5. 参照を返す。
- 公開まで行う理由: Contributor には公開権限がない(`content:publish_own` は Author 以上。`packages/auth/src/rbac.ts:28`)。標準 API で作成すると下書きのまま残り、サイトに表示されない。
- 必要な capability: `schema:read` / `content:read` / `content:write` / `content:publish` / `content:revisions:read`

## 8. サーバー側の検証

| 場所 | 検証内容 | 不正なとき |
|---|---|---|
| ① アップロード用ルート | ・保存先のフィールドが存在し、このプラグインの widget であること(`ctx.schema.getCollection` で `widget` / `options` を読む。`packages/core/src/plugins/types.ts:407`)<br>・`dataUrl` が `data:image/webp;base64,` で始まり、長さが `maxStoredBytes` 以下(固定上限 500,000)<br>・デコードした中身が WebP(RIFF / WEBP、`VP8 ` / `VP8L` / `VP8X`)で、ヘッダーから読んだ寸法が width / height と一致し、長辺が `maxEdge` 以下<br>・`thumb` が WebP で、data URL の長さで 8,000 バイト以下(WebP 本体で 5,982 バイト以下) | 拒否 |
| ② `b64_images` の `content:beforeSave` | ①と同じ中身の検証。API / MCP / 管理画面など、どこからの書き込みでも実行する | 拒否 |
| ③ 参照を持つコレクションの `content:beforeSave` | ・参照の形(`{ v, id, locale, width, height, alt }` の型、alt は 1,000 文字以内)<br>・ギャラリーの枚数が `maxItems` 以下で、同じ画像が重複していないこと<br>・参照している画像 ID が、すべて `imageRefs` に存在すること(`getMany` でまとめて1クエリ) | 拒否し、どのフィールドの何が問題かをメッセージで返す |

- 保存 hook では書き込み元を判別できない(`runContentBeforeSave` には書き込み元のプラグインを除外する引数がない。`packages/core/src/plugins/hooks.ts:543`)。そのため、書き込み元ではなく中身で判定する。
- 処理の重さ: 約 100KB の data URL のデコードと WebP ヘッダーの解析は、`Uint8Array.fromBase64` で 0.011ms、`atob` で 0.149ms(実測のみ。[[#付録 A. 実測データ|付録 A.4]])。
- ③の存在確認の影響: 管理者が画像を完全削除したあと、その画像を参照している投稿を保存しようとすると、保存が拒否される。widget 側では「画像が見つかりません」と表示し、削除ボタンで参照を外せるようにする。

## 9. 参照元の記録と未使用画像の検出

**記録(追記のみ)**
- アップロード時: `target.entryId` があれば、最初の参照元として記録する。アップロード用ルートの `ctx.content.create` では、このプラグイン自身の `content:afterSave` は呼ばれない(呼んだプラグインは除外される。`packages/core/src/emdash-runtime.ts:2147`)。根拠: 実測+公式ドキュメント([[T10-spike-after-save#結果|T10]])
- 保存時: 参照を持つコレクションの `content:afterSave` で、エントリの中の参照を読み取り、`imageRefs.owners` に追記する。
  - 読むのは `event.content.data`(保存した下書き。公開版ではない)と、更新のときにある `event.content.liveData`(content テーブルの列の値。公開済みなら公開版)。下の判定で見る範囲と揃える。根拠: 実測+公式ドキュメント([[T10-spike-after-save#結果|T10]])
  - afterSave が呼ばれるのは、作成(`isNew: true`)と更新(保存・自動保存・メタデータだけの更新。`isNew: false`)だけ。管理画面の「公開」は保存してから公開するので、保存の側で呼ばれる。`b64_images` の保存でも呼ばれるので、参照を持たないコレクションは読み飛ばす。根拠: 実測+公式ドキュメント
  - 公開(`content:afterPublish`)でも同じ処理をする。API だけで公開したとき(一覧の一括公開など)は afterSave が呼ばれないため。afterPublish の `event.content.data` は公開したデータ。根拠: 実測+公式ドキュメント
  - クエリ数は `getMany` の 1 と、参照元が増えた画像の数(`putMany` は 1 件 1 クエリ)。どちらも保存のリクエストと同じ呼び出しのクエリ数に入る。根拠: 実測+公式ドキュメント([[emdash-plugin-content-query-counts]])
  - afterSave は `after()` で実行され、保存の応答を待たせない(Workers では waitUntil。`packages/core/src/emdash-runtime.ts:5560`)。例外を投げると、後に続くプラグインの afterSave が呼ばれなくなる(既定の `errorPolicy` は `"abort"`)。例外は hook の中で受け止めてログに出し、`errorPolicy: "continue"` を指定する。根拠: 実測+公式ドキュメント([[emdash-after-save-payload]])
- 保存時に参照元を削除しない理由: 下書きと公開版の二重管理や、hook が失敗したときのずれを扱わずに済むため。
- 複製はどの hook も呼ばない。複製先は元の公開版の値を持つ下書きになり、保存か公開をするまで参照元として記録されない。記録されると、1枚の画像の `owners` に複数並ぶ。根拠: 実測+公式ドキュメント

**判定(画像管理ページを開いたときに行う)**
- 参照元ごとに `ctx.content.get` でエントリを取得する。`null` なら「参照元が削除された」(ゴミ箱と完全削除のどちらも)。
- 列の値(`get` の `data`)と、`draftRevisionId` があればその下書きリビジョン(`getRevision`)の両方で、参照元の `field` に画像 ID が残っているかを確認する。
  - 下書きは、公開版の行とは別にリビジョンのテーブルに保存されている(`packages/core/src/emdash-runtime.ts:3516`)。一度も公開していないエントリの列の値は、作成したときの値。根拠: 実測+公式ドキュメント
- 判定結果は4種類:
  - **使用中**
  - **参照元が削除された**(ゴミ箱に入った場合を含む)
  - **参照元から外された**
  - **参照元なし**(アップロードしたが保存されなかった)
- 判定結果とは別に、画像エントリ自身の状態(ゴミ箱に入っていない / ゴミ箱に入っている / エントリが無い)も返す。完全削除のボタンは、ゴミ箱に入った画像にだけ出すため([[T06-decision-trash-permission#結果|T06]])。値の名前は `src/shared/schema.ts` の `imageUsageSchema` / `imageEntryStatusSchema`([[T03-shared-contracts#結果|T03]])。
  - 0.39.1 では、capability `content:restore` の `ctx.content.getTrashedVersioned` が、ゴミ箱に入っているエントリだけを返す(`packages/core/src/emdash-runtime.ts:3877`)。`ctx.content.get` はゴミ箱に入ったものと無いものの両方で `null` なので、組み合わせると区別できる。`getTrashedVersioned` は、`get` が `null` のときだけ呼ぶ(ゴミ箱に入っていないエントリに呼ぶとクエリが多い)。根拠: 実測+公式ドキュメント([[T10-spike-after-save#結果|T10]])
- 判定はページ送りで行う。プラグインの `ctx.content.list` では ID の IN 検索ができず(`packages/core/src/plugins/types.ts:443`)、参照元ごとに取得するので、1 リクエストのクエリ数が件数に比例して増えるため。上限は 1 呼び出し 1,000 クエリ([[#2.2 プラットフォームの上限|2.2]])だが、応答時間を抑えるため、それより十分小さい予算で区切る。予算の値は [[T21-orphan-routes|T21]] で決める([[T10-1-spec-d1-limits|T10-1]])。
  - 1 回に扱う件数は固定にせず、クエリ数の見積もりで決める。1 件のクエリ数は、参照元が 1 / 3 / 6(削除済み / 下書きなし / 下書きあり)、画像の状態が 2 / 5 / 3(ゴミ箱に入っていない / ゴミ箱 / 無い)。同じ参照元は、リクエストの中で 1 回だけ調べる。参照元がそれぞれ別の投稿だと、10 件で 50 を超える。根拠: 実測のみ([[emdash-plugin-content-query-counts]])

> [!warning] 「参照されていない」は「消しても安全」ではない
> 判定の対象は、現在のコンテンツ(公開版と下書き)だけ。古いリビジョンや、複製したまま保存も公開もしていないエントリからは、まだ参照されている可能性がある。警告文にもそう明記する。

## 10. 画像のライフサイクル

- 画像は作成後に変更しない。既存画像の再利用もしない。自動削除もしない。
- 削除は、画像管理ページから手動で行う。
  - **ゴミ箱への移動**: Contributor 以上(2026-09-24 に利用者が決定。[[T06-decision-trash-permission#結果|T06]])。プラグインのルートに `permission: "content:create"` を宣言し、ハンドラーで `ctx.content.delete("b64_images", id)` を呼ぶ。
    - `ctx.content.delete` は、呼び出した利用者の権限を確かめない(公式ドキュメントのみ。`packages/core/src/plugins/context.ts:897`)。権限の確認はルートの `permission` だけになる(省略すると `plugins:manage` で、管理者のみ。実測+公式ドキュメント。`skills/creating-plugins/references/api-routes.md:81`)。
    - EmDash の標準より緩い。標準 API では、Contributor は自分のコンテンツもゴミ箱に移せない(`content:delete_own` は Author 以上。`packages/auth/src/rbac.ts:22`。実測+公式ドキュメント)。そのため Contributor が、他人の投稿で使われている画像もゴミ箱に移せる。ゴミ箱に入った画像は、サイトに表示されなくなる(サイト側の取得は `deleted_at IS NULL` のものだけ。`packages/core/src/loader.ts:1341`。公式ドキュメントのみ)。
    - ゴミ箱から戻せるのは Editor 以上(標準 API の restore)。プラグインが作った画像は作成者(`authorId`)が空なので、`content:edit_any` で判定される(`packages/core/src/astro/routes/api/content/[collection]/[id]/restore.ts:44`)。根拠: 実測+公式ドキュメント
    - 画像管理ページでは、ゴミ箱に移す前に確認し、使用中の画像ならそのことを示す([[#11.5 画像管理ページ]])。
  - **完全削除**: 管理者のみ。標準の API `DELETE /_emdash/api/content/b64_images/{id}/permanent` を、ログイン中の管理者の権限で呼ぶ(`packages/core/src/astro/routes/api/content/[collection]/[id]/permanent.ts:14`。権限は `content:delete_permanent`)。
- プラグインは完全削除ができない(`skills/creating-plugins/references/sandbox-boundaries.md`)。ゴミ箱を自動で空にする処理も見当たらない。容量が戻るのは完全削除したときだけ。
- EmDash 標準の `b64_images` 一覧画面とゴミ箱画面は、1ページ100件分の base64 を読み込むので使わない(1件約 100KB)。

## 11. 管理画面 UI

### 11.1 共通方針

- コンポーネントは Kumo(`@cloudflare/kumo`)を使う(公式の field-kit と同じ)。
- 文言は日本語と英語を用意し、`<html lang>` で切り替える。どちらでもなければ英語にする(`packages/admin/src/locales/LocaleDirectionProvider.tsx:21`)。
- ファイル選択、並べ替え、削除は、すべてキーボードでも操作できるようにする。進捗は `aria-live` でスクリーンリーダーに伝える。
- plugin widget には `readOnly` が渡されない(`packages/admin/src/components/ContentEditor.tsx:1833`)。そのため、編集ロック中でも widget は操作できてしまう。これは EmDash 側の制約。

### 11.2 単一画像 widget(`base64-image:image`)

```
空のとき        ┌──────────────────────────────┐
                │  画像をドロップ / 貼り付け          │
                │  [ファイルを選択]                 │
                └──────────────────────────────┘
処理中          圧縮中… 1280px / 画質 0.74   [キャンセル]
設定済みのとき   <img width height>(プレビュー)
                1280×853 · 保存サイズ 98.2KB · 画質 0.77
                代替テキスト [______________]   [差し替え] [削除]
```

- アップロードのタイミング: 圧縮が終わった時点で、すぐにルートへ送る。失敗したらその場にエラーを表示し、フィールドの値は変えない。
- プレビュー:
  - 追加したばかりの画像は、手元にある data URL をそのまま表示する。
  - 保存済みの画像は、編集画面を開いたときに、プラグインのルートからまとめて1回で取得する。
- 代替テキストは任意入力。空欄のときは「装飾画像として扱われます」と注意を表示する。
- 参照先の画像が見つからないときは、「画像が見つかりません」と表示し、削除ボタンを出す。

### 11.3 ギャラリー widget(`base64-image:gallery`)

- 複数枚をまとめて選択・ドロップでき、1枚ずつ順に処理する(それぞれの進捗を表示)。
- サムネイルを並べて表示する。ドラッグ、または ↑↓ ボタンで並べ替えられる。1枚ずつ削除や代替テキストの入力ができる。
- 「あと N 枚追加できます」と表示し、`maxItems` を超える追加は拒否する。

### 11.4 コンテンツ一覧のサムネイル列(Q10)

- trusted プラグイン向けの `contentListColumns` で列を追加する(`packages/admin/src/lib/content-list-columns.tsx:23`)。
- 表示する画像:
  - 単一画像のフィールドがあれば、スキーマ上で最初のものを表示する。
  - なければ、最初のギャラリーの1枚目を表示し、「+N」で残りの枚数を添える。
- プラグインのフィールドを持つコレクションにだけ列を出す。どのフィールドがプラグインの widget かは、`@emdash-cms/admin` の `fetchManifest` で判別する。
- サムネイルは、そのページに表示中の全行(`visibleItems`)の分を、1ページにつき1回のリクエストでまとめて `imageRefs` から取得する。100行で数百KB 程度で、各行の base64 本体は読み込まない。
- 画像が未設定の行は「—」を表示する。参照先の画像が見つからない行は、警告アイコンを表示する。

### 11.5 画像管理ページ

- `admin.pages` で登録する(例: `/_emdash/admin/plugins/base64-image/images`)。
- 一覧に出すもの: サムネイル、寸法、保存サイズ、参照元へのリンク、状態バッジ([[#9. 参照元の記録と未使用画像の検出]])、作成日時。
- 操作: ゴミ箱への移動、完全削除(管理者のみ)。
- メニューのラベルは静的な文字列になる(マニフェストのラベルは翻訳されない)。

## 12. サイト側の描画

- プラグインは `resolveBase64Images(refs)` を提供する。ページで使う参照をまとめて渡すと、画像 ID をキーにした `MediaValue` 互換の値(`src` は data URL、`alt` は参照のもの)を返す。
  - 中では `getEmDashCollection("b64_images", { where: { id: [...] }, locale })` を使う。IN 句は `packages/core/src/loader.ts:772`。
  - ID は 50 件ずつに分けて取得する(D1 のバインド変数は1クエリ100個まで)。1 回の呼び出しのバインド変数は「ID の数 + 7」(locale を指定したとき)なので、1 回に入る ID は 93 件まで。50 件なら余裕があり、EmDash 自身の IN 句の分割単位(`packages/core/src/utils/chunks.ts:17` の `SQL_BATCH_SIZE`)とも揃う。根拠: 実測+公式ドキュメント(D1 の上限は node:sqlite で模擬した。[[T09-spike-query-count#結果|T09]])
  - バイラインとタクソノミーは、本体のクエリに畳み込まれる(`packages/core/src/loader.ts:124`)。そのため、50 件までの 1 回の呼び出しは 1 クエリ。サイトにバイラインが 1 件でもあると、バイラインの補完のクエリが加わる。このプラグインで作った画像(authorId なし)では、リクエストあたり +1、バイラインのカスタムフィールドもあれば呼び出しごとにさらに +1 で、1 ページ(1 ロケール・50 件まで)は 1〜3 クエリ。標準の REST API や管理画面で作った画像(authorId あり)では、最悪で呼び出しごとに 4 クエリとリクエストあたり +2 になる。根拠: 実測+公式ドキュメント([[T09-spike-query-count#結果|T09]]、[[emdash-query-count-b64-images]])
- 描画は `emdash/ui` の `Image` を使う。data URL は responsive 変換の対象外なので、`<img src="data:…" width height loading="lazy" decoding="async">` がそのまま出力される(`packages/core/src/components/EmDashImage.astro`、`packages/core/src/media/responsive.ts:127`)。
- LCP の対象になる画像には `priority` を付ける。
- 画像が見つからないときは何も描画せず、警告ログを出す。
- 一覧ページ(カード表示)でもメイン画像を使う(Q12 は (a) を選択)。表示中のエントリの参照をまとめて1回で解決する。10件並べると HTML は最大約 1MB になる。

```astro
---
import { getEmDashCollection } from "emdash";
import { Image } from "emdash/ui";
import { isBase64ImageRef, resolveBase64Images } from "emdash-plugin-base64-image/astro";

const { entries } = await getEmDashCollection("posts", { limit: 10 });
const refs = entries.map((entry) => entry.data.cover).filter(isBase64ImageRef);
const images = await resolveBase64Images(refs);
---
{entries.map((entry, i) => {
	const ref = entry.data.cover;
	const image = isBase64ImageRef(ref) ? images.get(ref.id) : undefined;
	return image && <Image image={image} priority={i === 0} />;
})}
```

## 13. 設定

### 13.1 seed

管理画面のスキーマ編集 UI では `widget` を指定できない(`packages/admin/src/components/FieldEditor.tsx:362`)。フィールドは seed / API / MCP のいずれかで作成する。

```jsonc
{
	"collections": [
		{
			"slug": "b64_images",
			"label": "Base64 Images",
			"hidden": true,
			"routable": false,
			"supports": [],
			"fields": [{ "slug": "image", "label": "Image", "type": "json", "required": true }]
		},
		{
			"slug": "posts",
			"label": "Posts",
			"supports": ["drafts", "revisions", "search", "seo"],
			"fields": [
				{ "slug": "title", "label": "Title", "type": "string", "required": true },
				{
					"slug": "cover",
					"label": "Cover",
					"type": "json",
					"widget": "base64-image:image",
					"options": { "maxStoredBytes": 100000 }
				},
				{
					"slug": "gallery",
					"label": "Gallery",
					"type": "json",
					"widget": "base64-image:gallery",
					"options": { "maxStoredBytes": 100000, "maxItems": 10 }
				}
			]
		}
	]
}
```

- プラグインは起動時に `b64_images` があるかを確認し、なければエラーを出す。プラグインからはコレクションを作れない(`ctx.schema` は読み取り専用)。
- `b64_images` は上の構成で足りる。タイトル用のフィールドは要らない(作成・公開・取得・一覧ができ、管理画面の一覧とダッシュボードには ID が表示される)。根拠: 実測+公式ドキュメント([[T02-playground#結果|T02]])
  - `routable: false` は必須。プラグインが作るエントリには slug が無く、routable のままでは公開できない(`Cannot publish routable content without a slug`。`packages/core/src/database/repositories/content.ts:2305`)。
  - `hidden: true` で外れるのは、サイドバーとダッシュボードのクイックアクションだけ。ダッシュボードの件数と最近の更新には出る(画像本体は読まない)。
  - `supports: []` でも、公開すると内容をまるごと複製したリビジョンが 1 件できる(`content.ts:2308`)。
  - `image` の `required: true` は、省略を 400 で拒否する(標準の REST API で確認)。`null` は DB の NOT NULL 制約で 500 になるので、中身は [[#8. サーバー側の検証|8 章]] の②で拒否する。
- seed が適用されるのは、コレクションが 0 件のデータベースへの最初のリクエストと、セットアップ(開発では dev-bypass)のときだけ。既存のコレクションは変更されない(`packages/core/src/seed/apply.ts:217`)。

### 13.2 フィールドの `options`

| option | 対象 | 既定値 | 範囲 | 説明 |
|---|---|---|---|---|
| `maxStoredBytes` | image / gallery | 100000 | 10,000〜500,000 | data URL の最大長(バイト)。サーバー側の固定上限は 500000 |
| `maxEdge` | image / gallery | 1600 | 96〜4,096 | 長辺の上限(px) |
| `minQuality` | image / gallery | 0.6 | 0〜0.92 | 画質の下限 |
| `minEdge` | image / gallery | 480 | 96〜`maxEdge` | 縮小していく下限(px)。これを下回るとエラー |
| `maxItems` | gallery | 10 | 1〜20 | 最大枚数 |

- 範囲外の数値は範囲内に丸め、整数の項目は小数点以下を切り捨てる。数値でない値は既定値にする。サーバー(検証)とブラウザ(圧縮)は同じ関数 `normalizeFieldOptions`(`src/shared/options.ts`)で解釈する([[T03-shared-contracts#結果|T03]])。
- 範囲の理由: `maxStoredBytes` の上限は固定上限、下限は本体の予算をサムネイルの上限(8,000)より小さくしないため。長辺の下限はサムネイルの長辺(96px)。`minQuality` の上限は画質の上限(0.92、[[#6.3 リサイズと画質の方針(Q7)|6.3]])。`maxEdge` の上限 4,096 は 4K の幅(3,840px)を含み、これより大きい画像を固定上限(500,000)に収まる画質で作るのは難しいため(推測のみ)。`maxItems` の上限 20 は、ページの重さ(100KB × 20 枚で約 2MB)を抑えるため。後から広げても既存のデータは壊れないが、狭めると既存のギャラリーの保存が拒否されるので、小さく始めた。

### 13.3 `astro.config.mjs`

```js
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { base64ImagePlugin } from "emdash-plugin-base64-image";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			// storage は指定しない(R2 を使わない)
			plugins: [base64ImagePlugin()],
		}),
	],
});
```

## 14. 配布とバージョン

- **npm には公開しない。** git 依存として配布する(例: `"emdash-plugin-base64-image": "github:<owner>/emdash-base64img-plugin#v0.1.0"`)。
- 名前:
  - パッケージ名: `emdash-plugin-base64-image`
  - プラグイン ID: `base64-image`(`^[a-z0-9-]+$` を満たす。`packages/core/src/plugins/define-plugin.ts`)
  - widget: `base64-image:image` / `base64-image:gallery`
- プラグイン本体はリポジトリ直下に置く。npm はサブディレクトリを git 依存として入れられないため。
- TS ソースのまま配布する(`files: ["src"]`、ビルドなし)。
  - 公式プラグインも `"main": "src/index.ts"` で配布している(`packages/plugins/color/package.json`)。
  - ビルドがないので、git 依存でインストールするたびに `prepare` でビルドが走ることもない。
- peer dependency: `emdash: "^0.39.0"`(`>=0.39.0 <0.40.0`)、`react`、`@cloudflare/kumo`、`@emdash-cms/admin`
  - EmDash のマイナーバージョンが上がるたびに動作を確認し、範囲を広げる。
  - 範囲([[T01-scaffold]] で決め、[[T01-2-emdash-0-39|T01-2]] で 0.39 に変更): `@emdash-cms/admin: "^0.39.0"`、`@cloudflare/kumo: "2.6.0"`(`@emdash-cms/admin` 0.39.1 の依存と同じ版に固定)、`react: "^18.0.0 || ^19.0.0"`(`@emdash-cms/admin` 0.39.1 の peer と同じ)。開発には `emdash` / `@emdash-cms/admin` の 0.39.1 を使う。
- dependency: `zod: "^4.5.4"`(`emdash` 0.39.1 が依存する 4.5.4 と同じ版を使う)。
- GitHub リポジトリを非公開にする場合、サイトのビルド環境(Cloudflare Workers Builds など)に、そのリポジトリを読むためのトークンが必要になる。

## 15. リポジトリ構成・ツール・テスト

```
/                        ← パッケージのルート(git 依存でインストールされる対象)
├─ package.json          files: ["src"]、exports: "." / "./admin" / "./astro"
├─ src/
│  ├─ index.ts           definePlugin(ルート・hook・ストレージ・capability)
│  ├─ admin.tsx          widget(単一画像 / ギャラリー)・画像管理ページ・一覧の列
│  ├─ astro.ts           resolveBase64Images・型・type guard(サイト側で使う)
│  ├─ server/            アップロード用ルート・検証・参照元の記録
│  ├─ client/            圧縮処理(canvas)・サムネイル生成
│  └─ shared/            WebP ヘッダーの解析・参照のスキーマ・定数
├─ tests/                vitest(単体テスト)
├─ playground/           動作確認用の EmDash サイト(配布物には含めない)
├─ e2e/                  Playwright(Chromium・Firefox)
├─ plans/                仕様書
└─ references/           EmDash の clone(git 管理外)
```

**ツール**
- mise で固定した npm 12 を使い、ルートと `playground/` を npm workspaces でまとめる。
- TypeScript は strict。lint は oxlint、format は prettier。EmDash 0.39.1 は、lint に oxlint を、整形に oxfmt と prettier(`.astro` 用)を使っている(`package.json:24-27`、公式ドキュメントのみ)。このリポジトリは合意どおり prettier に統一する([[T01-1-workflow-docs-index|T01-1]])。

**テスト**

| 種類 | 対象 |
|---|---|
| 単体テスト(vitest) | WebP ヘッダーの解析、サーバー側の検証、参照のスキーマ、画質の探索処理(エンコーダーを差し替え可能にして試す)、参照元の判定 |
| widget のテスト(vitest + jsdom + Testing Library) | 操作と状態の遷移。jsdom には canvas がないので、エンコーダーはモックにする |
| E2E(Playwright、Chromium・Firefox) | 実ブラウザの canvas で「圧縮 → アップロード → 保存 → サイトに表示(img の width / height を確認)→ 一覧のサムネイル → 画像管理ページ」を通しで確認する。Safari の検出は、toBlob が PNG を返すモックで確認する |

- `@emdash-cms/plugin-test` は使わない。sandboxed プラグイン向け(workerd とマニフェストが前提)のため(`packages/plugin-test/package.json`)。
- playground: 普段の開発は Node + SQLite で素早く確認し、`wrangler dev` + D1 でも動くことを確かめる。
- Cloudflare の本番環境(Workers Free)でクエリ数と CPU 時間を測るのは任意。利用者のアカウントに手動でデプロイして行う。

## 16. 実装前の検証(スパイク)

問題が見つかったら、設計に戻る。

- [ ] git 依存 + TS ソースのプラグインを、Vite(Node と workerd)が読み込めるか(現状は推測のみ)
- [ ] プラグインのルートの body 上限(既定 1MiB。`skills/creating-plugins/references/sandbox-boundaries.md`)で、100KB の data URL を問題なくやり取りできるか
- [x] `resolveBase64Images` で画像を解決するのに、実際に何クエリかかるか(画像エントリの authorId によってバイライン取得のクエリが増えるかも含めて) → 50 件までの 1 回の呼び出しは 1 クエリ。このプラグインの画像(authorId なし)では、1 ページ 1〜3 クエリ。authorId のある画像はバイラインの補完で増える([[T09-spike-query-count#結果|T09]]、[[#12. サイト側の描画|12 章]])
- [x] canvas の WebP のファイルサイズが、ブラウザ間と cwebp とでどれだけずれるか → 同じ画素ならエンコーダーの差は小さい(Firefox は cwebp と同じ、Chromium は +0.2〜1.2%)。ずれの主な原因は縮小の方法で、上の 6.3 の方法に決めた([[T05-spike-canvas-webp#結果|T05]]、[[#A.5 ブラウザの canvas での確認|付録 A.5]])

## 17. 実装時に再確認する事項

> [!question] 合意内容のうち、実装時に確認・調整するもの
> - **ゴミ箱に移動できる権限**(決定済み): Contributor 以上のまま(2026-09-24、利用者の判断)。Editor 以上(`content:delete_any`)に揃える案は採らなかった。ルートの permission は `content:create`。→ [[T06-decision-trash-permission#結果|T06 の結果]]、[[#10. 画像のライフサイクル|10 章]]
> - **一覧の列を出すコレクションの判定方法**: `contentListColumns` の `collections` は同期関数。マニフェストをどう参照するかを確認する。
> - **`content:afterSave` に渡される内容**(確認済み、2026-09-24): `content.data` は保存した下書きで、公開版ではない。更新のときは、content テーブルの列の値(公開済みなら公開版)が `content.liveData` に入る。`isNew` は作成で `true`、更新で `false`。公開・複製・ゴミ箱・復元では呼ばれない。`after()` で実行され、応答を待たせない(`packages/core/src/emdash-runtime.ts:3670`)。→ [[T10-spike-after-save#結果|T10 の結果]]、[[#9. 参照元の記録と未使用画像の検出|9 章]]
> - **`b64_images` の seed**(確認済み、2026-09-24): [[#13.1 seed|13.1]] の構成(`hidden: true` / `routable: false` / `supports: []` / `image` は json・必須)で足りる。タイトル用のフィールドは要らない。`routable: false` は必須(slug の無いエントリを公開するため)。公開すると、内容を複製したリビジョンが 1 件できる。→ [[T02-playground#結果|T02 の結果]]

## 18. 既知の制約とリスク

| 項目 | 内容 |
|---|---|
| ブラウザ | 管理画面は Safari 非対応(canvas で WebP を作れない) |
| 入力形式 | HEIC / HEIF は非対応 |
| 編集ロック | 編集ロック中でも widget を操作できる(EmDash 側の制約) |
| 容量 | D1 の 500MB で約 2,500 枚(公開時にできるリビジョンを含む。[[#5.4 容量の目安\|5.4]])。使われなくなった画像は自動では消えず、プラグインからは完全削除もできない。使用量は Cloudflare のダッシュボードで監視する |
| バックアップ | D1 Time Travel(直近7日)だけ |
| D1 の 1 日の上限 | Free では、読み 500 万行・書き 10 万行 / 日を超えると、その日はクエリが失敗する(2026-09-01 から)。画像 1 枚のアップロードで書く行は、公開時の索引の更新を含めて数十行の見込み(推測のみ。[[T32-cloudflare-check\|T32]] で確かめる) |
| ページの重さ | 画像は HTML にインラインで埋め込まれる。一覧ページ10件で最大約 1MB、カバー1枚+ギャラリー10枚のページで約 1.1MB。圧縮すれば転送量はほぼ WebP 本体の合計まで下がる見込み(推測のみ) |
| 標準画面 | `b64_images` の標準の一覧画面・ゴミ箱画面は重い(1ページ100件 × 約 100KB) |
| スコープ外 | 本文中の画像と OGP 画像には対応しない |

## 19. 対象外・将来の検討事項

- OGP 用に画像を返す公開ルート
- 既存画像の再利用(選択 UI)
- カード表示用の小さい派生画像(Q12 の (b)。実測値は [[#付録 A. 実測データ|付録 A.3]])
- 未使用画像の自動検出・自動削除(cron)
- npm での公開
- Safari 対応(EmDash 本体で、CSP に `'wasm-unsafe-eval'` を許可する変更が必要)

## 20. 決定ログ

| # | 論点 | 決定 | 主な根拠 |
|---|---|---|---|
| Q1 | なぜ base64 か | R2 を使わない(支払い情報を登録せずに運用する) | R2 はサブスクリプションのチェックアウトが必要(公式ドキュメントのみ) |
| Q2 | スコープ | 単一画像とギャラリー。本文中の画像と OGP は対象外 | 本文ブロックの編集 UI は Block Kit のみ(公式ドキュメントのみ) |
| Q3 | 保存形式 | `json` フィールド、`MediaValue` 互換の形 | 標準の `Image` が data URL をそのまま描画できる(公式ドキュメントのみ) |
| Q4 | 画像本体の置き場所 | 非表示コレクション `b64_images` に置き、フィールドには参照だけを持つ | 画像を投稿に直接持たせると、管理画面の一覧が 146.9MB になる(実測+公式ドキュメント) |
| Q5 | ライフサイクル | 変更しない・再利用しない・自動削除しない。参照元をプラグインストレージに記録し、画像管理ページで警告を出す | プラグインは完全削除できない。D1 は1リクエスト50クエリまで(公式ドキュメントのみ) |
| Q6 | サイズ予算 | 保存する data URL で 100,000 バイト以下 | 利用者の選択 |
| — | ブラウザ | Safari は対象外。canvas で WebP を作る | Safari は WebP を作れない(外部ドキュメントのみ)。WASM は CSP で禁止されている(公式ドキュメントのみ) |
| Q7 | リサイズと画質 | 画質の下限(0.60)を守り、収まらなければ縮小する(1600 → 480px) | 写真5枚で検証(実測のみ) |
| Q8 | 入力形式 | JPEG / PNG / WebP / AVIF / BMP / GIF(静止画にする)を受け付ける。40MB・64MP まで | HEIC は Chrome / Firefox で扱えない(外部ドキュメントのみ) |
| Q9 | widget の仕様 | [[#11. 管理画面 UI]] のとおり | 公式ドキュメントのみ |
| Q10 | 一覧のサムネイル | 最初のバージョンに含める | `contentListColumns` / `visibleItems`(公式ドキュメントのみ) |
| Q11 | サーバー側の検証 | ルート・画像エントリの保存 hook・投稿の保存 hook の3か所 | デコードと解析は 0.011〜0.149ms(実測のみ) |
| Q12 | 一覧ページの画像 | メイン画像を使う(派生画像は作らない) | 利用者の選択 |
| Q13 | 配布 | npm には公開しない。git 依存で配布する | 利用者の選択 |
| Q14 | 構成とテスト | [[#15. リポジトリ構成・ツール・テスト]] のとおり | — |
| — | 対象の EmDash の版(2026-09-24) | 0.39.1(peer は `^0.39.0`)。公開から 3 日未満だったので、`~/.npmrc` の `min-release-age` の例外として入れた | npm の 0.38.0 には必要な capability が無い(実測)。0.39.x にはある(公式ドキュメントのみ)。利用者の選択([[T01-2-emdash-0-39\|T01-2]]) |

---

## 付録 A. 実測データ

> [!info] 計測環境
> - macOS(ローカル)、Node 26.10.0、cwebp 1.6.0(libsharpyuv 0.4.2)、ImageMagick(Lanczos でリサイズ)
> - 写真は、EmDash テンプレートの seed に含まれる Unsplash の写真5枚を 2400×1600 で取得して使った。
> - ブラウザの canvas ではなく cwebp で計測したので、実際のブラウザの値とは多少ずれる可能性がある。

### A.1 一覧データの JSON 処理(画像を投稿に直接持たせる案。不採用)

計測したときの前提: 画像1枚 = WebP 本体 100,000 バイト(data URL 約 133KB)。根拠は実測のみ。

| ケース | ペイロード | JSON の parse + stringify(中央値) |
|---|---|---|
| 管理画面の一覧 100件(カバーのみ) | 13.4MB | 6.8ms |
| 管理画面の一覧 100件(カバー+10枚ギャラリー) | 146.9MB | 87.5ms |
| サイト側 10件(カバーのみ) | 1.3MB | 0.6ms |
| サイト側 10件(カバー+10枚ギャラリー) | 14.7MB | 6.8ms |

### A.2 保存 100,000 バイト(WebP ≤ 74,982 B)に収まる最高画質(cwebp の `-q`)

| 写真 | 1920px | 1600px | 1280px | 1024px | 800px |
|---|---|---|---|---|---|
| p1 | 34 | 55 | 77 | 84 | 90 |
| p2 | 76 | 80 | 86 | 91 | 94 |
| p3(細部が多い) | 13 | 22 | 37 | 60 | 80 |
| p4 | 26 | 40 | 59 | 77 | 84 |
| p5(単純) | 89 | 92 | 95 | 97 | 100 |

### A.3 カード用の派生画像: 保存 30,000 バイト(WebP ≤ 22,482 B)に収まる最高画質(参考。不採用)

| 写真 | 640px | 512px |
|---|---|---|
| p1 | 49 | 76 |
| p2 | 83 | 88 |
| p3 | 49 | 76 |
| p4 | 54 | 75 |
| p5 | 94 | 97 |

### A.4 サーバー側の検証処理の重さ

- 入力: p4 を 1024px・画質 77 でエンコードしたもの(WebP 74,668 B、data URL 99,583 バイト)
- base64 のデコード + WebP ヘッダーの解析(20回の中央値):
  - `Uint8Array.fromBase64`: 0.011ms
  - `atob` + ループ: 0.149ms
- 実装([[T04-webp-utils|T04]] の `parseWebpDataUrl`)では、Node 26 で 0.009ms(`fromBase64`)/ 0.062ms(`atob`)、Chromium 153・Firefox 155 でも 0.15ms 以下だった(実測のみ。[[webp-data-url-validation]])。

### A.5 ブラウザの canvas での確認

[[T05-spike-canvas-webp|T05]] で、Chromium 153 と Firefox 155(Playwright 1.63.0、macOS、Apple M5 Pro)の `toBlob("image/webp")` を、A.2 の cwebp と比べた。全データと再現のコードは [[canvas-webp-encoding]]。根拠: 実測のみ

保存 100,000 バイトに収まる最高画質。各セルは「cwebp / Chromium / Firefox」。Firefox は 6.3 の方法(`createImageBitmap` の `resizeQuality: "high"`)で、Chromium は `drawImage`(`imageSmoothingQuality = "high"`、ソフトウェア描画)で縮小した。

| 写真 | 1600px | 1280px | 1024px | 800px |
|---|---|---|---|---|
| p1 | 55 / 57 / 55 | 77 / 78 / 77 | 84 / 85 / 84 | 90 / 91 / 90 |
| p2 | 80 / 81 / 80 | 86 / 87 / 86 | 91 / 91 / 91 | 94 / 94 / 94 |
| p3 | 22 / 26 / 22 | 37 / 45 / 36 | 60 / 70 / 60 | 80 / 83 / 80 |
| p4 | 40 / 43 / 39 | 59 / 66 / 58 | 77 / 79 / 77 | 84 / 86 / 84 |
| p5 | 92 / 92 / 91 | 95 / 95 / 95 | 97 / 97 / 97 | 100 / 99 / 99 |

- Chromium では、6.3 の方法(`createImageBitmap` の `resizeQuality: "high"`)で縮小しても、ほぼ同じ結果だった(5 枚中 4 枚はすべての条件で同じサイズ)。
- Chromium の出力は `VP8X` + `ICCP`(sRGB)+ `VP8 ` で、Firefox より 482 B 大きい。サイズの判定は Blob のサイズのままでよい。
- 採用される長辺と画質は、ブラウザと GPU の有無で変わる。E2E では値を固定しない。

## 付録 B. 参考資料

### EmDash(`references/emdash/`、0.39.1)

| パス | 内容 |
|---|---|
| `skills/creating-plugins/SKILL.md` | プラグインの形式(sandboxed / native)と capability |
| `skills/creating-plugins/references/admin-ui.md` | field widget(sandboxed で使える要素、native の React) |
| `skills/creating-plugins/references/sandbox-boundaries.md` | ルートの body 上限、完全削除できないこと |
| `skills/creating-plugins/references/storage.md` | プラグインストレージの API(`getMany` / `putMany`) |
| `packages/admin/src/components/ContentEditor.tsx:1806` | plugin widget の解決方法と、widget に渡される props |
| `packages/admin/src/router.tsx:440` | 管理画面の一覧は 100件ずつ取得する |
| `packages/admin/src/lib/content-list-columns.tsx:23` | 一覧の列を追加する拡張 |
| `packages/admin/src/components/FieldEditor.tsx:362` | スキーマ編集 UI では widget を指定できない |
| `packages/admin/src/components/editor/PluginBlockNode.tsx:41` | 本文ブロックの定義は Block Kit のみ |
| `packages/core/src/database/repositories/content.ts:760` | 一覧取得は `SELECT *` |
| `packages/core/src/cleanup.ts:37` | リビジョンは最大 50件残る |
| `packages/core/src/api/parse.ts:13` | リクエスト body の上限は 10MB |
| `packages/core/src/schema/zod-generator.ts:174` | `json` フィールドはサーバー側で中身を検証しない |
| `packages/core/src/components/EmDashImage.astro` / `packages/core/src/media/responsive.ts:127` | data URL をそのまま描画する |
| `packages/core/src/astro/middleware/csp.ts:92` / `auth.ts:301` | 管理画面の CSP |
| `packages/core/src/search/fts-manager.ts:111` | 検索は FTS5 の仮想テーブル |
| `packages/core/src/query.ts:769` / `loader.ts:772` | ロケールの決まり方、IN 句 |
| `packages/core/src/plugins/types.ts:407` / `:443` / `:544` | スキーマ情報・一覧の絞り込み条件・`ContentAccess` |
| `packages/core/src/plugins/hooks.ts:543` | beforeSave では書き込み元のプラグインを除外できない |
| `packages/core/src/emdash-runtime.ts:3516` / `:5560` | 下書きはリビジョンに保存される、afterSave は遅れて実行される |
| `packages/auth/src/rbac.ts:19` | 権限(content:create / delete_own / publish_own) |

### 外部ドキュメント

- Cloudflare R2 Get started: https://developers.cloudflare.com/r2/get-started/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare D1 Limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 Import and export data: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Can I use - toBlob の `image/webp`: https://caniuse.com/mdn-api_htmlcanvaselement_toblob_type_parameter_webp
- Can I use - HEIF/HEIC: https://caniuse.com/heif
- Can I use - AVIF: https://caniuse.com/avif
- MDN `HTMLCanvasElement.toBlob()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- MDN CSP `script-src`(`'wasm-unsafe-eval'`): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
