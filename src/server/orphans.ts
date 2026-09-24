/**
 * 未使用画像の判定(仕様書 9 章の「判定」)と、画像管理の一覧のページ送り。
 * 一覧のルート(`src/server/routes/images-admin.ts` の `imagesListRoute`)が使う。
 *
 * 判定:
 * - 画像エントリの状態(`entryStatus`): `ctx.content.get("b64_images", id)` があれば `active`。null のときだけ
 *   `getTrashedVersioned` を呼び(ゴミ箱に入っていないエントリに呼ぶと 9 クエリと重い)、あれば `trashed`、無ければ `missing`。
 * - 画像エントリの公開の状態(`entryPublication`): `active` のとき、`get` の `status` から決める(追加のクエリなし)。
 *   EmDash 0.39.1 の `status` は `draft` / `published` / `scheduled`。サイトに出るのは `published` だけなので、知らない値は
 *   `draft` にする。`trashed` / `missing` は null(ゴミ箱の画像はサイトに出ず、戻すと必ず下書きになる。T21-2)。
 * - 参照元ごとの状態(`owners[].status`): 参照元のエントリを `ctx.content.get` で読む。null なら `owner_deleted`
 *   (ゴミ箱・完全削除のどちらも)。あれば、列の値(`data`)と、`draftRevisionId` があればその下書き(`getRevision`)の
 *   どちらかで、参照元の `field` に画像が残っていれば `in_use`、どちらにも無ければ `detached`。
 *   - フィールドの値は `readReferencedImageIds`(参照元の記録 T20 と同じ規則)で読む。単一画像かギャラリーかは値の形で
 *     決める(配列ならギャラリー)。フィールドの widget が後から変わっても、値に参照が残っていれば `in_use` にする
 *     (「使われていない」と誤るほうが害が大きいため)。
 *   - 同じエントリ(`collection` と `entryId`)は、リクエストの中で 1 回だけ読む(cover とギャラリー、ロケールだけ違う
 *     参照元、ほかの画像の参照元)。列の値だけで、そのエントリを参照元に持つすべての画像が見つかれば、下書きは読まない。
 *   - 参照元のコレクションが消されていると `get` が例外を投げる(テーブルが無い)。そのときだけコレクションの一覧を読み、
 *     無ければ `owner_deleted` にする。あれば例外をそのまま投げる(データベースの失敗を「削除された」と誤らないため)。
 * - 画像の状態バッジ(`usage`): 参照元が無ければ `no_owner`。あれば、すべての参照元の状態のうち
 *   `in_use` → `owner_deleted` → `detached` の順で最初に見つかったもの(`imageUsageSchema`)。
 *
 * 記録(`imageRefs`)の読み方(T20 の注意):
 * - `owners` は増えるだけで、削除された・画像を外したエントリの要素も残る。要素ごとに読む。`collection` / `entryId` /
 *   `field` が読めない要素は調べずに飛ばし、ログに出す。`locale` だけが壊れた要素は、調べるが一覧には載せない
 *   (応答のスキーマに合わないため)。4 つのキーが同じ要素は、一覧には 1 つだけ載せる。
 * - 応答に載せられない記録(ID・サムネイル・寸法・バイト数・作成日時のどれかが不正、`owners` が配列でない)は、
 *   一覧から外してログに出す。
 * - 一覧に載せる参照元は、記録の順に先頭から `IMAGES_LIST_MAX_OWNERS` 件まで。`usage` はすべての参照元から決める。
 *   全体の件数(`ownersTotal`)は、一覧に載せる規則(`imageOwnerSchema` に合い、4 つのキーが同じものは 1 件)で数える。
 *
 * ページ送りとクエリ数:
 * - `imageRefs` を `createdAt` の新しい順(同じ時刻は ID の大きい順。EmDash の `query` の順)に読み、1 ページは
 *   `IMAGES_LIST_MAX_ITEMS` 枚まで。カーソルは、最後に読んだ記録の `createdAt` と ID を持つ(記録が消えても位置を失わない)。
 * - 1 リクエストのクエリ数は `IMAGES_LIST_QUERY_BUDGET` 以下にする。画像を 1 枚足すたびに、最悪の見積もり
 *   (画像エントリの状態 5 + まだ読んでいない参照元のエントリ 1 件につき 6。参照元があれば、コレクションの一覧 2 を
 *   リクエストに 1 回)が予算に収まるかを確かめ、収まらなければそこで止める。見積もりは SQLite での実測の最大
 *   (docs/emdash-plugin-content-query-counts.md)。調べるのは並行に行う(D1 では往復の待ち時間が重なるため)。
 * - 参照元のエントリが多く、1 枚だけで予算を超える画像は、その画像だけを扱うリクエストを続けて、参照元を予算の分ずつ
 *   調べる(途中までの結果はカーソルに持つ)。その間の応答は `items` が空で `nextCursor` がある。一覧に載せる参照元の
 *   状態がすべて分かり、どれかが `in_use` なら、残りは調べずに終える(`usage` は `in_use` に決まるため)。
 */

import { z } from "zod";

import { IMAGE_COLLECTION, type WidgetKind } from "../shared/constants";
import { WEBP_DATA_URL_PREFIX } from "../shared/data-url";
import {
	entryIdSchema,
	imageOwnerSchema,
	imageRefsRecordSchema,
	slugSchema,
} from "../shared/schema";
import type {
	ImageEntryPublication,
	ImageEntryStatus,
	ImageListItem,
	ImageListOwner,
	ImageOwner,
	ImageUsage,
	ImagesListResponse,
	OwnerStatus,
} from "../shared/types";
import { readReferencedImageIds } from "./hooks/owners";

// ---------------------------------------------------------------------------
// 上限と見積もり
// ---------------------------------------------------------------------------

/**
 * 1 リクエストのクエリ数の予算(SQLite で数えた数。ルートの固定費を含む)。
 * - 上限(Workers Free で D1 に送れるのは 1 呼び出し 1,000)の 1 割。D1 では同じ処理でも SQLite より多いことがある
 *   (EmDash の計測で `GET /` が 6 → 10)ので、十分な余裕を残す。
 * - アップロード(75)や EmDash の保存(55〜62)と同じ程度の重さに抑える。
 * - 参照元が 1 件ずつの画像なら、最悪の見積もりでも 1 ページ 8 枚になる。
 */
export const IMAGES_LIST_QUERY_BUDGET = 100;

/**
 * 1 ページに載せる画像の上限。画像エントリの状態を読む `get` は本体(1 枚最大 500,000 バイトの data URL)まで読むので、
 * プレビュー取得(`PREVIEW_MAX_IDS`)と同じく 10 枚にする(10 枚で最大約 5MB の JSON を読む。T17)。
 */
export const IMAGES_LIST_MAX_ITEMS = 10;

/** 1 枚の画像に載せる参照元の上限(記録の順に先頭から)。`usage` はすべての参照元から決める */
export const IMAGES_LIST_MAX_OWNERS = 20;

/** カーソルの最大の長さ(`imagesListRequestSchema` の `cursor` と同じ。テストで確かめる) */
export const IMAGES_LIST_CURSOR_MAX_LENGTH = 2048;

/**
 * クエリ数の見積もり(SQLite での実測の最大。docs/emdash-plugin-content-query-counts.md)。
 * - `route`: ルートの固定費(セッションの利用者の行)
 * - `refsPage`: `imageRefs` の `query`
 * - `schema`: コレクションの一覧(`listCollections`。参照元の `get` が例外を投げたときだけ読む。コレクションが 50 件以下なら 2)
 * - `imageEntry`: 画像エントリの状態(`get` 2 / 1 + `getTrashedVersioned` 4 / 2)
 * - `ownerEntry`: 参照元のエントリ 1 件(`get` 3 / 2 / 1 + 下書きの `getRevision` 3)
 */
export const LIST_QUERY_COSTS = {
	route: 1,
	refsPage: 1,
	schema: 2,
	imageEntry: 5,
	ownerEntry: 6,
} as const;

/** 1 回の `query` で読める記録の最大(EmDash のプラグインストレージの上限) */
const STORAGE_QUERY_MAX_LIMIT = 100;

/** ログに並べる画像 ID の数(超えた分は件数だけ) */
const MAX_LOGGED_IDS = 10;

// ---------------------------------------------------------------------------
// 使う部品の型(EmDash の型のうち、この処理が使う部分)
// ---------------------------------------------------------------------------

/** 参照元・画像のエントリ(EmDash の `ContentItem` の一部) */
export interface OwnerEntryLike {
	/** content テーブルの列の値(公開済みなら公開版、一度も公開していなければ作成したときの値) */
	readonly data: Readonly<Record<string, unknown>>;
	/** 下書きのリビジョン。無ければ null */
	readonly draftRevisionId?: string | null | undefined;
	/** エントリの状態(0.39.1 は `draft` / `published` / `scheduled`)。画像エントリの公開の状態に使う */
	readonly status?: string | undefined;
}

/** 下書きのリビジョン(EmDash の `ContentRevisionInfo` の一部) */
export interface RevisionLike {
	readonly data: Readonly<Record<string, unknown>>;
}

/**
 * 判定に使う content の操作(EmDash の `ContentAccess` の一部)。
 * - `getRevision`: capability `content:revisions:read` を宣言したときだけある
 * - `getTrashedVersioned`: capability `content:restore` を宣言したときだけある(ゴミ箱に入っていれば値、無ければ null)
 */
export interface JudgeContentAccess {
	get(collection: string, id: string): Promise<OwnerEntryLike | null>;
	getRevision(collection: string, id: string, revisionId: string): Promise<RevisionLike | null>;
	getTrashedVersioned(collection: string, id: string): Promise<unknown>;
}

/** `imageRefs` の `query` の範囲の条件(EmDash の `RangeFilter` の一部。文字列で比べる) */
export interface CreatedAtRange {
	readonly gte?: string;
	readonly lt?: string;
	readonly lte?: string;
}

/** `imageRefs` の `query` に渡す条件(EmDash の `QueryOptions` の一部) */
export interface ImageRefsQueryOptions {
	readonly where: { readonly createdAt: CreatedAtRange };
	readonly orderBy: { readonly createdAt: "desc" };
	readonly limit: number;
}

/** `imageRefs` の `query` の結果(EmDash の `PaginatedResult` の一部) */
export interface ImageRefsQueryResult {
	readonly items: readonly { readonly id: string; readonly data: unknown }[];
	readonly hasMore: boolean;
}

/** プラグインストレージ `imageRefs` のうち、一覧が使う部分(EmDash の `StorageCollection` をそのまま渡せる) */
export interface ImageRefsPageStore {
	query(options: ImageRefsQueryOptions): Promise<ImageRefsQueryResult>;
}

/** コレクションの一覧(EmDash の `SchemaAccess` の一部。capability `schema:read` が要る) */
export interface CollectionListing {
	listCollections(): Promise<readonly { readonly slug: string }[]>;
}

/** ログ(EmDash の `LogAccess` の一部) */
export interface ImagesListLog {
	warn(message: string, data?: unknown): void;
}

/** 判定と一覧に使う部品 */
export interface ImagesListDeps {
	readonly content: JudgeContentAccess;
	readonly schema: CollectionListing;
	readonly imageRefs: ImageRefsPageStore;
	readonly log: ImagesListLog;
}

// ---------------------------------------------------------------------------
// カーソル
// ---------------------------------------------------------------------------

/** 一覧の位置(最後に読んだ記録の `createdAt` と ID)。次のページは、この記録より後(古いほう)から */
export interface ImagesListPosition {
	readonly createdAt: string;
	readonly id: string;
}

/** 参照元の状態の 1 文字の表し方(`u` 使用中 / `d` 参照元が削除された / `x` 外された) */
export type OwnerStatusCode = "u" | "d" | "x";

/** 参照元の多い画像を、リクエストをまたいで調べている途中の状態 */
export interface HeavyImageProgress {
	/** 調べている画像(位置の次の記録) */
	readonly id: string;
	/** 始めたときの `owners` の要素の数。変わっていたら(参照元が足されたら)最初から調べ直す */
	readonly ownerCount: number;
	/** 調べ終えた参照元のエントリの数(記録に初めて現れた順) */
	readonly checkedEntries: number;
	/** 一覧に載せる参照元の状態(`OwnerStatusCode`。まだ調べていないものは `.`) */
	readonly listed: string;
	/** 一覧に載せない参照元の状態のうち、いちばん優先されるもの(まだ無ければ空) */
	readonly rest: OwnerStatusCode | "";
	/** 画像エントリの状態と公開の状態(最初のリクエストで調べる) */
	readonly entry: ImageEntryState;
}

/** 画像エントリの状態と公開の状態。公開の状態は `active` のときだけ値がある */
export interface ImageEntryState {
	readonly entryStatus: ImageEntryStatus;
	readonly entryPublication: ImageEntryPublication | null;
}

/** 一覧のカーソル。`after` が無ければ先頭から */
export interface ImagesListCursor {
	readonly after?: ImagesListPosition | undefined;
	readonly heavy?: HeavyImageProgress | undefined;
}

const STATUS_CODES = {
	in_use: "u",
	owner_deleted: "d",
	detached: "x",
} as const satisfies Record<OwnerStatus, OwnerStatusCode>;

const STATUS_BY_CODE: Readonly<Record<OwnerStatusCode, OwnerStatus>> = {
	u: "in_use",
	d: "owner_deleted",
	x: "detached",
};

/** 画像エントリの状態の 1 文字の表し方(公開済み `p` / 下書き `d` / 予約 `s` / ゴミ箱 `t` / 無い `m`) */
type EntryStateCode = "p" | "d" | "s" | "t" | "m";

const ENTRY_STATE_BY_CODE: Readonly<Record<EntryStateCode, ImageEntryState>> = {
	p: { entryStatus: "active", entryPublication: "published" },
	d: { entryStatus: "active", entryPublication: "draft" },
	s: { entryStatus: "active", entryPublication: "scheduled" },
	t: { entryStatus: "trashed", entryPublication: null },
	m: { entryStatus: "missing", entryPublication: null },
};

function entryStateCode(entry: ImageEntryState): EntryStateCode {
	if (entry.entryStatus === "trashed") return "t";
	if (entry.entryStatus === "missing") return "m";
	if (entry.entryPublication === "published") return "p";
	return entry.entryPublication === "scheduled" ? "s" : "d";
}

/** `missing` の状態(読めなかった画像の既定値) */
const MISSING_ENTRY: ImageEntryState = ENTRY_STATE_BY_CODE.m;

/**
 * カーソルの版。形を変えたら上げる(古いカーソルは `INVALID_CURSOR` になり、画面は最初から読み直す)。
 * 2: 途中の状態に、画像エントリの公開の状態を入れた(T21-2)
 */
const CURSOR_VERSION = 2;

/** 位置の `createdAt`。一覧は数字で始まる文字列の `createdAt` の記録だけを読む(`CREATED_AT_FLOOR`) */
const positionCreatedAtSchema = z.string().regex(/^[0-9]/);

const wireCursorSchema = z.strictObject({
	v: z.literal(CURSOR_VERSION),
	/** 位置: [createdAt, id] */
	a: z.tuple([positionCreatedAtSchema, z.string().min(1)]).optional(),
	/** 途中の画像: [id, owners の要素の数, 調べ終えたエントリの数, 一覧に載せる参照元の状態, 残りの状態, 画像エントリの状態と公開の状態] */
	h: z
		.tuple([
			entryIdSchema,
			z.int().min(0),
			z.int().min(0),
			z
				.string()
				.max(IMAGES_LIST_MAX_OWNERS)
				.regex(/^[udx.]*$/),
			z.enum(["", "u", "d", "x"]),
			z.enum(["p", "d", "s", "t", "m"]),
		])
		.optional(),
});

/** カーソルを文字列にする(ASCII だけの JSON を base64url にしたもの。画面にとっては中身の無い文字列) */
export function encodeImagesListCursor(cursor: ImagesListCursor): string {
	const wire: Record<string, unknown> = { v: CURSOR_VERSION };
	if (cursor.after !== undefined) wire["a"] = [cursor.after.createdAt, cursor.after.id];
	const heavy = cursor.heavy;
	if (heavy !== undefined) {
		wire["h"] = [
			heavy.id,
			heavy.ownerCount,
			heavy.checkedEntries,
			heavy.listed,
			heavy.rest,
			entryStateCode(heavy.entry),
		];
	}
	// ASCII 以外を \uXXXX にして、btoa(Latin-1 だけを受け付ける)に渡せるようにする
	const json = JSON.stringify(wire).replace(
		/[\u007f-\uffff]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** カーソルを読んだ結果。`ok === false` で判別する */
export type DecodeCursorResult =
	| { readonly ok: true; readonly cursor: ImagesListCursor | null }
	| { readonly ok: false; readonly message: string };

/** 画面から受け取ったカーソルを読む。省略されたら先頭から(`cursor: null`) */
export function decodeImagesListCursor(value: string | undefined): DecodeCursorResult {
	if (value === undefined) return { ok: true, cursor: null };
	const invalid = { ok: false, message: "The cursor is not an image list cursor" } as const;
	if (value.length > IMAGES_LIST_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
		return invalid;
	}
	let json: unknown;
	try {
		const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
		json = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)));
	} catch {
		return invalid;
	}
	const parsed = wireCursorSchema.safeParse(json);
	if (parsed.success === false) return invalid;
	const { a, h } = parsed.data;
	if (a === undefined && h === undefined) return invalid;
	const cursor: { after?: ImagesListPosition; heavy?: HeavyImageProgress } = {};
	if (a !== undefined) cursor.after = { createdAt: a[0], id: a[1] };
	if (h !== undefined) {
		cursor.heavy = {
			id: h[0],
			ownerCount: h[1],
			checkedEntries: h[2],
			listed: h[3],
			rest: h[4],
			entry: ENTRY_STATE_BY_CODE[h[5]],
		};
	}
	return { ok: true, cursor };
}

// ---------------------------------------------------------------------------
// 記録の読み方
// ---------------------------------------------------------------------------

/** 参照元の要素のうち、調べるのに要る部分(`locale` は壊れていてもよい) */
const checkableOwnerSchema = z.object({
	collection: slugSchema,
	entryId: entryIdSchema,
	field: slugSchema,
});

/** 応答の項目のうち、記録から取る部分(`owners` 以外) */
const itemBaseSchema = imageRefsRecordSchema.pick({
	bytes: true,
	width: true,
	height: true,
	thumb: true,
	createdAt: true,
});

type ItemBase = z.infer<typeof itemBaseSchema>;

/** 参照元の要素 1 つ(調べられるもの) */
interface OwnerElement {
	/** エントリを表すキー(`collection` と `entryId`) */
	readonly entryKey: string;
	readonly field: string;
	/** 一覧に載せる参照元。載せないなら null(`locale` が壊れている、4 つのキーが同じ要素がもう載っている、上限を超えた) */
	readonly listable: ImageOwner | null;
}

/** 参照元のエントリ 1 件 */
interface OwnerEntryRef {
	readonly key: string;
	readonly collection: string;
	readonly entryId: string;
}

/** 読んだ記録 1 件 */
interface RecordRow {
	readonly id: string;
	/** 位置に使う `createdAt`(文字列でなければ空。位置に使わない) */
	readonly createdAt: string;
	/** 応答に載せられる記録なら、その内容。載せられなければ null */
	readonly image: ImageRow | null;
}

/** 応答に載せられる記録 */
interface ImageRow {
	readonly id: string;
	readonly base: ItemBase;
	/** `owners` の要素の数(壊れた要素を含む。途中の状態が古くなっていないかの確認に使う) */
	readonly ownerCount: number;
	/** 調べられる参照元の要素(記録の順) */
	readonly elements: readonly OwnerElement[];
	/** 参照元のエントリ(記録に初めて現れた順) */
	readonly entries: readonly OwnerEntryRef[];
	/** 一覧に載せる要素の、`elements` の中の位置(先頭から `IMAGES_LIST_MAX_OWNERS` 件まで) */
	readonly listed: readonly number[];
	/** 参照元の全体の件数(一覧に載せる規則で数える。`listed` の件数以上) */
	readonly ownersTotal: number;
	/** 調べられなかった(壊れた)要素の数 */
	readonly brokenOwners: number;
}

function entryKeyOf(collection: string, entryId: string): string {
	return `${collection}\u0000${entryId}`;
}

function ownerIdentity(owner: ImageOwner): string {
	return `${owner.collection}\u0000${owner.entryId}\u0000${owner.locale}\u0000${owner.field}`;
}

/** 記録 1 件を読む。応答に載せられなければ `image` を null にする */
function readRecordRow(id: string, data: unknown): RecordRow {
	const createdAtValue = isRecord(data) ? data["createdAt"] : undefined;
	const createdAt = typeof createdAtValue === "string" ? createdAtValue : "";
	if (!entryIdSchema.safeParse(id).success || !isRecord(data)) {
		return { id, createdAt, image: null };
	}
	const base = itemBaseSchema.safeParse(data);
	const owners = data["owners"];
	if (
		base.success === false ||
		!base.data.thumb.startsWith(WEBP_DATA_URL_PREFIX) ||
		!Array.isArray(owners)
	) {
		return { id, createdAt, image: null };
	}

	const elements: OwnerElement[] = [];
	const entries: OwnerEntryRef[] = [];
	const seenEntries = new Set<string>();
	const seenOwners = new Set<string>();
	const listed: number[] = [];
	let brokenOwners = 0;
	for (const element of owners as readonly unknown[]) {
		const checkable = checkableOwnerSchema.safeParse(element);
		if (checkable.success === false) {
			brokenOwners += 1;
			continue;
		}
		const { collection, entryId, field } = checkable.data;
		const entryKey = entryKeyOf(collection, entryId);
		if (!seenEntries.has(entryKey)) {
			seenEntries.add(entryKey);
			entries.push({ key: entryKey, collection, entryId });
		}
		let listable: ImageOwner | null = null;
		const owner = imageOwnerSchema.safeParse(element);
		if (owner.success === true) {
			// 全体の件数は、上限を超えた分も数える
			const identity = ownerIdentity(owner.data);
			if (!seenOwners.has(identity)) {
				seenOwners.add(identity);
				if (listed.length < IMAGES_LIST_MAX_OWNERS) {
					listable = owner.data;
					listed.push(elements.length);
				}
			}
		}
		elements.push({ entryKey, field, listable });
	}
	return {
		id,
		createdAt,
		image: {
			id,
			base: base.data,
			ownerCount: owners.length,
			elements,
			entries,
			listed,
			ownersTotal: seenOwners.size,
			brokenOwners,
		},
	};
}

// ---------------------------------------------------------------------------
// 1 ページを作る
// ---------------------------------------------------------------------------

/** 一覧の 1 ページの結果 */
export interface ImagesListPage {
	readonly response: ImagesListResponse;
	/** 最悪の見積もりで確保したクエリ数(ルートの固定費と `imageRefs` の読み出しを含む)。予算以下になる */
	readonly reservedQueries: number;
	/** 読んだ参照元のエントリの数 */
	readonly checkedEntries: number;
	/** 参照元の多い画像だけを扱ったか(調べ終えたかは `response.items` で分かる) */
	readonly heavy: boolean;
}

/**
 * 一覧の 1 ページを作る(ルートのハンドラーの本体)。取得の失敗は、そのまま投げる。
 *
 * @param cursor 画面から受け取ったカーソル(`decodeImagesListCursor` で読んだもの)。先頭からなら null
 */
export async function listImagesPage(
	deps: ImagesListDeps,
	cursor: ImagesListCursor | null,
): Promise<ImagesListPage> {
	const after = cursor?.after;
	const fetched = await fetchRows(deps, after);
	const rows = fetched.rows;
	let reserved = LIST_QUERY_COSTS.route + fetched.queries;

	// 参照元の多い画像を、前のリクエストから続けて調べる
	const first = rows[0];
	const pending = cursor?.heavy;
	if (first !== undefined && first.image !== null && pending !== undefined) {
		const progress = resumeProgress(first.image, pending);
		if (progress !== null)
			return judgeHeavy(deps, first, first.image, progress, after, fetched, reserved);
	}

	// ふつうのページ: 画像を 1 枚ずつ、最悪の見積もりが予算に収まるだけ載せる
	const planned: ImageRow[] = [];
	const plannedEntries = new Map<string, OwnerEntryRef>();
	const consumed: RecordRow[] = [];
	const skipped: string[] = [];
	for (const row of rows) {
		if (planned.length >= IMAGES_LIST_MAX_ITEMS) break;
		const image = row.image;
		if (image === null) {
			skipped.push(row.id);
			consumed.push(row);
			continue;
		}
		const newEntries = image.entries.filter((entry) => !plannedEntries.has(entry.key));
		const schemaCost =
			plannedEntries.size === 0 && newEntries.length > 0 ? LIST_QUERY_COSTS.schema : 0;
		const cost =
			LIST_QUERY_COSTS.imageEntry + schemaCost + LIST_QUERY_COSTS.ownerEntry * newEntries.length;
		if (reserved + cost > IMAGES_LIST_QUERY_BUDGET) {
			// 1 枚だけで予算を超える画像は、ページの先頭のときだけ、その画像だけを扱うリクエストで調べる
			if (consumed.length === 0) {
				return judgeHeavy(deps, row, image, null, after, fetched, reserved);
			}
			break;
		}
		reserved += cost;
		for (const entry of newEntries) plannedEntries.set(entry.key, entry);
		planned.push(image);
		consumed.push(row);
	}

	const judged = await judge(
		deps,
		planned.map((image) => ({ image, elements: indexesOf(image.elements) })),
		[...plannedEntries.values()],
		planned.map((image) => image.id),
	);
	const items = planned.map((image) =>
		buildItem(
			image,
			judged.entries.get(image.id) ?? MISSING_ENTRY,
			(index) => judged.statusOf(image, index),
			indexesOf(image.elements),
			"",
		),
	);

	reportSkipped(deps.log, skipped);
	reportBrokenOwners(
		deps.log,
		planned.filter((image) => image.brokenOwners > 0).map((image) => image.id),
	);
	const more = rows.length > consumed.length || fetched.hasMore;
	return {
		response: withCursor({ items }, more ? positionCursor(deps.log, consumed) : undefined),
		reservedQueries: reserved,
		checkedEntries: plannedEntries.size,
		heavy: false,
	};
}

// ---------------------------------------------------------------------------
// 記録の読み出し
// ---------------------------------------------------------------------------

/**
 * 一覧が読む `createdAt` の範囲: 数字で始まる文字列(ISO 8601 の日時は数字で始まる)。
 * SQLite / D1 の比較では、数値は文字列より小さく、NULL はどの範囲にも入らない。そのため、`createdAt` が無い・数値・
 * オブジェクトの記録は読まない(応答に載せられず、位置にも使えないため)。
 */
const CREATED_AT_FLOOR = "0";
const CREATED_AT_CEILING = ":";

interface FetchedRows {
	/** 位置より後の記録(新しい順) */
	readonly rows: readonly RecordRow[];
	/** `rows` のほかにも記録があるか */
	readonly hasMore: boolean;
	/** 使ったクエリ数 */
	readonly queries: number;
}

/**
 * 位置より後の記録を読む。`createdAt` が位置と同じ記録は ID の大きい順に並ぶので、位置の ID 以上のもの
 * (前のページまでに読んだもの)を除く。除いた結果が空で、まだ記録があるとき(同じ時刻の記録が 1 ページより多い)は、
 * 上限の件数で読み直す。それでも空なら、同じ時刻の残りを飛ばして進む(ログに出す)。
 */
async function fetchRows(
	deps: ImagesListDeps,
	after: ImagesListPosition | undefined,
): Promise<FetchedRows> {
	const limit = IMAGES_LIST_MAX_ITEMS + 1; // 位置の記録そのもの(残っていれば、除かれる)の分を足す
	if (after === undefined) {
		const result = await queryRows(deps, { gte: CREATED_AT_FLOOR, lt: CREATED_AT_CEILING }, limit);
		return { rows: result.items.map(toRow), hasMore: result.hasMore, queries: 1 };
	}
	const range = { gte: CREATED_AT_FLOOR, lte: after.createdAt };
	let queries = 1;
	let result = await queryRows(deps, range, limit);
	let rows = dropRead(result.items.map(toRow), after);
	if (rows.length === 0 && result.hasMore) {
		queries += 1;
		result = await queryRows(deps, range, STORAGE_QUERY_MAX_LIMIT);
		rows = dropRead(result.items.map(toRow), after);
		if (rows.length === 0 && result.hasMore) {
			deps.log.warn(
				`Image list: more than ${STORAGE_QUERY_MAX_LIMIT} imageRefs records share the createdAt ${after.createdAt}; the rest of them are skipped`,
			);
			queries += 1;
			result = await queryRows(deps, { gte: CREATED_AT_FLOOR, lt: after.createdAt }, limit);
			rows = result.items.map(toRow);
		}
	}
	return { rows, hasMore: result.hasMore, queries };
}

function queryRows(
	deps: ImagesListDeps,
	range: CreatedAtRange,
	limit: number,
): Promise<ImageRefsQueryResult> {
	return deps.imageRefs.query({
		where: { createdAt: range },
		orderBy: { createdAt: "desc" },
		limit,
	});
}

function toRow(item: ImageRefsQueryResult["items"][number]): RecordRow {
	return readRecordRow(item.id, item.data);
}

/** 位置と同じ `createdAt` で、ID が位置の ID 以上の記録(前のページまでに読んだもの)を除く */
function dropRead(rows: readonly RecordRow[], after: ImagesListPosition): RecordRow[] {
	return rows.filter((row) => row.createdAt !== after.createdAt || row.id < after.id);
}

/**
 * 最後に読んだ記録の位置のカーソル。位置に使えない記録(`createdAt` が文字列でない、長すぎてカーソルに入らない)は
 * 飛ばして、その前の記録を使う(飛ばした記録は一覧に載せられないものなので、次のページでまた飛ばす)。
 * 位置に使える記録が 1 件も無ければ、ページ送りを止める(ログに出す)。
 */
function positionCursor(log: ImagesListLog, consumed: readonly RecordRow[]): string | undefined {
	for (let index = consumed.length - 1; index >= 0; index -= 1) {
		const row = consumed[index];
		if (row === undefined || row.createdAt === "") continue;
		const cursor = encodeImagesListCursor({ after: { createdAt: row.createdAt, id: row.id } });
		if (cursor.length <= IMAGES_LIST_CURSOR_MAX_LENGTH) return cursor;
	}
	log.warn("Image list: paging stopped because no record on this page can be used as a position", {
		...listIds(consumed.map((row) => row.id)),
	});
	return undefined;
}

// ---------------------------------------------------------------------------
// 参照元の多い画像(リクエストをまたいで調べる)
// ---------------------------------------------------------------------------

/** 途中の状態が、今の記録にそのまま使えるか。使えなければ null(最初から調べ直す) */
function resumeProgress(image: ImageRow, pending: HeavyImageProgress): HeavyImageProgress | null {
	if (
		pending.id !== image.id ||
		pending.ownerCount !== image.ownerCount ||
		pending.checkedEntries >= image.entries.length ||
		pending.listed.length !== image.listed.length
	) {
		return null;
	}
	return pending;
}

/**
 * 参照元の多い画像を、このリクエストの予算の分だけ調べる。調べ終えたら(または、一覧に載せる参照元の状態が
 * すべて分かり、どれかが使用中なら)項目を返す。終わらなければ、途中の状態をカーソルに入れて `items` を空で返す。
 *
 * @param progress 前のリクエストまでの状態。初めてなら null(画像エントリの状態もこのリクエストで調べる)
 */
async function judgeHeavy(
	deps: ImagesListDeps,
	row: RecordRow,
	image: ImageRow,
	progress: HeavyImageProgress | null,
	after: ImagesListPosition | undefined,
	fetched: FetchedRows,
	reservedBefore: number,
): Promise<ImagesListPage> {
	const checkedBefore = progress === null ? 0 : progress.checkedEntries;
	let reserved =
		reservedBefore +
		LIST_QUERY_COSTS.schema +
		(progress === null ? LIST_QUERY_COSTS.imageEntry : 0);
	const room = Math.floor((IMAGES_LIST_QUERY_BUDGET - reserved) / LIST_QUERY_COSTS.ownerEntry);
	const batch = image.entries.slice(checkedBefore, checkedBefore + Math.max(1, room));
	reserved += LIST_QUERY_COSTS.ownerEntry * batch.length;

	const batchKeys = new Set(batch.map((entry) => entry.key));
	const elements = indexesOf(image.elements).filter((index) => {
		const element = image.elements[index];
		return element !== undefined && batchKeys.has(element.entryKey);
	});
	const judged = await judge(
		deps,
		[{ image, elements }],
		batch,
		progress === null ? [image.id] : [],
	);

	// 調べた要素の状態を、一覧に載せる要素と、残りのまとめに振り分ける
	const listedCodes = (progress === null ? ".".repeat(image.listed.length) : progress.listed).split(
		"",
	);
	let rest: OwnerStatusCode | "" = progress === null ? "" : progress.rest;
	for (const index of elements) {
		const code = STATUS_CODES[judged.statusOf(image, index)];
		const position = image.listed.indexOf(index);
		if (position >= 0) listedCodes[position] = code;
		else rest = strongerCode(rest, code);
	}
	const next: HeavyImageProgress = {
		id: image.id,
		ownerCount: image.ownerCount,
		checkedEntries: checkedBefore + batch.length,
		listed: listedCodes.join(""),
		rest,
		entry: progress === null ? (judged.entries.get(image.id) ?? MISSING_ENTRY) : progress.entry,
	};

	const allListedKnown = !next.listed.includes(".");
	const done =
		next.checkedEntries >= image.entries.length ||
		(allListedKnown && (next.listed.includes("u") || next.rest === "u"));
	if (!done) {
		return {
			response: { items: [], nextCursor: encodeImagesListCursor({ after, heavy: next }) },
			reservedQueries: reserved,
			checkedEntries: batch.length,
			heavy: true,
		};
	}

	reportBrokenOwners(deps.log, image.brokenOwners > 0 ? [image.id] : []);
	const item = buildItem(
		image,
		next.entry,
		(index) => {
			const code = next.listed[image.listed.indexOf(index)];
			return code === "u" || code === "d" || code === "x" ? STATUS_BY_CODE[code] : "detached";
		},
		[],
		next.rest,
	);
	const more = fetched.rows.length > 1 || fetched.hasMore;
	return {
		response: withCursor({ items: [item] }, more ? positionCursor(deps.log, [row]) : undefined),
		reservedQueries: reserved,
		checkedEntries: batch.length,
		heavy: true,
	};
}

/** `usage` を決める順(`imageUsageSchema` の説明と同じ) */
const USAGE_PRIORITY: readonly OwnerStatus[] = ["in_use", "owner_deleted", "detached"];

function strongerCode(current: OwnerStatusCode | "", code: OwnerStatusCode): OwnerStatusCode {
	if (current === "") return code;
	const rank = (value: OwnerStatusCode) => USAGE_PRIORITY.indexOf(STATUS_BY_CODE[value]);
	return rank(code) < rank(current) ? code : current;
}

// ---------------------------------------------------------------------------
// 判定(並行に読む)
// ---------------------------------------------------------------------------

/** 調べる画像と、その画像の中で状態を求める要素 */
interface JudgeTarget {
	readonly image: ImageRow;
	readonly elements: readonly number[];
}

type EntryResult =
	| { readonly deleted: true }
	| {
			readonly deleted: false;
			readonly live: Readonly<Record<string, unknown>>;
			readonly draft: Readonly<Record<string, unknown>> | null;
	  };

interface Judged {
	/** 画像エントリの状態と公開の状態(画像 ID ごと) */
	readonly entries: ReadonlyMap<string, ImageEntryState>;
	statusOf(image: ImageRow, elementIndex: number): OwnerStatus;
}

/**
 * 画像エントリの状態と、参照元のエントリを並行に読む。
 * @param entries 読む参照元のエントリ(重複なし)
 * @param statusIds 状態を調べる画像の ID
 */
async function judge(
	deps: ImagesListDeps,
	targets: readonly JudgeTarget[],
	entries: readonly OwnerEntryRef[],
	statusIds: readonly string[],
): Promise<Judged> {
	// エントリごとに、それを参照元に持つ (画像, フィールド) の組。列の値だけで全部見つかれば、下書きを読まない
	const wanted = new Map<string, { imageId: string; field: string }[]>();
	for (const { image, elements } of targets) {
		for (const index of elements) {
			const element = image.elements[index];
			if (element === undefined) continue;
			const pairs = wanted.get(element.entryKey) ?? [];
			pairs.push({ imageId: image.id, field: element.field });
			wanted.set(element.entryKey, pairs);
		}
	}

	let collections: Promise<ReadonlySet<string>> | undefined;
	const existingCollections = (): Promise<ReadonlySet<string>> => {
		collections ??= deps.schema
			.listCollections()
			.then((list) => new Set(list.map((collection) => collection.slug)));
		return collections;
	};

	const [states, results] = await Promise.all([
		Promise.all(statusIds.map(async (id) => [id, await readEntryState(deps.content, id)] as const)),
		Promise.all(
			entries.map(
				async (entry) =>
					[
						entry.key,
						await readOwnerEntry(
							deps.content,
							entry,
							wanted.get(entry.key) ?? [],
							existingCollections,
						),
					] as const,
			),
		),
	]);
	const entryResults = new Map<string, EntryResult>(results);
	return {
		entries: new Map(states),
		statusOf(image, elementIndex) {
			const element = image.elements[elementIndex];
			const result = element === undefined ? undefined : entryResults.get(element.entryKey);
			if (element === undefined || result === undefined) {
				throw new Error(`The owner entry of image ${image.id} was not read`);
			}
			return ownerStatus(result, element.field, image.id);
		},
	};
}

/**
 * 画像エントリの状態と公開の状態。`getTrashedVersioned` は `get` が null のときだけ呼ぶ。
 * 公開の状態は `get` の `status` から決める(追加のクエリなし)。
 */
async function readEntryState(content: JudgeContentAccess, id: string): Promise<ImageEntryState> {
	const item = await content.get(IMAGE_COLLECTION, id);
	if (item !== null) {
		return { entryStatus: "active", entryPublication: publicationOf(item.status) };
	}
	const trashed = await content.getTrashedVersioned(IMAGE_COLLECTION, id);
	return trashed === null || trashed === undefined ? MISSING_ENTRY : ENTRY_STATE_BY_CODE.t;
}

/**
 * EmDash の `status` を公開の状態にする。0.39.1 の値は `draft` / `published` / `scheduled`
 * (`core/src/api/schemas/content.ts`)。サイトに出るのは `published` だけ(`core/src/loader.ts` の既定の取得)なので、
 * 知らない値は `draft`(サイトに出ない)にする。
 */
function publicationOf(status: unknown): ImageEntryPublication {
	return status === "published" || status === "scheduled" ? status : "draft";
}

/** 参照元のエントリを読む。下書きは、列の値で見つからない組があるときだけ読む */
async function readOwnerEntry(
	content: JudgeContentAccess,
	entry: OwnerEntryRef,
	pairs: readonly { imageId: string; field: string }[],
	existingCollections: () => Promise<ReadonlySet<string>>,
): Promise<EntryResult> {
	let item: OwnerEntryLike | null;
	try {
		item = await content.get(entry.collection, entry.entryId);
	} catch (error) {
		// コレクションが消されていると、テーブルが無いので例外になる。コレクションがあるなら、データベースの失敗なので投げる
		if ((await existingCollections()).has(entry.collection)) throw error;
		return { deleted: true };
	}
	if (item === null) return { deleted: true };
	const live = item.data;
	const revisionId = item.draftRevisionId;
	const needsDraft = pairs.some(
		(pair) => !referencedIds(fieldValue(live, pair.field)).includes(pair.imageId),
	);
	if (typeof revisionId !== "string" || revisionId === "" || !needsDraft) {
		return { deleted: false, live, draft: null };
	}
	const revision = await content.getRevision(entry.collection, entry.entryId, revisionId);
	return { deleted: false, live, draft: revision === null ? null : revision.data };
}

function ownerStatus(result: EntryResult, field: string, imageId: string): OwnerStatus {
	if (result.deleted === true) return "owner_deleted";
	if (referencedIds(fieldValue(result.live, field)).includes(imageId)) return "in_use";
	if (result.draft !== null && referencedIds(fieldValue(result.draft, field)).includes(imageId)) {
		return "in_use";
	}
	return "detached";
}

/** フィールドの値から参照している画像 ID を読む(T20 の記録と同じ規則)。単一画像かギャラリーかは値の形で決める */
function referencedIds(value: unknown): string[] {
	const kind: WidgetKind = Array.isArray(value) ? "gallery" : "image";
	return readReferencedImageIds(value, kind);
}

function fieldValue(data: Readonly<Record<string, unknown>>, field: string): unknown {
	return Object.hasOwn(data, field) ? data[field] : undefined;
}

// ---------------------------------------------------------------------------
// 項目
// ---------------------------------------------------------------------------

/**
 * 応答の項目を作る。
 * @param statusOf 要素の状態
 * @param aggregateIndexes `usage` を決めるのに使う要素(一覧に載せる要素は必ず使う)
 * @param rest 一覧に載せない要素の状態のまとめ(参照元の多い画像)
 */
function buildItem(
	image: ImageRow,
	entry: ImageEntryState,
	statusOf: (elementIndex: number) => OwnerStatus,
	aggregateIndexes: readonly number[],
	rest: OwnerStatusCode | "",
): ImageListItem {
	const owners: ImageListOwner[] = [];
	for (const index of image.listed) {
		const element = image.elements[index];
		if (element === undefined || element.listable === null) continue;
		owners.push({ ...element.listable, status: statusOf(index) });
	}
	const statuses = new Set<OwnerStatus>(owners.map((owner) => owner.status));
	for (const index of aggregateIndexes) statuses.add(statusOf(index));
	if (rest !== "") statuses.add(STATUS_BY_CODE[rest]);
	return {
		id: image.id,
		thumb: image.base.thumb,
		width: image.base.width,
		height: image.base.height,
		bytes: image.base.bytes,
		createdAt: image.base.createdAt,
		entryStatus: entry.entryStatus,
		entryPublication: entry.entryPublication,
		usage: usageOf(image, statuses),
		owners,
		ownersTotal: image.ownersTotal,
	};
}

function usageOf(image: ImageRow, statuses: ReadonlySet<OwnerStatus>): ImageUsage {
	if (image.elements.length === 0) return "no_owner";
	for (const status of USAGE_PRIORITY) {
		if (statuses.has(status)) return status;
	}
	return "no_owner";
}

function indexesOf(elements: readonly unknown[]): number[] {
	return elements.map((_, index) => index);
}

function withCursor(
	response: { items: ImageListItem[] },
	nextCursor: string | undefined,
): ImagesListResponse {
	return nextCursor === undefined ? response : { ...response, nextCursor };
}

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

function reportSkipped(log: ImagesListLog, ids: readonly string[]): void {
	if (ids.length === 0) return;
	log.warn(
		"Image list: skipped imageRefs records that cannot be listed (invalid ID, thumbnail, size, createdAt or owners)",
		listIds(ids),
	);
}

function reportBrokenOwners(log: ImagesListLog, ids: readonly string[]): void {
	if (ids.length === 0) return;
	log.warn(
		"Image list: ignored owners that are not { collection, entryId, field } in imageRefs records",
		listIds(ids),
	);
}

function listIds(ids: readonly string[]): { ids: string[]; count: number } {
	return { ids: ids.slice(0, MAX_LOGGED_IDS), count: ids.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
