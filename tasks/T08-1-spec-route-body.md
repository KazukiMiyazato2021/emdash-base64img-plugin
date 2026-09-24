---
id: T08-1
title: "T08 の結果(ルートの body 上限)を仕様書と後続タスクに反映する"
type: ドキュメント
status: done
wave: 2
parent: "[[T08-spike-route-body]]"
depends_on:
  - "[[T08-spike-route-body]]"
soft_depends_on: []
blocks: []
files:
  - "plans/base64-image-plugin-spec.md(2.2・16・20 章、付録 B)"
  - "tasks/T18-upload-route.md(作業内容・完了条件)"
  - "tasks/T32-cloudflare-check.md(作業内容に追加)"
  - "docs/00-index.md"
  - "tasks/T08-1-spec-route-body.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#2.2 プラットフォームの上限]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T08-1 T08 の結果(ルートの body 上限)を仕様書と後続タスクに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 2 / ブランチ: `phase-2/t-08-1`
> - 親タスク: [[T08-spike-route-body|T08]]
> - 着手の条件(依存): [[T08-spike-route-body|T08]]
> - このタスクを待つもの: なし([[T18-upload-route|T18]]・[[T32-cloudflare-check|T32]] はこの内容を前提に進める)
> - 仕様: [[base64-image-plugin-spec#2.2 プラットフォームの上限|仕様書 2.2]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|16 章]]

## 目的

[[T08-spike-route-body|T08]] の結果のうち、T08 が変更しなかった仕様書の章と、後続タスクのノートに反映する。T08 は仕様書 7 章だけを更新した。

## 発生した理由

- T08 の報告([[T08-spike-route-body#仕様書とほかのタスクへの影響]]):
  - 仕様書 2.2 と付録 B の「EmDash API のリクエスト body 10MB」は、プラグインのルートには当てはまらない。
  - 16 章の 2 つ目の項目は、リーダーが結論を書いて閉じる。
  - `localeSchema` に長さの上限が無い。
  - workerd での確認は T32 で行う。
- 反映の途中で、仕様書 20 章の Q5 の根拠に、[[T10-1-spec-d1-limits|T10-1]] で直した「D1 は 1 リクエスト 50 クエリまで」が残っていることに気付いた。T18 の完了条件にも「50 に収まる」が残っていた。

## 作業内容

- [x] 仕様書 2.2: 「EmDash の標準 API の body 10MB」はプラグインのルートに当てはまらないことを書き、プラグインのルートの body の行を足す
- [x] 仕様書 16 章: 2 つ目の項目(body の上限)に結論を書いて閉じる
- [x] 仕様書 20 章 Q5: 根拠の「D1 は 50 クエリまで」に、決めた時点の理解であることと、T10-1 の訂正を添える(決定の記録は書き換えない)
- [x] 仕様書 付録 B: `sandbox-boundaries.md`・`parse.ts:13` の説明を直し、プラグインのルートの body と権限の確認のソースを足す
- [x] [[T18-upload-route|T18]]: ルートの宣言の雛形、単体テストで確かめること、`target.locale` の照合を作業内容に足す。完了条件の「50 に収まる」を直す
- [x] [[T32-cloudflare-check|T32]]: workerd での body の上限とエラー、アップロード全体の CPU 時間を作業内容に足す
- [x] `docs/00-index.md`: [[emdash-plugin-route-body-limit]] を登録し、[[emdash-plugin-route-permissions]] の説明を 0.39.1 の再計測に合わせる

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T11-server-validation|T11]]・[[T12-input-decode|T12]]・[[T16-reference-hook|T16]]・[[T17-admin-data-routes|T17]])が編集しうるのは、仕様書の 5.1・6.4・6.5・11.2・11.4 だけなので、衝突しない。

## 結果

- `localeSchema` の長さの上限: EmDash 自身のロケールの検証(`LOCALE_CODE_PATTERN`、`references/emdash/packages/core/src/i18n/config.ts:15`。API の `localeCode` も同じ)も同じ正規表現で、長さの上限が無い。根拠: **公式ドキュメントのみ**
  - そのため、共有のスキーマ([[T03-shared-contracts|T03]] のファイル)はここでは変えない。
  - アップロードのルート([[T18-upload-route|T18]])で、サイトに設定されたロケールと照らし合わせる。スキーマに上限を足すかは、T18 で決める。根拠: **推測のみ**(設計の判断)
- [[T17-admin-data-routes|T17]] への「JSON の応答には上限が無い」は、実行中の T17 のノートを編集すると衝突するので、書かなかった。T17 には、応答の大きさを測って件数を決めるよう指示してある。
