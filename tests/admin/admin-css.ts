/**
 * 管理画面の部品が使うクラスが、EmDash の管理画面の CSS にあるかを確かめるテストの補助(T22-2)。
 *
 * 管理画面の CSS はビルド済みで(`@emdash-cms/admin/dist/styles.css`)、プラグインのファイルは Tailwind の対象にならない。
 * プラグインの部品が付けたクラスは、その CSS にあるものだけが当たる(docs/emdash-admin-plugin-ui-styling.md)。
 *
 * 使い方(管理画面の部品のテストで):
 *
 * ```tsx
 * const { container } = render(<ThumbnailColumn … />);
 * const missing = findMissingClasses(container, sourceTokens("src/admin/ThumbnailColumn.tsx"));
 * expect(missing.fromSource).toEqual([]); // 自分のソースに書いたクラスは、すべて CSS にある
 * expect(missing.unknown).toEqual([]); // CSS に無い残りは、Kumo が自分で付けるクラスだけ
 * ```
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// jsdom の環境では URL が jsdom のものになり、fs が `new URL(...)` を受け付けないので、パスの文字列で扱う
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** 管理画面の CSS(`@emdash-cms/admin/styles.css`) */
export const ADMIN_CSS = readFileSync(
	createRequire(import.meta.url).resolve("@emdash-cms/admin/styles.css"),
	"utf8",
);

/** Kumo のビルド済みの JS。CSS に無いクラスが、Kumo 自身の付けるものかを確かめるのに使う */
const KUMO_CHUNKS_DIR = join(ROOT_DIR, "node_modules/@cloudflare/kumo/dist/chunks");
const KUMO_DIST_JS = readdirSync(KUMO_CHUNKS_DIR)
	.filter((file) => file.endsWith(".js"))
	.map((file) => readFileSync(join(KUMO_CHUNKS_DIR, file), "utf8"))
	.join("\n");

/** クラス名を CSS のセレクタの書き方にする(Tailwind v4 の出力と同じく、英数字・`-`・`_` 以外の前に `\`) */
export function escapeClassName(name: string): string {
	let escaped = "";
	for (const [index, char] of Array.from(name).entries()) {
		if (/[A-Za-z0-9_-]/.test(char)) {
			escaped += index === 0 && /[0-9]/.test(char) ? `\\3${char} ` : char;
		} else {
			escaped += `\\${char}`;
		}
	}
	return escaped;
}

/** CSS に、そのクラスのセレクタがあるか。長いクラスの先頭の一致(`.min-h-3` と `.min-h-32`)は数えない */
export function hasClassSelector(css: string, name: string): boolean {
	const selector = `.${escapeClassName(name)}`;
	for (let at = css.indexOf(selector); at !== -1; at = css.indexOf(selector, at + 1)) {
		const next = css[at + selector.length];
		if (next === undefined || !/[A-Za-z0-9_\\-]/.test(next)) return true;
	}
	return false;
}

/** 要素とその子孫の `class` の値を、重複を除いて集める */
export function collectClassNames(root: Element): string[] {
	const names = new Set<string>();
	for (const element of [root, ...Array.from(root.querySelectorAll("[class]"))]) {
		for (const name of (element.getAttribute("class") ?? "").split(/\s+/)) {
			if (name !== "") names.add(name);
		}
	}
	return [...names];
}

/**
 * ソースに書いた語。DOM のクラスのうち、自分のソースが付けたものを見分けるのに使う。
 * パスはリポジトリのルートから。ディレクトリなら、直下のファイルをすべて読む。
 */
export function sourceTokens(...paths: string[]): Set<string> {
	const tokens = new Set<string>();
	for (const path of paths) {
		const full = join(ROOT_DIR, path);
		const files = statSync(full).isDirectory()
			? readdirSync(full)
					.map((file) => join(full, file))
					.filter((file) => statSync(file).isFile())
			: [full];
		for (const file of files) {
			for (const token of readFileSync(file, "utf8").split(/[\s"'`{}(),;]+/)) tokens.add(token);
		}
	}
	return tokens;
}

/** 描画した DOM のクラスのうち、管理画面の CSS に無いもの */
export interface MissingClasses {
	/** ソースに書いたクラス。当たらないので、CSS にあるクラスか style に直す */
	readonly fromSource: string[];
	/** ソースにも Kumo のビルド済みの JS にも無いクラス。どこから来たかを調べる */
	readonly unknown: string[];
}

/**
 * 描画した DOM のクラスのうち、管理画面の CSS に無いものを返す。Kumo が自分で付けるクラスにも CSS に無いものがあるので
 * (Kumo 2.6.0 の Input の `disabled:text-kumo-disabled` は、テーマに `kumo-disabled` の色が無く、CSS が作られない。
 * 管理画面の Input も同じ)、ソースに無く Kumo の JS にあるクラスは除く。
 */
export function findMissingClasses(root: Element, tokens: ReadonlySet<string>): MissingClasses {
	const missing = collectClassNames(root).filter((name) => !hasClassSelector(ADMIN_CSS, name));
	return {
		fromSource: missing.filter((name) => tokens.has(name)),
		unknown: missing.filter((name) => !tokens.has(name) && !KUMO_DIST_JS.includes(name)),
	};
}
