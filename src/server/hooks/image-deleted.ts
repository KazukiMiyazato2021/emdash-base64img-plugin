/**
 * 画像エントリの完全削除で、`imageRefs` の記録も消す(`content:afterDelete`。仕様書 10 章)。
 *
 * - event は `{ id, collection, permanent }`。`collection === "b64_images"` かつ `permanent === true` のときだけ、
 *   `imageRefs.delete(id)` を呼ぶ(1 クエリ)。ゴミ箱への移動(`permanent: false`)とほかのコレクションは何もしない(0 クエリ)。
 *   - ゴミ箱に入った画像の記録は、完全削除まで残す(ゴミ箱の状態は記録しない。画像管理の一覧は、画像エントリを読んで
 *     ゴミ箱かを判定する。T21 の結果)。
 *   - 完全削除は、画像管理ページが標準の API(`DELETE /_emdash/api/content/b64_images/{id}/permanent`)を管理者の権限で
 *     呼ぶ。プラグインの `ctx.content.delete`(ゴミ箱への移動)では、この hook は呼ばれない。
 * - `id` は URL で指定した値そのもの(slug で完全削除すると slug が入る)。`b64_images` はこのプラグインが slug なしで
 *   作るので、ID で呼ばれる。記録が無ければ(seed で作った画像など)何もしない。
 * - 条件なしで消してよい。参照元の記録(T20)は、消えた記録を作り直さない(`getVersioned` が null なら書かない)。
 * - afterDelete は削除の応答のあとに実行される(`after()`)。例外は外に出さず、`ctx.log` に出す。T29 は
 *   `imageDeletedHooks` をそのまま `hooks` に登録する(`errorPolicy: "continue"` と `priority` を含む)。登録には
 *   capability `content:read` が要る(無いと EmDash は警告を出して登録しない)。記録が消えなかったときは、画像管理の
 *   一覧に `entryStatus: "missing"` の画像として残る。
 */

import { IMAGE_COLLECTION, IMAGE_REFS_STORAGE } from "../../shared/constants";

/**
 * hook の優先度(小さいほど先)。EmDash の既定は 100。同じ hook のプラグインは 1 つずつ順に実行され、既定の
 * `errorPolicy: "abort"` のプラグインが例外を投げると、後に続くプラグインは呼ばれない。参照元の記録(T20 の
 * `OWNER_HOOK_PRIORITY`)と同じく、既定より先に実行して、ほかのプラグインの例外で記録が残らないようにする。
 */
export const IMAGE_DELETED_HOOK_PRIORITY = 50;

/** `content:afterDelete` の event(EmDash の `ContentDeleteEvent` をそのまま渡せる) */
export interface ImageDeletedEvent {
	readonly id: string;
	readonly collection: string;
	/** 完全削除なら true、ゴミ箱への移動なら false */
	readonly permanent: boolean;
}

/** プラグインストレージ `imageRefs` のうち、この hook が使う部分(EmDash の `StorageCollection` をそのまま渡せる) */
export interface ImageRefsRemover {
	/** 消したら true、無ければ false */
	delete(id: string): Promise<boolean>;
}

/**
 * この hook が使う ctx(EmDash の `PluginContext` の一部。そのまま渡せる)。
 * `storage[IMAGE_REFS_STORAGE]` は、ストレージ `imageRefs` を宣言したときだけある。
 */
export interface ImageDeletedContext {
	readonly storage: { readonly [name: string]: ImageRefsRemover | undefined };
	readonly log: { error(message: string, data?: unknown): void };
}

/**
 * 結果。
 * - `ignored`: 画像エントリの完全削除ではない(ゴミ箱への移動、ほかのコレクション)
 * - `removed`: 記録を消した
 * - `not-found`: 記録が無かった(seed で作った画像など)
 * - `failed`: 消せなかった(ストレージの失敗、ストレージの宣言が無い)。ログに出す
 */
export type ImageDeletedOutcome = "ignored" | "removed" | "not-found" | "failed";

/** 記録を消し、結果を返す(hook の本体。テストと動作確認のために結果を返す)。例外は投げない */
export async function removeImageRefs(
	event: ImageDeletedEvent,
	ctx: ImageDeletedContext,
): Promise<ImageDeletedOutcome> {
	if (event.collection !== IMAGE_COLLECTION || event.permanent !== true) return "ignored";
	const context = { collection: event.collection, id: event.id };
	const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
	if (imageRefs === undefined) {
		ctx.log.error(
			`content:afterDelete: ctx.storage.${IMAGE_REFS_STORAGE} is missing; the record of the deleted image was not removed. Declare it in the plugin's storage.`,
			context,
		);
		return "failed";
	}
	try {
		return (await imageRefs.delete(event.id)) ? "removed" : "not-found";
	} catch (error) {
		ctx.log.error(
			`content:afterDelete: failed to remove the ${IMAGE_REFS_STORAGE} record of the deleted image`,
			{
				...context,
				error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			},
		);
		return "failed";
	}
}

/** `content:afterDelete` の本体。例外は投げない(失敗は `ctx.log` に出す) */
export async function removeImageRefsAfterDelete(
	event: ImageDeletedEvent,
	ctx: ImageDeletedContext,
): Promise<void> {
	await removeImageRefs(event, ctx);
}

/**
 * T29 が `definePlugin({ hooks })` に登録する設定(`hooks: { ...imageOwnerHooks, ...imageDeletedHooks, … }`)。
 * - `errorPolicy: "continue"`: この hook が(タイムアウトなどで)失敗しても、後に続くプラグインを止めない
 * - `priority`: `IMAGE_DELETED_HOOK_PRIORITY`(ほかのプラグインの例外で飛ばされないよう、既定の 100 より先)
 */
export const imageDeletedHooks = {
	"content:afterDelete": {
		priority: IMAGE_DELETED_HOOK_PRIORITY,
		errorPolicy: "continue",
		handler: removeImageRefsAfterDelete,
	},
} as const;
