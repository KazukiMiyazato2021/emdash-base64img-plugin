/**
 * 画像管理ページ(仕様書 11.5)。管理画面の `admin.pages` に登録する部品(登録は T30)。
 *
 * - 一覧: `listImages`(T14。プラグインのルート `images/list`。T21・T21-2)を、`nextCursor` を渡して読み進める。
 *   1 ページの枚数は 0〜10 で変わる。`items: []` で `nextCursor` があるときは、参照元の多い画像を調べている途中なので、
 *   続けて次を読む(一覧の終わりではない)。400 `INVALID_CURSOR` なら、最初から読み直す。
 * - 操作(ボタンは、利用者のロールと画像の状態で出し分ける。表示のためだけで、権限はサーバーが判定する。T06):
 *   - ゴミ箱に移動: `entryStatus: "active"` の画像。寄稿者以上(`trashImage`)。移動の前に必ず確認し、使用中ならそのことを示す。
 *   - 完全に削除: `entryStatus: "trashed"` の画像。管理者だけ(`deleteImagePermanently`。標準 API)。必ず確認する。
 *   - 公開: `entryStatus: "active"` で `entryPublication: "draft"` の画像。編集者以上(`publishImage`。標準 API)。
 *     ゴミ箱から戻した画像と、アップロードの途中で止まった画像は下書きで、サイトに出ない。標準の編集画面からは公開し直せない(T19)。
 *   - `missing`(記録だけが残った画像)には操作が無い。
 * - ロールは `@emdash-cms/admin` の `useCurrentUser()`(管理画面と同じ `GET /_emdash/api/auth/me` の結果を共有する。T06)。
 * - 参照元へのリンクは、管理画面の編集画面の URL(`/_emdash/admin/content/<collection>/<エントリ ID>?locale=<ロケール>`)。
 *   記録(`owners`)を 1 件ずつそのまま並べる(状態はフィールドごとに決まるため)。載せきれない分は「ほか N 件」。
 * - 確認は Kumo の `Dialog`(`role="alertdialog"`)。最初のフォーカスは「キャンセル」。Escape で閉じる(処理中は閉じない)。
 *   操作が成功してボタンが消えるときは、フォーカスをその行(完全に削除したときは次の行)の見出しのセルに移す。
 * - 見た目は、管理画面の CSS にあるクラスだけを使う(tests/admin/ImagesPage.test.tsx で確かめる)。無いもの(縦の揃え)は style で書く。
 * - 決めたことの理由は tasks/T25-images-page.md の「結果」。
 */

import { Badge, Banner, Button, Dialog, Link, Loader, type BadgeVariant } from "@cloudflare/kumo";
import { useCurrentUser } from "@emdash-cms/admin";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { deleteImagePermanently, listImages, publishImage, trashImage } from "../client/api";
import { getErrorCode, getErrorMessage } from "../client/error-messages";
import { defineMessages, useLocale, useMessages, type Locale } from "../client/i18n";
import { storedBytesForWebp } from "../shared/data-url";
import { isBase64ImageError } from "../shared/errors";
import type {
	ImageEntryPublication,
	ImageListItem,
	ImageListOwner,
	ImageUsage,
	OwnerStatus,
} from "../shared/types";
import { ImageInfo, ImagePreview, isAbortError, WarningIcon } from "./parts";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/**
 * EmDash のロールの値(`references/emdash/packages/auth/src/types.ts:9-15`)。
 * `emdash` は `Role` を export せず、`@emdash-cms/auth` はこのプラグインの依存に無いので、管理画面と同じく自前で持つ(T06)。
 */
export const ROLE_CONTRIBUTOR = 20;
export const ROLE_EDITOR = 40;
export const ROLE_ADMIN = 50;

/**
 * 1 回の読み込み(最初の表示・「さらに読み込む」)で続けて送る要求の上限。
 * `items: []` が続くのは、参照元の多い画像を 1 回に 15〜16 件ずつ調べているとき(T21)。上限は、サーバーの不具合で
 * 空のページが返り続けたときに要求を止めるための安全弁。20 回で、参照元のエントリがおよそ 300 件の画像まで 1 回で読める。
 * 上限に達したら、残りは「さらに読み込む」で続ける。
 */
export const MAX_REQUESTS_PER_LOAD = 20;

/** 管理画面の起点(TanStack Router の basepath。固定。docs/emdash-admin-content-editor-url.md) */
const ADMIN_BASE_PATH = "/_emdash/admin";

/** 表のセルの縦の揃え(`align-top` は管理画面の CSS に無いので style で書く) */
const CELL_STYLE: CSSProperties = { verticalAlign: "top" };

/** 処理中のボタン。`disabled` にするとフォーカスが失われるので、`aria-disabled` にして押しても何もしない */
const BUSY_BUTTON_CLASS = "cursor-not-allowed opacity-50";

// ---------------------------------------------------------------------------
// 文言
// ---------------------------------------------------------------------------

const messages = defineMessages({
	ja: {
		title: "画像の管理",
		description: "base64-image プラグインでアップロードした画像です。新しい順に並びます。",
		permissions: "ゴミ箱への移動は寄稿者以上、公開は編集者以上、完全な削除は管理者だけが行えます。",
		unsafeTitle: "「参照されていない」は「消しても安全」ではありません",
		unsafeBody:
			"判定の対象は、現在のコンテンツ(公開版と下書き)だけです。古いリビジョンや、複製したまま保存も公開もしていないエントリからは、まだ参照されている可能性があります。",
		reload: "最初から読み込み直す",
		loading: "画像の一覧を読み込み中…",
		loadMore: "さらに読み込む",
		loadingMore: "読み込んでいます…",
		empty: "画像はまだありません。",
		moreToLoad: "表示中の画像はありません。一覧には続きがあります。続きを読み込んでください。",
		caption: (count: number) => `アップロードした画像(${count} 枚を表示中)`,
		columnImage: "画像",
		columnStatus: "状態",
		columnOwners: "参照元",
		columnCreated: "作成日時",
		columnActions: "操作",
		imageName: (width: number, height: number, created: string) =>
			`${width}×${height}、${created} 作成の画像`,
		imageNameWithId: (name: string, id: string) => `${name}(ID ${id})`,
		imageId: (id: string) => `ID ${id}`,
		entryPublished: "公開済み",
		entryDraft: "下書き",
		entryScheduled: "予約済み",
		entryTrashed: "ゴミ箱",
		entryMissing: "エントリなし",
		draftNote: "サイトに表示されません。",
		scheduledNote: "予約の日時まで、サイトに表示されません。",
		trashedNote: "サイトに表示されません。ゴミ箱から戻せるのは編集者以上です。",
		missingNote: "画像のエントリが無く、記録だけが残っています。このページからは操作できません。",
		usageInUse: "使用中",
		usageOwnerDeleted: "参照元が削除された",
		usageDetached: "参照元から外された",
		usageNoOwner: "参照元なし",
		ownerInUse: "使用中",
		ownerDeleted: "削除済み",
		ownerDetached: "外された",
		ownerField: (field: string, locale: string) => `フィールド ${field} · ${locale}`,
		noOwners: "なし",
		moreOwners: (count: number) => `ほか ${count} 件`,
		publish: "公開",
		publishing: "公開しています…",
		trash: "ゴミ箱に移動",
		deletePermanently: "完全に削除",
		actionLabel: (action: string, name: string) => `${action}: ${name}`,
		trashTitle: "画像をゴミ箱に移動しますか?",
		trashBody:
			"ゴミ箱に移動した画像は、サイトに表示されなくなります。ゴミ箱から戻せるのは、編集者以上のロールの利用者です。",
		trashInUse:
			"この画像は使用中です。移動すると、この画像を使っている投稿などに画像が表示されなくなります。",
		deleteTitle: "画像を完全に削除しますか?",
		deleteBody: "完全に削除した画像は、元に戻せません。",
		deleteInUse:
			"この画像はまだ使用中です。参照している投稿などは、画像を外すまで保存できなくなります。",
		deleteNotInUse:
			"参照されていないと判定された画像でも、古いリビジョンや、複製したまま保存も公開もしていないエントリから、まだ参照されている可能性があります。",
		cancel: "キャンセル",
		trashing: "移動しています…",
		deleting: "削除しています…",
		listFailed: "画像の一覧を読み込めませんでした",
		listForbidden: "画像の一覧を見る権限がありません。画像の管理は、寄稿者以上のロールで行えます。",
		trashFailed: "ゴミ箱に移動できませんでした",
		deleteFailed: "完全に削除できませんでした",
		publishFailed: "公開できませんでした",
		forbiddenOperation:
			"この操作を行う権限がありません。ロールが変更された可能性があるため、ページを再読み込みしてください。",
		publishLocked:
			"ほかの利用者が編集画面でこの画像を開いているため、公開できません。しばらくしてから、もう一度お試しください。",
		publishRejected:
			"公開が拒否されました。ほかのプラグインの公開の規則で止められた可能性があります。",
		publishConflict:
			"ほかの操作と重なったため、公開できませんでした。一覧を読み込み直してから、もう一度お試しください。",
		imageNotFound:
			"画像が見つかりません。ゴミ箱に移動されたか、削除された可能性があります。一覧を読み込み直してください。",
		notInTrash:
			"ゴミ箱に画像が見つかりません。すでに完全に削除されたか、ゴミ箱から戻された可能性があります。一覧を読み込み直してください。",
		restarted: "一覧の読み込み位置が古くなったため、最初から読み込み直しました。",
		loaded: (count: number) =>
			count === 0 ? "画像はありません。" : `${count} 枚の画像を読み込みました。`,
		loadedMore: (count: number) => `さらに ${count} 枚の画像を読み込みました。`,
		trashed: (name: string) => `${name}をゴミ箱に移動しました。`,
		deleted: (name: string) => `${name}を完全に削除しました。`,
		published: (name: string) => `${name}を公開しました。`,
	},
	en: {
		title: "Manage images",
		description: "Images uploaded with the base64-image plugin, newest first.",
		permissions:
			"Contributors and above can move images to the trash, editors and above can publish them, and only administrators can delete them permanently.",
		unsafeTitle: "“Not referenced” does not mean “safe to delete”",
		unsafeBody:
			"Only current content (published versions and drafts) is checked. Old revisions, and duplicated entries that have been neither saved nor published, may still refer to an image.",
		reload: "Reload from the start",
		loading: "Loading images…",
		loadMore: "Load more",
		loadingMore: "Loading…",
		empty: "No images yet.",
		moreToLoad: "No images are shown. The list continues; load more to see the rest.",
		caption: (count) => `Uploaded images (${count} shown)`,
		columnImage: "Image",
		columnStatus: "Status",
		columnOwners: "Referenced by",
		columnCreated: "Created",
		columnActions: "Actions",
		imageName: (width, height, created) => `${width}×${height} image created ${created}`,
		imageNameWithId: (name, id) => `${name} (ID ${id})`,
		imageId: (id) => `ID ${id}`,
		entryPublished: "Published",
		entryDraft: "Draft",
		entryScheduled: "Scheduled",
		entryTrashed: "In trash",
		entryMissing: "Entry missing",
		draftNote: "Not shown on the site.",
		scheduledNote: "Not shown on the site until the scheduled time.",
		trashedNote: "Not shown on the site. Editors and above can restore it from the trash.",
		missingNote:
			"The image entry no longer exists; only its record remains. It cannot be managed from this page.",
		usageInUse: "In use",
		usageOwnerDeleted: "Referencing entry deleted",
		usageDetached: "Removed from entries",
		usageNoOwner: "Not referenced",
		ownerInUse: "in use",
		ownerDeleted: "deleted",
		ownerDetached: "removed",
		ownerField: (field, locale) => `field ${field} · ${locale}`,
		noOwners: "None",
		moreOwners: (count) => `and ${count} more`,
		publish: "Publish",
		publishing: "Publishing…",
		trash: "Move to trash",
		deletePermanently: "Delete permanently",
		actionLabel: (action, name) => `${action}: ${name}`,
		trashTitle: "Move this image to the trash?",
		trashBody:
			"Images in the trash are not shown on the site. Only editors and above can restore them.",
		trashInUse: "This image is in use. Entries that use it will no longer show it.",
		deleteTitle: "Delete this image permanently?",
		deleteBody: "A permanently deleted image cannot be restored.",
		deleteInUse:
			"This image is still in use. Entries that refer to it cannot be saved until the image is removed from them.",
		deleteNotInUse:
			"Even an image that is not referenced may still be referred to by old revisions or by duplicated entries that have been neither saved nor published.",
		cancel: "Cancel",
		trashing: "Moving…",
		deleting: "Deleting…",
		listFailed: "Could not load the images",
		listForbidden:
			"You do not have permission to view the images. Managing images requires the Contributor role or higher.",
		trashFailed: "Could not move the image to the trash",
		deleteFailed: "Could not delete the image permanently",
		publishFailed: "Could not publish the image",
		forbiddenOperation:
			"You do not have permission to do this. Your role may have changed, so reload the page.",
		publishLocked:
			"Another user has this image open in the editor, so it cannot be published now. Try again later.",
		publishRejected: "Publishing was rejected, possibly by another plugin's publishing rules.",
		publishConflict: "Publishing conflicted with another change. Reload the list and try again.",
		imageNotFound:
			"Image not found. It may have been moved to the trash or deleted. Reload the list.",
		notInTrash:
			"The image is not in the trash. It may already have been deleted permanently or restored. Reload the list.",
		restarted: "The list position was no longer valid, so the list was reloaded from the start.",
		loaded: (count) =>
			count === 0 ? "No images." : count === 1 ? "Loaded 1 image." : `Loaded ${count} images.`,
		loadedMore: (count) => (count === 1 ? "Loaded 1 more image." : `Loaded ${count} more images.`),
		trashed: (name) => `Moved the ${name} to the trash.`,
		deleted: (name) => `Deleted the ${name} permanently.`,
		published: (name) => `Published the ${name}.`,
	},
});

type PageMessages = (typeof messages)["ja"];

/** 画像エントリの状態の表示(公開の状態を含む) */
type EntryDisplay = ImageEntryPublication | "trashed" | "missing";

const ENTRY_BADGES: Record<
	EntryDisplay,
	{ readonly variant: BadgeVariant; readonly label: (t: PageMessages) => string }
> = {
	published: { variant: "outline", label: (t) => t.entryPublished },
	draft: { variant: "warning", label: (t) => t.entryDraft },
	scheduled: { variant: "info", label: (t) => t.entryScheduled },
	trashed: { variant: "error", label: (t) => t.entryTrashed },
	missing: { variant: "error", label: (t) => t.entryMissing },
};

const USAGE_BADGES: Record<
	ImageUsage,
	{ readonly variant: BadgeVariant; readonly label: (t: PageMessages) => string }
> = {
	in_use: { variant: "success", label: (t) => t.usageInUse },
	owner_deleted: { variant: "warning", label: (t) => t.usageOwnerDeleted },
	detached: { variant: "secondary", label: (t) => t.usageDetached },
	no_owner: { variant: "secondary", label: (t) => t.usageNoOwner },
};

const OWNER_STATUS_LABELS: Record<OwnerStatus, (t: PageMessages) => string> = {
	in_use: (t) => t.ownerInUse,
	owner_deleted: (t) => t.ownerDeleted,
	detached: (t) => t.ownerDetached,
};

// ---------------------------------------------------------------------------
// 補助(テストでも使う)
// ---------------------------------------------------------------------------

/**
 * 画像エントリの状態の表示。ゴミ箱に入っていない画像は公開の状態で表す。
 * 公開の状態が無い(ルートの約束では起きない)ときは、サイトに出ないことだけが確かなので `draft` にする(T21-2 と同じ考え方)。
 */
export function entryDisplayOf(
	item: Pick<ImageListItem, "entryStatus" | "entryPublication">,
): EntryDisplay {
	if (item.entryStatus === "active") return item.entryPublication ?? "draft";
	return item.entryStatus;
}

/**
 * 参照元のエントリの、管理画面の編集画面の URL。コンテンツ一覧と同じく `?locale=` を付ける
 * (`references/emdash/packages/admin/src/components/ContentList.tsx:1269-1271`)。ID で開くとき、ロケールは取得に使われない。
 */
export function contentEditorHref(
	owner: Pick<ImageListOwner, "collection" | "entryId" | "locale">,
): string {
	const path = `${ADMIN_BASE_PATH}/content/${encodeURIComponent(owner.collection)}/${encodeURIComponent(owner.entryId)}`;
	return `${path}?${new URLSearchParams({ locale: owner.locale }).toString()}`;
}

/** 1 回の読み込みの結果 */
export interface ImagesReadResult {
	readonly items: readonly ImageListItem[];
	readonly nextCursor: string | undefined;
}

/**
 * `cursor` から一覧を読む。`items: []` で `nextCursor` がある応答は続けて読み、画像が 1 枚以上届くか、
 * 最後のページか、`MAX_REQUESTS_PER_LOAD` 回に達したら返す。
 */
export async function readImagePages(
	cursor: string | undefined,
	signal: AbortSignal,
): Promise<ImagesReadResult> {
	let next = cursor;
	const items: ImageListItem[] = [];
	for (let request = 0; request < MAX_REQUESTS_PER_LOAD; request += 1) {
		// oxlint-disable-next-line no-await-in-loop -- 次の要求のカーソルは、前の応答で決まる
		const page = await listImages(next === undefined ? {} : { cursor: next }, { signal });
		items.push(...page.items);
		next = page.nextCursor;
		if (next === undefined || items.length > 0) break;
	}
	return { items, nextCursor: next };
}

/** `readImageList` の結果。`restarted` は、カーソルが使えず最初から読み直したとき true */
export interface ImagesListRead extends ImagesReadResult {
	readonly restarted: boolean;
}

/**
 * `cursor` から一覧を読む(`readImagePages`)。カーソルが使えなくなっていたら(400 `INVALID_CURSOR`。
 * プラグインの更新でカーソルの版が変わったなど)、最初から 1 回だけ読み直す(T21)。
 */
export async function readImageList(
	cursor: string | undefined,
	signal: AbortSignal,
): Promise<ImagesListRead> {
	try {
		return { ...(await readImagePages(cursor, signal)), restarted: false };
	} catch (error) {
		if (signal.aborted || getErrorCode(error) !== "INVALID_CURSOR") throw error;
		return { ...(await readImagePages(undefined, signal)), restarted: true };
	}
}

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** 作成日時の表示(利用者の時間帯で、年月日と時分) */
function formatCreatedAt(iso: string, locale: Locale): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	let format = dateFormats.get(locale);
	if (format === undefined) {
		format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
		dateFormats.set(locale, format);
	}
	return format.format(date);
}

/** 応答の元のエラーコード(標準 API の知らないコードは、HTTP ステータスから決めた別のコードになるため。T14) */
function responseCodeOf(error: unknown): string | undefined {
	if (!isBase64ImageError(error)) return undefined;
	const value = error.details?.["responseCode"];
	return typeof value === "string" ? value : undefined;
}

type Operation = "trash" | "delete" | "publish";

/**
 * 操作の失敗の文言。T14 の文言(エラーコードから決まる)では合わない場合だけ、このページの文言にする。
 * - 公開: 409 `ENTRY_LOCKED` / `CONFLICT`(T14 では「予期しない応答」)、422 `PUBLISH_REJECTED`(同じく「送信した内容を…」)、404
 * - 完全に削除: 404(ゴミ箱に入っていない。戻された場合を含む)
 * - 403: ボタンはロールで出し分けているので、ロールが変わった可能性を伝える
 */
function operationErrorText(
	t: PageMessages,
	error: unknown,
	operation: Operation,
	locale: Locale,
): string {
	const code = getErrorCode(error);
	const responseCode = responseCodeOf(error);
	if (operation === "publish") {
		if (responseCode === "ENTRY_LOCKED") return t.publishLocked;
		if (responseCode === "PUBLISH_REJECTED") return t.publishRejected;
		if (responseCode === "CONFLICT") return t.publishConflict;
		if (code === "NOT_FOUND") return t.imageNotFound;
	}
	if (operation === "delete" && code === "NOT_FOUND") return t.notInTrash;
	if (code === "FORBIDDEN") return t.forbiddenOperation;
	return getErrorMessage(error, locale);
}

/** 表示するエラーの文言。エラーが無い・中断のときは undefined */
function visibleError(error: unknown, text: (error: unknown) => string): string | undefined {
	return error === null || error === undefined || isAbortError(error) ? undefined : text(error);
}

// ---------------------------------------------------------------------------
// 小さな部品
// ---------------------------------------------------------------------------

/**
 * エラーの表示。T22 の `ErrorMessage` と同じ形(`role="alert"` の領域を常に置き、中身だけを変える)で、
 * 文言をこのページで決められるようにしたもの(`ErrorMessage` はエラーコードの文言しか出せない)。
 */
function AlertMessage({
	text,
	title,
}: {
	readonly text: string | undefined;
	readonly title: string;
}) {
	return (
		<div role="alert">
			{text === undefined ? null : (
				<Banner variant="error" icon={<WarningIcon />} title={title} description={text} />
			)}
		</div>
	);
}

function EntryBadges({ item, t }: { readonly item: ImageListItem; readonly t: PageMessages }) {
	const display = entryDisplayOf(item);
	const entry = ENTRY_BADGES[display];
	const usage = USAGE_BADGES[item.usage];
	const notes: Partial<Record<EntryDisplay, string>> = {
		draft: t.draftNote,
		scheduled: t.scheduledNote,
		trashed: t.trashedNote,
		missing: t.missingNote,
	};
	const note = notes[display];
	return (
		<div className="grid gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={entry.variant}>{entry.label(t)}</Badge>
				<Badge variant={usage.variant}>{usage.label(t)}</Badge>
			</div>
			{note === undefined ? null : <p className="text-xs leading-4 text-kumo-subtle">{note}</p>}
		</div>
	);
}

function OwnerList({ item, t }: { readonly item: ImageListItem; readonly t: PageMessages }) {
	const more = item.ownersTotal - item.owners.length;
	if (item.owners.length === 0 && more <= 0) {
		return <p className="text-sm text-kumo-subtle">{t.noOwners}</p>;
	}
	return (
		<div className="grid gap-1">
			<ul className="grid gap-1">
				{item.owners.map((owner) => {
					const label = `${owner.collection} / ${owner.entryId}`;
					return (
						<li
							key={`${owner.collection}/${owner.entryId}/${owner.locale}/${owner.field}`}
							className="grid text-sm"
						>
							{/* 削除された参照元(ゴミ箱に入ったものを含む)は編集画面で開けないので、リンクにしない */}
							{owner.status === "owner_deleted" ? (
								<span className="break-all text-kumo-subtle">{label}</span>
							) : (
								<Link href={contentEditorHref(owner)} className="break-all">
									{label}
								</Link>
							)}
							<span className="text-xs leading-4 text-kumo-subtle">
								{t.ownerField(owner.field, owner.locale)} · {OWNER_STATUS_LABELS[owner.status](t)}
							</span>
						</li>
					);
				})}
			</ul>
			{more > 0 ? <p className="text-xs leading-4 text-kumo-subtle">{t.moreOwners(more)}</p> : null}
		</div>
	);
}

/** 確認のダイアログの中身 */
function ConfirmContent({
	t,
	dialog,
	pending,
	errorText,
	onCancel,
	onConfirm,
}: {
	readonly t: PageMessages;
	readonly dialog: DialogState;
	readonly pending: boolean;
	readonly errorText: string | undefined;
	readonly onCancel: () => void;
	readonly onConfirm: () => void;
}) {
	const { kind, item } = dialog;
	const inUse = item.usage === "in_use";
	const trash = kind === "trash";
	let lines: string[];
	if (trash) lines = inUse ? [t.trashInUse, t.trashBody] : [t.trashBody];
	else lines = [t.deleteBody, inUse ? t.deleteInUse : t.deleteNotInUse];
	const busyProps = pending ? { className: BUSY_BUTTON_CLASS } : {};
	return (
		<Dialog className="grid gap-4 p-6" size="base">
			<Dialog.Title className="text-lg font-semibold">
				{trash ? t.trashTitle : t.deleteTitle}
			</Dialog.Title>
			<Dialog.Description render={<div />} className="grid gap-2 text-sm text-kumo-subtle">
				{lines.map((line) => (
					<p key={line}>{line}</p>
				))}
			</Dialog.Description>
			<div className="flex flex-wrap items-center gap-3">
				<ImagePreview size="small" src={item.thumb} width={item.width} height={item.height} />
				<div className="grid gap-1">
					<ImageInfo
						width={item.width}
						height={item.height}
						storedBytes={storedBytesForWebp(item.bytes)}
					/>
					<span className="text-xs leading-4 break-all text-kumo-subtle">{t.imageId(item.id)}</span>
				</div>
			</div>
			<AlertMessage text={errorText} title={trash ? t.trashFailed : t.deleteFailed} />
			<div className="flex flex-wrap justify-end gap-2">
				{/* 最初のフォーカスはここ(取り消せる側)。Base UI はダイアログの最初のフォーカスできる要素に移す */}
				<Button variant="secondary" aria-disabled={pending} {...busyProps} onClick={onCancel}>
					{t.cancel}
				</Button>
				<Button variant="destructive" aria-disabled={pending} {...busyProps} onClick={onConfirm}>
					{pending ? (trash ? t.trashing : t.deleting) : trash ? t.trash : t.deletePermanently}
				</Button>
			</div>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// ページ
// ---------------------------------------------------------------------------

interface ListState {
	readonly items: readonly ImageListItem[];
	readonly nextCursor: string | undefined;
	/** 最初の読み込みが終わったか(空の一覧の表示に使う) */
	readonly loaded: boolean;
}

type LoadMode = "reset" | "more";

interface DialogState {
	readonly kind: "trash" | "delete";
	readonly item: ImageListItem;
	/** 読み上げに使う画像の名前(開いた時点の言語で作る) */
	readonly name: string;
}

interface Announcement {
	readonly id: number;
	readonly text: string;
}

/** 重複を除いて、`base` のあとに `items` を足す */
function appendItems(
	base: readonly ImageListItem[],
	items: readonly ImageListItem[],
): ImageListItem[] {
	const known = new Set(base.map((item) => item.id));
	const result = [...base];
	for (const item of items) {
		if (known.has(item.id)) continue;
		known.add(item.id);
		result.push(item);
	}
	return result;
}

/** 画像管理ページ。`admin.pages` に登録する(props は受け取らない) */
export function ImagesPage() {
	const t = useMessages(messages);
	const locale = useLocale();
	const { data: currentUser } = useCurrentUser();
	const role = currentUser?.role ?? 0;
	const baseId = useId();

	const [list, setList] = useState<ListState>({
		items: [],
		nextCursor: undefined,
		loaded: false,
	});
	const [loading, setLoading] = useState<LoadMode | null>("reset");
	const [listError, setListError] = useState<{
		readonly mode: LoadMode;
		readonly error: unknown;
	} | null>(null);
	const [restarted, setRestarted] = useState(false);
	const [announcement, setAnnouncement] = useState<Announcement | null>(null);
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogPending, setDialogPending] = useState(false);
	const [dialogError, setDialogError] = useState<unknown>(null);
	const [publishing, setPublishing] = useState<ReadonlySet<string>>(() => new Set());
	const [publishErrors, setPublishErrors] = useState<ReadonlyMap<string, unknown>>(() => new Map());
	const [focusRequest, setFocusRequest] = useState<{
		readonly id: string;
		readonly seq: number;
	} | null>(null);

	// 非同期の処理から読むもの(描画が確定したあとの値。言語が変わっても `load` を作り直さない)
	const tRef = useRef(t);
	const itemsRef = useRef<readonly ImageListItem[]>([]);
	const cursorRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		tRef.current = t;
		itemsRef.current = list.items;
		cursorRef.current = list.nextCursor;
	});

	const controllerRef = useRef<AbortController | null>(null);
	const announceSeqRef = useRef(0);
	const focusSeqRef = useRef(0);
	/** 処理中の操作(描画を待たずに二度押しを防ぐ) */
	const dialogPendingRef = useRef(false);
	const publishingRef = useRef(new Set<string>());
	/** 確認のダイアログが閉じ終わったら、フォーカスを移す先(操作が成功してボタンが消えるとき) */
	const dialogFocusRef = useRef<string | null>(null);

	const headingId = `${baseId}-heading`;
	const rowFocusId = useCallback((imageId: string) => `${baseId}-image-${imageId}`, [baseId]);

	const announce = useCallback((text: string) => {
		announceSeqRef.current += 1;
		setAnnouncement({ id: announceSeqRef.current, text });
	}, []);

	const requestFocus = useCallback((id: string) => {
		focusSeqRef.current += 1;
		setFocusRequest({ id, seq: focusSeqRef.current });
	}, []);

	useEffect(() => {
		if (focusRequest !== null) document.getElementById(focusRequest.id)?.focus();
	}, [focusRequest]);

	/** 読んだ一覧を反映する */
	const applyList = useCallback(
		(mode: LoadMode, read: ImagesListRead) => {
			const replace = mode === "reset" || read.restarted;
			const texts = tRef.current;
			// 読み上げとフォーカスには、確定している一覧から数えた「足した画像」を使う
			const before = replace ? [] : itemsRef.current;
			const added = appendItems(before, read.items).slice(before.length);
			setList((previous) => ({
				items: appendItems(replace ? [] : previous.items, read.items),
				nextCursor: read.nextCursor,
				loaded: true,
			}));
			setLoading(null);
			if (read.restarted) setRestarted(true);
			const loadedText = replace ? texts.loaded(added.length) : texts.loadedMore(added.length);
			announce(read.restarted ? `${texts.restarted} ${loadedText}` : loadedText);
			// 「さらに読み込む」で画像を足したら、最初の 1 枚に移る(最後のページではボタンが消えるため)
			const firstAdded = added[0];
			if (!replace && firstAdded !== undefined) requestFocus(rowFocusId(firstAdded.id));
		},
		[announce, requestFocus, rowFocusId],
	);

	/** 読み込みの失敗を反映する */
	const failList = useCallback((mode: LoadMode, error: unknown) => {
		setListError({ mode, error });
		setLoading(null);
	}, []);

	/**
	 * 一覧を読み、応答が届いたら反映する。中断した読み込みの結果は捨てる。
	 * 状態は応答を待ったあとでだけ変える(effect から呼ぶので、同期的に setState しない)。
	 */
	const startList = useCallback(
		(mode: LoadMode, cursor: string | undefined, controller: AbortController) => {
			const settle = (
				outcome:
					| { readonly ok: true; readonly read: ImagesListRead }
					| { readonly ok: false; readonly error: unknown },
			) => {
				if (controller.signal.aborted) return;
				if (outcome.ok === false) failList(mode, outcome.error);
				else applyList(mode, outcome.read);
			};
			void readImageList(cursor, controller.signal)
				.then(
					(read) => ({ ok: true, read }) as const,
					(error: unknown) => ({ ok: false, error }) as const,
				)
				.then(settle);
		},
		[applyList, failList],
	);

	/** 「最初から読み込み直す」「さらに読み込む」。読み込み中の要求は中断する */
	const load = (mode: LoadMode) => {
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		setLoading(mode);
		setListError(null);
		if (mode === "reset") setRestarted(false);
		startList(mode, mode === "more" ? cursorRef.current : undefined, controller);
	};

	// 最初の表示で読む(状態の初期値が「読み込み中」)。アンマウントしたら、そのとき読み込み中の要求を中断する
	useEffect(() => {
		const controller = new AbortController();
		controllerRef.current = controller;
		startList("reset", undefined, controller);
		return () => {
			controllerRef.current?.abort();
		};
	}, [startList]);

	const updateItem = (id: string, patch: Partial<ImageListItem>) => {
		setList((previous) => ({
			...previous,
			items: previous.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
		}));
	};

	/** 公開の失敗の表示を消す(公開し直すとき、ゴミ箱に移動・完全に削除したとき) */
	const clearPublishError = (id: string) => {
		setPublishErrors((previous) => {
			if (!previous.has(id)) return previous;
			const next = new Map(previous);
			next.delete(id);
			return next;
		});
	};

	// 画像の名前(ボタンの名前と読み上げに使う)。寸法と作成日時(分まで)が同じ画像がほかにも表示されているときは
	// (ギャラリーに同じ機種の写真をまとめてアップロードしたときなど)、区別できるよう、行に出している ID を足す
	const baseName = (item: ImageListItem) =>
		t.imageName(item.width, item.height, formatCreatedAt(item.createdAt, locale));
	const nameCounts = new Map<string, number>();
	for (const item of list.items) {
		const name = baseName(item);
		nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
	}
	const imageName = (item: ImageListItem) => {
		const name = baseName(item);
		return (nameCounts.get(name) ?? 0) > 1 ? t.imageNameWithId(name, item.id) : name;
	};

	// ---- 確認のダイアログ(ゴミ箱・完全削除) ----

	const openDialog = (kind: DialogState["kind"], item: ImageListItem) => {
		setDialog({ kind, item, name: imageName(item) });
		setDialogError(null);
		setDialogOpen(true);
	};

	const closeDialog = () => {
		// 処理中は閉じない(結果を見届けてから閉じる)
		if (dialogPendingRef.current) return;
		dialogFocusRef.current = null;
		setDialogOpen(false);
	};

	const confirmDialog = async () => {
		if (dialog === null || dialogPendingRef.current) return;
		const { kind, item, name } = dialog;
		dialogPendingRef.current = true;
		setDialogPending(true);
		setDialogError(null);
		try {
			if (kind === "trash") {
				await trashImage(item.id);
				updateItem(item.id, { entryStatus: "trashed", entryPublication: null });
				clearPublishError(item.id);
				// ゴミ箱のボタンは消えるので、閉じたら行の見出しに移る
				dialogFocusRef.current = rowFocusId(item.id);
				announce(tRef.current.trashed(name));
			} else {
				await deleteImagePermanently(item.id);
				// 記録は、応答のあとに完全削除の hook が消す。すぐに読み直すと残って見えることがあるので、画面から消すだけにする(T21)
				const current = itemsRef.current;
				const index = current.findIndex((entry) => entry.id === item.id);
				const remaining = current.filter((entry) => entry.id !== item.id);
				setList((previous) => ({
					...previous,
					items: previous.items.filter((entry) => entry.id !== item.id),
				}));
				clearPublishError(item.id);
				// 行は消えるので、閉じたら次の行(最後の行なら前の行、無ければ見出し)に移る
				const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
				dialogFocusRef.current = next === undefined ? headingId : rowFocusId(next.id);
				announce(tRef.current.deleted(name));
			}
			dialogPendingRef.current = false;
			setDialogPending(false);
			setDialogOpen(false);
		} catch (error) {
			dialogPendingRef.current = false;
			setDialogPending(false);
			setDialogError(error);
		}
	};

	const onDialogClosed = () => {
		const target = dialogFocusRef.current;
		dialogFocusRef.current = null;
		if (target !== null) requestFocus(target);
	};

	// ---- 公開 ----

	const publish = async (item: ImageListItem) => {
		if (publishingRef.current.has(item.id)) return;
		publishingRef.current.add(item.id);
		const name = imageName(item);
		setPublishing(new Set(publishingRef.current));
		clearPublishError(item.id);
		try {
			await publishImage(item.id);
			updateItem(item.id, { entryPublication: "published" });
			announce(tRef.current.published(name));
			// 公開のボタンは消えるので、行の見出しに移る
			requestFocus(rowFocusId(item.id));
		} catch (error) {
			setPublishErrors((previous) => new Map(previous).set(item.id, error));
		}
		publishingRef.current.delete(item.id);
		setPublishing(new Set(publishingRef.current));
	};

	// ---- 描画 ----

	const listErrorText = (error: unknown) =>
		getErrorCode(error) === "FORBIDDEN" ? t.listForbidden : getErrorMessage(error, locale);
	const resetErrorText =
		listError?.mode === "reset" ? visibleError(listError.error, listErrorText) : undefined;
	const moreErrorText =
		listError?.mode === "more" ? visibleError(listError.error, listErrorText) : undefined;
	const busy = loading !== null;
	const busyProps = busy ? { className: BUSY_BUTTON_CLASS } : {};

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 id={headingId} tabIndex={-1} className="text-2xl font-semibold leading-tight">
						{t.title}
					</h1>
					<p className="mt-1 text-sm leading-5 text-pretty text-kumo-subtle">{t.description}</p>
					<p className="mt-1 text-sm leading-5 text-pretty text-kumo-subtle">{t.permissions}</p>
				</div>
				<Button
					variant="secondary"
					aria-disabled={busy}
					{...busyProps}
					onClick={() => {
						if (!busy) load("reset");
					}}
				>
					{loading === "reset" && list.loaded ? t.loadingMore : t.reload}
				</Button>
			</div>

			<Banner
				variant="alert"
				icon={<WarningIcon />}
				title={t.unsafeTitle}
				description={t.unsafeBody}
			/>

			{/* 読み上げの領域(`<output>` の暗黙の role は status)。同じ文が続いても読まれるよう、中身の要素を作り直す */}
			<output aria-live="polite" className="sr-only">
				{announcement === null ? null : <span key={announcement.id}>{announcement.text}</span>}
			</output>

			{restarted ? <Banner variant="default" description={t.restarted} /> : null}

			<AlertMessage text={resetErrorText} title={t.listFailed} />

			{list.items.length === 0 ? (
				loading === "reset" ? (
					<p className="flex items-center gap-2 text-sm text-kumo-subtle">
						{/* Kumo の Loader は英語の「Loading」を読み上げるので隠し、文字で伝える */}
						<span aria-hidden="true" className="flex items-center">
							<Loader size="sm" />
						</span>
						{t.loading}
					</p>
				) : list.loaded ? (
					<p className="text-sm text-kumo-subtle">
						{/* 空のページが要求の上限(MAX_REQUESTS_PER_LOAD)まで続いたときや、表示中の画像をすべて完全に削除したときは、まだ続きがある */}
						{list.nextCursor === undefined ? t.empty : t.moreToLoad}
					</p>
				) : null
			) : (
				<div className="overflow-x-auto rounded-md border bg-kumo-base">
					<table className="w-full text-sm">
						<caption className="sr-only">{t.caption(list.items.length)}</caption>
						<thead>
							<tr className="border-b bg-kumo-tint/50">
								<th scope="col" className="px-4 py-3 text-start font-medium">
									{t.columnImage}
								</th>
								<th scope="col" className="px-4 py-3 text-start font-medium">
									{t.columnStatus}
								</th>
								<th scope="col" className="px-4 py-3 text-start font-medium">
									{t.columnOwners}
								</th>
								<th scope="col" className="px-4 py-3 text-start font-medium">
									{t.columnCreated}
								</th>
								<th scope="col" className="px-4 py-3 text-start font-medium">
									{t.columnActions}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-kumo-line">
							{list.items.map((item) => {
								const name = imageName(item);
								const isPublishing = publishing.has(item.id);
								const canPublish =
									role >= ROLE_EDITOR &&
									item.entryStatus === "active" &&
									entryDisplayOf(item) === "draft";
								const canTrash = role >= ROLE_CONTRIBUTOR && item.entryStatus === "active";
								const canDelete = role >= ROLE_ADMIN && item.entryStatus === "trashed";
								return (
									<tr key={item.id}>
										<th
											scope="row"
											id={rowFocusId(item.id)}
											tabIndex={-1}
											className="px-4 py-3 text-start font-normal"
											style={CELL_STYLE}
										>
											<div className="grid gap-2">
												<ImagePreview
													size="small"
													src={item.thumb}
													width={item.width}
													height={item.height}
												/>
												<ImageInfo
													width={item.width}
													height={item.height}
													storedBytes={storedBytesForWebp(item.bytes)}
												/>
												<span className="text-xs leading-4 break-all text-kumo-subtle">
													{t.imageId(item.id)}
												</span>
											</div>
										</th>
										<td className="px-4 py-3" style={CELL_STYLE}>
											<EntryBadges item={item} t={t} />
										</td>
										<td className="px-4 py-3" style={CELL_STYLE}>
											<OwnerList item={item} t={t} />
										</td>
										<td className="px-4 py-3 whitespace-nowrap" style={CELL_STYLE}>
											<time dateTime={item.createdAt}>
												{formatCreatedAt(item.createdAt, locale)}
											</time>
										</td>
										<td className="px-4 py-3" style={CELL_STYLE}>
											<div className="grid gap-2">
												<div className="flex flex-wrap items-center gap-2">
													{canPublish ? (
														<Button
															variant="secondary"
															size="sm"
															aria-label={t.actionLabel(t.publish, name)}
															aria-disabled={isPublishing}
															{...(isPublishing ? { className: BUSY_BUTTON_CLASS } : {})}
															onClick={() => void publish(item)}
														>
															{isPublishing ? t.publishing : t.publish}
														</Button>
													) : null}
													{canTrash ? (
														<Button
															variant="secondary-destructive"
															size="sm"
															aria-label={t.actionLabel(t.trash, name)}
															onClick={() => openDialog("trash", item)}
														>
															{t.trash}
														</Button>
													) : null}
													{canDelete ? (
														<Button
															variant="secondary-destructive"
															size="sm"
															aria-label={t.actionLabel(t.deletePermanently, name)}
															onClick={() => openDialog("delete", item)}
														>
															{t.deletePermanently}
														</Button>
													) : null}
												</div>
												<AlertMessage
													text={visibleError(publishErrors.get(item.id), (error) =>
														operationErrorText(t, error, "publish", locale),
													)}
													title={t.publishFailed}
												/>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{list.nextCursor === undefined || !list.loaded ? null : (
				<div className="grid gap-2">
					<div>
						<Button
							variant="secondary"
							aria-disabled={busy}
							{...busyProps}
							onClick={() => {
								if (!busy) load("more");
							}}
						>
							{loading === "more" ? t.loadingMore : t.loadMore}
						</Button>
					</div>
					<AlertMessage text={moreErrorText} title={t.listFailed} />
				</div>
			)}

			<Dialog.Root
				role="alertdialog"
				open={dialogOpen}
				onOpenChange={(open) => {
					if (!open) closeDialog();
				}}
				onOpenChangeComplete={(open) => {
					if (!open) onDialogClosed();
				}}
			>
				{dialog === null ? null : (
					<ConfirmContent
						t={t}
						dialog={dialog}
						pending={dialogPending}
						errorText={visibleError(dialogError, (error) =>
							operationErrorText(t, error, dialog.kind, locale),
						)}
						onCancel={closeDialog}
						onConfirm={() => void confirmDialog()}
					/>
				)}
			</Dialog.Root>
		</div>
	);
}
