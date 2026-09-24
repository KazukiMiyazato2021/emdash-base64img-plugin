/**
 * 管理画面の文言の仕組み(仕様書 11.1)。
 *
 * - 言語は `<html lang>` で決める。主言語が `ja` なら日本語、それ以外(`en`・`en-GB`・空など)は英語。
 * - EmDash 0.39.1 の管理画面は、設定画面で言語を変えると、再読み込みせずに `<html lang>` を書き換える
 *   (`LocaleDirectionProvider` の effect。`references/emdash/packages/admin/src/locales/LocaleDirectionProvider.tsx:20-23`)。
 *   plugin の部品は言語が変わっても再描画されるとは限らないので、`useLocale()` が `MutationObserver` で属性を監視する。
 * - 文言は、各部品が自分のファイルの中に `defineMessages({ ja: {...}, en: {...} })` で持つ(共有の辞書ファイルは作らない)。
 *   ja と en で、キーと値の型(文字列か、引数を取る関数か)が揃っていなければ型エラーになる。
 */

import { useSyncExternalStore } from "react";

/** 用意する言語 */
export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** `<html lang>` が ja / en のどちらでもないときの言語 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * `lang` 属性の値(BCP 47)から言語を決める。主言語のサブタグ(`ja-JP` の `ja`)を大文字・小文字を区別せずに比べ、
 * ja / en のどちらでもなければ `DEFAULT_LOCALE` にする。
 */
export function resolveLocale(lang: string | null | undefined): Locale {
	const primary = (lang ?? "").trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
	return LOCALES.find((locale) => locale === primary) ?? DEFAULT_LOCALE;
}

/** 今の `<html lang>` から決めた言語。DOM が無い環境(サーバー)では `DEFAULT_LOCALE` */
export function getDocumentLocale(): Locale {
	if (typeof document === "undefined") return DEFAULT_LOCALE;
	return resolveLocale(document.documentElement.lang);
}

// `<html lang>` の監視は、購読している部品の数に関係なく 1 つの MutationObserver で行う
// (コンテンツ一覧の列は、1 ページ 100 行の各セルが購読しうる)。
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/**
 * `<html lang>` が変わったら `listener` を呼ぶ。戻り値の関数で購読をやめる。
 * 言語(ja / en)が変わらない書き換え(`en` → `en-GB` など)でも呼ぶので、呼ばれた側で `getDocumentLocale()` を比べる。
 */
export function subscribeDocumentLocale(listener: () => void): () => void {
	if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
		return () => {};
	}
	// 同じ関数が 2 回購読しても、それぞれを別に解除できるよう、包んでから登録する。
	const entry = () => listener();
	listeners.add(entry);
	if (observer === null) {
		observer = new MutationObserver(() => {
			// 通知の途中で解除された購読は呼ばない(Set の反復は、削除された要素を飛ばす)。
			for (const notify of listeners) notify();
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
	}
	return () => {
		listeners.delete(entry);
		if (listeners.size === 0 && observer !== null) {
			observer.disconnect();
			observer = null;
		}
	};
}

function getServerLocale(): Locale {
	return DEFAULT_LOCALE;
}

/** 今の言語。管理画面で言語を変えると(`<html lang>` が変わると)再描画する */
export function useLocale(): Locale {
	return useSyncExternalStore(subscribeDocumentLocale, getDocumentLocale, getServerLocale);
}

// ---------------------------------------------------------------------------
// 辞書
// ---------------------------------------------------------------------------

/** 文言の値。文字列か、差し込む値を受け取って文字列を返す関数(ja 側の関数の引数には型を書く) */
export type MessageValue = string | ((...args: never[]) => string);

/** 1 言語分の辞書の形 */
export type MessageShape = Readonly<Record<string, MessageValue>>;

/**
 * 文字列リテラルの型を `string` に広げる(ja から推論した形で en を確かめるため)。
 * `T[K] | …` の形にしているのは、`T` 自身をこの型に代入できるようにするため(関数の値はそのまま残る)。
 */
export type WidenMessages<T> = {
	readonly [K in keyof T]: T[K] | (T[K] extends string ? string : never);
};

/** ja / en の辞書 */
export type Messages<T extends MessageShape> = Readonly<Record<Locale, T>>;

/**
 * ja / en の辞書を定義する。辞書の形は ja から推論する(型引数で明示してもよい)。
 * en のキーが足りない・余る・関数の引数の型が違うと、型エラーになる。
 *
 * @example
 * ```ts
 * const messages = defineMessages({
 * 	ja: { select: "ファイルを選択", remaining: (count: number) => `あと ${count} 枚追加できます` },
 * 	en: { select: "Select a file", remaining: (count) => `You can add ${count} more` },
 * });
 * const t = useMessages(messages);
 * t.remaining(3);
 * ```
 */
export function defineMessages<T extends MessageShape>(messages: {
	readonly ja: T;
	readonly en: NoInfer<WidenMessages<T>>;
}): Messages<WidenMessages<T>> {
	return messages;
}

/** 今の言語の辞書を返す。言語が変わると再描画する */
export function useMessages<T extends MessageShape>(messages: Messages<T>): T {
	return messages[useLocale()];
}
