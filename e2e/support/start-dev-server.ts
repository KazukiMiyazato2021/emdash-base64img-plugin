/**
 * E2E(T31)の開発サーバーを起動する。Playwright の `webServer.command` から呼ぶ(`playwright.config.ts`)。
 *
 * 実行: node e2e/support/start-dev-server.ts --port 4431(リポジトリのルートで)
 *
 * - playground の SQLite(`playground/data.db`)を空にしてから起動する。E2E を毎回同じ状態(空のデータベース)から始めるため。
 *   - E2E が作ったデータベース(目印 `e2e/.cache/playground-database-by-e2e` があるとき)は、そのまま消す。
 *   - それ以外(利用者が playground で使っていたもの)は、`playground/data.e2e-backup-<日時>.db` に移して残す
 *     (`-wal` / `-shm` / `-journal` も同じ名前で移す。`*.db` と `*.db-*` なので、リポジトリには入らない)。
 *     何度 E2E を実行しても、利用者のデータベースの控えは上書きされない。
 * - Astro は、エージェント(環境変数 `CLAUDECODE` など)から実行した `astro dev` をバックグラウンドにする
 *   (docs/astro-dev-background-for-agents.md)。`--ignore-lock` を付けて前面で動かし、Playwright が止められるようにする
 *   (Playwright はこのプロセスのグループに SIGTERM を送る)。
 * - 同じ playground で別の開発サーバー(`npm run dev -w playground` で起動したもの)が動いていたら、起動しない。
 *   そのサーバーが使っているデータベースを消さないため。先に `npm run dev -w playground -- stop` で止める。
 * - Playwright は、ポートに応答があれば(`reuseExistingServer`)このスクリプトを呼ばない。そのときデータベースはそのまま使う。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

const ROOT = join(import.meta.dirname, "..", "..");
const PLAYGROUND = join(ROOT, "playground");
const DATABASE = join(PLAYGROUND, "data.db");
/** SQLite がデータベースの横に作るファイル */
const DATABASE_SIDE_FILES = ["-wal", "-shm", "-journal"];
/** 今の `playground/data.db` が E2E の作ったものである目印(`e2e/.cache/` はリポジトリに入らない) */
const E2E_DATABASE_MARKER = join(ROOT, "e2e", ".cache", "playground-database-by-e2e");
/** `astro dev` がバックグラウンドで動いているときのロックファイル(docs/astro-dev-background-for-agents.md) */
const DEV_LOCK = join(PLAYGROUND, ".astro", "dev.json");
const ASTRO = join(ROOT, "node_modules", "astro", "bin", "astro.mjs");

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** 同じ playground の開発サーバー(バックグラウンド)が動いていれば、その情報 */
function runningDevServer(): { pid: number; url: string } | null {
	if (!existsSync(DEV_LOCK)) return null;
	try {
		const lock = JSON.parse(readFileSync(DEV_LOCK, "utf8")) as { pid?: unknown; url?: unknown };
		if (typeof lock.pid !== "number" || !isRunning(lock.pid)) return null;
		return { pid: lock.pid, url: typeof lock.url === "string" ? lock.url : "?" };
	} catch {
		return null;
	}
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/** `20260924-213005` の形の日時(ローカル時刻。控えのファイル名に使う) */
function timestamp(): string {
	const now = new Date();
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * データベースを空にする。E2E が作ったものは消し、それ以外は日時の付いた名前で残す。
 * これから起動する開発サーバーが作るデータベースは E2E のものなので、目印を書く。
 */
function resetDatabase(): void {
	const files = ["", ...DATABASE_SIDE_FILES].map((suffix) => `${DATABASE}${suffix}`);
	if (existsSync(E2E_DATABASE_MARKER)) {
		for (const file of files) rmSync(file, { force: true });
	} else if (existsSync(DATABASE)) {
		const backup = join(PLAYGROUND, `data.e2e-backup-${timestamp()}.db`);
		for (const file of files) {
			if (existsSync(file)) renameSync(file, file.replace(DATABASE, backup));
		}
		// Playwright は webServer の標準出力を捨てるので、標準エラーに出す
		console.error(`[e2e] playground/data.db を ${relative(ROOT, backup)} に移した`);
	} else {
		for (const file of files) rmSync(file, { force: true });
	}
	mkdirSync(dirname(E2E_DATABASE_MARKER), { recursive: true });
	writeFileSync(E2E_DATABASE_MARKER, `${new Date().toISOString()}\n`);
}

function main(): void {
	const { values } = parseArgs({ options: { port: { type: "string", default: "4431" } } });
	const port = values.port;
	const other = runningDevServer();
	if (other !== null) {
		console.error(
			`[e2e] playground の開発サーバーが動いています(pid ${other.pid}、${other.url})。` +
				`データベースを共有するので、先に npm run dev -w playground -- stop で止めてください。`,
		);
		process.exit(1);
	}
	resetDatabase();
	const child = spawn(process.execPath, [ASTRO, "dev", "--port", port, "--ignore-lock"], {
		cwd: PLAYGROUND,
		stdio: "inherit",
	});
	const forward = (signal: NodeJS.Signals) => {
		if (child.exitCode === null) child.kill(signal);
	};
	process.on("SIGTERM", () => forward("SIGTERM"));
	process.on("SIGINT", () => forward("SIGINT"));
	child.on("exit", (code, signal) => {
		process.exit(code ?? (signal === null ? 0 : 1));
	});
}

main();
