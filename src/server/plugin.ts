/**
 * base64-image プラグインの定義(仕様書 4 章・7 章・13 章)。各タスクが作った部品を `definePlugin` にまとめる。
 *
 * - 部品の設定は、各タスクが export したものをそのまま使う。ルートは `PluginRoute<Input>` の定義(T17・T18・T21)を、
 *   参照元の記録(T20)と完全削除の後始末(T21)の hook は `priority` / `errorPolicy` を含む設定を、書き換えずに登録する。
 * - `content:beforeSave` は 1 つのプラグインに 1 つだけ(`hooks` のキー)。`b64_images`(T19)とそれ以外(T16)を
 *   1 つの handler で振り分ける(`validateBeforeSave`)。`errorPolicy` は既定の `"abort"` のまま(`"continue"` にすると、
 *   拒否の例外が捨てられて保存が通る)。
 * - `b64_images` があるかの確認(仕様書 13.1): EmDash 0.39.1 には、`astro.config.mjs` で登録した native プラグインの
 *   起動時に呼ばれる hook が無い(`plugin:install` は呼ばれず、`plugin:activate` は管理者が無効にしたプラグインを有効に
 *   戻したときだけ)。そのため、`plugin:activate` と、このプラグインの定義ができてから最初の `b64_images` 以外の保存
 *   (`content:beforeSave`)で確かめ、無ければエラーのログを出す(`checkImageCollection`)。
 * - 管理画面の部品(React・Kumo)は読み込まない。管理画面の入口は `admin.entry`(`ADMIN_ENTRY`)で、EmDash が
 *   管理画面のバンドルに入れる。`src/shared/constants.ts` は依存の無い定数だけなので読み込んでよい。
 */

import type {
	FieldWidgetConfig,
	LogAccess,
	PluginCapability,
	PluginStorageConfig,
	ResolvedPlugin,
} from "emdash";
import { definePlugin } from "emdash";

import {
	IMAGE_COLLECTION,
	IMAGE_REFS_STORAGE,
	IMAGES_PAGE,
	PLUGIN_ID,
	ROUTES,
	WIDGET_KINDS,
	type WidgetKind,
} from "../shared/constants";
import { imageDeletedHooks } from "./hooks/image-deleted";
import { validateImageEntryBeforeSave, type ImageEntryHookEvent } from "./hooks/image-entry";
import { imageOwnerHooks } from "./hooks/owners";
import { validateReferencesBeforeSave, type ReferenceHookContext } from "./hooks/references";
import { previewRoute, thumbnailsRoute } from "./routes/admin-data";
import { imagesListRoute, imagesTrashRoute } from "./routes/images-admin";
import { uploadRoute } from "./routes/upload";

// ---------------------------------------------------------------------------
// 名前と版
// ---------------------------------------------------------------------------

/** プラグインの版(semver)。descriptor(`src/index.ts`)と `definePlugin` で同じ値を使う。`package.json` の `version` と揃える(tests/package-exports.test.ts) */
export const PLUGIN_VERSION = "0.1.0";

/** パッケージ名(`package.json` の `name`)。descriptor の `entrypoint` になる */
export const PACKAGE_NAME = "emdash-plugin-base64-image";

/**
 * 管理画面の入口(`package.json` の `exports["./admin"]`)。descriptor の `adminEntry`(ビルド時に管理画面のバンドルに
 * 入れる)と、`definePlugin` の `admin.entry`(マニフェストの `adminMode` を `"react"` にする)の両方に使う。
 */
export const ADMIN_ENTRY = `${PACKAGE_NAME}/admin`;

// ---------------------------------------------------------------------------
// capability・ストレージ・widget
// ---------------------------------------------------------------------------

/**
 * capability。宣言が足りないと、EmDash は `ctx` にそのアクセサーを入れない(ルートは 500 になり、hook は登録されない)。
 * - `schema:read`: `ctx.schema`。保存先・参照を持つフィールドの定義(T16・T18・T20)、消されたコレクションの確認(T21)、
 *   `b64_images` があるかの確認(このファイル)
 * - `content:read`: `ctx.content.get`(T17 のプレビュー、T21 の一覧)。`content:afterSave` / `afterPublish` / `afterDelete`
 *   の登録に要る(無いと警告だけ出して登録しない)
 * - `content:write`: `ctx.content.create`(T18)・`delete`(T18 の後始末、T21 のゴミ箱への移動)。`content:beforeSave` の
 *   登録に要る(無いと警告だけ出して登録しない)
 * - `content:publish`: `ctx.content.getVersioned` / `publish`(T18)
 * - `content:revisions:read`: `ctx.content.getRevision`(T21。参照元の下書き)
 * - `content:restore`: `ctx.content.getTrashedVersioned`(T21。画像がゴミ箱に入っているか)。`content:read` は含まない
 */
export const PLUGIN_CAPABILITIES = [
	"schema:read",
	"content:read",
	"content:write",
	"content:publish",
	"content:revisions:read",
	"content:restore",
] as const satisfies readonly PluginCapability[];

/**
 * widget の `label`。EmDash 0.39.1 の管理画面は、native プラグインの widget を管理画面の入口の `fields` から探し
 * (`<プラグイン ID>:<名前>` の名前の部分)、`admin.fieldWidgets` はマニフェストに載せるだけで表示には使わない。
 * サーバーは管理画面の言語を知らないので英語にする。
 */
const FIELD_WIDGET_LABELS = {
	image: "Base64 image",
	gallery: "Base64 image gallery",
} as const satisfies Record<WidgetKind, string>;

/**
 * widget の宣言。`fieldTypes` は `json` だけ。サーバーの検証(T11 の `getFieldWidgetKind`)は、このプラグインの widget を
 * 使う `json` フィールドだけを、保存先と参照を持つフィールドとして扱うため。
 */
function fieldWidgets(): FieldWidgetConfig[] {
	return WIDGET_KINDS.map((name) => ({
		name,
		label: FIELD_WIDGET_LABELS[name],
		fieldTypes: ["json"],
	}));
}

/** プラグインストレージ。`imageRefs` は画像 ID をキーにした記録(仕様書 5.3)。一覧(T21)が `createdAt` で並べて絞る */
function pluginStorage() {
	return {
		[IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] },
	} satisfies PluginStorageConfig;
}

// ---------------------------------------------------------------------------
// content:beforeSave(T19 と T16 の振り分け)
// ---------------------------------------------------------------------------

/**
 * `content:beforeSave` の priority(小さいほど先)。EmDash の既定(100)より後にする。EmDash は前の hook が返した値を
 * 次の hook に渡すので、ほかのプラグインの beforeSave が値を変えたあとの、実際に保存される値を確かめられる。
 */
export const BEFORE_SAVE_HOOK_PRIORITY = 200;

/**
 * beforeSave の振り分け。`b64_images` は画像エントリの検証(T19)、ほかのコレクションは参照の検証(T16)に渡す。
 * どちらも、問題があれば `ContentSaveRejectedError` を投げ(EmDash は 422 `SAVE_REJECTED` にする)、値は変えない。
 * EmDash の `ContentHookEvent` / `PluginContext` をそのまま渡せる。
 */
export async function validateBeforeSave(
	event: ImageEntryHookEvent,
	ctx: ReferenceHookContext,
): Promise<void> {
	if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
	return validateReferencesBeforeSave(event, ctx);
}

// ---------------------------------------------------------------------------
// b64_images があるかの確認(仕様書 13.1)
// ---------------------------------------------------------------------------

/** 確認が使う ctx(EmDash の `PluginContext` の一部。そのまま渡せる)。`schema` は capability `schema:read` があるときだけある */
export interface ImageCollectionCheckContext {
	readonly schema?:
		{ getCollection(slug: string): Promise<{ readonly slug: string } | null> } | undefined;
	readonly log: Pick<LogAccess, "error" | "warn">;
}

/** 確認したところ(ログに出す) */
export type ImageCollectionCheckTrigger = "plugin:activate" | "content:beforeSave";

/**
 * 確認の結果。
 * - `exists`: ある
 * - `missing`: 無い。エラーのログを出した
 * - `unknown`: 確かめられなかった(`ctx.schema` が無い・読み出しに失敗した)。ログを出した
 */
export type ImageCollectionStatus = "exists" | "missing" | "unknown";

/**
 * `b64_images` があるかを `ctx.schema.getCollection` で確かめる(あれば 2 クエリ、無ければコレクションの行の 1 クエリ)。
 * 無ければ、作り方を書いたエラーのログを出す。例外は投げない(保存や有効化を、この確認で止めない)。
 */
export async function checkImageCollection(
	ctx: ImageCollectionCheckContext,
	trigger: ImageCollectionCheckTrigger,
): Promise<ImageCollectionStatus> {
	const context = { collection: IMAGE_COLLECTION, trigger };
	const schema = ctx.schema;
	if (schema === undefined) {
		ctx.log.error(
			`Cannot check whether the "${IMAGE_COLLECTION}" collection exists: ctx.schema is missing. Declare the "schema:read" capability.`,
			context,
		);
		return "unknown";
	}
	let collection: { readonly slug: string } | null;
	try {
		collection = await schema.getCollection(IMAGE_COLLECTION);
	} catch (error) {
		ctx.log.warn(`Failed to check whether the "${IMAGE_COLLECTION}" collection exists`, {
			...context,
			error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
		});
		return "unknown";
	}
	if (collection) return "exists";
	ctx.log.error(
		`The "${IMAGE_COLLECTION}" collection does not exist, so images cannot be uploaded (the upload route returns IMAGE_COLLECTION_MISSING). ` +
			`This plugin cannot create collections: add it to the site's seed, or create it with the schema API ` +
			`(hidden: true, routable: false, supports: [], and a required "image" field of type json).`,
		context,
	);
	return "missing";
}

/**
 * `checkImageCollection` を 1 回だけ行う関数を作る。2 回目以降と、確認の途中に来た呼び出しは何もしない(クエリなし。
 * 結果は `skipped`)。1 回目が確かめられなかった(`unknown`)ときも、やり直さない(ログは 1 回だけにする)。
 */
export function createImageCollectionCheck(): (
	ctx: ImageCollectionCheckContext,
	trigger: ImageCollectionCheckTrigger,
) => Promise<ImageCollectionStatus | "skipped"> {
	let started = false;
	return async (ctx, trigger) => {
		if (started) return "skipped";
		started = true;
		return checkImageCollection(ctx, trigger);
	};
}

// ---------------------------------------------------------------------------
// definePlugin
// ---------------------------------------------------------------------------

/**
 * プラグインを作る(`src/index.ts` の `createPlugin()`)。EmDash は、生成する仮想モジュールの中で 1 回呼ぶ。
 * `b64_images` の確認を 1 回だけにする状態は、ここで作ったプラグインごとに持つ。
 */
export function createBase64ImagePlugin(): ResolvedPlugin<ReturnType<typeof pluginStorage>> {
	const checkImageCollectionOnce = createImageCollectionCheck();

	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		capabilities: [...PLUGIN_CAPABILITIES],
		storage: pluginStorage(),
		hooks: {
			// 管理者が、無効にしたこのプラグインを有効に戻したときだけ呼ばれる(astro.config.mjs で登録した
			// native プラグインでは、起動時には呼ばれない)
			"plugin:activate": {
				handler: async (_event, ctx) => {
					await checkImageCollection(ctx, "plugin:activate");
				},
			},
			// errorPolicy は書かない(既定の "abort")。priority は既定より後
			"content:beforeSave": {
				priority: BEFORE_SAVE_HOOK_PRIORITY,
				handler: async (event, ctx) => {
					// `b64_images` への保存では確かめない。beforeSave はコレクションがあるかを確かめる前に呼ばれ、
					// 無いときはこのあと EmDash が COLLECTION_NOT_FOUND で止める(アップロードのルートは
					// IMAGE_COLLECTION_MISSING を返す)。
					if (event.collection !== IMAGE_COLLECTION) {
						await checkImageCollectionOnce(ctx, "content:beforeSave");
					}
					await validateBeforeSave(event, ctx);
				},
			},
			// content:afterSave / content:afterPublish(T20)と content:afterDelete(T21)。
			// priority: 50・errorPolicy: "continue" を含む設定をそのまま使う(上書きしない)
			...imageOwnerHooks,
			...imageDeletedHooks,
		},
		routes: {
			[ROUTES.upload]: uploadRoute,
			[ROUTES.preview]: previewRoute,
			[ROUTES.thumbnails]: thumbnailsRoute,
			[ROUTES.imagesList]: imagesListRoute,
			[ROUTES.imagesTrash]: imagesTrashRoute,
		},
		admin: {
			entry: ADMIN_ENTRY,
			fieldWidgets: fieldWidgets(),
			pages: [IMAGES_PAGE],
		},
	});
}
