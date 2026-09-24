/**
 * 参照を持つコレクションの保存 hook(`content:beforeSave`。仕様書 8 章③)。
 *
 * - 保存するコレクションのフィールド定義を `ctx.schema.getCollection` で読み(2 クエリ)、このプラグインの widget
 *   (`base64-image:image` / `base64-image:gallery`)を使う `json` フィールドを探す。無ければ、ほかのクエリはしない。
 *   `json` 以外の型で widget だけがこのプラグインのものというフィールドは、設定の誤りとして検証しない
 *   (アップロードのルートが `INVALID_TARGET` で拒否するので、widget からは参照が入らない)。
 * - 検証するのは、送られてきたフィールドだけ。更新(PUT)の beforeSave には送ったフィールドだけが渡る。
 *   送られていないフィールドは保存済みの値なので確かめない。`null` / `undefined` は「画像なし」として通す
 *   (必須かどうかは、このあと EmDash が確かめる)。
 * - 参照の形(`base64ImageRefSchema`)、alt の長さ、ギャラリーの枚数(`maxItems`)と重複を確かめ、
 *   参照している画像 ID が `imageRefs` にあるかを `getMany` でまとめて確かめる(重複を除き、50 件ずつ)。
 *   ゴミ箱に入った画像は `imageRefs` に残るので通る。seed で作った画像は `imageRefs` に無いので拒否する。
 * - 問題があれば `ContentSaveRejectedError` を投げる。EmDash は 422 `SAVE_REJECTED` と `message` を返し、
 *   管理画面は保存の失敗の通知に `message` をそのまま出す(改行は空白になる)。hook は管理画面の言語を知らない
 *   (event にも ctx にも無い)ので、`message` には日本語と英語の両方を、この順に書く。
 * - `b64_images` 自身は対象外(T19 の hook が検証する)。
 */

import { ContentSaveRejectedError } from "emdash";
import type { z } from "zod";

import {
	IMAGE_COLLECTION,
	IMAGE_REFS_STORAGE,
	MAX_ALT_LENGTH,
	PLUGIN_ID,
	type WidgetKind,
} from "../../shared/constants";
import type { ServerErrorCode } from "../../shared/errors";
import { getWidgetKind, normalizeFieldOptions } from "../../shared/options";
import { base64ImageRefSchema } from "../../shared/schema";
import type { Base64ImageRef } from "../../shared/types";

/**
 * 1 回の `getMany` に入れる画像 ID の数。EmDash 0.39.1 の `getMany` は ID を分けずに IN 句に入れ、
 * バインド変数は「ID の数 + 2」になる(`packages/core/src/database/repositories/plugin-storage.ts:271`)。
 * D1 の上限(1 クエリ 100 個)に余裕を残し、EmDash の IN 句の分割単位(`SQL_BATCH_SIZE`)と揃える。
 */
export const IMAGE_REFS_BATCH_SIZE = 50;

/**
 * `message` に並べる問題の数。超えた分は件数だけを書く。管理画面の通知は幅 340px で約 5 秒で消え、
 * 日本語と英語の両方を書くと、問題 1 件でも 10 行ほどになるため。
 */
export const MAX_LISTED_ISSUES = 3;

// ---------------------------------------------------------------------------
// ctx と event(EmDash の型のうち、この hook が使う部分)
// ---------------------------------------------------------------------------

/** この hook が読むフィールド定義(EmDash の `FieldSchemaInfo` の一部) */
export interface ReferenceFieldInfo {
	readonly slug: string;
	readonly label: string;
	/** フィールドの型(`json` など) */
	readonly type: string;
	readonly widget?: string | undefined;
	readonly options?: unknown;
}

/** プラグインストレージ `imageRefs` のうち、この hook が使う部分(EmDash の `StorageCollection` の一部) */
export interface ImageRefsLookup {
	/** 見つかった ID だけを持つ Map を返す */
	getMany(ids: string[]): Promise<ReadonlyMap<string, unknown>>;
}

/**
 * この hook が使う ctx(EmDash の `PluginContext` の一部)。`PluginContext` をそのまま渡せる。
 * - `schema`: capability `schema:read` を宣言したときだけある
 * - `storage[IMAGE_REFS_STORAGE]`: ストレージ `imageRefs` を宣言したときだけある
 */
export interface ReferenceHookContext {
	readonly schema?:
		| {
				getCollection(
					slug: string,
				): Promise<{ readonly fields: readonly ReferenceFieldInfo[] } | null>;
		  }
		| undefined;
	readonly storage: { readonly [name: string]: ImageRefsLookup | undefined };
}

/** この hook が読む event(EmDash の `ContentHookEvent` の一部) */
export interface ReferenceHookEvent {
	/** 保存するデータ。更新では、送られてきたフィールドだけ */
	readonly content: Readonly<Record<string, unknown>>;
	readonly collection: string;
}

// ---------------------------------------------------------------------------
// フィールド
// ---------------------------------------------------------------------------

/** このプラグインの widget のフィールド */
export interface ImageField {
	readonly slug: string;
	readonly label: string;
	readonly kind: WidgetKind;
	/** フィールド定義の `options`(`normalizeFieldOptions` で解釈する) */
	readonly options: unknown;
}

/** フィールド定義から、このプラグインの widget を使う `json` フィールドを、定義の順に取り出す */
export function getImageFields(fields: readonly ReferenceFieldInfo[]): ImageField[] {
	const result: ImageField[] = [];
	for (const field of fields) {
		const kind = getFieldWidgetKind(field);
		if (kind === null) continue;
		result.push({ slug: field.slug, label: field.label, kind, options: field.options });
	}
	return result;
}

/**
 * フィールドが、このプラグインの widget を使う `json` フィールドなら、その種類を返す。そうでなければ null。
 * 管理画面はフィールドの型を見ずに widget を割り当てるが、参照(オブジェクト)をそのまま保存できるのは `json`
 * フィールドだけなので、型も確かめる。T11 の `src/server/validate.ts` の `getFieldWidgetKind` と同じ規則・同じ形で、
 * このブランチの分岐元にはまだ無いため、ここに置いている(マージのときに、そちらに差し替える)。
 */
function getFieldWidgetKind(field: {
	readonly slug: string;
	readonly type: string;
	readonly widget?: string | undefined;
	readonly options?: unknown;
}): WidgetKind | null {
	return field.type === "json" ? getWidgetKind(field.widget) : null;
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

/**
 * `content:beforeSave` の本体。問題が無ければ何も返さない(保存するデータは変えない)。
 * 問題があれば `ContentSaveRejectedError` を投げる。`ctx.schema` や `imageRefs` が無いとき(プラグインの定義の誤り)は、
 * 通常の `Error` を投げる(EmDash は 500 `CONTENT_HOOK_ERROR` にして、`message` をログにだけ出す)。
 */
export async function validateReferencesBeforeSave(
	event: ReferenceHookEvent,
	ctx: ReferenceHookContext,
): Promise<void> {
	if (event.collection === IMAGE_COLLECTION) return;
	const { content } = event;
	if (Object.keys(content).length === 0) return;

	const schema = ctx.schema;
	if (!schema) {
		throw new Error(
			`[${PLUGIN_ID}] ctx.schema is not available. Declare the "schema:read" capability.`,
		);
	}
	const collection = await schema.getCollection(event.collection);
	if (!collection) return;
	const fields = getImageFields(collection.fields).filter((field) =>
		Object.hasOwn(content, field.slug),
	);
	if (fields.length === 0) return;

	const { issues, refs } = inspectFields(fields, content);
	if (refs.length > 0) {
		const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
		if (!imageRefs) {
			throw new Error(
				`[${PLUGIN_ID}] ctx.storage.${IMAGE_REFS_STORAGE} is not available. Declare the "${IMAGE_REFS_STORAGE}" storage collection.`,
			);
		}
		const stored = await findStoredIds(
			imageRefs,
			refs.map((located) => located.ref.id),
		);
		for (const { fieldIndex, field, item, ref } of refs) {
			if (stored.has(ref.id)) continue;
			issues.push({ code: "IMAGE_NOT_FOUND", id: ref.id, fieldIndex, field, item });
		}
	}
	if (issues.length === 0) return;
	issues.sort(compareIssues);
	throw new ContentSaveRejectedError(formatIssues(issues));
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

/** `ServerErrorCode` にあるコードだけを書けるようにする */
type Code<C extends ServerErrorCode> = C;

/** 参照そのものの問題 */
type RefProblem =
	| {
			readonly code: Code<"REFERENCE_INVALID">;
			/** 形の合わないキー。空なら、値そのものが参照(ギャラリーでは参照の配列)ではない */
			readonly keys: readonly string[];
	  }
	| { readonly code: Code<"ALT_TOO_LONG">; readonly length: number };

/** 問題の場所。`item` はギャラリーの何枚目か(1 から)。単一画像のフィールドと、ギャラリー全体の問題には無い */
interface IssueLocation {
	/** 検証したフィールドの中での順番(`message` をフィールドの定義の順に並べるのに使う) */
	readonly fieldIndex: number;
	readonly field: ImageField;
	readonly item?: number | undefined;
}

type ReferenceIssue = IssueLocation &
	(
		| RefProblem
		| {
				readonly code: Code<"GALLERY_TOO_MANY_ITEMS">;
				readonly count: number;
				readonly max: number;
		  }
		| {
				readonly code: Code<"GALLERY_DUPLICATE_ITEM">;
				readonly id: string;
				readonly firstItem: number;
		  }
		| { readonly code: Code<"IMAGE_NOT_FOUND">; readonly id: string }
	);

/** 形の正しい参照と、その場所 */
interface LocatedRef extends IssueLocation {
	readonly ref: Base64ImageRef;
}

type RefCheck =
	| { readonly ok: true; readonly ref: Base64ImageRef }
	| { readonly ok: false; readonly problem: RefProblem };

/** 送られてきた値の形・枚数・重複を確かめ、存在を確かめる参照を集める */
function inspectFields(
	fields: readonly ImageField[],
	content: Readonly<Record<string, unknown>>,
): { issues: ReferenceIssue[]; refs: LocatedRef[] } {
	const issues: ReferenceIssue[] = [];
	const refs: LocatedRef[] = [];
	for (const [fieldIndex, field] of fields.entries()) {
		const value = content[field.slug];
		if (value === null || value === undefined) continue;

		if (field.kind === "image") {
			const checked = checkRef(value);
			if (checked.ok === false) {
				issues.push({ ...checked.problem, fieldIndex, field });
			} else {
				refs.push({ fieldIndex, field, ref: checked.ref });
			}
			continue;
		}

		if (!Array.isArray(value)) {
			issues.push({ code: "REFERENCE_INVALID", keys: [], fieldIndex, field });
			continue;
		}
		const { maxItems } = normalizeFieldOptions(field.options);
		if (value.length > maxItems) {
			// 保存は拒否されるので、1 枚ずつの検証と存在の確認はしない(大きな配列でクエリを増やさない)
			issues.push({
				code: "GALLERY_TOO_MANY_ITEMS",
				count: value.length,
				max: maxItems,
				fieldIndex,
				field,
			});
			continue;
		}
		const firstItemById = new Map<string, number>();
		for (const [index, element] of (value as readonly unknown[]).entries()) {
			const item = index + 1;
			const checked = checkRef(element);
			if (checked.ok === false) {
				issues.push({ ...checked.problem, fieldIndex, field, item });
				continue;
			}
			const firstItem = firstItemById.get(checked.ref.id);
			if (firstItem !== undefined) {
				issues.push({
					code: "GALLERY_DUPLICATE_ITEM",
					id: checked.ref.id,
					firstItem,
					fieldIndex,
					field,
					item,
				});
				continue;
			}
			firstItemById.set(checked.ref.id, item);
			refs.push({ fieldIndex, field, item, ref: checked.ref });
		}
	}
	return { issues, refs };
}

/** 値が参照の形かを確かめる。alt が長すぎることだけが問題なら `ALT_TOO_LONG` にする */
function checkRef(value: unknown): RefCheck {
	const parsed = base64ImageRefSchema.safeParse(value);
	if (parsed.success === true) return { ok: true, ref: parsed.data };
	const { issues } = parsed.error;
	const altLength = readAltLength(value);
	if (altLength !== undefined && issues.every(isAltTooLong)) {
		return { ok: false, problem: { code: "ALT_TOO_LONG", length: altLength } };
	}
	return { ok: false, problem: { code: "REFERENCE_INVALID", keys: invalidKeys(issues) } };
}

function isAltTooLong(issue: z.core.$ZodIssue): boolean {
	return issue.code === "too_big" && issue.path.length === 1 && issue.path[0] === "alt";
}

/** alt の長さ(Unicode のコードポイントで数える。zod の `max` と同じ数え方) */
function readAltLength(value: unknown): number | undefined {
	if (!isRecord(value)) return undefined;
	const alt = value["alt"];
	return typeof alt === "string" ? Array.from(alt).length : undefined;
}

/** 形の合わないキーを並べる。値そのものがオブジェクトでなければ空にする */
function invalidKeys(issues: readonly z.core.$ZodIssue[]): string[] {
	const keys = new Set<string>();
	for (const issue of issues) {
		if (issue.code === "unrecognized_keys") {
			for (const key of issue.keys) keys.add(key);
			continue;
		}
		const first = issue.path[0];
		if (first === undefined) return [];
		keys.add(String(first));
	}
	return [...keys];
}

/** `imageRefs` にある ID を返す。ID は重複を除き、`IMAGE_REFS_BATCH_SIZE` 件ずつ `getMany` に渡す */
async function findStoredIds(
	imageRefs: ImageRefsLookup,
	ids: readonly string[],
): Promise<Set<string>> {
	const unique = [...new Set(ids)];
	const batches: string[][] = [];
	for (let start = 0; start < unique.length; start += IMAGE_REFS_BATCH_SIZE) {
		batches.push(unique.slice(start, start + IMAGE_REFS_BATCH_SIZE));
	}
	const results = await Promise.all(batches.map((batch) => imageRefs.getMany(batch)));
	const stored = new Set<string>();
	for (const result of results) {
		for (const id of result.keys()) stored.add(id);
	}
	return stored;
}

/** 問題を、フィールドの定義の順、ギャラリーでは何枚目かの順に並べる(ギャラリー全体の問題が先) */
function compareIssues(a: ReferenceIssue, b: ReferenceIssue): number {
	return a.fieldIndex - b.fieldIndex || (a.item ?? 0) - (b.item ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// message(日本語と英語)
// ---------------------------------------------------------------------------

type Language = "ja" | "en";

const formatNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format;

/** 代替テキストの上限(「1,000」) */
const ALT_LIMIT = formatNumber(MAX_ALT_LENGTH);

/** `message` に入れるキーの数と長さの上限(知らないキーが大量に送られても `message` を長くしない) */
const MAX_LISTED_KEYS = 5;
const MAX_KEY_LENGTH = 40;

interface IssueMessages {
	/** フィールドと、ギャラリーの何枚目か */
	location(field: ImageField, item: number | undefined): string;
	problem(issue: ReferenceIssue): string;
	/** 並べなかった問題の件数 */
	more(count: number): string;
	/** 画像が見つからないときの原因と対処 */
	missingHint: string;
}

const MESSAGES: Readonly<Record<Language, IssueMessages>> = {
	ja: {
		location: (field, item) =>
			`画像フィールド${nameJa(field)}${item === undefined ? "" : `の ${formatNumber(item)} 枚目`}`,
		problem(issue) {
			switch (issue.code) {
				case "REFERENCE_INVALID":
					if (issue.keys.length > 0) {
						return `画像の参照の形式が正しくありません(キー: ${formatKeys(issue.keys)})。`;
					}
					return isGalleryValue(issue)
						? "値が画像の参照の配列ではありません。"
						: "画像の参照の形式が正しくありません。";
				case "ALT_TOO_LONG":
					return `代替テキストが ${ALT_LIMIT} 文字を超えています(${formatNumber(issue.length)} 文字)。`;
				case "GALLERY_TOO_MANY_ITEMS":
					return `画像が ${formatNumber(issue.count)} 枚あり、上限の ${formatNumber(issue.max)} 枚を超えています。`;
				case "GALLERY_DUPLICATE_ITEM":
					return `${formatNumber(issue.firstItem)} 枚目と同じ画像です(ID: ${issue.id})。`;
				case "IMAGE_NOT_FOUND":
					return `画像が見つかりません(ID: ${issue.id})。`;
			}
		},
		more: (count) => `ほかに ${formatNumber(count)} 件の問題があります。`,
		missingHint:
			"見つからない画像は、完全に削除されたか、このプラグインでアップロードされていません(seed など)。画像を外すか、選び直してください。",
	},
	en: {
		location: (field, item) =>
			`Image field ${nameEn(field)}${item === undefined ? "" : `, item ${formatNumber(item)}`}`,
		problem(issue) {
			switch (issue.code) {
				case "REFERENCE_INVALID":
					if (issue.keys.length > 0) {
						return `the image reference is invalid (keys: ${formatKeys(issue.keys)}).`;
					}
					return isGalleryValue(issue)
						? "the value is not an array of image references."
						: "the image reference is invalid.";
				case "ALT_TOO_LONG":
					return `the alternative text is longer than ${ALT_LIMIT} characters (${formatNumber(issue.length)}).`;
				case "GALLERY_TOO_MANY_ITEMS":
					return `${formatNumber(issue.count)} images exceed the limit of ${formatNumber(issue.max)}.`;
				case "GALLERY_DUPLICATE_ITEM":
					return `the same image as item ${formatNumber(issue.firstItem)} (ID: ${issue.id}).`;
				case "IMAGE_NOT_FOUND":
					return `image not found (ID: ${issue.id}).`;
			}
		},
		more: (count) =>
			count === 1
				? "1 more problem is not shown."
				: `${formatNumber(count)} more problems are not shown.`,
		missingHint:
			"Missing images were deleted permanently or not uploaded through this plugin (for example, seeded). Remove or replace them.",
	},
};

/**
 * `message` の言語の順番。hook は管理画面の言語を知らない(event・ctx・リクエストの文脈のどれにも無い)。
 * `ctx.site.locale` はオプション `emdash:locale` の値で、EmDash 0.39.1 ではセットアップでも設定画面でも書かれず、
 * ほぼ常に既定の en になる。そのため固定の順にする。
 */
const LANGUAGES: readonly Language[] = ["ja", "en"];

/** 問題を 1 行ずつ、日本語・英語の順に書く。管理画面の通知では、改行は空白になる */
function formatIssues(issues: readonly ReferenceIssue[]): string {
	const listed = issues.slice(0, MAX_LISTED_ISSUES);
	const hidden = issues.length - listed.length;
	const hasMissing = listed.some((issue) => issue.code === "IMAGE_NOT_FOUND");
	return LANGUAGES.map((language) => {
		const messages = MESSAGES[language];
		const lines = listed.map(
			(issue) => `${messages.location(issue.field, issue.item)}: ${messages.problem(issue)}`,
		);
		if (hidden > 0) lines.push(messages.more(hidden));
		if (hasMissing) lines.push(messages.missingHint);
		return lines.join("\n");
	}).join("\n");
}

/** ギャラリーの値そのものの問題か(1 枚ずつの問題ではない) */
function isGalleryValue(issue: ReferenceIssue): boolean {
	return issue.field.kind === "gallery" && issue.item === undefined;
}

/** 「Cover」(cover)。表示名が無いか slug と同じなら slug だけ */
function nameJa(field: ImageField): string {
	const label = field.label.trim();
	if (label === "" || label === field.slug) return `「${field.slug}」`;
	return `「${label}」(${field.slug})`;
}

/** "Cover" (cover)。表示名が無いか slug と同じなら slug だけ */
function nameEn(field: ImageField): string {
	const label = field.label.trim();
	if (label === "" || label === field.slug) return `"${field.slug}"`;
	return `"${label}" (${field.slug})`;
}

function formatKeys(keys: readonly string[]): string {
	const listed = keys
		.slice(0, MAX_LISTED_KEYS)
		.map((key) => (key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}…` : key));
	return keys.length > MAX_LISTED_KEYS ? `${listed.join(", ")}, …` : listed.join(", ");
}
