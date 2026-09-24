/**
 * コンテンツ一覧のサムネイル列(仕様書 11.4)。
 *
 * - EmDash 0.39.1 の trusted プラグイン向けの `contentListColumns` の要素(`thumbnailColumn`)と、その描画の部品。
 *   登録は T30(`src/admin.tsx`)が行う。使い方は tasks/T24-list-column.md の「結果」。
 * - 列を出すコレクションと、表示するフィールドは、管理画面のマニフェスト(`GET /_emdash/api/manifest`)で決める。
 *   単一画像のフィールドがあればスキーマ上で最初のもの、なければ最初のギャラリー(1 枚目と「+N」)を表示する。
 * - `collections` は同期関数で、一覧の画面が列を選ぶときに呼ぶ(`references/emdash/packages/admin/src/components/ContentList.tsx:382-385`
 *   の `useMemo`。コレクション・利用者のロールなどが変わったときだけ呼び直される)。マニフェストを読み込み終えるまでは
 *   `true` を返し(列が出ないまま残るのを避ける)、プラグインのフィールドが無いと分かったコレクションでは、セルが何も描かない。
 *   管理画面の入口を読み込んだときに `preloadThumbnailColumn()` を呼んでおくと、最初に開いた一覧から正しく判定できる。
 * - サムネイルは、そのページに表示中の行(`visibleItems`)の分を、1 回の要求(T14 の `fetchThumbnails`)でまとめて取得する。
 *   セルは行ごとに描画されるので、画像 ID ごとの覚え書き(`requestThumbnails`)で要求を 1 つにまとめる。
 * - 文言は日本語と英語(`<html lang>` で切り替える)。見た目は管理画面の CSS にあるクラスだけで作る。
 */

import type {
	ContentItem,
	ContentListColumnCellContext,
	ContentListColumnExtension,
} from "@emdash-cms/admin";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { fetchThumbnails } from "../client/api";
import { useErrorMessage } from "../client/error-messages";
import { defineMessages, useMessages } from "../client/i18n";
import type { WidgetKind } from "../shared/constants";
import { Base64ImageError } from "../shared/errors";
import { getWidgetKind } from "../shared/options";
import { isBase64ImageGallery, isBase64ImageRef } from "../shared/schema";
import type { Base64ImageRef, Thumbnail, ThumbnailItem } from "../shared/types";
import { WarningIcon } from "./parts/icons";

// ---------------------------------------------------------------------------
// 表示するフィールドと、行の値
// ---------------------------------------------------------------------------

/** 列に表示するフィールド(コレクションごとに 1 つ) */
export interface ThumbnailField {
	readonly slug: string;
	readonly kind: WidgetKind;
}

/**
 * コレクションのフィールド(マニフェストの `collections[slug].fields`。キーの順はスキーマの順)から、列に表示するフィールドを選ぶ。
 * 単一画像(`base64-image:image`)があれば最初のもの、なければ最初のギャラリー(`base64-image:gallery`)。どちらも無ければ null。
 *
 * マニフェストはフィールドの型を `kind` で表す(`json` 型は `kind: "json"`。
 * `references/emdash/packages/core/src/api/handlers/manifest.ts:37-54`)。サーバーの `getFieldWidgetKind` と同じく、
 * `json` のフィールドだけを対象にする。
 */
export function selectThumbnailField(fields: unknown): ThumbnailField | null {
	if (!isRecord(fields)) return null;
	let gallery: ThumbnailField | null = null;
	for (const [slug, field] of Object.entries(fields)) {
		if (!isRecord(field) || field["kind"] !== "json") continue;
		const kind = getWidgetKind(field["widget"]);
		if (kind === "image") return { slug, kind };
		if (kind === "gallery" && gallery === null) gallery = { slug, kind };
	}
	return gallery;
}

/** 行に表示する画像 */
export type RowImage =
	/** 未設定(値が無い、ギャラリーが空) */
	| { readonly status: "none" }
	/** 参照の形でない値(seed や手での書き換え。保存 hook を通っていない) */
	| { readonly status: "invalid" }
	/** 表示する参照。`more` はギャラリーの残りの枚数(単一画像は 0) */
	| { readonly status: "image"; readonly ref: Base64ImageRef; readonly more: number };

const ROW_NONE: RowImage = { status: "none" };
const ROW_INVALID: RowImage = { status: "invalid" };

/** 行の値(`item.data`)から、表示する画像を取り出す */
export function getRowImage(
	data: Readonly<Record<string, unknown>>,
	field: ThumbnailField,
): RowImage {
	const value = data[field.slug];
	if (value === null || value === undefined) return ROW_NONE;
	if (field.kind === "image") {
		return isBase64ImageRef(value) ? { status: "image", ref: value, more: 0 } : ROW_INVALID;
	}
	if (!isBase64ImageGallery(value)) return ROW_INVALID;
	const first = value[0];
	return first === undefined ? ROW_NONE : { status: "image", ref: first, more: value.length - 1 };
}

/** 表示中の行の画像 ID。重複を除き、行の順に並べる */
export function collectThumbnailIds(
	items: readonly Pick<ContentItem, "data">[],
	field: ThumbnailField,
): string[] {
	const ids = new Set<string>();
	for (const item of items) {
		const row = getRowImage(item.data, field);
		if (row.status === "image") ids.add(row.ref.id);
	}
	return [...ids];
}

// ---------------------------------------------------------------------------
// 覚え書きの世代
// ---------------------------------------------------------------------------

/** `clearThumbnailColumnCache` で進める。消す前に始めた要求の結果は、届いても覚えない */
let cacheGeneration = 0;

// ---------------------------------------------------------------------------
// マニフェスト(コレクションごとの表示するフィールド)
// ---------------------------------------------------------------------------

/** マニフェストを読み直すまでの時間(ms)。管理画面の TanStack Query の `staleTime`(1 分)と同じ */
export const MANIFEST_STALE_MS = 60_000;

/** コレクションの表示するフィールドを引いた結果。`field` が null なら、このプラグインのフィールドが無い */
export type FieldLookup =
	| { readonly status: "loading" }
	| { readonly status: "failed"; readonly error: unknown }
	| { readonly status: "ready"; readonly field: ThumbnailField | null };

const LOOKUP_LOADING: FieldLookup = { status: "loading" };
const LOOKUP_NO_FIELD: FieldLookup = { status: "ready", field: null };

interface ManifestCache {
	/** コレクションの slug ごとの結果。まだ読み込めていなければ null */
	readonly fields: ReadonlyMap<string, FieldLookup> | null;
	/** `fields` を読み込んだ時刻(`Date.now()`) */
	readonly loadedAt: number;
	/** 読み込み中か */
	readonly loading: boolean;
	/** `fields` が無いまま読み込みに失敗したときの結果 */
	readonly failure: FieldLookup | null;
}

const EMPTY_MANIFEST_CACHE: ManifestCache = {
	fields: null,
	loadedAt: 0,
	loading: false,
	failure: null,
};

let manifestCache = EMPTY_MANIFEST_CACHE;
const manifestListeners = new Set<() => void>();

function subscribeManifest(listener: () => void): () => void {
	manifestListeners.add(listener);
	return () => {
		manifestListeners.delete(listener);
	};
}

function notifyManifest(): void {
	for (const listener of manifestListeners) listener();
}

/** マニフェストから、コレクションごとの表示するフィールドを作る */
function buildFieldLookups(manifest: unknown): Map<string, FieldLookup> {
	const lookups = new Map<string, FieldLookup>();
	const collections = isRecord(manifest) ? manifest["collections"] : undefined;
	if (!isRecord(collections)) return lookups;
	for (const [slug, collection] of Object.entries(collections)) {
		const field = selectThumbnailField(isRecord(collection) ? collection["fields"] : undefined);
		lookups.set(slug, field === null ? LOOKUP_NO_FIELD : { status: "ready", field });
	}
	return lookups;
}

/**
 * マニフェストを(まだ無いか古ければ)読み込む。読み込み中なら何もしない。
 * 失敗したら、次に呼ばれたときに読み直す。古い結果があれば、読み直している間も使う。
 *
 * 一覧の描画中(`collections` の判定)にも呼ばれるので、ここでは購読している部品に知らせない
 * (知らせると、描画中に別の部品を更新することになる)。知らせるのは、結果が届いたときだけ。
 * 読み直しで前の失敗を消した変化は、セルの `useSyncExternalStore` が描画の確定後に値を読み直して拾う。
 */
function ensureManifest(): void {
	const cache = manifestCache;
	if (cache.loading) return;
	if (cache.fields !== null && Date.now() - cache.loadedAt < MANIFEST_STALE_MS) return;
	// 前に失敗していたら、読み直している間は読み込み中にする
	manifestCache = { ...cache, loading: true, failure: null };
	void loadManifest(cacheGeneration);
}

/** 管理画面のマニフェスト(`references/emdash/packages/core/src/astro/routes/api/manifest.ts`) */
const MANIFEST_URL = "/_emdash/api/manifest";

/**
 * マニフェストを取得する。EmDash がプラグインの管理画面向けに用意した `emdash/plugin-utils` の関数で送る
 * (CSRF のヘッダーを付け、応答の包みを開く。`references/emdash/packages/core/src/plugin-utils.ts:27-31`・`:62-71`)。
 *
 * `@emdash-cms/admin` の `fetchManifest` は使わない。応答を受け取ったあとで管理画面の Lingui(`i18n._`)を呼ぶので、
 * 管理画面が Lingui を有効にする前(入口の読み込み時)に呼ぶと失敗する
 * (「Attempted to call a translation function without setting a locale」。docs/emdash-admin-content-list-columns.md)。
 * `emdash/plugin-utils` の関数は Lingui を使わない。
 */
async function requestManifest(): Promise<unknown> {
	return parseApiResponse<unknown>(
		await apiFetch(MANIFEST_URL),
		"Failed to fetch the admin manifest",
	);
}

async function loadManifest(generation: number): Promise<void> {
	let manifest: unknown;
	try {
		manifest = await requestManifest();
	} catch (error) {
		if (generation !== cacheGeneration) return;
		const current = manifestCache;
		manifestCache = {
			...current,
			loading: false,
			failure: current.fields === null ? { status: "failed", error } : null,
		};
		notifyManifest();
		return;
	}
	if (generation !== cacheGeneration) return;
	manifestCache = {
		fields: buildFieldLookups(manifest),
		loadedAt: Date.now(),
		loading: false,
		failure: null,
	};
	notifyManifest();
}

/** コレクションの表示するフィールド(読み込んでいなければ `loading`、読み込めなければ `failed`) */
function lookupThumbnailField(collection: string): FieldLookup {
	const cache = manifestCache;
	if (cache.fields === null) return cache.failure ?? LOOKUP_LOADING;
	return cache.fields.get(collection) ?? LOOKUP_NO_FIELD;
}

/**
 * セルの中で、コレクションの表示するフィールドを読む。マニフェストを読み込むと再描画する。
 * セルはコレクションごとに作り直される(一覧の画面がセルの `key` にコレクションを含める。
 * `references/emdash/packages/admin/src/components/ContentList.tsx:1307`)ので、読み込みの確認は作られたときだけ行う。
 */
function useThumbnailField(collection: string): FieldLookup {
	useEffect(() => {
		ensureManifest();
	}, []);
	return useSyncExternalStore(subscribeManifest, () => lookupThumbnailField(collection));
}

/**
 * 列を出すコレクションか(列の `collections` に渡す同期関数)。
 * マニフェストを読み込み終えるまで(と、読み込めないとき)は `true`。呼ばれたときに、読み込みを始める。
 */
export function showsThumbnailColumn(collection: string): boolean {
	ensureManifest();
	const lookup = lookupThumbnailField(collection);
	return lookup.status !== "ready" || lookup.field !== null;
}

/**
 * マニフェストの読み込みを先に始める。管理画面の入口(`src/admin.tsx`)の読み込み時に呼ぶ。
 *
 * 呼ばないと、ダッシュボードなどから最初に開いた一覧で、マニフェストを読み込む前に `collections` が呼ばれ、
 * このプラグインのフィールドが無いコレクションにも、空の列が出る(一覧の画面は、コレクションが変わるまで列を選び直さない)。
 * 失敗しても(ログイン画面の 401 など)、次に `collections` が呼ばれたときに読み直す。
 */
export function preloadThumbnailColumn(): void {
	ensureManifest();
}

// ---------------------------------------------------------------------------
// サムネイル(画像 ID ごとの覚え書き)
// ---------------------------------------------------------------------------

/** 取得したサムネイルを取り直すまでの時間(ms)。一覧のデータ(管理画面の `staleTime`)と同じ 1 分 */
export const THUMBNAIL_STALE_MS = 60_000;

/** 覚えておくサムネイルの最大数。1 件は最大 8,000 バイトなので、最大約 1.6MB */
export const MAX_CACHED_THUMBNAILS = 200;

/** 画像 1 枚の取得の状態 */
export type ThumbnailEntry =
	| { readonly status: "loading" }
	| { readonly status: "failed"; readonly error: unknown }
	/** `thumbnail` が null なら、`imageRefs` に記録が無い(完全に削除された・記録が作られていない) */
	| { readonly status: "ready"; readonly thumbnail: Thumbnail | null; readonly fetchedAt: number };

const ENTRY_LOADING: ThumbnailEntry = { status: "loading" };

/** 取得を終えた画像(`ready` / `failed`)。Map の順は、表示に使った順(古いものから捨てる) */
const thumbnailEntries = new Map<string, ThumbnailEntry>();
/** 取得中の画像 ID */
const thumbnailsInFlight = new Set<string>();
const thumbnailListeners = new Set<() => void>();

function subscribeThumbnails(listener: () => void): () => void {
	thumbnailListeners.add(listener);
	return () => {
		thumbnailListeners.delete(listener);
	};
}

function notifyThumbnails(): void {
	for (const listener of thumbnailListeners) listener();
}

function getThumbnailEntry(id: string): ThumbnailEntry {
	return thumbnailEntries.get(id) ?? ENTRY_LOADING;
}

/** 取得中でなく、まだ無いか・失敗したか・古い画像か */
function needsFetch(id: string, now: number): boolean {
	if (thumbnailsInFlight.has(id)) return false;
	const entry = thumbnailEntries.get(id);
	if (entry === undefined || entry.status !== "ready") return true;
	return now - entry.fetchedAt >= THUMBNAIL_STALE_MS;
}

/** 古いもの(取得中でないもの)から捨てて、`MAX_CACHED_THUMBNAILS` 件に収める */
function evictThumbnails(): void {
	for (const id of thumbnailEntries.keys()) {
		if (thumbnailEntries.size <= MAX_CACHED_THUMBNAILS) return;
		if (!thumbnailsInFlight.has(id)) thumbnailEntries.delete(id);
	}
}

function unexpectedResponse(id: string): Base64ImageError {
	return new Base64ImageError(
		"UNEXPECTED_RESPONSE",
		`The thumbnails response has no item for ${id}`,
	);
}

/**
 * 表示中の画像のサムネイルを取得する。まだ無いもの・前に失敗したもの・古いものだけを、1 回の要求にまとめる
 * (取得中のものは送らない。同じページの各セルが呼んでも、要求は 1 回)。古いサムネイルは、取り直している間も表示する。
 */
export function requestThumbnails(ids: readonly string[]): void {
	const now = Date.now();
	const missing = ids.filter((id) => needsFetch(id, now));
	// 表示中の画像を末尾(新しい側)に移し、捨てる対象から外す
	for (const id of ids) {
		const entry = thumbnailEntries.get(id);
		if (entry === undefined) continue;
		thumbnailEntries.delete(id);
		thumbnailEntries.set(id, entry);
	}
	if (missing.length === 0) return;
	for (const id of missing) {
		thumbnailsInFlight.add(id);
		// 失敗した画像は、取り直している間は読み込み中にする
		if (thumbnailEntries.get(id)?.status === "failed") thumbnailEntries.delete(id);
	}
	notifyThumbnails();
	void loadThumbnails(missing, cacheGeneration);
}

async function loadThumbnails(ids: readonly string[], generation: number): Promise<void> {
	let items: ThumbnailItem[];
	try {
		({ items } = await fetchThumbnails(ids));
	} catch (error) {
		if (generation !== cacheGeneration) return;
		for (const id of ids) {
			thumbnailsInFlight.delete(id);
			thumbnailEntries.set(id, { status: "failed", error });
		}
		evictThumbnails();
		notifyThumbnails();
		return;
	}
	if (generation !== cacheGeneration) return;
	const fetchedAt = Date.now();
	const received = new Map(items.map((item) => [item.id, item.thumbnail]));
	for (const id of ids) {
		thumbnailsInFlight.delete(id);
		const thumbnail = received.get(id);
		thumbnailEntries.set(
			id,
			thumbnail === undefined
				? { status: "failed", error: unexpectedResponse(id) }
				: { status: "ready", thumbnail, fetchedAt },
		);
	}
	evictThumbnails();
	notifyThumbnails();
}

function useThumbnailEntry(id: string | undefined): ThumbnailEntry | undefined {
	return useSyncExternalStore(subscribeThumbnails, () =>
		id === undefined ? undefined : getThumbnailEntry(id),
	);
}

/**
 * 覚えているマニフェストとサムネイルを消す(次に表示するときに取り直す)。消す前に始めた要求の結果は、届いても覚えない。
 * 単体テストで、テストごとに状態を戻すのにも使う。
 */
export function clearThumbnailColumnCache(): void {
	cacheGeneration += 1;
	manifestCache = EMPTY_MANIFEST_CACHE;
	thumbnailEntries.clear();
	thumbnailsInFlight.clear();
	notifyManifest();
	notifyThumbnails();
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

const messages = defineMessages({
	ja: {
		none: "画像なし",
		loading: "サムネイルを読み込み中",
		loadFailed: "サムネイルを読み込めませんでした",
		loadFailedWithReason: (reason: string) => `サムネイルを読み込めませんでした。${reason}`,
		notFound: "画像が見つかりません(完全に削除されたか、記録がありません)",
		invalid: "画像の値が正しくありません",
		image: "画像",
		more: (count: number) => `ほか ${count} 枚`,
	},
	en: {
		none: "No image",
		loading: "Loading thumbnail",
		loadFailed: "Could not load the thumbnail",
		loadFailedWithReason: (reason) => `Could not load the thumbnail. ${reason}`,
		notFound: "Image not found (permanently deleted or not recorded)",
		invalid: "The image value is invalid",
		image: "Image",
		more: (count) => `${count} more`,
	},
});

// 管理画面の CSS にあるクラスだけを使う(tests/admin/ThumbnailColumn.test.tsx で確かめる)。
// 枠と画像は、EmDash のメディアライブラリの一覧のサムネイルと同じ
// (`references/emdash/packages/admin/src/components/MediaLibrary.tsx:1763-1775`)。
const FRAME_CLASS = "h-10 w-10 shrink-0 overflow-hidden rounded";
const IMAGE_CLASS = "emdash-media-transparency-grid h-full w-full object-cover";
const PLACEHOLDER_CLASS = "flex h-full w-full items-center justify-center bg-kumo-tint";

/** サムネイルの枠(40px の正方形) */
function Frame({ title, children }: { readonly title?: string; readonly children: ReactNode }) {
	return (
		<div className={FRAME_CLASS} title={title}>
			{children}
		</div>
	);
}

/** 読み込み中の枠。文字は読み上げ用 */
function LoadingFrame({ label }: { readonly label: string }) {
	return (
		<Frame>
			<div className={PLACEHOLDER_CLASS} />
			<span className="sr-only">{label}</span>
		</Frame>
	);
}

/** 警告アイコンの枠。文字は読み上げ用で、マウスを重ねたときにも出す(`title` を省くと `label`) */
function WarningFrame({ label, title }: { readonly label: string; readonly title?: string }) {
	return (
		<Frame title={title ?? label}>
			<div className={`${PLACEHOLDER_CLASS} text-kumo-warning`}>
				<WarningIcon size={20} />
			</div>
			<span className="sr-only">{label}</span>
		</Frame>
	);
}

/** 1 行のサムネイル。`entry` は `reference` の画像の取得の状態 */
function RowThumbnail({
	entry,
	reference,
}: {
	readonly entry: ThumbnailEntry;
	readonly reference: Base64ImageRef;
}) {
	const t = useMessages(messages);
	const errorText = useErrorMessage(entry.status === "failed" ? entry.error : undefined);
	if (entry.status === "loading") return <LoadingFrame label={t.loading} />;
	if (entry.status === "failed") {
		return (
			<WarningFrame
				label={t.loadFailed}
				{...(errorText === undefined ? {} : { title: t.loadFailedWithReason(errorText) })}
			/>
		);
	}
	if (entry.thumbnail === null) return <WarningFrame label={t.notFound} />;
	// 代替テキストが空(装飾画像)の画像も、行に画像があることは伝える
	const alt = reference.alt.trim() === "" ? t.image : reference.alt;
	return (
		<Frame>
			<img src={entry.thumbnail.thumb} alt={alt} decoding="async" className={IMAGE_CLASS} />
		</Frame>
	);
}

/** 列のセル。`visibleItems` の分のサムネイルを 1 回の要求で取得し、この行の画像を表示する */
export function ThumbnailCell({ collection, item, visibleItems }: ContentListColumnCellContext) {
	const t = useMessages(messages);
	const lookup = useThumbnailField(collection);
	const field = lookup.status === "ready" ? lookup.field : null;
	const ids = useMemo(
		() => (field === null ? [] : collectThumbnailIds(visibleItems, field)),
		[visibleItems, field],
	);
	// `visibleItems` は一覧が描画されるたびに作り直されるので、ID の並びが変わったときだけ要求する。
	// ID は空白を含まない(`entryIdSchema`)。
	const idsKey = ids.join(" ");
	useEffect(() => {
		if (idsKey !== "") requestThumbnails(idsKey.split(" "));
	}, [idsKey]);
	const row = field === null ? null : getRowImage(item.data, field);
	const entry = useThumbnailEntry(row?.status === "image" ? row.ref.id : undefined);

	if (lookup.status === "loading") return <LoadingFrame label={t.loading} />;
	if (lookup.status === "failed") return <WarningFrame label={t.loadFailed} />;
	// このプラグインのフィールドが無いコレクション(マニフェストを読み込む前に列が選ばれたとき)
	if (row === null) return null;
	if (row.status === "none") {
		return (
			<span className="text-kumo-subtle">
				<span aria-hidden="true">—</span>
				<span className="sr-only">{t.none}</span>
			</span>
		);
	}
	if (row.status === "invalid") return <WarningFrame label={t.invalid} />;
	return (
		<div className="flex items-center gap-2">
			<RowThumbnail entry={entry ?? ENTRY_LOADING} reference={row.ref} />
			{row.more > 0 ? (
				<span className="text-xs text-kumo-subtle tabular-nums">
					<span aria-hidden="true">+{row.more}</span>
					<span className="sr-only">{t.more(row.more)}</span>
				</span>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 列の定義
// ---------------------------------------------------------------------------

/**
 * 列の見出し(`label`)。管理画面は `i18n._(label)` で訳して、見出しの文字と `<th aria-label>` に使う
 * (`references/emdash/packages/admin/src/components/ContentList.tsx:1149`)。
 *
 * 管理画面の辞書のキーは、Lingui がメッセージから作る ID(`sha256(message + "\u001F")` の base64 の先頭 6 文字)。
 * これは管理画面の辞書にある「Image」の ID で、管理画面の言語で表示される(ja は「画像」)。
 * 辞書に無い文字列("Image" など)を渡すと、訳されずにそのまま表示され、本番のビルドでは描画のたびに Lingui が
 * console に「Uncompiled message detected!」を出す(docs/emdash-admin-content-list-columns.md)。
 * 辞書にあることは tests/admin/ThumbnailColumn.test.tsx で確かめる。
 */
export const THUMBNAIL_COLUMN_LABEL = "hG89Ed";

/**
 * コンテンツ一覧のサムネイル列。T30 が `src/admin.tsx` の `contentListColumns` に入れる。
 */
export const thumbnailColumn = {
	id: "thumbnail",
	label: THUMBNAIL_COLUMN_LABEL,
	cell: ThumbnailCell,
	collections: showsThumbnailColumn,
} satisfies ContentListColumnExtension;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
