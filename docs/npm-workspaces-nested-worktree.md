---
title: npm 12 の workspaces と入れ子の worktree
aliases:
  - npm workspaces
  - 入れ子の worktree での解決
tags:
  - docs
  - npm
  - workspaces
  - worktree
source_task: "[[T01-scaffold]]"
created: 2026-09-23
updated: 2026-09-24
---

# npm 12 の workspaces と入れ子の worktree

> [!summary] 要点
> - ルートがプラグイン本体、`playground/` が workspace。playground は `"emdash-plugin-base64-image": "file:.."` でルートを参照する。npm 12 は `node_modules/emdash-plugin-base64-image -> ..`(ルート自身へのリンク)を作る。
> - npm workspaces のロックファイルはルートの `package-lock.json` 1 つだけ。**playground の依存を変えると、ルートの `package-lock.json` も変わる。**
> - worktree はメインの作業ディレクトリの中にある。Node と TypeScript は、上位ディレクトリ(メインの作業ディレクトリ)の `node_modules` まで探しに行く。worktree ごとに `npm ci` で `node_modules` を作ってから作業する。
> - 関連: [[T01-scaffold]]、[[T02-playground]]、[[base64-image-plugin-spec#15. リポジトリ構成・ツール・テスト|仕様書 15 章]]

## playground からルートのプラグインを参照する

仕様書 14 章のとおり、プラグイン本体はリポジトリ直下に置く(git 依存でサブディレクトリを入れられないため)。そのため、ルートを workspace にはできない。playground からは `file:..` で参照する。

```jsonc
// playground/package.json(抜粋)
{
	"name": "playground",
	"private": true,
	"dependencies": {
		"emdash-plugin-base64-image": "file:.."
	}
}
```

npm 12.0.2 で `npm install` した結果(根拠: **実測のみ**):

```text
node_modules/emdash-plugin-base64-image -> ..            ← ルート自身へのリンク
node_modules/playground -> ../playground                 ← workspace へのリンク
```

```jsonc
// package-lock.json(抜粋)
"node_modules/emdash-plugin-base64-image": { "resolved": "", "link": true },
"node_modules/playground": { "resolved": "playground", "link": true },
"playground": { "version": "0.0.0", "dependencies": { "emdash-plugin-base64-image": "file:..", … } }
```

- playground から `emdash-plugin-base64-image` / `/admin` / `/astro` を解決すると、リンクをたどってルートの `src/index.ts` / `src/admin.tsx` / `src/astro.ts` になる(`import.meta.resolve` で確認)。根拠: **実測のみ**
- ルートの中からは、リンクが無くてもパッケージの自己参照で解決できる。`package.json` と `src/` だけを別の場所に置いて `import.meta.resolve` で確かめた。`exports` に無いパス(`emdash-plugin-base64-image/src/index.ts`)は `ERR_PACKAGE_PATH_NOT_EXPORTED` になる。根拠: **実測のみ**

> [!warning] リンクが自分自身を指している
> `node_modules/emdash-plugin-base64-image` はルートを指すので、ディレクトリをリンクをたどって再帰的に走査するツールは、同じ場所を何度も通る可能性がある。tsc / vitest / oxlint / prettier / `npm pack` は `node_modules` を対象外にしているので、問題は起きなかった(根拠: **実測のみ**)。playground の開発サーバー(Vite の監視)で問題が出たら、[[T02-playground]] で `vite.resolve.alias` に切り替えることを検討する(根拠: **推測のみ**)。

## ロックファイルは 1 つ

- workspaces では、playground の依存もルートの `package-lock.json` に記録される(上の `"playground": {…}`)。根拠: **実測のみ**
- [[T01-scaffold]] では、[[T02-playground]] が `package-lock.json` を変更せずに済むように、playground の依存(`astro`、`@astrojs/node`、`@astrojs/react`、`emdash`、`react`、`react-dom`、このプラグイン)を先に入れた。T02 はスクリプト(`dev` / `build`)や `emdash.seed` を足すだけなら、ロックファイルは変わらない(`scripts` はロックファイルに記録されない)。
- Cloudflare 用の依存(`@astrojs/cloudflare`、`@emdash-cms/cloudflare`、`wrangler`)はまだ入れていない。[[T32-cloudflare-check]] の前に、依存を追加する小さな変更が必要。

## npm scripts と workspaces

- `npm run build --workspaces --if-present` は、`build` を持つ workspace だけで実行し、持たない workspace は飛ばして成功する。playground に仮の `build` を足すと、playground のディレクトリで実行された。根拠: **実測のみ**
- ルートは workspace ではないので、ルートの `build` がこの中で再帰的に呼ばれることはない。
- npm 12 は `npm run` / `npx` のたびに `npm notice run …` という行を出す。エラーではない。根拠: **実測のみ**

## 入れ子の worktree で起きること

worktree は `/Users/home/sandbox/emdash-base64img-plugin/.claude/worktrees/<名前>/` にある。

### Node は上位の `node_modules` まで探す

worktree の中から `require.resolve.paths()` を出すと、次の順に探す(根拠: **実測のみ**)。

```text
…/.claude/worktrees/<名前>/node_modules
…/.claude/worktrees/node_modules
…/.claude/node_modules
/Users/home/sandbox/emdash-base64img-plugin/node_modules   ← メインの作業ディレクトリ
/Users/home/sandbox/node_modules
…
```

- worktree に `node_modules` が無い、または足りないパッケージがあると、メインの作業ディレクトリの `node_modules` から読み込まれてしまう。依存の入れ忘れに気付けないので、worktree ごとに `npm ci` する。
- `npm ci` は約 8 秒(npm のキャッシュがある状態)。ロックファイルは変わらなかった。根拠: **実測のみ**

### TypeScript の @types の探し方

- `tsc --traceResolution` を見ると、`types` の探索先(type roots)も上位ディレクトリの `node_modules/@types` まで含む。根拠: **実測のみ**
- TypeScript 6.0.3 では、`types` を省略すると `[]` として扱われ、`@types/*` を自動では読み込まない(`"*"` を書いたときだけ全部読む)。`node_modules/typescript/lib/_tsc.js:40294-40297` の `getAutomaticTypeDirectiveNames`。根拠: **実測+公式ドキュメント**(`types` を消した tsconfig でも、import されていない `@types/babel__core` などは読み込まれなかった)
- それでも、このリポジトリの `tsconfig.json` は `"types": ["node"]` と明示している。TypeScript の版が変わっても、上位の `@types` を拾わないようにするため。
- `types` に書いた `node` 自体も上位まで探すので、worktree に `@types/node` が無ければメインの作業ディレクトリのものが使われる。これも `npm ci` で防ぐ。

### Vite のワークスペースのルート

- Vite は、上位に向かって `pnpm-workspace.yaml` / `lerna.json`、または `workspaces` を持つ `package.json` を探し、最初に見つかった場所をワークスペースのルートにする(`node_modules/vite/dist/node/chunks/node.js:20373-20420` の `searchForWorkspaceRoot`)。根拠: **公式ドキュメントのみ**
- worktree の `playground/` から呼ぶと、worktree のルートが返った(`workspaces` を持つため)。メインの作業ディレクトリまでは上がらない。根拠: **実測のみ**
- 開発サーバーが配信を許すファイルの範囲(`server.fs.allow`)の既定値はこのルートなので、メインの作業ディレクトリの `node_modules` にあるファイルは配信されない見込み。根拠: **推測のみ**

### mise

- worktree のパスは毎回変わるので、worktree の `mise.toml` は worktree ごとに `mise trust` が必要。根拠: **実測のみ**
- 上位の `~/sandbox/mise.toml` は `npm = "latest"`。リポジトリの `mise.toml` が無いと、npm の版が固定されない。根拠: **実測のみ**

### ツールの対象範囲

メインの作業ディレクトリには、テストを大量に含む `references/`(EmDash のクローン)と、他の worktree(`.claude/worktrees/`)がある。これらを対象にしないよう、各ツールの範囲を絞った。

| ツール | 設定 | 確認 |
|---|---|---|
| vitest | `include` を `tests/**/*.test.{ts,tsx}` だけにした | テスト 0 件のときも成功した(`passWithNoTests`) |
| tsc | `include` を `src` / `tests` / `e2e` / `*.config.ts` だけにした(のちに [[T26-1-typecheck-playground-scripts\|T26-1]] で `playground/scripts` を足した) | `--listFilesOnly` で、プロジェクトのファイルと worktree の `node_modules` だけが読み込まれた(`playground/scripts` を足したあとも、メインの作業ディレクトリで同じだった) |
| oxlint | `ignorePatterns` に `references/**`、`.claude/**`、`playground/dist/**`、`playground/.astro/**`、`spikes/**`、`plans/**`、`tasks/**`、`docs/**` | 各場所に lint エラーのあるファイルを置き、`e2e/` と `playground/src/` のものだけが報告された |
| prettier | `.prettierignore` に同じ場所と `*.md`、`package-lock.json` | 同上。prettier 3.9.8 は `.gitignore` も読む(`.gitignore` にだけ書いた `test-results/` のファイルは、明示しても対象外になった) |

根拠: すべて **実測のみ**

> [!info] 計測環境
> macOS(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2(mise)、TypeScript 6.0.3、vitest 4.1.11、oxlint 1.83.0、prettier 3.9.8、Vite 8.3.0。2026-09-23 に計測。
