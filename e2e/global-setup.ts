/**
 * E2E の前準備(Playwright の `globalSetup`。開発サーバーは、この前に `webServer` が起動している)。
 *
 * 1. 入力画像(`e2e/fixtures/images/`)が無ければ `node e2e/fixtures/make-images.ts` で作る(macOS の `sips` が要る)。
 * 2. 管理者でログインし(開発用ログイン。空のデータベースなら seed の適用と管理者の作成も行う)、歓迎のダイアログを
 *    API で閉じた状態にして、ログインの状態を `e2e/.cache/auth/admin.json` に書く。管理画面の言語は日本語(cookie)。
 * 3. ロールごとの利用者(編集者・投稿者・寄稿者・閲覧者)を作り、それぞれのログインの状態を書く([[#ロールの利用者]])。
 * 4. テスト用のコレクションを足す: `notes`(このプラグインのフィールドなし)と `albums`(ギャラリーだけ、上限 3 枚)。
 *    `posts` の title を検索の対象にする(コマンドパレットで投稿を探すため。検索は公開済みの投稿だけを返す)。
 * 5. API で上げる画像(WebP の data URL とサムネイル)を Chromium の canvas で作る。
 * 6. 管理画面とサイトを 1 回開いておく。開発サーバーは、初めてブラウザが接続したときに Vite が依存を最適化して
 *    ページを読み直すことがあるため(docs/playground-site-pages.md)。
 *
 * ## ロールの利用者
 * EmDash 0.39.1 の開発用ログイン(`/_emdash/api/auth/dev-bypass`)は、メールアドレス `dev@emdash.local` の利用者で
 * ログインする。パスキーを使わずにほかの利用者のセッションを作る API は無い。そこで、playground の SQLite に利用者を
 * 直接足し、メールアドレスを一時的に入れ替えてから開発用ログインを呼び、その利用者のセッションを作る。EmDash は要求の
 * たびにセッションの利用者 ID から利用者を読み直す(`packages/core/src/astro/middleware/auth.ts:437-447`)ので、
 * 入れ替えを戻したあとも、セッションはその利用者のまま使える。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { chromium, firefox, request, type APIRequestContext } from "@playwright/test";

import { readData, type SampleImage } from "./support/api";
import {
	ADMIN_LOCALE_COOKIE,
	authStatePath,
	BASE_URL,
	CSRF_HEADERS,
	FIXTURE_IMAGES,
	PLAYGROUND_DATABASE,
	ROLES,
	ROOT,
	SAMPLE_IMAGE_PATH,
	type RoleName,
} from "./support/env";
import { ALL_FIXTURES } from "./support/images";

const DEV_EMAIL = "dev@emdash.local";
/** 入れ替えの間、管理者のメールアドレスを置いておく値 */
const PARKED_EMAIL = "e2e-parked-dev-admin@example.test";
/** global setup が作る利用者の名前の先頭 */
const E2E_USER_PREFIX = "E2E ";

function roleEmail(role: RoleName): string {
	return `e2e-${role}@example.test`;
}

// ---------------------------------------------------------------------------
// 1. 入力画像
// ---------------------------------------------------------------------------

function ensureFixtureImages(): void {
	const missing = ALL_FIXTURES.filter((name) => !existsSync(join(FIXTURE_IMAGES, name)));
	if (missing.length === 0) return;
	console.log(`[e2e] 入力画像を作ります(無いもの: ${missing.length} 個)`);
	execFileSync(process.execPath, [join(ROOT, "e2e", "fixtures", "make-images.ts")], {
		cwd: ROOT,
		stdio: "inherit",
	});
}

// ---------------------------------------------------------------------------
// 2・3. ログイン
// ---------------------------------------------------------------------------

/** ログインの状態を、管理画面の言語(日本語)の cookie を足して書く */
async function saveAuthState(context: APIRequestContext, role: RoleName): Promise<void> {
	const state = await context.storageState();
	state.cookies.push({
		name: ADMIN_LOCALE_COOKIE,
		value: "ja",
		domain: "localhost",
		path: "/_emdash",
		expires: -1,
		httpOnly: false,
		secure: false,
		sameSite: "Lax",
	});
	const path = authStatePath(role);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, "\t"));
}

/** 歓迎のダイアログを閉じた状態にする(管理画面の「はじめる」と同じ API。利用者の data に記録される) */
async function dismissWelcome(context: APIRequestContext): Promise<void> {
	const response = await context.post("/_emdash/api/auth/me", {
		headers: CSRF_HEADERS,
		data: { action: "dismissWelcome" },
	});
	await readData(response, "歓迎のダイアログを閉じる");
}

/** 管理者でログインする。空のデータベースなら、seed の適用と管理者の作成も行われる */
async function loginAdmin(): Promise<void> {
	const context = await request.newContext({ baseURL: BASE_URL });
	try {
		const response = await context.get("/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin", {
			maxRedirects: 0,
		});
		if (response.status() !== 200) {
			throw new Error(`開発用ログインに失敗しました(HTTP ${response.status()})`);
		}
		await dismissWelcome(context);
		const me = await readData<{ role: number }>(
			await context.get("/_emdash/api/auth/me"),
			"管理者の確認",
		);
		if (me.role !== ROLES.admin) throw new Error(`管理者のロールが ${me.role} です`);
		await saveAuthState(context, "admin");
	} finally {
		await context.dispose();
	}
}

/** 前の実行が入れ替えの途中で止まっていたら、メールアドレスを戻す */
function repairParkedAdmin(db: DatabaseSync): void {
	const parked = db.prepare("SELECT id FROM users WHERE email = ?").get(PARKED_EMAIL);
	if (parked === undefined) return;
	const holder = db.prepare("SELECT id, role FROM users WHERE email = ?").get(DEV_EMAIL) as
		{ id: string; role: number } | undefined;
	if (holder !== undefined) {
		const role = (Object.keys(ROLES) as RoleName[]).find((name) => ROLES[name] === holder.role);
		if (role === undefined || role === "admin") {
			throw new Error(
				"メールアドレスの入れ替えを戻せません。playground のデータベースを確かめてください",
			);
		}
		db.prepare("UPDATE users SET email = ? WHERE id = ?").run(roleEmail(role), holder.id);
	}
	db.prepare("UPDATE users SET email = ? WHERE email = ?").run(DEV_EMAIL, PARKED_EMAIL);
}

/** ULID の形の ID(EmDash の利用者 ID と同じ形) */
function newUlid(): string {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let time = Date.now();
	let head = "";
	for (let i = 0; i < 10; i++) {
		head = alphabet[time % 32] + head;
		time = Math.floor(time / 32);
	}
	let tail = "";
	for (let i = 0; i < 16; i++) tail += alphabet[Math.floor(Math.random() * 32)];
	return head + tail;
}

/** ロールの利用者を作る(あればロールを合わせる)。歓迎のダイアログは閉じた状態にする */
function ensureRoleUser(db: DatabaseSync, role: RoleName): string {
	const email = roleEmail(role);
	const found = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
		{ id: string } | undefined;
	const now = new Date().toISOString();
	if (found !== undefined) {
		db.prepare("UPDATE users SET role = ?, disabled = 0, updated_at = ? WHERE id = ?").run(
			ROLES[role],
			now,
			found.id,
		);
		return found.id;
	}
	const id = newUlid();
	db.prepare(
		`INSERT INTO users (id, email, name, role, email_verified, data, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
	).run(
		id,
		email,
		`${E2E_USER_PREFIX}${role}`,
		ROLES[role],
		JSON.stringify({ welcomeDismissed: true }),
		now,
		now,
	);
	return id;
}

/** メールアドレスを入れ替えて開発用ログインを呼び、その利用者のセッションを作る */
async function loginAs(db: DatabaseSync, role: RoleName, userId: string): Promise<void> {
	db.prepare("UPDATE users SET email = ? WHERE email = ?").run(PARKED_EMAIL, DEV_EMAIL);
	const context = await request.newContext({ baseURL: BASE_URL });
	try {
		db.prepare("UPDATE users SET email = ? WHERE id = ?").run(DEV_EMAIL, userId);
		const user = await readData<{ user: { id: string; role: number } }>(
			await context.get("/_emdash/api/auth/dev-bypass"),
			`${role} の開発用ログイン`,
		);
		if (user.user.id !== userId || user.user.role !== ROLES[role]) {
			throw new Error(`${role} でログインできませんでした: ${JSON.stringify(user.user)}`);
		}
	} finally {
		db.prepare("UPDATE users SET email = ? WHERE id = ?").run(roleEmail(role), userId);
		db.prepare("UPDATE users SET email = ? WHERE email = ?").run(DEV_EMAIL, PARKED_EMAIL);
	}
	try {
		const me = await readData<{ id: string; role: number }>(
			await context.get("/_emdash/api/auth/me"),
			`${role} の確認`,
		);
		if (me.id !== userId) throw new Error(`${role} のセッションが別の利用者になりました`);
		await saveAuthState(context, role);
	} finally {
		await context.dispose();
	}
}

async function loginRoleUsers(): Promise<void> {
	const db = new DatabaseSync(PLAYGROUND_DATABASE);
	try {
		db.exec("PRAGMA busy_timeout = 10000");
		repairParkedAdmin(db);
		for (const role of ["editor", "author", "contributor", "subscriber"] as const) {
			const userId = ensureRoleUser(db, role);
			// oxlint-disable-next-line no-await-in-loop -- 入れ替えは 1 人ずつ行う(同じメールアドレスを使うため)
			await loginAs(db, role, userId);
		}
	} finally {
		db.close();
	}
}

// ---------------------------------------------------------------------------
// 4. コレクション・検索
// ---------------------------------------------------------------------------

interface CollectionSpec {
	slug: string;
	label: string;
	fields: Record<string, unknown>[];
}

const EXTRA_COLLECTIONS: readonly CollectionSpec[] = [
	{
		// このプラグインのフィールドが無いコレクション(一覧に画像の列が出ないこと)
		slug: "notes",
		label: "Notes",
		fields: [{ slug: "title", label: "Title", type: "string", required: true }],
	},
	{
		// ギャラリーだけのコレクション(一覧の列が 1 枚目と「+N」を出すこと)
		slug: "albums",
		label: "Albums",
		fields: [
			{ slug: "title", label: "Title", type: "string", required: true },
			{
				slug: "photos",
				label: "Photos",
				type: "json",
				widget: "base64-image:gallery",
				options: { maxItems: 3 },
			},
		],
	},
];

async function ensureCollections(api: APIRequestContext): Promise<void> {
	for (const collection of EXTRA_COLLECTIONS) {
		// oxlint-disable-next-line no-await-in-loop -- コレクションとフィールドは順に作る
		const existing = await api.get(`/_emdash/api/schema/collections/${collection.slug}`);
		if (existing.ok()) continue;
		// oxlint-disable-next-line no-await-in-loop -- 同上
		const created = await api.post("/_emdash/api/schema/collections", {
			headers: CSRF_HEADERS,
			data: { slug: collection.slug, label: collection.label, supports: ["drafts"] },
		});
		// oxlint-disable-next-line no-await-in-loop -- 同上
		await readData(created, `コレクション ${collection.slug} の作成`);
		for (const field of collection.fields) {
			// oxlint-disable-next-line no-await-in-loop -- 同上
			const added = await api.post(`/_emdash/api/schema/collections/${collection.slug}/fields`, {
				headers: CSRF_HEADERS,
				data: field,
			});
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await readData(added, `${collection.slug} のフィールド ${String(field["slug"])} の作成`);
		}
	}
}

/** `posts` の title を検索の対象にし、検索を有効にする(コマンドパレットで公開済みの投稿を探すため) */
async function enablePostSearch(api: APIRequestContext): Promise<void> {
	await readData(
		await api.put("/_emdash/api/schema/collections/posts/fields/title", {
			headers: CSRF_HEADERS,
			data: { searchable: true },
		}),
		"posts の title を検索の対象にする",
	);
	await readData(
		await api.post("/_emdash/api/search/enable", {
			headers: CSRF_HEADERS,
			data: { collection: "posts", enabled: true },
		}),
		"posts の検索を有効にする",
	);
}

// ---------------------------------------------------------------------------
// 5. API で上げる画像
// ---------------------------------------------------------------------------

async function createSampleImage(): Promise<void> {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const image: SampleImage = await page.evaluate(async () => {
			const width = 480;
			const height = 320;
			const canvas = new OffscreenCanvas(width, height);
			const context = canvas.getContext("2d");
			if (context === null) throw new Error("2d のコンテキストを作れません");
			const gradient = context.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, "#2f6fdb");
			gradient.addColorStop(1, "#e0a030");
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
			context.fillStyle = "#ffffff";
			context.font = "bold 64px sans-serif";
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText("E2E", width / 2, height / 2);
			const thumbCanvas = new OffscreenCanvas(96, 64);
			const thumbContext = thumbCanvas.getContext("2d");
			if (thumbContext === null) throw new Error("2d のコンテキストを作れません");
			thumbContext.drawImage(canvas, 0, 0, 96, 64);
			const quality = 0.8;
			const toDataUrl = async (target: OffscreenCanvas) => {
				const blob = await target.convertToBlob({ type: "image/webp", quality });
				if (blob.type !== "image/webp") throw new Error(`WebP を作れません(${blob.type})`);
				const bytes = new Uint8Array(await blob.arrayBuffer());
				let binary = "";
				for (const byte of bytes) binary += String.fromCharCode(byte);
				return `data:image/webp;base64,${btoa(binary)}`;
			};
			return {
				dataUrl: await toDataUrl(canvas),
				thumb: await toDataUrl(thumbCanvas),
				width,
				height,
				quality,
			};
		});
		mkdirSync(dirname(SAMPLE_IMAGE_PATH), { recursive: true });
		writeFileSync(SAMPLE_IMAGE_PATH, JSON.stringify(image));
	} finally {
		await browser.close();
	}
}

// ---------------------------------------------------------------------------
// 6. 暖機
// ---------------------------------------------------------------------------

async function warmUp(): Promise<void> {
	for (const browserType of [chromium, firefox]) {
		// oxlint-disable-next-line no-await-in-loop -- ブラウザは 1 つずつ開く
		const browser = await browserType.launch();
		try {
			// oxlint-disable-next-line no-await-in-loop -- 同上
			const context = await browser.newContext({ storageState: authStatePath("admin") });
			// oxlint-disable-next-line no-await-in-loop -- 同上
			const page = await context.newPage();
			for (const path of [
				"/_emdash/admin/content/posts/new",
				"/_emdash/admin/plugins/base64-image/images",
				"/posts/",
			]) {
				// oxlint-disable-next-line no-await-in-loop -- ページは 1 つずつ開く
				await page.goto(`${BASE_URL}${path}`);
				// oxlint-disable-next-line no-await-in-loop -- 同上
				await page.waitForLoadState("networkidle");
			}
		} finally {
			// oxlint-disable-next-line no-await-in-loop -- 同上
			await browser.close();
		}
	}
}

export default async function globalSetup(): Promise<void> {
	const started = Date.now();
	ensureFixtureImages();
	await loginAdmin();
	const api = await request.newContext({
		baseURL: BASE_URL,
		storageState: authStatePath("admin"),
	});
	try {
		await ensureCollections(api);
		await enablePostSearch(api);
	} finally {
		await api.dispose();
	}
	await loginRoleUsers();
	await createSampleImage();
	await warmUp();
	console.log(`[e2e] 前準備: ${Date.now() - started}ms`);
}
