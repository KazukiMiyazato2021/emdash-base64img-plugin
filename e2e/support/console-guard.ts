/**
 * ブラウザの console の警告・エラーと、捕まえられなかった例外を見張る。テストの終わりに、想定していないものがあれば失敗にする。
 *
 * 除くもの:
 * - EmDash 側が出す 3 つ(docs/emdash-admin-console-noise.md)。プラグインの部品と関係なく出る。
 *   1. 本番のビルドでコマンドパレットの項目を選んだときの Lingui の「Uncompiled message detected!」
 *   2. Firefox の本番のビルドの CSP の eval の違反(zod 4 の確認)
 *   3. Firefox でサイドバーをスクロールしたときの「scroll-linked positioning effect」
 * - Playwright がページの中で実行したコード(Firefox では「debugger eval code」と出る)が起こした、Firefox の
 *   「Layout was forced before the page was fully loaded」の警告。テストが読み込みの途中で要素の位置を読んだときに出る。
 * - テストが `allow()` で許したもの(わざと 4xx を返させたときの、Chromium の「Failed to load resource」など)。
 */

import type { ConsoleMessage, Page } from "@playwright/test";

/** EmDash 側と、テストの道具(Playwright)が起こす警告・エラー(除く) */
const KNOWN_NOISE: readonly RegExp[] = [
	/Uncompiled message detected!/,
	/Content-Security-Policy.*unsafe-eval/,
	/scroll-linked positioning effect/,
	/Layout was forced before the page was fully loaded.*debugger eval code/,
];

interface Recorded {
	readonly kind: string;
	readonly text: string;
	readonly url: string;
}

export class ConsoleGuard {
	private readonly allowed: RegExp[] = [...KNOWN_NOISE];
	private readonly recorded: Recorded[] = [];
	private readonly pages = new WeakSet<Page>();

	/** このテストで出てもよいもの(メッセージか URL に当たる正規表現) */
	allow(...patterns: RegExp[]): void {
		this.allowed.push(...patterns);
	}

	/** ページの console と例外を記録し始める(同じページは 1 回だけ) */
	watch(page: Page): void {
		if (this.pages.has(page)) return;
		this.pages.add(page);
		page.on("console", (message: ConsoleMessage) => {
			const type = message.type();
			if (type !== "error" && type !== "warning") return;
			this.recorded.push({ kind: type, text: message.text(), url: message.location().url });
		});
		page.on("pageerror", (error) => {
			this.recorded.push({ kind: "pageerror", text: `${error.name}: ${error.message}`, url: "" });
		});
	}

	/** 想定していない警告・エラー */
	unexpected(): Recorded[] {
		return this.recorded.filter(
			(entry) =>
				!this.allowed.some((pattern) => pattern.test(entry.text) || pattern.test(entry.url)),
		);
	}

	/** 想定していない警告・エラーがあれば例外を投げる */
	assertClean(): void {
		const unexpected = this.unexpected();
		if (unexpected.length === 0) return;
		const lines = unexpected.map((entry) => `- [${entry.kind}] ${entry.text} ${entry.url}`.trim());
		throw new Error(
			`ブラウザの console に想定していない警告・エラーがありました:\n${lines.join("\n")}`,
		);
	}
}

/** Chromium が 4xx / 5xx の応答で出す console のエラー(Firefox は fetch の失敗を console に出さない) */
export function failedResourcePattern(status: number): RegExp {
	return new RegExp(`Failed to load resource: the server responded with a status of ${status}\\b`);
}
