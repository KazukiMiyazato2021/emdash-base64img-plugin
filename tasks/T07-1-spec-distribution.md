---
id: T07-1
title: "T07 の結果(配布・npm 12・利用者側の制約)を仕様書と後続タスクに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T07-spike-git-dependency]]"
depends_on:
  - "[[T07-spike-git-dependency]]"
  - "[[T04-1-consumer-typecheck]]"
soft_depends_on: []
blocks: []
files:
  - "plans/base64-image-plugin-spec.md(14・16・18 章)"
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加)"
  - "tasks/T34-release.md(作業内容に追記)"
  - "tasks/T07-1-spec-distribution.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T07-1 T07 の結果(配布・npm 12・利用者側の制約)を仕様書と後続タスクに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-07-1`
> - 親タスク: [[T07-spike-git-dependency|T07]]
> - 着手の条件(依存): [[T07-spike-git-dependency|T07]]、[[T04-1-consumer-typecheck|T04-1]](型チェックの対策を先に入れた)
> - このタスクを待つもの: なし([[T29-plugin-definition|T29]]・[[T33-readme|T33]]・[[T34-release|T34]] はこの内容を前提に進める)
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|16 章]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|18 章]]

## 目的

[[T07-spike-git-dependency|T07]] で分かった配布の条件と、利用者のサイトでの制約を、仕様書と後続タスクのノートに書く。

## 発生した理由

- T07 は、変更してよいファイルが spike のノートだけだった。仕様書と他のタスクへの影響は、変更せずにリーダーに報告した([[T07-spike-git-dependency#仕様書と他のタスクへの影響]])。
- 報告のうち、`src/shared/data-url.ts` の型の問題は [[T04-1-consumer-typecheck|T04-1]] で直した。残りをこのサブタスクで反映する。
- T07 と T13 の知見ノートの索引への登録は、T04-1 で済ませた。

## 作業内容

- [x] 仕様書 14 章: npm 12 では、サイトの `.npmrc` に `allow-git=root` が要ること。npm 12 が依存の `prepare` を既定で止めること。両アダプターで読み込めたこと(T07 の結果)。利用者の `tsc` が `src` を検査し、T04-1 の tsconfig で確かめていること
- [x] 仕様書 16 章: 1 つ目の項目(git 依存 + TS ソース)に結論を書いて閉じる
- [x] 仕様書 18 章: git 依存(npm 12)、利用者の型チェック、`emdash migrate --from-config`、Cloudflare の開発サーバーの再読み込み、の 4 行を足す
- [x] [[T29-plugin-definition|T29]]: 配布形態は TS ソースのまま。ルートは `PluginRoute<Input>` の定義を登録する([[T08-spike-route-body|T08]] の結果も合わせた)。`src/index.ts` 以下も利用者の `tsc` で検査される
- [x] [[T33-readme|T33]]: `.npmrc` の `allow-git=root`、Cloudflare の `vite.ssr.optimizeDeps.include`(任意)、型チェック、`emdash migrate --from-config`
- [x] [[T34-release|T34]]: 別のサイトでの確認に `allow-git=root` が要ること

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T11-server-validation|T11]]・[[T12-input-decode|T12]]・[[T16-reference-hook|T16]]・[[T17-admin-data-routes|T17]])が編集しうるのは、仕様書の 5.1・6.4・6.5・11.2・11.4 だけなので、衝突しない。

## 結果

- T07 の報告の 6 項目は、すべて反映した(T04 の項目は [[T04-1-consumer-typecheck|T04-1]] で対応済み)。
- T29 への申し送りは、T07 の「型付きの `RouteContext<T>` を受け取る関数を渡す」を、T08 の実測(`PluginRoute<Input>` で型を付ける。`definePluginRoute` は入力の型が `unknown` になる)に合わせて書いた。どちらも、ハンドラーが `RouteContext<Input>` を受け取る点は同じ。根拠: **実測のみ**(T08 の `tsc`)
