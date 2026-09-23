---
id: T02-1
title: "playground の生成物を prettier から外し、storage と容量の記述を直す"
type: ドキュメント
status: done
wave: 1
parent: "[[T02-playground]]"
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks: []
files:
  - ".prettierignore"
  - "plans/base64-image-plugin-spec.md(2.3・5.4・18 章)"
  - "tasks/T18-upload-route.md(作業内容に 1 項目追加)"
  - "tasks/T02-1-prettier-storage-capacity.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#5.4 容量の目安]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T02-1 playground の生成物を prettier から外し、storage と容量の記述を直す

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 1 / ブランチ: `phase-1/t-02-1`
> - 親タスク: [[T02-playground|T02]]
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#2. 動作環境と制約|仕様書 2章]]、[[base64-image-plugin-spec#5.4 容量の目安|仕様書 5.4]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|仕様書 18章]]

## 目的

[[T02-playground|T02]] の報告のうち、T02 の変更してよいファイルの外にあったものを片付ける。

## 発生した理由

- 開発サーバーが `playground/emdash-env.d.ts` を生成する。末尾に改行が無いので、`prettier --check .` が失敗する。prettier は `playground/.gitignore` を読まない。後続のタスクが playground を起動すると、`npm run verify` が失敗する。
- EmDash 0.39.1 は、`storage` を省略すると local storage(`./.emdash/uploads`)を既定にする。仕様書 2.3 は「storage を指定しない = `NO_STORAGE`」を前提に書いていた。
- 公開すると、データを丸ごと複製したリビジョンが 1 件できる(`supports: []` でも同じ)。仕様書 5.4 の容量の見積もり(約 5,000 枚)は、これを含んでいなかった。

## 作業内容

- [x] `.prettierignore` に `playground/emdash-env.d.ts` と `playground/.emdash/`(`astro build` が書くマイグレーションのマニフェストと、local storage の保存先)を追加する
- [x] 仕様書 2.3 に、storage を省略したときの既定と、Node・Cloudflare での違い(Cloudflare は [[T32-cloudflare-check|T32]] で確認)を書く
- [x] 仕様書 5.4 と 18 章の容量を、リビジョンの複製を含めた見積もり(約 2,500 枚)に直す
- [x] [[T18-upload-route|T18]] の作業内容に、複製を避けられるかの確認を追加する

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。フェーズ 1 で並行している [[T05-spike-canvas-webp|T05]] は仕様書の 6.3 章しか触らないので、衝突しない。

## 結果

- storage の既定: `storage: config.storage ?? DEFAULT_STORAGE`(`references/emdash/packages/core/src/astro/integration/index.ts:335`)。`DEFAULT_STORAGE` は `local({ directory: "./.emdash/uploads" })`(`:71-75`)。根拠: 公式ドキュメントのみ。Node で標準のメディアのアップロードが成功することは、T02 で実測した。
- 公開時のリビジョン: `publish` は、公開中のリビジョンが無ければ `revisionRepo.create({ data: existing.data })` で内容を複製する(`references/emdash/packages/core/src/database/repositories/content.ts:2309-2318`)。根拠: 公式ドキュメントのみ。リビジョンが 1 件できることは、T02 で実測した。
- playground は、仕様書どおり `storage` を指定しないままにする。本番(Cloudflare)と同じ設定にしておき、Node で標準のメディアのアップロードが動くことは、プラグインの動作に影響しないため(推測のみ)。
