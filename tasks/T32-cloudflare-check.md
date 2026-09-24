---
id: T32
title: "Cloudflare(wrangler dev + D1)で動作を確認する"
type: テスト
status: todo
wave: 6
depends_on:
  - "[[T26-playground-pages]]"
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "playground/wrangler.jsonc"
  - "playground/astro.config.cloudflare.mjs"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト]]"
tags:
  - task
  - test
created: 2026-09-23
---

# T32 Cloudflare(wrangler dev + D1)で動作を確認する

> [!info] 概要
> - 種別: テスト / ウェーブ: 6
> - 着手の条件(依存): [[T26-playground-pages|T26]]、[[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2章]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15章]]

## 目的

Node + SQLite だけでなく、workerd + D1 でも動くことを確かめる。

## 作業内容

- [ ] playground に wrangler の設定を追加する(D1 のみ、R2 なし)
- [ ] `wrangler dev` で主なシナリオを確認する(手動、または E2E の一部)
- [ ] workerd でも、プラグインのルートの body の上限(`maxBytes`)とエラー(413 `INVALID_PLUGIN_REQUEST`・400 `VALIDATION_ERROR`)が Node と同じになるかを確かめる([[T08-spike-route-body#仕様書とほかのタスクへの影響|T08]]、[[T08-1-spec-route-body|T08-1]])
- [ ] workerd でも、保存 hook の拒否が 422 `SAVE_REJECTED` と `message` になることを確かめる([[T16-reference-hook|T16]]・[[T19-image-entry-hook|T19]])
- [ ] 任意: 利用者のアカウントの Workers Free にデプロイし、CPU 時間とクエリ数を測る(手動。利用者の了承を得てから行う)。CPU 時間は、アップロード 1 回の全体(body の parse・検証・作成・公開)で測る(Node での検証だけの時間は 0.28ms。[[emdash-plugin-route-body-limit]])
  - ルートの検証全体(T11)は Node で中央値 0.40ms / 0.93ms(`fromBase64` / `atob`)。workerd には `Uint8Array.fromBase64` がある([[T07-spike-git-dependency#結果|T07]]、[[server-image-validation]])
  - `preview` 10 件 × 500,000 バイトの JS の処理は、Node で 3.5〜5.6ms([[emdash-plugin-preview-thumbnail-routes]])。Workers でも 10ms に収まるかを測る

## 完了条件

- [ ] 結果をこのノートに根拠レベル付きで記録した

## 変更してよいファイル

- `playground/wrangler.jsonc`
- `playground/astro.config.cloudflare.mjs`
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
