---
id: T25-1
title: "T25 の結果(画像管理ページ)を後続タスクのノートに反映する"
type: ドキュメント
status: done
wave: 3
parent: "[[T25-images-page]]"
depends_on:
  - "[[T25-images-page]]"
  - "[[T25-2-page-registration-prep]]"
soft_depends_on: []
blocks: []
files:
  - "tasks/T29-plugin-definition.md(作業内容に追加)"
  - "tasks/T30-admin-entry.md(作業内容に追加)"
  - "tasks/T31-e2e.md(作業内容に追加)"
  - "tasks/T33-readme.md(作業内容に追加)"
  - "plans/base64-image-plugin-spec.md(19 章)"
  - "docs/test-lint-setup.md(vitest の節に 1 行)"
  - "tasks/T25-images-page.md・tasks/T25-2-page-registration-prep.md(反映済みの注記だけ)"
  - "tasks/T25-1-handoff-images-page.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#11.5 画像管理ページ]]"
  - "[[base64-image-plugin-spec#19. 対象外・将来の検討事項]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T25-1 T25 の結果(画像管理ページ)を後続タスクのノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 3 / ブランチ: `phase-3/t-25-1`
> - 親タスク: [[T25-images-page|T25]]
> - 着手の条件(依存): [[T25-images-page|T25]]、[[T25-2-page-registration-prep|T25-2]](登録に使う定数 `IMAGES_PAGE` を作った)
> - このタスクを待つもの: なし([[T29-plugin-definition|T29]]・[[T30-admin-entry|T30]]・[[T31-e2e|T31]]・[[T33-readme|T33]] はこの内容を前提に進める)

## 目的

T25 と T25-2 の報告のうち、後続タスクに関わるものを、それぞれのタスクノートの作業内容に書く。

## 発生した理由

T25 は、変更してよいファイルが `src/admin/ImagesPage.tsx` とテスト、`src/client/api.ts` の関数 1 つ、仕様書 11.5 だけだった。後続タスクへの影響は、ノートの「T29・T30 への登録のしかた」「影響・サブタスクの候補」に書いてリーダーに報告した。登録に使う定数は、[[T25-2-page-registration-prep|T25-2]] で作った。

## 作業内容

- [x] [[T29-plugin-definition|T29]]: `admin.pages: [IMAGES_PAGE]` での登録
- [x] [[T30-admin-entry|T30]]: `pages = { [IMAGES_PAGE.path]: ImagesPage }` での登録
- [x] [[T31-e2e|T31]]: 画像管理ページの E2E(ロールごとのボタン・確認・操作のあとの表示・さらに読み込む・参照元のリンク)と、一覧の `items: []` が続く場合と `INVALID_CURSOR`
- [x] [[T33-readme|T33]]: 画像管理ページの使い方、ゴミ箱から戻す方法、コマンドパレットの `b64_images`
- [x] 仕様書 19 章: 画像管理ページにゴミ箱から戻す操作を置くこと(将来の検討事項。利用者の了承)
- [x] 知見ノート [[test-lint-setup]]: テストが直接読む推移的な依存と、devDependencies に入れない理由

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスクは無い(フェーズ 3 の最後)。

## 結果

- T25 の「影響・サブタスクの候補」は、次のように扱った。
  - ゴミ箱から戻す操作: 合意した仕様の操作(ゴミ箱への移動・完全削除)に無いので、今は作らない。仕様書 19 章の将来の検討事項にした(2026-09-24、利用者の了承)。T33 の README で、標準 API で戻して画像管理ページで公開し直す手順を案内する。
  - T22 の `ErrorMessage` に文言を渡せる props: T25 のページは同じ形の自前の表示を持つ。見た目と読み上げは同じなので、今は置き換えない。
  - 記録だけが残った画像を消す手段: 仕様書 19 章にある([[T21-1-handoff-orphan-routes|T21-1]])。
  - ページの定数: [[T25-2-page-registration-prep|T25-2]] で作った。
  - `tests/admin/hooks.test.ts` の後片付け: [[T23-2-hooks-test-cleanup|T23-2]] で直した。
  - コマンドパレットの `b64_images`: 仕様書 18 章に書いた(T25 のマージのとき)。
  - テストが直接読む推移的な依存(`@tanstack/react-query`・`@lingui/core`、T25-2 で足した `@emdash-cms/blocks/server`): devDependencies には入れない。理由は [[test-lint-setup#vitest(4.1.11)]] に書いた。
- T25-2 の提案の `forgetThumbnails(ids)`(完全削除 1 回ごとのマニフェストの要求を減らす)は、要求が 1 回増えるだけなので、今は作らない。
