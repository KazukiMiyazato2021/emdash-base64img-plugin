/**
 * アップロード用ルート(仕様書 7 章)。
 *
 * widget(T23・T27・T28)が、ブラウザで圧縮した画像を 1 枚ずつ送る。ハンドラーは次の順に処理する。
 *
 * 1. ロケールを決める。画像エントリはサイトの既定ロケールで作る(仕様書 5.1)。`target.locale` は、サイトに設定された
 *    ロケール(EmDash の `getI18nConfig()`。Astro の `i18n` から作られる)と照らし合わせる。
 * 2. 検証する(仕様書 8 章①。T11 の `validateUpload`)。保存先のフィールド定義は `ctx.schema.getCollection` で読む(2 クエリ)。
 * 3. `ctx.content.create("b64_images", { image })` で画像エントリを作る(下書き)。このとき、同じプラグインの
 *    `content:beforeSave`(T19)が、画像エントリの値をもう一度検証する(仕様書 8 章②。書き込み元を除外できないため)。
 * 4. `imageRefs` にメタデータを保存する。`target.entryId` があれば、最初の参照元として記録する(仕様書 9 章。
 *    このプラグイン自身の `content:afterSave` は、自分の `create` では呼ばれない)。
 * 5. `getVersioned` → `publish` で公開する(Contributor には公開の権限が無く、下書きのままではサイトに出ないため)。
 * 6. 参照(`alt` は空)を返す。
 *
 * - 4 を公開より先にするのは、途中で失敗したり処理が止まったりしたときに、作った画像エントリを画像管理ページ
 *   (T21。`imageRefs` を一覧する)から見つけて消せるようにするため。
 * - 3 で保存 hook が拒否したら 400 `IMAGE_ENTRY_INVALID`、ほかの理由で作れなければ 500 `UPLOAD_FAILED`(`b64_images` が
 *   無ければ `IMAGE_COLLECTION_MISSING`)。どちらも何も作られない。
 * - 3 のあとで失敗したら、作った画像エントリをゴミ箱に移して(プラグインは完全削除できない)、500 `UPLOAD_FAILED` にする。
 *   `imageRefs` の記録は残す(画像管理ページで「ゴミ箱に入った・参照元なし」の画像として完全削除できる)。
 * - クエリ数は、SQLite で 1 回 75(ルートの固定費 1、フィールド定義 2、作成 30、`imageRefs` 1、取得 3、公開 38)。
 *   作成と公開のそれぞれ 15 本は、EmDash 本体のメディアの使用状況の索引の更新。i18n を設定したサイトでは、公開で
 *   さらに 2 本増えて 77(docs/emdash-plugin-upload-route.md)。
 *
 * 登録は T29 が行う(ルートが使う capability は `schema:read` / `content:write` / `content:publish`、ストレージは `imageRefs`):
 * `definePlugin({ capabilities: ["schema:read", "content:write", "content:publish", …], storage: { imageRefs: { indexes: ["createdAt"] } }, routes: { [ROUTES.upload]: uploadRoute } })`
 */

import type { PluginRoute } from "emdash";
import { getI18nConfig, PluginRouteError } from "emdash";

import {
	IMAGE_COLLECTION,
	IMAGE_FIELD,
	IMAGE_REFS_STORAGE,
	ROUTE_PERMISSIONS,
	SCHEMA_VERSION,
	WEBP_MIME_TYPE,
} from "../../shared/constants";
import { ERROR_HTTP_STATUS } from "../../shared/errors";
import { localeSchema, uploadRequestSchema } from "../../shared/schema";
import type {
	Base64ImageEntry,
	Base64ImageRef,
	ImageOwner,
	ImageRefsRecord,
	UploadRequest,
	UploadResponse,
} from "../../shared/types";
import { validateUpload, type CollectionSchemaLike } from "../validate";

// ログと例外のメッセージには、プラグイン ID を付けない。EmDash が `[plugin:base64-image]` を付けて出す。

// ---------------------------------------------------------------------------
// 上限と既定値
// ---------------------------------------------------------------------------

/**
 * アップロードの body の上限(バイト)。
 * 正しい入力の body は最大 511,515 バイト(dataUrl 500,000 文字、thumb 8,000 文字、絵文字 255 文字の filename を
 * `\uXXXX` で書いたもの、最大の長さの slug と entryId、`MAX_TARGET_LOCALE_LENGTH` 文字の `target.locale`)で、
 * それに余裕を足した(テストで確かめる)。宣言しないと、EmDash は body を上限なしに読む(docs/emdash-plugin-route-body-limit.md)。
 */
export const UPLOAD_MAX_BODY_BYTES = 600_000;

/**
 * i18n を設定していないサイトで受け付ける `target.locale` の長さの上限(文字)。
 * ロケールのスキーマ(EmDash の `LOCALE_CODE_PATTERN` と同じ規則)は長さを制限しないので、`imageRefs` の参照元に
 * 長い文字列を保存しないよう、ここで抑える。35 は、RFC 5646(BCP 47)4.4.1 が「言語タグの長さを制限する仕様は、
 * 少なくとも 35 文字のタグを受け付けなければならない(MUST)」とする長さ。超えたものは拒否する(切り詰めない)。
 * i18n を設定したサイトでは、設定されたロケールと照らし合わせる(長さは見ない)。
 */
export const MAX_TARGET_LOCALE_LENGTH = 35;

/**
 * i18n を設定していないサイトで、EmDash がエントリを作るときのロケール
 * (`references/emdash/packages/core/src/i18n/config.ts:73` の `resolveContentCreateLocale`)。
 */
export const DEFAULT_CONTENT_LOCALE = "en";

/**
 * 保存 hook の拒否(`SAVE_REJECTED`)のメッセージを、応答に入れる長さの上限(文字)。
 * メッセージはプラグインが編集者向けに書いたもの(EmDash の保存の API も、そのまま返す)だが、長さの決まりは無い。
 */
export const MAX_HOOK_MESSAGE_LENGTH = 1_000;

// ---------------------------------------------------------------------------
// ハンドラーが使う ctx(EmDash の `RouteContext<UploadRequest>` の一部)
// ---------------------------------------------------------------------------

/** 作成した画像エントリのうち、この処理が使う部分(EmDash の `ContentItem` の一部) */
export interface CreatedEntry {
	readonly id: string;
	/** EmDash が保存したロケール(`ContentRepository.create` は `locale || "en"` で保存するので、実際は null にならない) */
	readonly locale: string | null;
}

/**
 * この処理が使う content の操作(EmDash の `ContentAccess` の一部)。
 * - `create` / `delete`: capability `content:write` を宣言したときだけある
 * - `getVersioned` / `publish`: capability `content:publish` を宣言したときだけある
 */
export interface UploadContentAccess {
	create?(collection: string, data: Record<string, unknown>): Promise<CreatedEntry>;
	getVersioned?(collection: string, id: string): Promise<{ readonly _rev: string } | null>;
	publish?(collection: string, id: string, options: { _rev: string }): Promise<unknown>;
	/** ゴミ箱に移す(完全削除ではない)。見つからなければ false */
	delete?(collection: string, id: string): Promise<boolean>;
}

/** プラグインストレージ `imageRefs` のうち、この処理が使う部分(EmDash の `StorageCollection` の一部) */
export interface ImageRefsWriter {
	put(id: string, data: ImageRefsRecord): Promise<void>;
}

/**
 * アップロードのハンドラーが使う ctx。ルートでは EmDash の `RouteContext<UploadRequest>` が渡る(型のテストで確かめる)。
 * - `user`: private ルートでは EmDash が認証済みの利用者を入れる(型は省略可能)
 * - `schema`: capability `schema:read` を宣言したときだけある
 * - `storage[IMAGE_REFS_STORAGE]`: ストレージ `imageRefs` を宣言したときだけある
 */
export interface UploadRouteContext {
	readonly input: UploadRequest;
	readonly user?: { readonly id: string } | undefined;
	readonly schema?:
		{ getCollection(slug: string): Promise<CollectionSchemaLike | null> } | undefined;
	readonly content?: UploadContentAccess | undefined;
	readonly storage: { readonly [name: string]: ImageRefsWriter | undefined };
	readonly log: { error(message: string, data?: unknown): void };
}

/**
 * サイトの i18n の設定のうち、この処理が使う部分。EmDash の `getI18nConfig()` の結果(`I18nConfig`)をそのまま渡せる。
 * `locales` は、Astro の `i18n.locales` の文字列(オブジェクトの形なら `path`)を並べたもの。
 */
export interface I18nConfigLike {
	readonly defaultLocale: string;
	readonly locales: readonly string[];
}

/** `createUploadHandler` の options。テストで差し替えるためにある */
export interface UploadHandlerOptions {
	/** サイトの i18n の設定を読む。i18n を設定していないサイトでは null。既定は EmDash の `getI18nConfig` */
	readonly getI18nConfig?: (() => I18nConfigLike | null) | undefined;
	/** 今の時刻(`imageRefs.createdAt`)。既定は `new Date()` */
	readonly now?: (() => Date) | undefined;
}

// ---------------------------------------------------------------------------
// ロケール
// ---------------------------------------------------------------------------

/**
 * 画像エントリを作るロケール。`ctx.content.create` の既定と同じ、サイトの既定ロケール(仕様書 5.1)。
 * EmDash の `resolveContentCreateLocale(undefined)` は `config?.defaultLocale ?? "en"` を返す。
 */
export function defaultContentLocale(config: I18nConfigLike | null): string {
	return config === null ? DEFAULT_CONTENT_LOCALE : config.defaultLocale;
}

export type TargetLocaleResult =
	{ readonly ok: true; readonly locale: string } | { readonly ok: false; readonly message: string };

/**
 * `target.locale`(参照元のエントリのロケール)を、サイトに設定されたロケールと照らし合わせる。
 * 結果の `locale` は、`imageRefs` の参照元に記録するロケール。
 *
 * - 省略されたら、サイトの既定ロケール(EmDash がロケールを指定せずに作ったエントリと同じ)。
 * - i18n を設定したサイト: 設定されたロケールのどれかと、大文字・小文字を区別せずに一致すること。
 *   結果は設定の表記にそろえる(EmDash の `resolveContentCreateLocale` と同じ)。
 * - i18n を設定していないサイト: EmDash はどのロケールのエントリも作れるので、形(スキーマで確かめ済み)と
 *   長さ(`MAX_TARGET_LOCALE_LENGTH`)だけを確かめる。
 */
export function resolveTargetLocale(
	locale: string | undefined,
	config: I18nConfigLike | null,
): TargetLocaleResult {
	if (locale === undefined) return { ok: true, locale: defaultContentLocale(config) };
	if (config !== null) {
		const lower = locale.toLowerCase();
		const configured = config.locales.find((candidate) => candidate.toLowerCase() === lower);
		if (configured !== undefined) return { ok: true, locale: configured };
		return {
			ok: false,
			message: `target.locale ${quote(locale)} is not configured for this site (configured: ${config.locales.join(", ")})`,
		};
	}
	if (locale.length > MAX_TARGET_LOCALE_LENGTH) {
		return {
			ok: false,
			message: `target.locale is ${locale.length} characters long, which exceeds the limit of ${MAX_TARGET_LOCALE_LENGTH}`,
		};
	}
	return { ok: true, locale };
}

/** 参照の `locale` に使えるロケールか(`base64ImageRefSchema` の `locale`) */
function isRefLocale(locale: string): boolean {
	return localeSchema.safeParse(locale).success;
}

// ---------------------------------------------------------------------------
// ハンドラー
// ---------------------------------------------------------------------------

/** 失敗したときに、どの処理だったかをメッセージに書くための文 */
const STEP_TEXT = {
	create: "create the image entry",
	locale: "use the locale of the created image entry",
	imageRefs: `save the metadata to "${IMAGE_REFS_STORAGE}"`,
	publish: "publish the image entry",
} as const;
type UploadStep = keyof typeof STEP_TEXT;

/** ハンドラーを作る。ルートには既定の options で作った `handleUpload` を登録する */
export function createUploadHandler(
	options: UploadHandlerOptions = {},
): (ctx: UploadRouteContext) => Promise<UploadResponse> {
	const readI18nConfig = options.getI18nConfig ?? getI18nConfig;
	const now = options.now ?? (() => new Date());
	return (ctx) => upload(ctx, readI18nConfig(), now);
}

/** アップロードのハンドラー(仕様書 7 章。処理の順番はファイルの先頭のコメント) */
export const handleUpload = createUploadHandler();

async function upload(
	ctx: UploadRouteContext,
	i18n: I18nConfigLike | null,
	now: () => Date,
): Promise<UploadResponse> {
	// private ルートでは EmDash が認証済みの利用者を入れるが、型は省略可能なので絞り込む
	const user = ctx.user;
	if (user === undefined) throw PluginRouteError.unauthorized();
	// capability とストレージの宣言が足りないのはプラグインの定義の誤り。何かを作る前に、500 にする
	const deps = requireDependencies(ctx);
	const input = ctx.input; // uploadRequestSchema で検証済み(合わなければ 400 VALIDATION_ERROR で、ここには来ない)

	// 1. ロケール
	const imageLocale = defaultContentLocale(i18n);
	if (!isRefLocale(imageLocale)) {
		// Astro の i18n で、ロケールをオブジェクト(`{ path, codes }`)で書くと、EmDash は `path` をロケールにする
		// (`references/emdash/packages/core/src/i18n/normalize.ts`)。参照の `locale` に入らない値だと、作った画像を
		// 参照として保存できないので、作る前に止める。サイトの設定の誤りなので、500 `INTERNAL_ERROR` にしてログに出す
		throw new Error(
			`The default locale ${quote(imageLocale)} of this site is not a locale code that image references can hold`,
		);
	}
	const ownerLocale = resolveTargetLocale(input.target.locale, i18n);
	if (ownerLocale.ok === false) {
		throw new PluginRouteError(
			"INVALID_TARGET",
			ownerLocale.message,
			ERROR_HTTP_STATUS.INVALID_TARGET,
		);
	}

	// 2. 検証(仕様書 8 章①)
	const collection = await deps.schema.getCollection(input.target.collection);
	const checked = validateUpload(input, collection);
	// `=== false` で比べる(利用者の設定で strictNullChecks が無効でも絞り込まれるように。T04-1)
	if (checked.ok === false) {
		throw new PluginRouteError(checked.code, checked.message, ERROR_HTTP_STATUS[checked.code]);
	}

	// 3. 作成(同じプラグインの content:beforeSave が、画像エントリの値を検証する。仕様書 8 章②)
	const image: Base64ImageEntry = {
		src: input.dataUrl,
		mimeType: WEBP_MIME_TYPE,
		width: input.width,
		height: input.height,
		...(input.filename === undefined ? {} : { filename: input.filename }),
		// meta.bytes は、検証がデコードした WebP 本体のバイト数(② が一致を確かめる)
		meta: { v: SCHEMA_VERSION, bytes: checked.image.webpBytes, quality: input.quality },
	};
	let created: CreatedEntry;
	try {
		created = await deps.content.create(IMAGE_COLLECTION, { [IMAGE_FIELD]: image });
	} catch (error) {
		throw createFailure(ctx, error);
	}
	const id = created.id;
	// 参照の locale は、EmDash が保存したロケール(ふつうは imageLocale と同じ)
	const refLocale = created.locale ?? imageLocale;
	if (!isRefLocale(refLocale)) {
		throw await abandonImage(
			ctx,
			deps,
			id,
			"locale",
			new Error(`The image entry was created with the locale ${quote(refLocale)}`),
		);
	}

	// 4. メタデータ(公開より先に保存する。ファイルの先頭のコメント)
	const owners: ImageOwner[] =
		input.target.entryId === undefined
			? []
			: [
					{
						collection: input.target.collection,
						entryId: input.target.entryId,
						locale: ownerLocale.locale,
						field: input.target.field,
					},
				];
	const record: ImageRefsRecord = {
		owners,
		bytes: checked.image.webpBytes,
		width: input.width,
		height: input.height,
		thumb: input.thumb,
		createdAt: now().toISOString(),
		createdBy: user.id,
	};
	try {
		await deps.imageRefs.put(id, record);
	} catch (error) {
		throw await abandonImage(ctx, deps, id, "imageRefs", error);
	}

	// 5. 公開
	try {
		const versioned = await deps.content.getVersioned(IMAGE_COLLECTION, id);
		if (versioned === null) throw new Error("getVersioned returned null");
		// `_rev` は EmDash の版のトークン。中身は見ずに、そのまま渡す(`skills/creating-plugins/references/content.md`)
		const { _rev: rev } = versioned;
		await deps.content.publish(IMAGE_COLLECTION, id, { _rev: rev });
	} catch (error) {
		throw await abandonImage(ctx, deps, id, "publish", error);
	}

	// 6. 参照
	const ref: Base64ImageRef = {
		v: SCHEMA_VERSION,
		id,
		locale: refLocale,
		width: input.width,
		height: input.height,
		alt: "",
	};
	return { ref };
}

export const uploadRoute: PluginRoute<UploadRequest> = {
	permission: ROUTE_PERMISSIONS.upload, // "content:create"(Contributor 以上)
	methods: ["POST"],
	request: { body: "json", maxBytes: UPLOAD_MAX_BODY_BYTES },
	input: uploadRequestSchema,
	handler: handleUpload,
};

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 宣言がそろったときの依存(メソッドは、元のオブジェクトを `this` にして呼ぶ) */
interface UploadDependencies {
	readonly schema: NonNullable<UploadRouteContext["schema"]>;
	readonly content: Required<UploadContentAccess>;
	readonly imageRefs: ImageRefsWriter;
}

/** capability とストレージの宣言を確かめる。足りなければ通常の `Error`(EmDash が 500 `INTERNAL_ERROR` にしてログに出す) */
function requireDependencies(ctx: UploadRouteContext): UploadDependencies {
	const schema = ctx.schema;
	if (schema === undefined) {
		throw new Error(`ctx.schema is missing. Declare the "schema:read" capability.`);
	}
	const content = ctx.content;
	const create = content?.create;
	const remove = content?.delete;
	if (content === undefined || create === undefined || remove === undefined) {
		throw new Error(`ctx.content.create is missing. Declare the "content:write" capability.`);
	}
	const getVersioned = content.getVersioned;
	const publish = content.publish;
	if (getVersioned === undefined || publish === undefined) {
		throw new Error(`ctx.content.publish is missing. Declare the "content:publish" capability.`);
	}
	const imageRefs = ctx.storage[IMAGE_REFS_STORAGE];
	if (imageRefs === undefined) {
		throw new Error(
			`ctx.storage.${IMAGE_REFS_STORAGE} is missing. Declare it in the plugin's storage.`,
		);
	}
	return {
		schema,
		content: {
			create: (collection, data) => create.call(content, collection, data),
			getVersioned: (collection, entryId) => getVersioned.call(content, collection, entryId),
			publish: (collection, entryId, options) =>
				publish.call(content, collection, entryId, options),
			delete: (collection, entryId) => remove.call(content, collection, entryId),
		},
		imageRefs,
	};
}

/**
 * 作成に失敗したときの例外。何も作られていない(保存 hook と EmDash の検証は、行を書く前に行う)ので、後始末は要らない。
 * `ctx.content.create` は、失敗を `name` と `code` にコードを入れた通常の `Error` で投げる
 * (`references/emdash/packages/core/src/emdash-runtime.ts:2149-2155`)。
 * - `SAVE_REJECTED`: `content:beforeSave` が拒否した(このプラグインの ② の検証、またはほかのプラグイン)
 *   → 400 `IMAGE_ENTRY_INVALID`。hook のメッセージを添える。そのまま投げ直すと、EmDash は 500 `INTERNAL_ERROR` にする。
 *   ① を通った値は ② も通る(T11)ので、ふつうは起きない
 * - `COLLECTION_NOT_FOUND`(`b64_images` が無い。`references/emdash/packages/core/src/api/handlers/validation.ts:157`)
 *   → 500 `IMAGE_COLLECTION_MISSING`
 * - それ以外(`VALIDATION_ERROR` = `b64_images` の形が違う、データベースのエラーなど)→ 500 `UPLOAD_FAILED`
 */
function createFailure(ctx: UploadRouteContext, error: unknown): PluginRouteError {
	ctx.log.error(`Failed to ${STEP_TEXT.create}`, describeError(error));
	const code = errorCodeOf(error);
	if (code === "SAVE_REJECTED") {
		const reason = error instanceof Error ? error.message : "";
		return new PluginRouteError(
			"IMAGE_ENTRY_INVALID",
			`The image entry was rejected by a content:beforeSave hook: ${truncate(reason, MAX_HOOK_MESSAGE_LENGTH)}`,
			ERROR_HTTP_STATUS.IMAGE_ENTRY_INVALID,
		);
	}
	if (code === "COLLECTION_NOT_FOUND") {
		return new PluginRouteError(
			"IMAGE_COLLECTION_MISSING",
			`The "${IMAGE_COLLECTION}" collection does not exist`,
			ERROR_HTTP_STATUS.IMAGE_COLLECTION_MISSING,
		);
	}
	return new PluginRouteError(
		"UPLOAD_FAILED",
		`Failed to ${STEP_TEXT.create}${code === undefined ? "" : ` (${code})`}`,
		ERROR_HTTP_STATUS.UPLOAD_FAILED,
	);
}

/**
 * 作成のあとで失敗したときの後始末。作った画像エントリをゴミ箱に移し、500 `UPLOAD_FAILED` の例外を返す。
 * ゴミ箱に移せなくても(データベースのエラーなど)、ログに出して同じ例外を返す。`imageRefs` の記録は消さない。
 */
async function abandonImage(
	ctx: UploadRouteContext,
	deps: UploadDependencies,
	id: string,
	step: UploadStep,
	error: unknown,
): Promise<PluginRouteError> {
	ctx.log.error(
		`Failed to ${STEP_TEXT[step]}; moving the image entry ${id} to the trash`,
		describeError(error),
	);
	try {
		const trashed = await deps.content.delete(IMAGE_COLLECTION, id);
		if (!trashed) ctx.log.error(`The image entry ${id} to move to the trash was not found`);
	} catch (cleanupError) {
		ctx.log.error(`Failed to move the image entry ${id} to the trash`, describeError(cleanupError));
	}
	const code = errorCodeOf(error);
	return new PluginRouteError(
		"UPLOAD_FAILED",
		`Failed to ${STEP_TEXT[step]}${code === undefined ? "" : ` (${code})`}; the image entry ${id} was moved to the trash`,
		ERROR_HTTP_STATUS.UPLOAD_FAILED,
	);
}

/** EmDash の content の操作が投げる例外の `code`(`SAVE_REJECTED` など)。SCREAMING_SNAKE_CASE でなければ undefined */
function errorCodeOf(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code: unknown = (error as { code?: unknown }).code;
	return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : undefined;
}

/** ログに出す、例外の要点 */
function describeError(error: unknown): Readonly<Record<string, string>> {
	const code = errorCodeOf(error);
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			...(code === undefined ? {} : { code }),
		};
	}
	return { message: String(error) };
}

/** メッセージに入れる値。長い値は切り詰める(body の上限までの長さの文字列が来うる) */
function quote(value: string): string {
	return JSON.stringify(truncate(value, 64));
}

/** `max` 文字を超えたら切り詰めて「…」を付ける */
function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}…` : value;
}
