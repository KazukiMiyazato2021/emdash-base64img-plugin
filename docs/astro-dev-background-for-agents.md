---
title: エージェントから実行した astro dev はバックグラウンドで起動する
aliases:
  - astro dev のバックグラウンド起動
  - astro dev stop
tags:
  - docs
  - astro
  - dev-server
  - agent
source_task: "[[T02-playground]]"
created: 2026-09-24
updated: 2026-09-24
---

# エージェントから実行した astro dev はバックグラウンドで起動する

> [!summary] 要点
> - Astro 7.3.3 の `astro dev` と `astro preview` は、AI エージェントの中で実行されたことを検出すると、サーバーをバックグラウンドのプロセスとして起動し、コマンド自体はすぐに終わる。Claude Code は環境変数 `CLAUDECODE` で検出される。
> - 止めるときは `npm run dev -w playground -- stop`(= `astro dev stop`)。`status` と `logs` もある。**Bash の `run_in_background` で起動しても、そのシェルを止めただけではサーバーは止まらない。**
> - ロックファイルは `playground/.astro/dev.json`、ログは `playground/.astro/dev.log`。同じ playground では 2 つ目を起動できない。
> - 関連: [[T02-playground]]、[[playground/README|playground の README]]、[[emdash-playground-site-config]]

## 起動のされ方

`npm run dev -w playground -- --port 4402` の出力(根拠: **実測のみ**):

```text
{"message":"Dev server running at http://localhost:4402 (pid 43362)\n  Stop:   astro dev stop\n  Status: astro dev status\n  Logs:   astro dev logs","label":"SKIP_FORMAT","level":"info"}
```

- サーバーが起動するとコマンドは終わり、サーバーは親プロセスが 1(launchd)のプロセスとして残る(`ps -o pid,ppid`)。根拠: **実測のみ**
- 判定は `node_modules/astro/dist/cli/dev/index.js:85-90`。根拠: **公式ドキュメントのみ**

```js
const agentDetected = !process.env.ASTRO_DEV_BACKGROUND && isRunByAgent();
if (agentDetected) flags.json = true;  // ログは JSON 行になる
const wantsBackground = !!flags.background || agentDetected && !ignoreLock;
```

- `isRunByAgent()` は `am-i-vibing` 0.4.0 の `detectAgenticEnvironment().type === "agent"`(`node_modules/astro/dist/cli/agent.js`)。Claude Code は `CLAUDECODE` があれば該当する(`node_modules/am-i-vibing/dist/detector-*.mjs` の `claude-code`)。Codex(`CODEX_THREAD_ID`)や Gemini CLI(`GEMINI_CLI=1`)なども同じ扱い。根拠: **公式ドキュメントのみ**
- `astro preview` も同じ(`node_modules/astro/dist/cli/preview/index.js:45-50`、環境変数は `ASTRO_PREVIEW_BACKGROUND`)。`npm run preview -w playground -- --port 4402` はバックグラウンドで起動し、`npm run preview -w playground -- stop` で止まった。根拠: **実測+公式ドキュメント**

## 操作

| したいこと | コマンド(リポジトリのルートで実行) |
|---|---|
| 起動 | `npm run dev -w playground -- --port 4402` |
| 停止 | `npm run dev -w playground -- stop` |
| 状態 | `npm run dev -w playground -- status` |
| ログ | `npm run dev -w playground -- logs`(`--follow` で追う)。ファイルは `playground/.astro/dev.log` |
| 前面で動かす | `npm run dev -w playground -- --port 4402 --ignore-lock` |

- `-- stop` の出力は `Stopped dev server (pid …).`。止めると `dev.json` は消え、`dev.log` は残る。根拠: **実測のみ**
- `--ignore-lock` を付けると、前面で動き、`dev.json` を作らない。そのため `stop` / `status` / `logs` の対象にならない。止めるには起動したシェルを止める(Bash の `run_in_background` で起動したなら TaskStop)。止めたあとポートが空くことを確かめた。根拠: **実測+公式ドキュメント**(`index.js:108-142`)
- 止め忘れの確認: `lsof -nP -iTCP:4402 -sTCP:LISTEN`。根拠: **実測のみ**

## ロックファイル

- 場所は `<root>/.astro/dev.json`(`node_modules/astro/dist/core/dev/lockfile.js:5-10`)。`pid` / `port` / `url` / `background` / `startedAt` を持つ。根拠: **実測+公式ドキュメント**
- 同じ root でもう 1 つ起動しようとすると、`Another astro dev server is already running.` で止まる。`--force` で置き換えられる(`index.js:143-157`)。根拠: **公式ドキュメントのみ**
- ロックファイルは playground のディレクトリごとにできるので、worktree が違えば別のサーバーとして扱われる。ポートは `4400 + タスク番号` で分ける。根拠: **推測のみ**(コードから。複数の worktree で同時に起動しての確認はしていない)

> [!warning] 作業の最後に止める
> エージェントの作業では、サーバーは「コマンドが終わっても動き続ける」。作業の最後に `npm run dev -w playground -- stop` を実行し、`lsof` でポートが空いたことを確かめる。

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、Astro 7.3.3、am-i-vibing 0.4.0、Claude Code の Bash ツールから実行。2026-09-24 に計測。
