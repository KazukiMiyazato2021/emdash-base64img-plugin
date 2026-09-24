/**
 * base64-image プラグイン(サーバー側の入口)。
 *
 * EmDash 0.39.1 の native プラグインの形(公式の color プラグインと同じ。docs/emdash-native-plugin-entrypoints.md)。
 * - `createPlugin()`: EmDash が生成する仮想モジュールが、descriptor の `entrypoint` から名前付きで import して
 *   `createPlugin(descriptor.options)` の形で呼ぶ。中身は `src/server/plugin.ts`(ルート・hook・ストレージ・capability・
 *   管理画面の登録)。
 * - `base64ImagePlugin()`: サイトの `astro.config.mjs` で `emdash({ plugins: [base64ImagePlugin()] })` に渡す descriptor。
 *
 * TS ソースのまま配布する(ビルドなし。T07)。利用者のサイトの `tsc` は、`astro.config.mjs` からこのファイル以下を
 * 利用者の設定で検査する。管理画面の部品(React・Kumo)はここから読み込まない(管理画面の入口は `./admin`)。
 */

import type { PluginDescriptor } from "emdash";

import {
	ADMIN_ENTRY,
	createBase64ImagePlugin,
	PACKAGE_NAME,
	PLUGIN_VERSION,
} from "./server/plugin";
import { PLUGIN_ID } from "./shared/constants";

/**
 * プラグイン本体を作る。EmDash が `createPlugin(descriptor.options)` の形で呼ぶ(options は使わない)。
 */
export function createPlugin() {
	return createBase64ImagePlugin();
}

export default createPlugin;

/**
 * サイトの設定(`emdash({ plugins: [...] })`)に渡す descriptor を返す。
 */
export function base64ImagePlugin(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		entrypoint: PACKAGE_NAME,
		options: {},
		adminEntry: ADMIN_ENTRY,
	};
}
