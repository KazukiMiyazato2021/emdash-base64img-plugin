---
title: zod 4.5 の文字列の長さはコードポイントで数える
aliases:
  - zod の max はコードポイント
  - zod string length code points
tags:
  - docs
  - zod
  - validation
source_task: "[[T03-shared-contracts]]"
created: 2026-09-24
updated: 2026-09-24
---

# zod 4.5 の文字列の長さはコードポイントで数える

> [!summary] 要点
> - zod 4.5.4 の `z.string().max(n)` / `.min(n)` / `.length(n)` は、文字列の長さを **Unicode のコードポイント** で数える。JavaScript の `.length`(UTF-16 のコード単位)とも、UTF-8 のバイト数とも違う。
> - そのため、`max(n)` を「n バイト以下」の意味で使えるのは、文字列が ASCII だけのときに限る。
> - このプラグインは、data URL のスキーマを空白を除く ASCII の印字可能文字(`/^[\x21-\x7E]+$/`)に限り、長さの上限がそのままバイトの上限になるようにした(`src/shared/schema.ts`)。
> - 代替テキストの 1,000 文字はコードポイントで数える。HTML の `maxlength` は UTF-16 のコード単位で数えるので、入力欄の制限のほうが厳しいか同じになる。
> - 関連: [[T03-shared-contracts]]、[[base64-image-plugin-spec#5.2 参照(投稿側フィールドの値)|仕様書 5.2]]、[[T11-server-validation]]、[[T16-reference-hook]]、[[T22-widget-parts]]

## 実測

根拠: **実測+公式ドキュメント**(zod のソースは `node_modules/zod/v4/core/checks.js`)

| 入力 | `.length`(UTF-16) | コードポイント | `z.string().max(1000)` |
|---|---|---|---|
| `"a".repeat(1001)` | 1001 | 1001 | 拒否 |
| `"😀".repeat(500) + "a"` | 1001 | 501 | 通る |
| `"😀".repeat(600)` | 1200 | 600 | 通る |
| `"😀".repeat(1001)` | 2002 | 1001 | 拒否 |

```js
const { z } = require("zod");
const s = "😀".repeat(500) + "a";
console.log(s.length, [...s].length, z.string().max(1000).safeParse(s).success); // 1001 501 true
```

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0(mise)、`zod` 4.5.4(`emdash` 0.39.1 が依存する版と同じ)。2026-09-24 に計測。

## ソース

- `max`: `input.length` が上限を超えたときだけ `util.codePointLength(input)` で数え直す(`node_modules/zod/v4/core/checks.js:330-333`)。コメントに「Strings are measured in Unicode code points, not UTF-16 units」とある。
- `min`: `input.length` が下限以上で下限の 2 倍未満のときだけ、コードポイントで数え直す(`:358-363`)。
- `length`: `input.length` が `[n, 2n]` の範囲にあるとき、コードポイントで数え直す(`:389-394`)。
- 根拠: 公式ドキュメントのみ(ソースを読んだ)

## このプラグインでの扱い

| 値 | 上限 | 数え方 | 対応 |
|---|---|---|---|
| 画像本体の data URL | 固定上限 500,000 バイト | バイト | スキーマで ASCII に限る。`.length` = バイト数 = コードポイント数 |
| サムネイルの data URL | 8,000 バイト | バイト | 同上 |
| 代替テキスト | 1,000 文字 | コードポイント | zod の数え方のまま。入力欄の `maxlength={1000}` は UTF-16 で数えるので、入力欄のほうが厳しいか同じ |
| 元のファイル名 | 255 文字 | コードポイント | zod の数え方のまま |

- サーバー側の検証([[T11-server-validation]])で data URL の長さを `maxStoredBytes` と比べるときは、先頭が `data:image/webp;base64,` で base64 の文字だけから成る(= ASCII)ことを確かめたうえで `.length` を使う。
- 代替テキストの残りの文字数を画面に出すなら([[T22-widget-parts]])、`[...text].length`(コードポイント)で数えると、サーバーの判定と一致する。
