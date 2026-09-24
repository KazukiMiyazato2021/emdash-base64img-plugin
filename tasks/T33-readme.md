---
id: T33
title: "README と導入手順を書く"
type: ドキュメント
status: todo
wave: 6
depends_on:
  - "[[T29-plugin-definition]]"
  - "[[T30-admin-entry]]"
soft_depends_on: []
blocks:
  - "[[T34-release]]"
files:
  - "README.md"
spec:
  - "[[base64-image-plugin-spec#13. 設定]]"
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
created: 2026-09-23
---

# T33 README と導入手順を書く

> [!info] 概要
> - 種別: ドキュメント / ウェーブ: 6
> - 着手の条件(依存): [[T29-plugin-definition|T29]]、[[T30-admin-entry|T30]]
> - このタスクを待つもの: [[T34-release|T34]]
> - 仕様: [[base64-image-plugin-spec#13. 設定|仕様書 13章]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#18. 既知の制約とリスク|仕様書 18章]]

## 目的

自分のサイトにこのプラグインを入れるための手順をまとめる。

## 作業内容

- [ ] インストール(git 依存でタグを指定する方法。非公開リポジトリの場合のトークン)
- [ ] サイトの `.npmrc` に `allow-git=root` を書く(npm 12 は git 依存を既定で拒否する。`npm ci` を実行する CI とビルドの環境でも要る)([[npm12-git-dependency-policy]]、[[T07-1-spec-distribution|T07-1]])
- [ ] Cloudflare アダプターで開発するとき: `vite.ssr.optimizeDeps.include` にプラグインを入れると、最初のリクエストでの再読み込みが起きない(任意)([[git-dependency-ts-source#Cloudflare アダプターの astro dev の再最適化]])
- [ ] 型チェック: サイトで `tsc --noEmit` を実行すると、プラグインの `src` も検査される(`astro check` は検査しない)。どちらでもエラーが出ないこと([[T04-1-consumer-typecheck|T04-1]])
- [ ] マイグレーション: `emdash migrate --from-config` は使えない。既定の `emdash migrate` を使う([[git-dependency-ts-source]])
- [ ] `astro.config.mjs` の設定(storage を指定しない)
- [ ] seed(`b64_images` とフィールドの定義)と options の一覧
- [ ] サイト側の使い方(`resolveBase64Images` と `Image`、一覧ページでまとめて解決する方法)
- [ ] 制約(Safari 非対応、HEIC 非対応、容量、バックアップ、標準の `b64_images` の画面を使わないこと)
  - `b64_images` は標準の画面で編集しない。標準の編集画面からは保存も公開もできない(保存 hook が拒否する)。画像を差し替えるときは、新しくアップロードする([[T19-image-entry-hook#他のタスクへの影響|T19]])
  - 標準の新規作成の画面・REST・seed で作った画像は `imageRefs` に記録が無く、投稿から参照すると保存が拒否される。画像は widget からアップロードする([[T16-reference-hook#seed の画像の扱い|T16]])
- [ ] サイト側の例: `getEmDashEntry` は、エントリが見つからないときも `error`(Astro の `LiveEntryNotFoundError`)を返す。`error` があるだけで 500 にすると、存在しない URL が 500 になる。playground の詳細ページ(`playground/src/pages/posts/[slug].astro`)の書き方を例にする([[playground-site-pages#getEmDashEntry は見つからないときも error を返す]])
- [ ] サイト側の例: LCP の対象の画像に `priority` を付けるとき、対象の画像が見つからないとどの画像にも付かないことがある。描画できる最初の画像を選ぶ(仕様書 12 章、[[playground-site-pages#LCP の対象の選び方]])
- [ ] 画像管理ページ(サイドバーの「プラグイン」の「画像」)の使い方: ゴミ箱への移動(寄稿者以上)、完全削除(管理者、ゴミ箱の画像だけ)、公開し直す(編集者以上、下書きの画像だけ)。ページの項目はロールで絞られず、閲覧者にも出る(開くと権限の文言)([[T25-images-page#結果|T25]])
- [ ] ゴミ箱から戻す操作は画像管理ページに無い。戻すなら、標準 API の `POST /_emdash/api/content/b64_images/{id}/restore`(編集者以上)を使う。戻した画像は下書きになるので、画像管理ページの「公開」で公開し直す(仕様書 10 章・19 章)。EmDash の標準の画面でも戻せるとみられるが、1 ページ 100 件の base64 を読むので使わない(推測のみ。T33 で確かめて書く)
- [ ] 管理画面のコマンドパレットで「Images」などと入力すると、非表示の `b64_images`(Base64 Images)も候補に出る。選ぶと標準の `b64_images` の一覧(`/_emdash/admin/content/b64_images`。1 ページ 100 件の base64 を読み、重い)に移るので、選ばない(仕様書 18 章。移る先は [[T29-plugin-definition#他のタスクへの影響・サブタスクの候補|T29]] の実測)
- [ ] `b64_images` は、サイトの seed に入れる(仕様書 13.1 の構成)。無いと、最初の保存と、管理画面でプラグインを有効にしたときに、サーバーのログにエラーが出て、アップロードが 500 `IMAGE_COLLECTION_MISSING` になる。プラグインはコレクションを作れない([[T29-plugin-definition#決めたこと|T29]]、[[emdash-native-plugin-lifecycle-hooks]])

## 完了条件

- [ ] README の手順だけで、playground と同じ構成を再現できる

## 変更してよいファイル

- `README.md`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
