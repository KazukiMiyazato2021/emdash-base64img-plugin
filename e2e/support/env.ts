/**
 * E2E の共通の値(ポート・パス・ロール)。`playwright.config.ts`・global setup・テストの全部から読む。
 */

import { join } from "node:path";

/** 開発サーバーのポート。T31 は 4431(チームの規則: 4400 + タスク番号)。`E2E_PORT` で変えられる */
export const PORT = Number(process.env["E2E_PORT"] ?? "4431");

export const BASE_URL = `http://localhost:${PORT}`;

/** リポジトリのルート */
export const ROOT = join(import.meta.dirname, "..", "..");

/** playground の SQLite(astro.config.mjs の `file:./data.db`) */
export const PLAYGROUND_DATABASE = join(ROOT, "playground", "data.db");

/** 入力画像(`node e2e/fixtures/make-images.ts` が作る。e2e/fixtures/README.md) */
export const FIXTURE_IMAGES = join(ROOT, "e2e", "fixtures", "images");

/** 入力画像のパス */
export function fixture(name: string): string {
	return join(FIXTURE_IMAGES, name);
}

/** global setup が作るもの(ログインの状態・API で上げる画像)。git の管理外 */
export const CACHE_DIR = join(ROOT, "e2e", ".cache");

/** API でアップロードする画像(WebP の data URL とサムネイル。global setup が Chromium で作る) */
export const SAMPLE_IMAGE_PATH = join(CACHE_DIR, "sample-image.json");

/** EmDash のロール(`references/emdash/packages/auth/src/types.ts`) */
export const ROLES = {
	admin: 50,
	editor: 40,
	author: 30,
	contributor: 20,
	subscriber: 10,
} as const;
export type RoleName = keyof typeof ROLES;

/** ロールごとのログインの状態(Playwright の storageState) */
export function authStatePath(role: RoleName): string {
	return join(CACHE_DIR, "auth", `${role}.json`);
}

/** 管理画面の言語の cookie(EmDash の管理画面は `emdash-locale` を読む。Path は `/_emdash`) */
export const ADMIN_LOCALE_COOKIE = "emdash-locale";

/** 管理画面が API に付ける CSRF 対策のヘッダー(無いと 403 `CSRF_REJECTED`) */
export const CSRF_HEADERS = { "X-EmDash-Request": "1" } as const;

/** このプラグインのルートの起点 */
export const PLUGIN_API = "/_emdash/api/plugins/base64-image";
