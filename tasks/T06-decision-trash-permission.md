---
id: T06
title: "決定: 画像をゴミ箱に移動できる権限"
type: 決定
status: done
wave: 0
depends_on: []
soft_depends_on: []
blocks:
  - "[[T21-orphan-routes]]"
  - "[[T25-images-page]]"
files:
  - "plans/base64-image-plugin-spec.md(10・17 章)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
  - "[[base64-image-plugin-spec#17. 実装時に再確認する事項]]"
tags:
  - task
  - decision
created: 2026-09-23
---

# T06 決定: 画像をゴミ箱に移動できる権限

> [!info] 概要
> - 種別: 決定 / ウェーブ: 0
> - 着手の条件(依存): なし
> - このタスクを待つもの: [[T21-orphan-routes|T21]]、[[T25-images-page|T25]]
> - 仕様: [[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17章]]

## 目的

仕様書 17 章の未決事項。画像をゴミ箱に移動できる権限を決める。利用者が判断する。

## 選択肢

- **案A**: Contributor 以上(合意済みの案)→ **採用**(2026-09-24、利用者の判断)
- **案B**: Editor 以上(`content:delete_any`)。**推奨**。自分のコンテンツを削除する `content:delete_own` でも Author 以上で(`references/emdash/packages/auth/src/rbac.ts:22`)、画像は複数の投稿から参照されうるため → 不採用

## 作業内容

- [x] 案A と案B のどちらにするかを決める(利用者が案A を選んだ)
- [x] 決めた権限を、このノートの「結果」に書く

## 完了条件

- [x] 決定をこのノートと、仕様書 10・17 章に記録した

## 変更してよいファイル

- `plans/base64-image-plugin-spec.md`(10・17 章)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 決定(2026-09-24、利用者の判断)
> - 画像のゴミ箱への移動は **Contributor 以上**(案A、合意済みの案)。推奨した案B(Editor 以上)は採らない。
> - 完全削除は、標準 API のまま **Admin のみ**(`content:delete_permanent`)。
> - 実装: プラグインのルートに `permission: "content:create"` を宣言し、ハンドラーで `ctx.content.delete("b64_images", id)` を呼ぶ。
> - 記録した場所: このノート、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10 章]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17 章]]。

> [!warning] 参照ソースと npm の `emdash@0.38.0` は中身が違う
> `references/emdash` は `package.json` の版が 0.38.0 だが、0.38.0 のリリース後の開発版で、未リリースの changeset が 80 件ある。このノートの結論は、インストール済みの npm 版(`node_modules/emdash`)で実測し、両方のソースを読んで確かめた。ルートの権限、`ctx.content.delete`、標準 API の権限は両方で同じ。T06 に関係して違うのは、ゴミ箱から戻したあとの状態([[#緩和策]])と、プラグインからゴミ箱の中を読めるか(`content:restore` は参照ソースにだけある。[[#後続タスク向けのメモ]])の 2 点。ずれの全体は [[emdash-reference-vs-npm-0-38]]。
>
> 2026-09-24 追記: 利用者の判断で、対象を 0.39.1 に上げた([[T01-2-emdash-0-39|T01-2]])。このノートの `node_modules/` の行番号は 0.38.0 のときのもの。

### 決定と理由

| 項目 | 内容 | 根拠レベル |
|---|---|---|
| 決定 | 案A(Contributor 以上)。利用者の判断で、当初の合意(仕様書 10 章)のまま | —(利用者の判断) |
| 選択肢として示した根拠 | `content:create` = Contributor、`content:delete_own` = Author、`content:delete_any` = Editor、`content:delete_permanent` = Admin(`references/emdash/packages/auth/src/rbac.ts:19-27`)。media は `media:delete_own` = Author、`media:delete_any` = Editor(`:36-37`)。インストール済みの `@emdash-cms/auth` 0.38.0 も同じ値(`node_modules/@emdash-cms/auth/dist/index.mjs:99-105`) | 公式ドキュメントのみ |
| 結果として揃うこと | アップロードできる人(ルートの permission は `content:create`。仕様書 7 章)と、ゴミ箱に移せる人が同じ範囲になる | 公式ドキュメントのみ |

### 実装への落とし込み

#### ルートの `permission` は `content:create`

- private ルートでは、EmDash がハンドラーを呼ぶ前に `user.role >= Permissions[permission]` で判定する。**`permission` を省略すると `plugins:manage`(Admin のみ)になる**。根拠: 実測+公式ドキュメント(`node_modules/emdash/src/astro/routes/api/plugins/[pluginId]/[...path].ts:53-58`、`references/emdash/packages/core/src/plugins/http-route-dispatch.ts:55-72`、`references/emdash/skills/creating-plugins/references/api-routes.md:81-103`)
- Contributor 以上になる permission は `content:read_drafts` / `content:create` / `media:upload` の 3 つだけ(`references/emdash/packages/auth/src/rbac.ts:18-19`、`:33`)。ゴミ箱に移すルートは `content:create` にする。アップロードのルート(仕様書 7 章)と同じで、Contributor の段階にある唯一のコンテンツの書き込みの権限のため。根拠: 公式ドキュメントのみ
- npm の `emdash@0.38.0` の catch-all ルート(dist)を、偽の `locals` で直接呼んだ結果(POST、`X-EmDash-Request: 1` あり、セッション認証)。根拠: **実測のみ**

| permission \ ロール | 未ログイン | Subscriber | Contributor | Author | Editor | Admin |
|---|---|---|---|---|---|---|
| (省略) | 401 | 403 | 403 | 403 | 403 | 200 |
| `content:create` | 401 | 403 | **200** | 200 | 200 | 200 |
| `content:read_drafts` | 401 | 403 | 200 | 200 | 200 | 200 |
| `content:delete_own` | 401 | 403 | 403 | 200 | 200 | 200 |
| `content:delete_any` | 401 | 403 | 403 | 403 | 200 | 200 |
| `content:delete_permanent` | 401 | 403 | 403 | 403 | 403 | 200 |
| `content:trash`(存在しない) | 500 | 500 | 500 | 500 | 500 | 500 |

- GET / DELETE でも同じ判定になる。`X-EmDash-Request: 1` が無いと 403 `CSRF_REJECTED` で、ハンドラーは呼ばれない。API トークンは `admin` スコープが要る(無いと 403 `INSUFFICIENT_SCOPE`)。根拠: **実測のみ**
- `permission` の型は `Permission`(`node_modules/emdash/src/plugins/types.ts:1349`)。存在しない文字列は型エラー TS2820 になる。根拠: **実測のみ**(`tsc --noEmit`)
- 手順と再現用のコード: [[emdash-plugin-route-permissions]]

#### `ctx.content.delete` は利用者本人の削除権限を確かめない

- `ctx.content.delete(collection, id)` には利用者を渡す引数が無い。`ctx.content` の有無は、利用者ではなくプラグインの capability(`content:write`)で決まる。
- 中身は `ContentRepository.delete`(`deleted_at` に日時を入れるソフト削除。つまりゴミ箱)の直接呼び出し。`content:delete_own` / `content:delete_any` の確認も、`content:beforeDelete` / `content:afterDelete` の hook も、entry lock の取得もしない(lock は解放する)。
  - 根拠: 公式ドキュメントのみ(`node_modules/emdash/src/plugins/context.ts:516-527`、`node_modules/emdash/src/database/repositories/content.ts:1236-1252`。参照ソースでは `references/emdash/packages/core/src/plugins/context.ts:897-908`)
- そのため、**ゴミ箱への移動の権限の確認は、ルートの `permission` だけになる**。案A ではこれで足りるので、ハンドラーで追加のロール判定はしない。
- ハンドラーの `ctx.user`(`{ id, email, name, role, createdAt }`)は、EmDash が認証・認可した呼び出し元で、信頼してよい。ただし型は省略可能で、`ctx.user.role` を直接読むと TS18048 になる。根拠: 実測+公式ドキュメント(`node_modules/emdash/src/plugins/types.ts:1323-1334`)

#### 標準 API との比較(プラグインが作った画像)

- プラグインの `ctx.content.create` は `authorId` を渡せない(`ContentCreateOptions` は `locale` だけ)。そのため `b64_images` の `author_id` は NULL になり、標準 API の所有者の判定では「所有者なし」として `*_any` の権限が要る。根拠: 公式ドキュメントのみ(`node_modules/emdash/src/plugins/types.ts:365-368`、`node_modules/emdash/src/database/repositories/content.ts:376`、`node_modules/@emdash-cms/auth/dist/index.mjs:163-167`)
- 標準 API のルート(dist)を、`authorId: null` の画像として偽の `locals` で呼んだ結果。根拠: **実測のみ**

| 標準 API | Subscriber | Contributor | Author | Editor | Admin |
|---|---|---|---|---|---|
| ゴミ箱へ移動 `DELETE /_emdash/api/content/b64_images/{id}` | 403 | 403 | 403 | 通る | 通る |
| 復元 `POST /_emdash/api/content/b64_images/{id}/restore` | 403 | 403 | 403 | 通る | 通る |
| 完全削除 `DELETE /_emdash/api/content/b64_images/{id}/permanent` | 403 | 403 | 403 | 403 | 通る |

- 参考: 自分が作成者のエントリでも、標準 API のゴミ箱移動と復元は Author 以上(Contributor は 403)。根拠: **実測のみ**

### この決定で起きうること

- Contributor が、他人の投稿(公開済みを含む)で使われている画像もゴミ箱に移せる。ゴミ箱に入った画像はサイト側の取得から外れ、参照している投稿の表示から画像が消える(サイト側の取得は `deleted_at IS NULL` で、既定で `published` だけ)。根拠: 公式ドキュメントのみ(`node_modules/emdash/src/loader.ts:1219`、`:1327`)
- EmDash の標準より緩い。標準では、Contributor は自分のコンテンツもゴミ箱に移せない(上の表)。根拠: 実測+公式ドキュメント
- Contributor は、自分がゴミ箱に移した画像を元に戻せない(復元は Editor 以上)。根拠: 実測+公式ドキュメント
- プラグインのゴミ箱移動では `content:beforeDelete` / `content:afterDelete` が動かない。ほかのプラグインは、画像がゴミ箱に入ったことを hook では知れない。根拠: 公式ドキュメントのみ

### 緩和策

| 緩和策 | 内容 | 担当 | 根拠レベル |
|---|---|---|---|
| ゴミ箱なので元に戻せる | ソフト削除なので、完全削除するまでデータは残る。ただし戻せるのは Editor 以上(標準 API の restore)。npm の 0.38.0 では、戻すと元の状態(公開)のままで、サイトにもすぐ表示される(`node_modules/emdash/src/database/repositories/content.ts:1257-1273`)。参照ソース(未リリース)では、戻すと下書きになり、公開し直す必要がある(`references/emdash/packages/core/src/database/repositories/content.ts:1513-1544`) | 運用。画像管理ページに「元に戻す」を置くかは未定([[#未解決・サブタスクの候補]]) | 権限は実測+公式ドキュメント、戻したあとの状態は公式ドキュメントのみ |
| 完全削除は Admin のみ | 標準 API `DELETE /_emdash/api/content/b64_images/{id}/permanent`(`content:delete_permanent`)。ゴミ箱に入っていない画像には 404 `NOT_FOUND` を返すので、必ず「ゴミ箱 → 完全削除」の順になる(`node_modules/emdash/src/database/repositories/content.ts:1288-1300`、`node_modules/emdash/src/api/handlers/content.ts:1425-1429`) | [[T25-images-page]] | Admin のみは実測+公式ドキュメント、404 は公式ドキュメントのみ |
| 画像管理ページの注意書き | ゴミ箱に移す前に確認ダイアログを出す。状態が「使用中」なら、参照している投稿の表示から画像が消えることと、戻せるのは Editor 以上であることを示す | [[T25-images-page]] | 推測のみ(誤操作が減るかは未確認) |

### 後続タスク向けのメモ

#### [[T21-orphan-routes]](サーバー側)

| 項目 | 値・方法 |
|---|---|
| ゴミ箱へ移動するルートの `permission` | `"content:create"`(Contributor 以上)。**省略しない**(省略すると Admin のみになる) |
| 画像一覧(状態判定)のルートの `permission` | Contributor 以上が呼べるものにする(例: `"content:read_drafts"`)。Editor 以上にすると、Contributor はページを開いても一覧を読めず、ゴミ箱のボタンを使えない |
| capability | `content:write`(`ctx.content.delete` に必要) |
| ハンドラーの流れ | `ctx.user` が無ければ `PluginRouteError.unauthorized()`(`emdash` から import できる)→ `imageRefs` にある画像 ID かを確かめる → `ctx.content.delete("b64_images", id)`。戻り値が `false`(既にゴミ箱、または存在しない)なら 404 にする |
| 完全削除の検知(`image-deleted.ts`) | `content:afterDelete` の event は `{ id, collection, permanent }`。`collection === "b64_images"` かつ `permanent === true` のときだけ `imageRefs` を消す。標準 API のゴミ箱移動は `permanent: false` で届く。根拠: 公式ドキュメントのみ(`node_modules/emdash/src/plugins/types.ts:939-944`、`node_modules/emdash/src/emdash-runtime.ts:3172`、`:3211`) |
| ゴミ箱に入っているかの判定 | npm の 0.38.0 のプラグイン API では、ゴミ箱内と「存在しない」を区別できない(`ctx.content.get` はどちらも `null`。`node_modules/emdash/src/database/repositories/content.ts:524-531`)。「`imageRefs` にあって `get` が `null` ならゴミ箱」とみなすか、ゴミ箱に移すときに `imageRefs` に記録するかを決める(後者は [[T03-shared-contracts]] の型の変更が要る)。参照ソース(未リリース)なら、capability `content:restore` の `getTrashedVersioned` で区別できる(`references/emdash/packages/core/src/plugins/types.ts:593`)。根拠: 公式ドキュメントのみ |

#### [[T25-images-page]](画面側)

| 項目 | 値・方法 |
|---|---|
| ロールの取得 | `import { useCurrentUser } from "@emdash-cms/admin"` → `const { data: currentUser } = useCurrentUser();` → `const role = currentUser?.role ?? 0;`。`GET /_emdash/api/auth/me` をキー `["currentUser"]` でキャッシュする hook で、管理画面自身も同じ形でボタンを出し分けている。根拠: 公式ドキュメントのみ(`node_modules/@emdash-cms/admin/dist/index.js:2602-2609`、`:8548`、`node_modules/emdash/src/astro/routes/api/auth/me.ts:46`) |
| ロールの値 | Subscriber 10 / Contributor 20 / Author 30 / Editor 40 / Admin 50(`references/emdash/packages/auth/src/types.ts:9-15`)。`emdash` は `Role` を export しておらず、`@emdash-cms/auth` はこのプラグインの依存に無い。`ImagesPage.tsx` の中に `ROLE_CONTRIBUTOR = 20` / `ROLE_ADMIN = 50` を定義する(管理画面も同じく自前で定義している。`node_modules/@emdash-cms/admin/dist/index.js:7729`、`:61324`) |
| 「ゴミ箱へ移動」ボタン | `role >= ROLE_CONTRIBUTOR` かつ、その画像がゴミ箱に入っていない |
| 「完全削除」ボタン | `role >= ROLE_ADMIN` かつ、その画像がゴミ箱に入っている。確認ダイアログを出す |
| 画面の条件の位置付け | 表示のためだけ。権限はサーバー側(ルートの `permission` と標準 API)が判定する。403 が返ったら「権限がありません」を表示する |
| ページを開ける人 | プラグインのページは、ロールに関係なくサイドバーに出る(`minRole` が無い)。ページに props も渡らない。Subscriber も開けるので、一覧の 403 を扱う。根拠: 公式ドキュメントのみ(`node_modules/@emdash-cms/admin/dist/index.js:32338-32354`、`:61922-61927`) |

### 未解決・サブタスクの候補

- 画像管理ページに「元に戻す」(Editor 以上、標準 API の restore)を置くか。仕様書 11.5 には無い。今は、Contributor が誤ってゴミ箱に移した画像を戻す手段が、標準 API か、重い標準のゴミ箱画面(仕様書 10 章)しかなく、どちらも Editor 以上が操作する必要がある。
- 誰がいつゴミ箱に移したかの記録(`imageRefs` に `trashedBy` / `trashedAt`)。[[T03-shared-contracts]] の型の変更が要る。
- 参照ソースと npm の `emdash@0.38.0` のずれ。仕様書 7・8・9 章が使う capability とメソッドが npm の 0.38.0 に無い(T06 の範囲外。[[emdash-reference-vs-npm-0-38]])。
