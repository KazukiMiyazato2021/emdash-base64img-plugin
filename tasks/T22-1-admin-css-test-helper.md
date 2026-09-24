---
id: T22-1
title: "管理画面の CSS にクラスがあるかを確かめるテストの補助を共通にする"
type: 実装
status: done
wave: 3
parent: "[[T22-widget-parts]]"
depends_on:
  - "[[T22-widget-parts]]"
soft_depends_on: []
blocks:
  - "[[T24-list-column]]"
  - "[[T25-images-page]]"
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
files:
  - "tests/admin/admin-css.ts"
  - "tests/admin/admin-css.test.ts"
  - "tests/admin/parts.test.tsx(補助を使う形にする)"
  - "docs/emdash-admin-plugin-ui-styling.md(確かめ方の節)"
  - "tasks/T22-1-admin-css-test-helper.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
tags:
  - task
  - impl
  - admin
  - subtask
created: 2026-09-24
---

# T22-1 管理画面の CSS にクラスがあるかを確かめるテストの補助を共通にする

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-22-1`
> - 親タスク: [[T22-widget-parts|T22]]
> - 着手の条件(依存): [[T22-widget-parts|T22]]
> - このタスクを待つもの: [[T24-list-column|T24]]、[[T25-images-page|T25]]、[[T27-image-widget|T27]]、[[T28-gallery-widget|T28]](どれも管理画面の部品を作り、同じ確かめ方が要る)
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]

## 目的

管理画面の部品が使うクラスが、EmDash の管理画面の CSS にあるかを確かめる処理を、テストの補助として 1 か所にまとめる。後続の 4 つのタスクが、同じ処理を写さずに使えるようにする。

## 発生した理由

- 管理画面の CSS はビルド済みで、プラグインのファイルを読まない。プラグインの部品のクラスは、その CSS にあるものだけが当たる([[emdash-admin-plugin-ui-styling]])。
- [[T22-widget-parts|T22]] は、これを確かめる処理(CSS の読み込み、セレクタの書き方への変換、DOM のクラスの収集、Kumo が付けるクラスの除外)を `tests/admin/parts.test.tsx` の中に書いた。
- 一覧の列(T24)、画像管理ページ(T25)、2 つの widget(T27・T28)も同じ確かめ方が要る。それぞれに写すと、直すときに 5 か所を直すことになる。[[T16-2-image-refs-batches|T16-2]] と同じく、後続タスクが始まる前に共通にした。

## 作業内容

- [x] `tests/admin/admin-css.ts` に、`ADMIN_CSS`・`escapeClassName`・`hasClassSelector`・`collectClassNames`・`sourceTokens`・`findMissingClasses` を置く
- [x] `tests/admin/parts.test.tsx` を、補助を使う形にする(確かめる内容は変えない)
- [x] 補助のテスト(`tests/admin/admin-css.test.ts`)を書き、わざと入れた不具合でテストが失敗することを確かめる
- [x] 知見ノート [[emdash-admin-plugin-ui-styling]] の確かめ方の節を、補助の使い方に直す

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T26-playground-pages|T26]])は、これらのファイルを変更しない。

## 結果

### 補助の使い方

```tsx
import { findMissingClasses, sourceTokens } from "./admin-css";

const { container } = render(<ThumbnailColumn … />);
// 引数はリポジトリのルートからのパス。ディレクトリなら直下のファイルをすべて読む
const missing = findMissingClasses(container, sourceTokens("src/admin/ThumbnailColumn.tsx"));
expect(missing.fromSource).toEqual([]); // 自分のソースに書いたクラスは、すべて CSS にある
expect(missing.unknown).toEqual([]); // CSS に無い残りは、Kumo が自分で付けるクラスだけ
```

| export | 内容 |
|---|---|
| `findMissingClasses(root, tokens)` | 描画した DOM のクラスのうち、管理画面の CSS に無いものを返す。`fromSource` はソースに書いたクラス(当たらないので直す)。`unknown` は、ソースにも Kumo のビルド済みの JS にも無いクラス |
| `sourceTokens(...paths)` | ソースに書いた語の集合。パスはリポジトリのルートから。ディレクトリなら直下のファイルをすべて読む |
| `ADMIN_CSS` | `@emdash-cms/admin/styles.css` の本文 |
| `hasClassSelector(css, name)` | CSS にそのクラスのセレクタがあるか。長いクラスの先頭の一致(`.min-h-3` と `.min-h-32`)は数えない |
| `escapeClassName(name)` | クラス名をセレクタの書き方にする(`hover:bg-kumo-tint` → `hover\:bg-kumo-tint`) |
| `collectClassNames(root)` | 要素とその子孫のクラスを、重複と空を除いて集める |

- 状態によって付くクラス(ドラッグ中・エラー・無効など)も確かめるには、その状態にしてから集める(T22 のテストは、ドラッグ中と「1 枚ずつ」の知らせを出してから集めている)。
- `parts.test.tsx` の確かめる内容は変えていない。「確かめ方の確認」のテスト 1 件は、補助のテストに移した(`parts.test.tsx` は 78 件 → 77 件)。

### 補助のテスト

`tests/admin/admin-css.test.ts`: 26 件。根拠: **実測のみ**

- セレクタの書き方(`[`・`:`・`.`・`/`・先頭の数字)
- 管理画面の CSS にあるクラス・無いクラス。`.min-h-3` のように、長いクラスの一部としてだけ現れるものを数えないこと
- DOM のクラスの収集(要素自身・子孫・重複・空)
- ソースの語(ファイル・ディレクトリ・複数のパス)
- `fromSource` と `unknown` の分け方。Kumo が自分で付けるクラス(`disabled:text-kumo-disabled`)の除外

補助を 1 か所ずつ壊してテストを実行し、元に戻した。9 通りとも、1 件以上のテストが失敗した(括弧内は失敗した件数)。根拠: **実測のみ**

- 直後の文字を見ずに一致とする(2)/ 記号の前に `\` を置かない(9)/ 先頭の数字を変換しない(1)
- Kumo のクラスを除かない(2)/ `unknown` にソースの語を含める(1)
- ディレクトリの最初のファイルだけを読む(1)/ 要素自身のクラスを集めない(1)/ 空のクラスを除かない(2)
- 部品に管理画面の CSS に無いクラス(`max-h-24`)を足す(1。`parts.test.tsx` が失敗する)。この確認をしている `expect(missing.fromSource).toEqual([])` を弱めると、同じ不具合でもテストが通ることも確かめた

### 検証

- `npm run verify`: build・lint・test が通った(テスト 17 ファイル・1,321 件)。
