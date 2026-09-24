---
id: T18-2
title: "INVALID_TARGET の文言を、エントリの言語がサイトに無いときにも合うようにする"
type: 実装
status: done
wave: 3
parent: "[[T18-upload-route]]"
depends_on:
  - "[[T18-upload-route]]"
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks: []
files:
  - "src/client/error-messages.ts(INVALID_TARGET の文言だけ)"
  - "tests/client/api.test.ts(文言のテストを 1 件足す)"
  - "tasks/T18-upload-route.md(反映済みの注記だけ)"
  - "tasks/T18-2-invalid-target-message.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#7. アップロード(書き込み経路)]]"
tags:
  - task
  - impl
  - admin
  - subtask
created: 2026-09-24
---

# T18-2 INVALID_TARGET の文言を、エントリの言語がサイトに無いときにも合うようにする

> [!info] 概要
> - 種別: 実装(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-18-2`
> - 親タスク: [[T18-upload-route|T18]]
> - 着手の条件(依存): [[T18-upload-route|T18]]、[[T14-admin-i18n-api|T14]](文言のファイルを作った)
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#7. アップロード(書き込み経路)|仕様書 7 章]]

## 目的

アップロードのルートが返す 400 `INVALID_TARGET` の画面の文言を、ルートがこのコードを返すすべての場合に合うようにする。

## 発生した理由

- [[T14-admin-i18n-api|T14]] は、`INVALID_TARGET` を「保存先のフィールドが無い、またはこのプラグインの画像フィールドでない」として文言を作った。
- [[T18-upload-route|T18]] で、`target.locale` がサイトのロケールでないとき(i18n のサイトで設定に無いロケール、i18n の無いサイトで 36 文字以上)も、同じ `INVALID_TARGET` を返すことにした(仕様書 7 章)。
- 起きるのは、設定から外したロケールのエントリを編集するときくらい。それでも、元の文言だと「フィールドの設定を確認してください」と、違う場所を案内してしまう。
- 文言を広げるかは、T18 が T14・T23 の判断とした。`src/client/error-messages.ts` は T14 のファイルで、実行中のタスクは変更しないので、リーダーがサブタスクとして直した。

## 作業内容

- [x] `INVALID_TARGET` の ja / en の文言に、エントリの言語がサイトに設定されていない場合を加える
- [x] 文言がどちらの場合も伝えることを、テストで確かめる

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T21-orphan-routes|T21]]・[[T23-upload-hook|T23]]・[[T24-list-column|T24]]・[[T26-playground-pages|T26]])は、これらのファイルを変更しない。

## 結果

| 言語 | 変更前 | 変更後 |
|---|---|---|
| ja | 保存先のフィールドが見つからないか、このプラグインの画像フィールドではありません。フィールドの設定を確認してください。 | 保存先が正しくありません。フィールドが見つからないか、このプラグインの画像フィールドではないか、編集中のエントリの言語がサイトに設定されていません。フィールドとサイトの言語の設定を確認してください。 |
| en | The destination field does not exist or is not an image field of this plugin. Check the field settings. | The destination is invalid: the field does not exist, is not an image field of this plugin, or the entry's locale is not configured for the site. Check the field settings and the site's locales. |

- 日本語では、ロケールを「言語」と書いた。EmDash 0.39.1 の管理画面の日本語の文言も、ロケールを「言語」と訳している(`references/emdash/packages/admin/src/locales/ja/` の「言語を設定」など)。根拠: **公式ドキュメントのみ**
- ルートの応答の `message`(英語。ログと調査のため)は変えていない。画面の文言はコードで決まる。
- テスト: `tests/client/api.test.ts` に 1 件足した。元の文言に戻すと失敗し、新しい文言で通ることを確かめた。根拠: **実測のみ**
- `npm run verify`: build・lint・test が通った(テスト 17 ファイル・1,322 件)。
