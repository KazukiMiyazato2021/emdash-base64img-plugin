/**
 * 参照元の記録(`content:afterSave` / `content:afterPublish`。仕様書 9 章、5.3)。
 *
 * - 保存・公開したエントリの参照を読み、参照している画像の `imageRefs.owners` に、参照元
 *   `{ collection, entryId, locale, field }` を追記する。削除はしない。同じ参照元は重複させない。
 *   `entryId` と `locale` は `event.content.id` / `event.content.locale`、`collection` は `event.collection`。
 * - 読むのは `event.content.data`(afterSave では保存した下書き、afterPublish では公開したデータ)と、あれば
 *   `event.content.liveData`(content テーブルの列の値。公開済みなら公開版)。画像管理の判定(T21)が見る範囲と揃える。
 * - 参照として扱うのは、このプラグインの widget を使う `json` フィールド(`getFieldWidgetKind`)の値のうち、
 *   参照の形(`isBase64ImageRef`)に合うものだけ。ギャラリーは 1 枚ずつ見る。サイトの描画(T15)と同じ規則。
 * - クエリ: 参照の形の値が無ければ 0(`b64_images` も 0)。あれば、フィールド定義 2(`ctx.schema.getCollection`)
 *   + 記録の読み出し(50 件ずつ `getMany`。ふつうは 1)+ 参照元が増える画像 1 枚につき 2
 *   (`getVersioned` + `compareAndSet`。版が変わっていて読み直すたびに 2 増える)。
 * - 同時の書き込み: 「`getMany` → 追記 → `putMany`」では、同じ画像に別の参照元を同時に足すと、あとの書き込みが
 *   先の追記を消す。そのため、書くときは `getVersioned` で記録と版(`revision`。EmDash はどの書き込みでも版を変える)
 *   を読み、`compareAndSet` で「版が変わっていなければ書く」。変わっていたら読み直して、最大 `MAX_APPEND_ATTEMPTS` 回試す。
 * - 記録が無い画像(seed で作った画像、完全削除された画像)には、記録を作らない。記録にはサーバーで作れない値
 *   (サムネイル)が要るため。記録が `imageRefsRecordSchema` に合わなくても、`owners` が配列なら追記し、ほかのキーは
 *   そのまま残す(参照元を失わないため)。記録がオブジェクトでない・`owners` が配列でないときは書かない。どれもログに出す。
 * - afterSave / afterPublish は保存・公開の応答のあとに実行され(`after()`)、保存を止められない。例外は外に出さず、
 *   `ctx.log` に出す。T29 は `imageOwnerHooks` をそのまま `hooks` に登録する(`errorPolicy: "continue"` と
 *   `priority: OWNER_HOOK_PRIORITY` を含む)。
 */

import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE, type WidgetKind } from "../../shared/constants";
import {
	imageOwnerSchema,
	imageRefsRecordSchema,
	isBase64ImageRef,
	slugSchema,
} from "../../shared/schema";
import type { ImageOwner } from "../../shared/types";
import { getManyInBatches } from "../image-refs";
import { getFieldWidgetKind, type FieldSchemaLike } from "../validate";

/**
 * 1 枚の画像に参照元を追記するときに試す回数。版が変わっていたら(同時にほかの書き込みがあったら)読み直す。
 * 管理画面の一括操作は、同時に 5 件ずつリクエストを送る(`references/emdash/packages/admin/src/lib/bulk.ts` の
 * `BULK_CONCURRENCY`)。同じ画像を参照するエントリを一括公開しても、競合は最悪 4 回で済む。公開ボタン(保存と公開)の
 * afterSave と afterPublish が重なる分の余裕を見て 8 回にする。競合が無ければ 1 回で済み、クエリは増えない。
 */
export const MAX_APPEND_ATTEMPTS = 8;

/**
 * hook の優先度(小さいほど先)。EmDash の既定は 100。同じ hook のプラグインは 1 つずつ順に実行され、既定の
 * `errorPolicy: "abort"` のプラグインが例外を投げると、後に続くプラグインは呼ばれない。既定より先に実行して、
 * ほかのプラグインの例外で記録が飛ばされないようにする(この hook は例外を投げないので、後のプラグインは止めない)。
 */
export const OWNER_HOOK_PRIORITY = 50;

/** ログに並べる画像 ID の数(超えた分は件数だけ) */
const MAX_LOGGED_IDS = 10;

// ---------------------------------------------------------------------------
// ctx と event(EmDash の型のうち、この hook が使う部分)
// ---------------------------------------------------------------------------

/** hook の名前(ログに出す) */
export type OwnerHookName = "content:afterSave" | "content:afterPublish";

/**
 * この hook が読む event。afterSave の `ContentHookEvent` と、afterPublish の `ContentPublishStateChangeEvent`
 * をそのまま渡せる。`content` はエントリ全体(`id` / `locale` / `data` / 更新のときは `liveData` など)。
 */
export interface OwnerHookEvent {
	readonly content: Readonly<Record<string, unknown>>;
	readonly collection: string;
}

/** `getVersioned` の結果(EmDash の `VersionedValue`) */
export interface VersionedRecord {
	readonly value: unknown;
	/** 記録の版。EmDash は、どの書き込み(`put` / `putMany` / `compareAndSet` / `updateIf`)でも新しい値にする */
	readonly revision: string;
}

/** プラグインストレージ `imageRefs` のうち、この hook が使う部分(EmDash の `StorageCollection` をそのまま渡せる) */
export interface ImageRefsStore {
	/** 見つかった ID だけを持つ Map を返す */
	getMany(ids: string[]): Promise<ReadonlyMap<string, unknown>>;
	/** 記録と版を返す。記録が無ければ null */
	getVersioned(id: string): Promise<VersionedRecord | null>;
	/** 版が `expectedRevision` のままなら書き、`applied: true` を返す。変わっていれば書かずに `applied: false` */
	compareAndSet(
		id: string,
		expectedRevision: string | null,
		data: unknown,
	): Promise<{ readonly applied: boolean }>;
}

/** ログ(EmDash の `LogAccess` の一部) */
export interface OwnerHookLog {
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}

/**
 * この hook が使う ctx(EmDash の `PluginContext` の一部)。`PluginContext` をそのまま渡せる。
 * - `schema`: capability `schema:read` を宣言したときだけある
 * - `storage[IMAGE_REFS_STORAGE]`: ストレージ `imageRefs` を宣言したときだけある
 */
export interface OwnerHookContext {
	readonly schema?:
		| {
				getCollection(
					slug: string,
				): Promise<{ readonly fields: readonly FieldSchemaLike[] } | null>;
		  }
		| undefined;
	readonly storage: { readonly [name: string]: ImageRefsStore | undefined };
	readonly log: OwnerHookLog;
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

/**
 * 画像ごとの結果。
 * - `appended`: 参照元を追記した
 * - `unchanged`: 参照元はすでに記録されていた(書かない)
 * - `missing`: `imageRefs` に記録が無い(seed で作った画像、完全削除された画像)。記録は作らない
 * - `broken`: 記録がオブジェクトでないか、`owners` が配列でない。書かない
 * - `conflict`: 版が変わり続け、`MAX_APPEND_ATTEMPTS` 回で書けなかった。エントリを次に保存・公開したときに記録される
 * - `failed`: 読み書きが例外で失敗した
 */
export type ImageOwnerOutcome =
	"appended" | "unchanged" | "missing" | "broken" | "conflict" | "failed";

/**
 * 記録を読む前に終えた理由。
 * - `image-collection`: `b64_images` の保存・公開
 * - `no-references`: `data` / `liveData` に参照の形の値が無い(クエリなし)
 * - `invalid-entry`: エントリの ID かロケールが、参照元の形(`imageOwnerSchema`)に合わない(クエリなし)
 * - `no-image-fields`: このプラグインの widget を使うフィールドに参照が無い(コレクションが無いときも)
 */
export type OwnerTrackingSkip =
	"image-collection" | "no-references" | "invalid-entry" | "no-image-fields";

export interface OwnerTrackingResult {
	/** 記録を読む前に終えたときの理由 */
	readonly skipped?: OwnerTrackingSkip | undefined;
	/** 参照していた画像ごとの結果 */
	readonly images: ReadonlyMap<string, ImageOwnerOutcome>;
	/** 画像ごとの処理に入る前の失敗(フィールド定義や記録の読み出しの失敗、プラグインの定義の誤り) */
	readonly error?: unknown;
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

/** `content:afterSave` の本体。例外は投げない(失敗は `ctx.log` に出す) */
export async function recordImageOwnersAfterSave(
	event: OwnerHookEvent,
	ctx: OwnerHookContext,
): Promise<void> {
	await trackImageOwners(event, ctx, "content:afterSave");
}

/**
 * `content:afterPublish` の本体。例外は投げない。一覧の一括公開や予約公開のように、API だけで公開したときは
 * afterSave が呼ばれないので、公開したデータ(`event.content.data`)もここで記録する。
 */
export async function recordImageOwnersAfterPublish(
	event: OwnerHookEvent,
	ctx: OwnerHookContext,
): Promise<void> {
	await trackImageOwners(event, ctx, "content:afterPublish");
}

/**
 * T29 が `definePlugin({ hooks })` に登録する設定(`hooks: { ...imageOwnerHooks, … }`)。
 * - `errorPolicy: "continue"`: この hook が(タイムアウトなどで)失敗しても、後に続くプラグインを止めない
 * - `priority`: `OWNER_HOOK_PRIORITY`(ほかのプラグインの例外で飛ばされないよう、既定の 100 より先)
 * - 登録には capability `content:read` が要る(無いと EmDash は警告を出して登録しない)。`ctx.schema` には
 *   `schema:read`、`ctx.storage.imageRefs` にはストレージの宣言が要る
 */
export const imageOwnerHooks = {
	"content:afterSave": {
		priority: OWNER_HOOK_PRIORITY,
		errorPolicy: "continue",
		handler: recordImageOwnersAfterSave,
	},
	"content:afterPublish": {
		priority: OWNER_HOOK_PRIORITY,
		errorPolicy: "continue",
		handler: recordImageOwnersAfterPublish,
	},
} as const;

/**
 * 参照元を記録し、画像ごとの結果を返す(hook の本体。テストと動作確認のために結果を返す)。例外は投げない。
 */
export async function trackImageOwners(
	event: OwnerHookEvent,
	ctx: OwnerHookContext,
	hook: OwnerHookName,
): Promise<OwnerTrackingResult> {
	const images = new Map<string, ImageOwnerOutcome>();
	const context: LogContext = {
		hook,
		collection: event.collection,
		entryId: event.content["id"],
	};
	try {
		if (event.collection === IMAGE_COLLECTION) return { skipped: "image-collection", images };
		const sources = readSources(event.content);
		if (!sources.some(mayHoldReferences)) return { skipped: "no-references", images };

		const entry = readEntry(event.collection, event.content);
		if (entry === null) {
			ctx.log.warn(`${hook}: image owners were not recorded; the entry ID or locale is invalid`, {
				...context,
				locale: event.content["locale"],
			});
			return { skipped: "invalid-entry", images };
		}

		const schema = ctx.schema;
		if (!schema) {
			throw new Error(`ctx.schema is not available. Declare the "schema:read" capability.`);
		}
		const collection = await schema.getCollection(event.collection);
		const wanted = collectOwners(entry, collection === null ? [] : collection.fields, sources);
		if (wanted.size === 0) return { skipped: "no-image-fields", images };

		const store = ctx.storage[IMAGE_REFS_STORAGE];
		if (!store) {
			throw new Error(
				`ctx.storage.${IMAGE_REFS_STORAGE} is not available. Declare the "${IMAGE_REFS_STORAGE}" storage collection.`,
			);
		}
		const stored = await getManyInBatches(store, [...wanted.keys()]);
		const problems: Problems = { failures: [], mismatched: [] };
		const pending: [string, ImageOwner[]][] = [];
		for (const [id, owners] of wanted) {
			if (!stored.has(id)) {
				images.set(id, "missing");
				continue;
			}
			// 読んだ時点で記録済みなら書かない(ふつうの保存・自動保存はここで終わり、クエリは getMany だけ)
			const plan = planAppend(stored.get(id), owners);
			if (plan.kind === "append") pending.push([id, owners]);
			else images.set(id, plan.kind);
		}
		// 画像ごとの書き込みは互いに関係しないので、並行に行う
		await Promise.all(
			pending.map(async ([id, owners]) => {
				images.set(id, await appendOwners(store, id, owners, problems));
			}),
		);
		report(ctx.log, context, images, problems);
		return { images };
	} catch (error) {
		ctx.log.error(`${hook}: failed to record image owners`, {
			...context,
			error: describeError(error),
		});
		return { images, error };
	}
}

// ---------------------------------------------------------------------------
// 参照の読み取り
// ---------------------------------------------------------------------------

/**
 * フィールドの値から、参照している画像 ID を取り出す。参照の形(`isBase64ImageRef`)に合う値だけを数え、
 * ギャラリーは 1 枚ずつ見る(形の合わない要素は飛ばす)。同じ ID は重複を除かずに返す。
 * 画像管理の判定(T21。参照元のフィールドに画像がまだあるか)でも、同じ規則で読むために使える。
 */
export function readReferencedImageIds(value: unknown, kind: WidgetKind): string[] {
	if (kind === "image") return isBase64ImageRef(value) ? [value.id] : [];
	if (!Array.isArray(value)) return [];
	const ids: string[] = [];
	for (const element of value as readonly unknown[]) {
		if (isBase64ImageRef(element)) ids.push(element.id);
	}
	return ids;
}

/** 参照を読むデータ: `data` と、あれば `liveData`(どちらもオブジェクトのときだけ) */
function readSources(
	content: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>[] {
	const sources: Readonly<Record<string, unknown>>[] = [];
	for (const key of ["data", "liveData"]) {
		const value = content[key];
		if (isRecord(value)) sources.push(value);
	}
	return sources;
}

/**
 * 参照の形の値(単一の参照か、参照を含む配列)を持つフィールドがあるか。無ければ、フィールド定義も記録も読まずに終える
 * (widget のフィールドを持たないコレクションや、画像が空のエントリでクエリを増やさない)。
 */
function mayHoldReferences(data: Readonly<Record<string, unknown>>): boolean {
	return Object.values(data).some(
		(value) =>
			isBase64ImageRef(value) ||
			(Array.isArray(value) &&
				(value as readonly unknown[]).some((item) => isBase64ImageRef(item))),
	);
}

/** 参照元のうち、エントリで決まる部分 */
type OwnerEntry = Omit<ImageOwner, "field">;

const ownerEntrySchema = imageOwnerSchema.pick({ collection: true, entryId: true, locale: true });

/** `event.collection` と `event.content.id` / `event.content.locale` から、参照元のエントリの部分を作る */
function readEntry(
	collection: string,
	content: Readonly<Record<string, unknown>>,
): OwnerEntry | null {
	const parsed = ownerEntrySchema.safeParse({
		collection,
		entryId: content["id"],
		locale: content["locale"],
	});
	return parsed.success === true ? parsed.data : null;
}

/**
 * 画像 ID ごとに、追記したい参照元を集める(フィールドの定義の順。同じ画像・同じフィールドは 1 つ)。
 * このプラグインの widget を使う `json` フィールドだけを見る。
 */
function collectOwners(
	entry: OwnerEntry,
	fields: readonly FieldSchemaLike[],
	sources: readonly Readonly<Record<string, unknown>>[],
): Map<string, ImageOwner[]> {
	const wanted = new Map<string, ImageOwner[]>();
	for (const field of fields) {
		const kind = getFieldWidgetKind(field);
		if (kind === null || slugSchema.safeParse(field.slug).success === false) continue;
		for (const source of sources) {
			const value = Object.hasOwn(source, field.slug) ? source[field.slug] : undefined;
			for (const id of readReferencedImageIds(value, kind)) {
				const owners = wanted.get(id) ?? [];
				if (!owners.some((owner) => owner.field === field.slug)) {
					owners.push({ ...entry, field: field.slug });
				}
				wanted.set(id, owners);
			}
		}
	}
	return wanted;
}

// ---------------------------------------------------------------------------
// 記録への追記
// ---------------------------------------------------------------------------

type AppendPlan =
	| { readonly kind: "unchanged" }
	| { readonly kind: "broken" }
	| {
			readonly kind: "append";
			/** 書き込む記録(`owners` だけを変え、ほかのキーは読んだまま) */
			readonly record: Record<string, unknown>;
			/** 書き込む記録が `imageRefsRecordSchema` に合うか(合わなくても書く。ログに出す) */
			readonly matchesSchema: boolean;
	  };

/**
 * 読んだ記録に、まだ無い参照元を足した記録を作る。既存の `owners` の要素は、形が壊れていてもそのまま残し、
 * 4 つのキー(`collection` / `entryId` / `locale` / `field`)がすべて同じ要素があれば「記録済み」とする。
 * `owners` が無い記録には `owners` を作る。記録がオブジェクトでない・`owners` が配列でないときは書かない。
 */
function planAppend(stored: unknown, owners: readonly ImageOwner[]): AppendPlan {
	if (!isRecord(stored)) return { kind: "broken" };
	const current = stored["owners"];
	if (current !== undefined && !Array.isArray(current)) return { kind: "broken" };
	const existing: readonly unknown[] = current === undefined ? [] : (current as readonly unknown[]);
	const added = owners.filter((owner) => !existing.some((item) => isSameOwner(item, owner)));
	if (added.length === 0) return { kind: "unchanged" };
	const record = { ...stored, owners: [...existing, ...added] };
	return {
		kind: "append",
		record,
		matchesSchema: imageRefsRecordSchema.safeParse(record).success,
	};
}

function isSameOwner(item: unknown, owner: ImageOwner): boolean {
	return (
		isRecord(item) &&
		item["collection"] === owner.collection &&
		item["entryId"] === owner.entryId &&
		item["locale"] === owner.locale &&
		item["field"] === owner.field
	);
}

/** 画像ごとの処理で出た、ログに出す問題 */
interface Problems {
	/** 例外で失敗した画像と、その理由 */
	readonly failures: { readonly id: string; readonly error: string }[];
	/** スキーマに合わない記録に追記した画像 */
	readonly mismatched: string[];
}

/**
 * 1 枚の画像に参照元を追記する。版を読み(`getVersioned`)、版が変わっていなければ書く(`compareAndSet`)。
 * 変わっていたら読み直して、最大 `MAX_APPEND_ATTEMPTS` 回試す。記録が消えていたら作らない(完全削除との競合)。
 */
async function appendOwners(
	store: ImageRefsStore,
	id: string,
	owners: readonly ImageOwner[],
	problems: Problems,
	attempt = 1,
): Promise<ImageOwnerOutcome> {
	try {
		const current = await store.getVersioned(id);
		if (current === null) return "missing";
		const plan = planAppend(current.value, owners);
		if (plan.kind !== "append") return plan.kind;
		const written = await store.compareAndSet(id, current.revision, plan.record);
		if (written.applied === true) {
			if (!plan.matchesSchema) problems.mismatched.push(id);
			return "appended";
		}
	} catch (error) {
		problems.failures.push({ id, error: describeError(error) });
		return "failed";
	}
	if (attempt >= MAX_APPEND_ATTEMPTS) return "conflict";
	return appendOwners(store, id, owners, problems, attempt + 1);
}

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

/** どのログにも添える情報 */
interface LogContext {
	readonly hook: OwnerHookName;
	readonly collection: string;
	readonly entryId: unknown;
}

/** 画像ごとの結果のうち、記録できなかったものと、スキーマに合わない記録をログに出す */
function report(
	log: OwnerHookLog,
	context: LogContext,
	images: ReadonlyMap<string, ImageOwnerOutcome>,
	problems: Problems,
): void {
	const { hook } = context;
	const idsOf = (outcome: ImageOwnerOutcome) =>
		[...images].filter(([, value]) => value === outcome).map(([id]) => id);

	const missing = idsOf("missing");
	if (missing.length > 0) {
		log.warn(
			`${hook}: image owners were not recorded for images without an imageRefs record (created by seed or deleted permanently)`,
			{ ...context, ...listIds(missing) },
		);
	}
	const broken = idsOf("broken");
	if (broken.length > 0) {
		log.error(
			`${hook}: image owners were not recorded because the imageRefs record is not an object or its owners is not an array`,
			{ ...context, ...listIds(broken) },
		);
	}
	const conflicts = idsOf("conflict");
	if (conflicts.length > 0) {
		log.warn(
			`${hook}: image owners were not recorded because the imageRefs record kept changing (${MAX_APPEND_ATTEMPTS} attempts); they are recorded the next time the entry is saved or published`,
			{ ...context, ...listIds(conflicts) },
		);
	}
	if (problems.failures.length > 0) {
		log.error(`${hook}: failed to record image owners`, {
			...context,
			...listIds(problems.failures.map((failure) => failure.id)),
			error: problems.failures[0]?.error,
		});
	}
	if (problems.mismatched.length > 0) {
		log.warn(
			`${hook}: image owners were appended to imageRefs records that do not match the schema`,
			{ ...context, ...listIds(problems.mismatched) },
		);
	}
}

function listIds(ids: readonly string[]): { ids: string[]; count: number } {
	return { ids: ids.slice(0, MAX_LOGGED_IDS), count: ids.length };
}

function describeError(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
