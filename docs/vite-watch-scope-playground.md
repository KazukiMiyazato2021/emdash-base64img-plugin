---
title: playground の開発サーバーが監視する範囲
aliases:
  - Vite の監視範囲
  - 自分自身へのリンクと監視
  - server.watch.ignored
tags:
  - docs
  - vite
  - playground
  - worktree
source_task: "[[T02-playground]]"
created: 2026-09-24
updated: 2026-09-24
---

# playground の開発サーバーが監視する範囲

> [!summary] 要点
> - Vite 8.3.0(chokidar 3.6.0)が監視するのは、playground のディレクトリと、読み込まれたプラグインのソース(`src/index.ts`、`src/admin.tsx`)のファイル単位だけだった。worktree のルート、`node_modules`(自分自身へのリンク `node_modules/emdash-plugin-base64-image -> ..` を含む)、`spikes/` はたどらない。
> - playground の外で 3,000 ファイルを書いて消しても、開発サーバーの CPU 時間は増えず、監視のイベントも 0 件だった。ループも起きない。
> - そのため `vite.server.watch.ignored` は足さなかった。
> - 関連: [[T02-playground]]、[[npm-workspaces-nested-worktree]]、[[playground/README|playground の README]]

## 監視の仕組み

- 監視の対象は `[root, 設定ファイルの依存, .env, publicDir]`(`node_modules/vite/dist/node/chunks/node.js:24288-24293`)。root は playground。根拠: **公式ドキュメントのみ**
- 既定で除外するもの: `**/.git/**`、`**/node_modules/**`、`**/test-results/**`、cacheDir、outDir(`node.js:16353-16369`)。EmDash は `**/.wrangler/**` を足し、サイトの設定にある `vite.server.watch.ignored` は残す(`references/emdash/packages/core/src/astro/integration/vite-config.ts:403-409`、`:472-476`)。根拠: **公式ドキュメントのみ**
- root の外のファイルは、読み込まれたときに 1 ファイルずつ監視に加わる(`node.js:2449-2451` の `ensureWatchedFile`)。プラグインはリンクをたどった実体のパス(`<worktree>/src/…`)で読み込まれるので、このファイル単位の監視になる。根拠: **実測+公式ドキュメント**

## 実測

### 監視している場所(`server.watcher.getWatched()`)

| 時点 | ディレクトリ数 | 項目数 | playground の外 |
|---|---|---|---|
| 起動の 8 秒後 | 9 | 23 | `<worktree>`(項目は `playground` だけ)、`<worktree>/src`(`index.ts`) |
| 管理画面を開いて投稿を作った後 | 9 | 24 | `<worktree>`(`playground` だけ)、`<worktree>/src`(`admin.tsx`、`index.ts`) |

- `<worktree>` の項目が `playground` だけなのは、chokidar が root の親ディレクトリを記録しているため。親の中身はたどっていない。
- playground の中で監視しているのは `.astro/`、`.emdash/`、`seed/`、`src/` と直下のファイル(`data.db`、`emdash-env.d.ts` など)。`node_modules/` と `dist/` は入らない。

根拠: **実測のみ**

### イベントと負荷

| 操作 | 監視のイベント | 開発サーバーの CPU 時間 |
|---|---|---|
| `spikes/t02-playground/churn/` に 3,000 ファイルを書いて消す(playground の外) | 0 件 | 0:07.21 → 0:07.21(増えない) |
| `playground/.emdash/churn/` に 3,000 ファイルを書いて消す(playground の中) | 6,000 件(add と unlink) | 0:07.29 → 0:07.96(書く)→ 0:08.39(消す) |
| `seed/seed.json` を touch | change 1 件。再読み込みも再起動もない | — |
| API で投稿を作る(`data.db` に書く) | 記録されなかった | — |

根拠: **実測のみ**

- 同じ測り方で、playground の中の変更は CPU 時間の増加として見えた。外の変更は、監視に届いていない。
- メインの作業ディレクトリでも、`.claude/worktrees/*` は playground の兄弟のディレクトリなので、監視の対象にならない見込み。根拠: **推測のみ**(worktree の中でだけ計測した)

## 除外を足さなかった理由

- playground の外は、そもそも監視されていない。自分自身へのリンクは `node_modules` の中にあり、既定で除外される。
- playground の中の `.emdash/`(アップロードの保存先)や `data.db` の変更は、モジュールではないので、ページの再読み込みを起こさない。
- 除外が必要になったら、`astro.config.mjs` の `vite.server.watch.ignored` に書く。EmDash の `**/.wrangler/**` と合わせて使われる。

## 再現の手順

playground に次の設定ファイル(コミットしない)を置き、`npm run dev -w playground -- --port 4402 --config astro.config.watch-debug.mjs` で起動した。

```js
// playground/astro.config.watch-debug.mjs
import { appendFileSync, writeFileSync } from "node:fs";
import base from "./astro.config.mjs";

const OUT = "/path/to/scratchpad/watch";
export default {
	...base,
	vite: {
		...base.vite,
		plugins: [
			...(base.vite?.plugins ?? []),
			{
				name: "t02-watch-debug",
				configureServer(server) {
					const started = Date.now();
					server.watcher.on("all", (event, path) => {
						appendFileSync(`${OUT}-events.log`, `${Date.now() - started}ms ${event} ${path}\n`);
					});
					server.httpServer?.once("listening", () => {
						setTimeout(() => {
							writeFileSync(`${OUT}-startup.json`, JSON.stringify(server.watcher.getWatched(), null, 1));
						}, 8000);
					});
				},
			},
		],
	},
};
```

- 負荷は、`ps -o time= -p <開発サーバーの pid>` を、ファイルを書く前・書いた 5 秒後・消した 5 秒後に取って比べた。pid は `playground/.astro/dev.json` にある([[astro-dev-background-for-agents]])。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、Astro 7.3.3、Vite 8.3.0(chokidar 3.6.0 を同梱)、fsevents 2.3.3。worktree(`.claude/worktrees/agent-…`)の中で計測。2026-09-24 に計測。
