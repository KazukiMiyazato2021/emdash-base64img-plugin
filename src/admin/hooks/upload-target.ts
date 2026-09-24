/**
 * アップロードの保存先(`target`)を、管理画面の URL と widget の `id` から求める(仕様書 7 章)。
 *
 * EmDash 0.39.1 の管理画面は、plugin widget に collection・エントリ ID・ロケールを渡さない
 * (`references/emdash/packages/admin/src/components/ContentEditor.tsx:1818-1843`)。そのため次のように求める
 * (docs/emdash-admin-content-editor-url.md)。
 *
 * | 値 | 求め方 |
 * |---|---|
 * | `collection` | パス `/_emdash/admin/content/<collection>/<エントリ ID または new>` の 1 つ目 |
 * | `entryId` | 同じパスの 2 つ目。`new`(新規作成)や、エントリ ID の形でない値(手で入力した slug など)なら送らない |
 * | `locale` | 検索パラメーター `locale`。管理画面は、エントリの保存済みのロケールをここに入れて移動する |
 * | `field` | widget の props の `id`(`field-<フィールドの slug>`)から `field-` を除いたもの |
 *
 * `entryId` と `locale` は組にして、両方が分かるときだけ送る(仕様書 7 章)。ルートは `entryId` の参照元を
 * `locale` のロケールで記録し、省くと既定ロケールで記録する。既定以外のロケールのエントリでは、保存時の記録(T20)と
 * ロケールだけ違う参照元が増える(T18 の実測)。`?locale=` の無い画面(ダッシュボード・コマンドパレット・サイトの
 * ツールバーから開いた編集画面)では、参照元を送らず、保存のときに T20 が記録する。`entryId` の無いときに `locale` を
 * 送らないのは、ルートがロケールを設定と照らし合わせ、合わなければアップロード全体を 400 にするため(使わない値で
 * 失敗させない)。
 */

import { useMemo, useSyncExternalStore } from "react";

import { entryIdSchema, localeSchema, slugSchema } from "../../shared/schema";
import type { UploadTarget } from "../../shared/types";

/** widget の props の `id` の接頭辞(`ContentEditor.tsx:1791` の `field-${name}`) */
export const FIELD_ID_PREFIX = "field-";

/**
 * コンテンツの新規作成(`/content/$collection/new`)と編集(`/content/$collection/$id`)の画面のパス。
 * 管理画面のルーターの起点は `/_emdash/admin` に固定されている(`references/emdash/packages/admin/src/router.tsx:689`・
 * `:835`・`:2814`)。末尾の `/` は許す。
 */
const CONTENT_EDITOR_PATH = /^\/_emdash\/admin\/content\/([^/]+)\/([^/]+)\/?$/;

/** 新規作成の画面のパスの 2 つ目(ルーターは `$id` より先にこの静的なパスに当てる) */
const NEW_ENTRY_SEGMENT = "new";

/**
 * 送るロケールの長さの上限。アップロード用ルートは、i18n を設定していないサイトでは 35 文字までを受け付け、超えると
 * 400 にする(T18。RFC 5646 の 4.4.1 が、受け付けなければならないとする長さ)。手で書き換えた URL の長い値で
 * アップロード全体を失敗させないよう、超えたらロケールは分からないとみなす。
 */
const MAX_TARGET_LOCALE_LENGTH = 35;

/** 保存先を求められない理由 */
export type UploadTargetProblem =
	/** widget の `id` が `field-<slug>` の形でない */
	| "invalid-field-id"
	/** 今のページが、コンテンツの新規作成・編集の画面でない */
	| "not-content-editor";

/** 保存先を求めた結果。`ok` は `=== false` で判別する(利用者の設定で strictNullChecks が無効でも絞り込まれるように) */
export type UploadTargetResolution =
	| { readonly ok: true; readonly target: UploadTarget }
	| { readonly ok: false; readonly problem: UploadTargetProblem; readonly message: string };

/** URL のうち、保存先を求めるのに使う部分(`Location` と `URL` が当てはまる) */
export interface LocationLike {
	/** パーセントエンコードされたままのパス */
	readonly pathname: string;
	/** 先頭の `?` を含んでも含まなくてもよい */
	readonly search: string;
}

/**
 * widget の `id` と管理画面の URL から、アップロードの保存先を求める。
 *
 * - `collection` がコレクションの slug の形でなければ、コンテンツの画面ではないとみなす(`not-content-editor`)。
 * - `entryId` と `locale` は、両方がスキーマ(`entryIdSchema` / `localeSchema`)に合うときだけ、組にして入れる。
 *   合わない値を送ると、アップロード全体が送る前の確認(`VALIDATION_ERROR`)やルートの確認で失敗するため。
 */
export function resolveUploadTarget(
	fieldId: string,
	location: LocationLike,
): UploadTargetResolution {
	const field = fieldSlugFromId(fieldId);
	if (field === undefined) {
		return {
			ok: false,
			problem: "invalid-field-id",
			message: `The widget id "${fieldId}" is not in the form "${FIELD_ID_PREFIX}<field slug>"`,
		};
	}
	const page = parseContentEditorPath(location.pathname);
	if (page === undefined) {
		return {
			ok: false,
			problem: "not-content-editor",
			message: `The page "${location.pathname}" is not a content editor of the EmDash admin`,
		};
	}
	const target: UploadTarget = { collection: page.collection, field };
	const locale = readTargetLocale(location.search);
	if (page.entryId !== undefined && locale !== undefined) {
		target.entryId = page.entryId;
		target.locale = locale;
	}
	return { ok: true, target };
}

/**
 * 管理画面の URL から、今の widget の保存先を求める。
 *
 * - 描画のたびに `window.location` を読む。ブラウザの戻る・進む(`popstate`)でも再描画する。
 * - 管理画面のルーターは `history.pushState` で移動し、イベントを出さない。ただし、別のエントリや翻訳に移ると、
 *   widget は作り直される(`ContentEditor.tsx:1370-1377` のキー `${name}:${item?.id ?? "new"}`、新規作成の画面と編集の
 *   画面は別のルート)。そのため、描画のときに読めば足りる。
 * - DOM が無い環境(サーバー)では `not-content-editor`。
 */
export function useUploadTarget(fieldId: string): UploadTargetResolution {
	const href = useSyncExternalStore(subscribeToHistory, getLocationHref, getServerLocationHref);
	return useMemo(() => resolveUploadTarget(fieldId, toLocation(href)), [fieldId, href]);
}

/**
 * 管理画面のルーター(TanStack Router)と同じ規則で、検索パラメーターの文字列の値を読む。文字列でなければ undefined。
 *
 * ルーターは、値を `true` / `false` / 数値に変換し、残りの文字列は `JSON.parse` できれば、その結果にする
 * (`@tanstack/router-core` の `qss.js` の `decode` と `searchParams.js` の `parseSearchWith`)。同じ名前が 2 つ以上
 * あれば配列になる。管理画面は、`locale` が文字列のときだけ使う(`router.tsx:692-694`・`:838-841`)。
 *
 * ここでは `JSON.parse` だけを使う。ルーターが `true` / `false` / 数値に変換する文字列は、`JSON.parse` でも文字列に
 * ならないので、文字列かどうかの判定は同じになる。
 */
export function readRouterSearchString(search: string, name: string): string | undefined {
	const values = new URLSearchParams(search).getAll(name);
	if (values.length !== 1) return undefined;
	const value = parseJsonOrRaw(values[0] ?? "");
	return typeof value === "string" ? value : undefined;
}

function parseJsonOrRaw(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/** `?locale=` のうち、送れる値(`localeSchema` に合い、35 文字まで)。そうでなければ undefined */
function readTargetLocale(search: string): string | undefined {
	const locale = readRouterSearchString(search, "locale");
	if (locale === undefined || locale.length > MAX_TARGET_LOCALE_LENGTH) return undefined;
	return localeSchema.safeParse(locale).success ? locale : undefined;
}

function fieldSlugFromId(fieldId: string): string | undefined {
	if (!fieldId.startsWith(FIELD_ID_PREFIX)) return undefined;
	const slug = fieldId.slice(FIELD_ID_PREFIX.length);
	return slugSchema.safeParse(slug).success ? slug : undefined;
}

function parseContentEditorPath(
	pathname: string,
): { readonly collection: string; readonly entryId: string | undefined } | undefined {
	const match = CONTENT_EDITOR_PATH.exec(pathname);
	if (match === null) return undefined;
	const collection = decodeSegment(match[1] ?? "");
	if (collection === undefined || !slugSchema.safeParse(collection).success) return undefined;
	const second = decodeSegment(match[2] ?? "");
	if (second === NEW_ENTRY_SEGMENT) return { collection, entryId: undefined };
	// 2 つ目は、エントリ ID のほかに slug のこともある(標準 API は ID と slug のどちらでも引く。
	// `references/emdash/packages/core/src/database/repositories/content.ts:633-659`)。管理画面の中の移動は ID を使う。
	const entryId =
		second !== undefined && entryIdSchema.safeParse(second).success ? second : undefined;
	return { collection, entryId };
}

function decodeSegment(segment: string): string | undefined {
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}

function subscribeToHistory(onChange: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	window.addEventListener("popstate", onChange);
	return () => {
		window.removeEventListener("popstate", onChange);
	};
}

function getLocationHref(): string {
	return typeof window === "undefined" ? "" : window.location.href;
}

function getServerLocationHref(): string {
	return "";
}

function toLocation(href: string): LocationLike {
	if (href === "") return { pathname: "", search: "" };
	const url = new URL(href);
	return { pathname: url.pathname, search: url.search };
}
