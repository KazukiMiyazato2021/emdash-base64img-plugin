---
id: T07
title: "スパイク: git 依存 + TS ソースで読み込めるか確かめる"
type: スパイク
status: todo
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "spikes/git-dependency/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T07 スパイク: git 依存 + TS ソースで読み込めるか確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の1つ目。TS ソースのままのプラグインを git 依存で入れたとき、Vite(Node と workerd)が読み込めるかを確かめる。

## 作業内容

- [ ] 雛形([[T01-scaffold|T01]])のプラグインを `git+file://` などで git 依存としてインストールした、使い捨てのサイトを作る(playground の複製でよい)
- [ ] Node アダプターで `astro dev` と `astro build` を実行し、起動を確認する
- [ ] Cloudflare アダプターで `astro build` を実行し、`wrangler dev` で起動を確認する
- [ ] 管理画面側の入口(`./admin` の `.tsx`)が、管理画面のバンドルに含まれることを確認する
- [ ] `files: ["src"]` で、playground などが配布物から除かれることを確認する

## 完了条件

- [ ] 結果をこのノートに根拠レベル付きで記録した
- [ ] 読み込めない場合は、ビルド(tsdown など)を入れる方針を決め、仕様書 14 章と [[T29-plugin-definition|T29]] / [[T33-readme|T33]] / [[T34-release|T34]] を更新した

## 変更してよいファイル

- `spikes/git-dependency/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!todo] 未記入
> 根拠レベル(実測+公式ドキュメント / 実測のみ / 公式ドキュメントのみ / 外部ドキュメントのみ / 推測のみ)を付けて記録する。設計が変わる場合は、仕様書と関係するタスクも更新する。
