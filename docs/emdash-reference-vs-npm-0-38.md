---
title: references/emdash と npm の emdash@0.38.0 のずれ
aliases:
  - 参照ソースと npm 版のずれ
  - emdash 0.38.0 の版のずれ
tags:
  - docs
  - emdash
  - version
source_task: "[[T06-decision-trash-permission]]"
created: 2026-09-24
updated: 2026-09-24
---

# references/emdash と npm の emdash@0.38.0 のずれ

> [!warning] 要点
> - `references/emdash` は `package.json` の版が 0.38.0 だが、0.38.0 のリリース後の開発版で、未リリースの changeset が 80 件ある。npm からインストールされる `emdash@0.38.0`(このリポジトリが使う版)とは中身が違う。
> - 仕様書が使っている capability `schema:read` / `content:publish` / `content:revisions:read` / `content:restore` は、npm の 0.38.0 には無い。`definePlugin` に渡すと `Invalid capability` の例外になる(実測)。
> - 仕様書やノートの行番号(`references/emdash/...`)は、npm の 0.38.0 の行番号と一致しないことがある。実際に動くのは `node_modules/emdash` のほう。
> - 関連: [[T06-decision-trash-permission]]、[[emdash-plugin-route-permissions]]、[[emdash-dependency-versions]]、[[base64-image-plugin-spec|仕様書]]

> [!success] 対応(2026-09-24)
> - 利用者の判断で、対象を npm の 0.39.1 に上げた(peer は `^0.39.0`)。0.39.0 / 0.39.1 には、上の capability と `ctx.content` のメソッドがある(tarball を読んで確認。公式ドキュメントのみ)。→ [[T01-2-emdash-0-39|T01-2]]、[[emdash-dependency-versions#0.38.0 から 0.39.1 に上げた経緯]]
> - `references/emdash` は、タグ `emdash@0.39.1` に切り替えた。これで、参照ソースとインストールされる版が一致する。
> - 下の表は、2026-09-24 に 0.38.0 と開発版(`ea275faf`)を比べたときの記録として残す。

## 確かめたこと

| 項目 | `references/emdash` | npm の `emdash@0.38.0` | 根拠レベル |
|---|---|---|---|
| `package.json` の version | 0.38.0 | 0.38.0 | 公式ドキュメントのみ |
| CHANGELOG の最新 | `## 0.38.0`(`packages/core/CHANGELOG.md:3`)。0.38.0 の項目に、下の capability は無い | — | 公式ドキュメントのみ |
| 未リリースの changeset | 80 件(`.changeset/*.md`、README を除く) | — | 実測のみ(ファイル数) |
| インストール元 | — | `https://registry.npmjs.org/emdash/-/emdash-0.38.0.tgz`(`package-lock.json`) | 実測のみ |
| プラグインの capability(現行の名前) | 26 個(`packages/core/src/plugins/manifest-schema.ts:30-57`) | 12 個(`node_modules/emdash/src/plugins/manifest-schema.ts:26-39`) | 公式ドキュメントのみ |
| `definePlugin({ capabilities })` | — | `schema:read` / `content:publish` / `content:revisions:read` / `content:restore` は、どれも `Invalid capability "…" in plugin "…"` の例外。`content:read` / `content:write` は通る | 実測のみ |
| `ctx.content` のメソッド | `get` / `list` / `getTranslations` / `getPublicUrl` / `listRevisions` / `getRevision` / `create` / `update` / `delete` / `getVersioned` / `publish` / `unpublish` / `schedule` / `unschedule` / `getTrashedVersioned` / `restore`(`packages/core/src/plugins/types.ts:544-599`) | `get` / `list` / `create` / `update` / `delete` だけ(`node_modules/emdash/src/plugins/types.ts:412-425`) | 公式ドキュメントのみ |
| `ctx.schema` | ある(`types.ts:986`、`schema:read` が要る) | 無い(`PluginContext` に `schema` が無い。`types.ts:596-637`) | 公式ドキュメントのみ |
| `ContentCreateOptions` | `locale` / `translationOf` | `locale` だけ(`types.ts:365-368`) | 公式ドキュメントのみ |
| ゴミ箱から戻したあとの状態 | 下書きにする(`status = 'draft'`、`live_revision_id = NULL`。`packages/core/src/database/repositories/content.ts:1513-1544`) | `deleted_at` を戻すだけで、状態はそのまま(`node_modules/emdash/src/database/repositories/content.ts:1257-1273`) | 公式ドキュメントのみ |
| プラグインルートの認可 | `packages/core/src/plugins/http-route-dispatch.ts` に分けてある | catch-all ルートの中に直接書いてある | 公式ドキュメントのみ。判定の中身は同じ([[emdash-plugin-route-permissions]]) |
| 主なファイルの行数 | `emdash-runtime.ts` 5944 / `plugins/context.ts` 1835 / `plugins/types.ts` 2154 | 4441 / 1243 / 1681 | 実測のみ(`wc -l`) |
| 同じだったファイル | `api/authorize.ts`、標準 API の `astro/routes/api/content/[collection]/[id].ts` / `[id]/restore.ts` / `[id]/permanent.ts` | 同じ | 実測のみ(`diff`) |

- 追加の capability は、changeset `plugin-publication-actions.md`(`content:publish` / `content:restore`)と `bright-plugins-discover.md`(`schema:read` / `content:revisions:read`)に、`emdash` の minor の変更として書かれている。根拠: 公式ドキュメントのみ
- これらが npm の 0.39.x に入っているかは確かめていない。changeset の運用から、次のマイナーで出ると見込まれる。根拠: 推測のみ
- T01 の時点(2026-09-23)では、0.39.x は公開から 3 日たっておらず、利用者の `~/.npmrc` の `min-release-age=3` でインストールできなかった([[emdash-dependency-versions|依存パッケージの版]])。根拠: 実測のみ(T01)

## 仕様書への影響(T06 では直していない)

| 仕様書の箇所 | 前提にしているもの | npm の 0.38.0 では | 関係するタスク |
|---|---|---|---|
| 7 章「必要な capability」 | `schema:read` / `content:publish` / `content:revisions:read` | `definePlugin` が例外を投げ、プラグインが読み込めない | [[T18-upload-route]]、[[T29-plugin-definition]] |
| 7 章「処理の順番」3 | `getVersioned` → `publish` で画像エントリを公開する | メソッドが無い。プラグインが作ったエントリは下書き(`status` の既定は `draft`。`node_modules/emdash/src/database/repositories/content.ts:332`)のままで、サイト側の既定の取得(`published` だけ)に出てこない | [[T18-upload-route]]、[[T15-site-resolve]] |
| 8 章 ① | `ctx.schema.getCollection` で widget / options を読む | `ctx.schema` が無い | [[T18-upload-route]] |
| 9 章「判定」 | `getRevision` で下書きのリビジョンを確かめる | メソッドが無い | [[T21-orphan-routes]] |
| 各章・付録 B の行番号 | `references/emdash` の行 | 行がずれていることがある | 全体 |

> [!question] 決めること(リーダー・利用者)
> - 対象の版を、これらの機能が入った版(0.39.x 以降の見込み)に上げるか。上げるなら、peer の範囲(`^0.38.0`)と T01 の固定を変える。
> - 0.38.0 のままにするなら、公開・スキーマの読み取り・下書きの確認を、npm の 0.38.0 にある API だけで設計し直す。

## 確かめた方法

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2(mise)。2026-09-24 に計測。

- ファイルの比較: `diff references/emdash/packages/core/src/<パス> node_modules/emdash/src/<パス>`。npm の `emdash` には `src/` も入っている。
- capability の確認: worktree で次を実行した。

```sh
node --input-type=module -e '
import { definePlugin } from "emdash";
for (const caps of [["content:read","content:write"], ["schema:read"], ["content:publish"], ["content:revisions:read"], ["content:restore"]]) {
  try { definePlugin({ id: "t06-check", version: "0.0.0", capabilities: caps }); console.log(caps, "ok"); }
  catch (e) { console.log(caps, e.message); }
}'
```

```text
[ 'content:read', 'content:write' ] ok
[ 'schema:read' ] Invalid capability "schema:read" in plugin "t06-check".
[ 'content:publish' ] Invalid capability "content:publish" in plugin "t06-check".
[ 'content:revisions:read' ] Invalid capability "content:revisions:read" in plugin "t06-check".
[ 'content:restore' ] Invalid capability "content:restore" in plugin "t06-check".
```

- `references/emdash` では git を実行していない(worktree からの操作が許されていないため)。どのコミットかは確かめていない。
