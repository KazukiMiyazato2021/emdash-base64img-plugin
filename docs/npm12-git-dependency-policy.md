---
title: npm 12 の git 依存・install スクリプトの既定と min-release-age
aliases:
  - allow-git
  - EALLOWGIT
  - npm 12 の git 依存
  - spike のロックファイルの監査
tags:
  - docs
  - npm
  - distribution
  - dependencies
source_task: "[[T07-spike-git-dependency]]"
created: 2026-09-24
updated: 2026-09-24
---

# npm 12 の git 依存・install スクリプトの既定と min-release-age

> [!summary] 要点
> - **npm 12 は `allow-git` の既定が `none` で、git 依存を入れない(`EALLOWGIT`)。** `github:` の短縮形・`git+https://`・`git+ssh://`・`git+file://` のすべてが当たる。`npm ci` も止まる。
> - 利用者のサイトの `.npmrc` に `allow-git=root`(サイトの package.json に直接書いた git 依存だけを許す)を書けば入る。コマンドごとなら `--allow-git=root`。
> - tarball の URL(`https://codeload.github.com/…`)は `allow-remote` の対象で、これも既定は `none`。
> - 依存の install スクリプトは既定で止まる(`allowScripts`)。git 依存の `prepare` も含む。`prepare` でビルドする配布にすると、利用者に許可の設定が要る。
> - `min-release-age=3` のままだと、peer に `emdash ^0.39.0` を持つこのプラグインを足すときも、npm が emdash の manifest を期間の条件で取り直し、`ERESOLVE`(`Found: emdash@undefined`)になる。EmDash 0.39.1 が公開から 3 日たつまで(2026-09-26 19:20 JST ごろ)は、そのコマンドにも `--min-release-age=0` が要る。
> - spike のロックファイルを監査し、EmDash の外で公開から 3 日未満の 7 個を `overrides` でルートのロックファイルと同じ版に戻した。最終的に EmDash の外は 0 個。
> - 関連: [[git-dependency-ts-source]]、[[emdash-dependency-versions#min-release-age の例外(2026-09-24)]]、[[T07-spike-git-dependency]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]

## allow-git(npm 12)

- 既定は `none`。種類は `all` / `none` / `root`。`root` は、プロジェクトの package.json に書いた git 依存だけを許す(`npm view` なども許す)。「As of npm 12 the default is `none`」とあり、per project(`.npmrc`)か per command(CLI)で明示的に許可するよう案内している(npm 12.0.2 の `docs/content/using-npm/config.md:207-227`)。根拠: **実測+公式ドキュメント**
- 判定は、依存の書き方の種類で行う(`node_modules/pacote/lib/fetcher.js:477-500` の `canUse`。拒否すると `code: EALLOWGIT`)。根拠: **公式ドキュメントのみ**
- 実測した挙動:

| 操作 | 結果 |
|---|---|
| `npm install "emdash-plugin-base64-image@git+file:///…#<commit>"`(設定なし) | `npm error code EALLOWGIT` / `Fetching packages of type "git" have been disabled` |
| サイトの `.npmrc` に `allow-git=root` を書いて同じ操作 | 入る(次の節の `min-release-age` の問題は別) |
| ロックファイルに git 依存がある状態で `npm ci --allow-git=none` | `EALLOWGIT` |
| 同じ状態で `.npmrc` の `allow-git=root` のまま `npm ci` | 成功(693 パッケージ。`min-release-age=3` のままでも入る) |

根拠: **実測のみ**

- 依存の書き方と種類(npm 12 の `npm-package-arg`):

| 書き方 | 種類 | 判定する設定 |
|---|---|---|
| `github:owner/emdash-base64img-plugin#v0.1.0`(仕様書 14 章の例) | `git` | `allow-git`(既定 `none`) |
| `git+https://github.com/owner/emdash-base64img-plugin.git#v0.1.0` | `git` | `allow-git` |
| `git+ssh://git@github.com/owner/emdash-base64img-plugin.git#v0.1.0` | `git` | `allow-git` |
| `https://codeload.github.com/owner/emdash-base64img-plugin/tar.gz/v0.1.0` | `remote` | `allow-remote`(既定 `none`。registry と同じホスト名なら別扱い) |
| `file:../emdash-plugin-base64-image-0.1.0.tgz` | `file` | `allow-file`(既定 `all`) |

根拠: **実測+公式ドキュメント**(`npm-package-arg` で種類を表示した。既定値は `config.md:171-243`)

- 利用者の `~/.npmrc` は変えていない。spike では、サイトのディレクトリに `.npmrc`(`allow-git=root`)を置いた。

> [!warning] 利用者のビルド環境
> サイトのリポジトリに `.npmrc`(`allow-git=root`)をコミットしておかないと、npm 12 のビルド環境(CI や Cloudflare Workers Builds など)の `npm ci` が止まる。Workers Builds が使う npm の版は確かめていない。npm 11 以前では、この設定は不要か、既定が `all`(推測のみ)。

## install スクリプト(allowScripts)

- npm 12 では、依存の install スクリプト(`preinstall` / `install` / `postinstall`、registry 以外の依存の `prepare`)は既定で止まる。許可は package.json の `allowScripts`(`npm install-scripts approve`)で管理する(npm 12.0.2 の `docs/content/commands/npm-install-scripts.md:27`、`config.md:266-284`)。根拠: **公式ドキュメントのみ**
- このプラグインは `prepare` を持たないので影響を受けない。ビルド(tsdown など)を `prepare` で走らせる配布にすると、利用者に `allowScripts` の設定が要る。利用者の `~/.npmrc` の `ignore-scripts=true` でも止まる。TS ソースのまま配る理由の 1 つになる。根拠: **公式ドキュメントのみ**

## min-release-age と peer の解決

- ロックファイルに emdash 0.39.1 がある状態で、`min-release-age=3` のまま `npm install "emdash-plugin-base64-image@git+file:///…"` を実行すると、`ERESOLVE` になった。

```text
While resolving: t07-git-dependency-site@0.0.0
Found: emdash@undefined
node_modules/emdash
  emdash@"0.39.1" from the root project

Could not resolve dependency:
peer emdash@"^0.39.0" from emdash-plugin-base64-image@0.0.0
```

- debug ログでは、npm が `emdash@0.39.1` と `emdash@^0.39.0` の manifest を取り直していた。期間の条件で 0.39.1 が外れ、版が `undefined` になる。プラグイン自体は registry のパッケージではないが、peer の解決でこの条件に当たる。根拠: **実測のみ**
- そのコマンドに `--min-release-age=0` を付けると入った。追加されたのはプラグインの 1 パッケージだけで、registry から新しく入った版は無かった(下の監査)。根拠: **実測のみ**
- `npm ci`(ロックファイルの版を入れる)は、`min-release-age=3` のままで成功した([[emdash-dependency-versions#min-release-age の例外(2026-09-24)]] と同じ)。根拠: **実測のみ**

## spike のロックファイルの監査

[[emdash-dependency-versions#min-release-age の例外(2026-09-24)]] の手順(例外のコマンドのあとで、公開から 3 日未満の版が EmDash の外に入っていないかを調べる)を、使い捨てのサイト(`spikes/git-dependency/site`)に当てた。リポジトリの `package.json` / `package-lock.json` は変えていない。

| 手順 | コマンド | 結果 |
|---|---|---|
| 1 | `npm install`(Astro・アダプター・wrangler・`@astrojs/check` など。`min-release-age=3`) | 370 パッケージ |
| 2 | `npm install --min-release-age=0 --save-exact emdash@0.39.1 @emdash-cms/cloudflare@0.39.1` | 315 パッケージを追加 |
| 3 | 監査(下のスクリプト) | 804 項目を調べ、公開から 3 日未満は EmDash 系 10 個・**EmDash の外 7 個** |
| 4 | `overrides` を足して `npm install`(`min-release-age=3`) | 追加 12・削除 5・変更 3 |
| 5 | 監査 | EmDash 系 10 個・EmDash の外 **0 個** |
| 6 | `npm install --min-release-age=0 "emdash-plugin-base64-image@git+file:///…#<commit>"` | 追加 1(プラグイン)。監査(差分)で registry の新しい版は 0 個 |

根拠: **実測のみ**(2026-09-23 17:00 UTC ごろ。境界は公開日時が 2026-09-20 17:00 UTC より後)

EmDash の外に入った 7 個と、戻した版(すべてルートのロックファイルの版で、依存元の範囲を満たす):

| パッケージ | 入った版(公開日時 UTC) | 依存元 | 戻した版(公開日時 UTC) |
|---|---|---|---|
| `@atcute/lexicons` | 2.1.1(09-23 01:46) | `@atcute/*`、`@emdash-cms/*`、`emdash`(`^2.0.0`〜`^2.1.0`) | 2.1.0(08-19) |
| `@modelcontextprotocol/sdk` | 1.30.1(09-23 16:06) | `emdash`(`^1.26.0`) | 1.30.0(07-27) |
| `@wordpress/block-serialization-default-parser` | 5.56.0(09-23 12:33) | `@emdash-cms/gutenberg-to-portable-text`(`^5.13.0`) | 5.55.0(09-10) |
| `dompurify` | 3.4.16(09-23 15:29) | `@emdash-cms/admin`(`^3.3.2`) | 3.4.15(09-06) |
| `prosemirror-model` | 1.25.12(09-21 13:05) | `@tiptap/pm`(`^1.25.11`)、`prosemirror-view@1.42.5`(`^1.25.12`)など | 1.25.11(07-11) |
| `prosemirror-view` | 1.42.5(09-21 13:08) | `@tiptap/pm`(`^1.42.3`)など | 1.42.4(09-18) |
| `yjs` | 13.6.33(09-23 16:37) | `@emdash-cms/admin`(`^13.6.0`)など | 13.6.32(08-04) |

```json
// spikes/git-dependency/site/package.json に足した overrides
"overrides": {
	"@atcute/lexicons": "2.1.0",
	"@modelcontextprotocol/sdk": "1.30.0",
	"@wordpress/block-serialization-default-parser": "5.55.0",
	"dompurify": "3.4.15",
	"prosemirror-model": "1.25.11",
	"prosemirror-view": "1.42.4",
	"yjs": "13.6.32"
}
```

- `prosemirror-model` 1.25.12 は、`prosemirror-view` 1.42.5 の依存(`^1.25.12`)で入っていた。view を戻すと model も戻せた。根拠: **実測のみ**
- EmDash 系の 10 個: `emdash`・`@emdash-cms/admin`・`auth`・`blocks`・`cloudflare`・`gutenberg-to-portable-text`(0.39.1)、`@emdash-cms/plugin-types` 0.4.0、`registry-client` 0.6.1、`registry-lexicons` 0.6.0、`registry-verification` 0.3.2。利用者が了承した例外の範囲。
- 例外のコマンドで何もない状態から入れると、ロックファイルがある状態で上げたとき([[T01-2-emdash-0-39|T01-2]] は 1 個)より、EmDash の外の新しい版が多く入る。根拠: **実測のみ**

監査のスクリプト(比較元を渡すと、比較元に無い `名前@版` だけを調べる):

```js
// node audit-lock.mjs <package-lock.json> [<比較元の package-lock.json>]
import { readFileSync } from "node:fs";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const cutoff = now - 3 * DAY;
const [lockPath, basePath] = process.argv.slice(2);

function entries(path) {
	const lock = JSON.parse(readFileSync(path, "utf8"));
	const out = new Map();
	for (const [key, value] of Object.entries(lock.packages ?? {})) {
		if (key === "" || value.link) continue;
		const name = value.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
		const registry = (value.resolved ?? "").startsWith("https://registry.npmjs.org/");
		out.set(`${name}@${value.version}`, { name, version: value.version, key, registry, resolved: value.resolved });
	}
	return out;
}

const base = basePath ? entries(basePath) : new Map();
const targets = [...entries(lockPath).values()].filter((e) => !base.has(`${e.name}@${e.version}`));
const names = [...new Set(targets.filter((e) => e.registry).map((e) => e.name))];
const times = new Map();
const queue = [...names];
await Promise.all(
	Array.from({ length: 16 }, async () => {
		while (queue.length > 0) {
			const name = queue.shift();
			const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
			times.set(name, (await res.json()).time ?? {});
		}
	}),
);
const isEmdash = (name) => name === "emdash" || name.startsWith("@emdash-cms/");
for (const e of targets) {
	if (!e.registry) {
		console.log(`registry 以外: ${e.name}@${e.version} ${e.resolved}`);
		continue;
	}
	const published = times.get(e.name)?.[e.version];
	if (!published || Date.parse(published) > cutoff) {
		console.log(`${isEmdash(e.name) ? "EmDash 系" : "EmDash の外"}: ${e.name}@${e.version} ${published ?? "(不明)"} ${e.key}`);
	}
}
```

- npm 12 の `npm view --json` は、結果を配列で包んで返す(`[{ … }]`)。`npm view <名前> time --json` を使うスクリプトは、配列の 1 つ目を取る必要がある。根拠: **実測のみ**

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2(mise)、利用者の `~/.npmrc` は `ignore-scripts=true` と `min-release-age=3`。2026-09-24(日本時間)に計測。
