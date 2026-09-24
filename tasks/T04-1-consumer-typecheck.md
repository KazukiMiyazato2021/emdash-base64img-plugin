---
id: T04-1
title: "利用者のサイトの tsc で src の型が通るようにする"
type: 実装
status: done
wave: 2
parent: "[[T04-webp-utils]]"
depends_on:
  - "[[T07-spike-git-dependency]]"
  - "[[T13-encode-search]]"
soft_depends_on: []
blocks: []
files:
  - "src/shared/data-url.ts"
  - "src/shared/pipeline.ts(signal の型だけ)"
  - "src/client/encode.ts(1 行)"
  - "src/client/thumbnail.ts(1 行)"
  - "tsconfig.consumer-loose.json"
  - "tsconfig.consumer-strict.json"
  - "package.json(typecheck の script だけ)"
  - "docs/git-dependency-ts-source.md(追記)"
  - "docs/test-lint-setup.md(npm scripts と TypeScript の節)"
  - "docs/compress-image-browser-check.md(表の wikilink の書き方だけ)"
  - "docs/00-index.md"
  - "tasks/T04-1-consumer-typecheck.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - impl
  - subtask
created: 2026-09-24
---

# T04-1 利用者のサイトの tsc で src の型が通るようにする

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-04-1`
> - 親タスク: [[T04-webp-utils|T04]](`src/shared/data-url.ts` の担当)
> - 着手の条件(依存): [[T07-spike-git-dependency|T07]](問題を見つけた)、[[T13-encode-search|T13]](直すファイルの一部を作った)
> - このタスクを待つもの: なし。以降のすべてのタスクは、`npm run typecheck` で利用者向けの型チェックも通す
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|15 章]]

## 目的

このプラグインは TS ソースのまま配布する。利用者のサイトで `tsc` を実行すると、プラグインの `src` も利用者の設定で型チェックされる([[git-dependency-ts-source#利用者側の型チェック]])。利用者の設定が緩くても厳しくても型エラーが出ないようにし、それが崩れないことを `npm run verify` で確かめられるようにする。

## 発生した理由

- [[T07-spike-git-dependency|T07]] の実測で、TypeScript 5.x、`lib` を ES2022 に絞った設定、`strict: false` の設定では、`src/shared/data-url.ts` が型エラーになった。
- このリポジトリの `tsconfig.json`(TypeScript 6.0.3、strict)では 0 件なので、T04 のときは気付けなかった。
- `src/shared/data-url.ts` は T04 の担当のファイルで、T07(スパイク)は変更できない。そこで、リーダーがサブタスクとして直した。

## 作業内容

- [x] `Uint8Array.fromBase64` / `toBase64` を、lib の型に頼らずに呼ぶ(使う形だけを自前で宣言する)
- [x] 結果の型の判別を `if (!result.ok)` から `if (result.ok === false)` にする(`src/shared/data-url.ts`・`src/client/encode.ts`・`src/client/thumbnail.ts`)
- [x] 省略できる `signal` の型を `AbortSignal | undefined` にする(`src/shared/pipeline.ts` の 5 か所)
- [x] 利用者の設定の代わりになる tsconfig を 2 つ作り、`npm run typecheck` で検査する
- [x] 知見ノート [[git-dependency-ts-source]] に対策を追記し、[[test-lint-setup]] の npm scripts を直す
- [x] 索引に登録していなかった T07・T13 の知見ノートを、`docs/00-index.md` に登録する
- [x] 以降のタスクのチームメイトへの指示に、書き方の決まりを加える(下の「結果」)

## 完了条件

- [x] `tsc --noEmit` を 3 つの設定で実行し、どれも 0 件
- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T14-admin-i18n-api|T14]]・[[T15-site-resolve|T15]])は、これらのファイルを変更しない。ただし、マージしたあとは、それらのコードも利用者向けの型チェックを通す必要がある。

## 結果

### 利用者の設定の代わりにする tsconfig

どちらも `tsconfig.json` を継承し、`include` を `src` だけにした(利用者の tsc が検査するのは `src` だから)。

| ファイル | 変えた設定 | 何の代わりか |
|---|---|---|
| `tsconfig.consumer-loose.json` | `lib: ["es2022", "dom", "dom.iterable"]`、`strict: false`、`noUncheckedIndexedAccess: false` | TypeScript 5.x の lib、`strict` を切ったサイト |
| `tsconfig.consumer-strict.json` | `exactOptionalPropertyTypes`・`noPropertyAccessFromIndexSignature`・`noImplicitReturns`・`noUnusedLocals`・`noUnusedParameters`・`noUncheckedSideEffectImports`・`erasableSyntaxOnly` を有効 | Astro の strictest と、それより厳しい設定 |

`package.json` の `typecheck` は `tsc --noEmit && tsc --noEmit -p tsconfig.consumer-loose.json && tsc --noEmit -p tsconfig.consumer-strict.json` にした。`build` と `verify` から呼ばれる。

- TypeScript 5.x の実物では検査していない。lib を絞った設定で、5.x の lib に無い型(`fromBase64` など)を使っていないことを確かめる。根拠: **推測のみ**。T07 は TypeScript 5.8.3 / 5.9.3 / 7.0.2 で、同じ対策で 0 件になることを確かめている(**実測のみ**)
- `.tsx`(管理画面)は、利用者のコードが `/admin` を import しない限り検査されない([[git-dependency-ts-source#利用者側の型チェック]])。今は `src` に `.tsx` が無いので、`include: ["src"]` で全部を検査しても問題ない。管理画面のタスク(T22〜T25)で `.tsx` が増えて、この 2 つの設定で通らないものが出たら、そのときに扱いを決める。根拠: **推測のみ**

### 直す前と後(TypeScript 6.0.3)

`phase/2`(`5404fe4`)の `src` を取り出し、同じ tsconfig で検査した。根拠: **実測のみ**

| 設定 | 直す前 | 直した後 |
|---|---|---|
| `tsconfig.json` | 0 | 0 |
| `tsconfig.consumer-loose.json` | 12 | 0 |
| `tsconfig.consumer-strict.json` | 1 | 0 |

直す前のエラーの内訳:

- `lib` に `Uint8Array.fromBase64` / `toBase64` が無い(TS2550): `data-url.ts` の 4 件
- `strictNullChecks` が無効だと `if (!result.ok)` で絞り込まれず、失敗の側のプロパティ(`lastEdge` など)が無いことになる(TS2339 / TS2322): `data-url.ts` の 2 件、`encode.ts` の 3 件、`thumbnail.ts` の 3 件。`encode.ts` と `thumbnail.ts` は T07 のあとに T13 で増えたもの
- `exactOptionalPropertyTypes` で、`AbortSignal | undefined` の値を `signal?: AbortSignal` に渡せない(TS2379): `encode.ts` の 1 件

### 書き方の決まり(以降のタスク)

チームメイトへの指示(リーダーが持つ `team-rules.md`)に加えた。

- lib の型に頼る新しい API(ES2023 以降の組み込みや、`Uint8Array.fromBase64` など)は、使う形を自前で宣言してから呼ぶ。実行時に無いときの代わりの処理も書く
- 成功・失敗を表す判別共用体は、`=== false`(または `=== true`)で判別する。`!result.ok` は使わない
- 省略できるプロパティに `undefined` を渡しうるなら、型を `?: T | undefined` にする
- `npm run typecheck` が 3 つの設定を通ることを、`npm run verify` で確かめる
