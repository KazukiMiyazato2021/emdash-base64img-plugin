/**
 * フィールドの options(仕様書 13.2)の補完と丸め、widget の判定。
 *
 * サーバー(検証)とブラウザ(圧縮)が同じ関数で options を解釈するので、適用する上限が一致する。
 */

import {
	DEFAULT_FIELD_OPTIONS,
	FIELD_OPTION_RANGES,
	WIDGET_IDS,
	type WidgetKind,
} from "./constants";

/** 補完・丸めたあとのフィールドの options */
export interface FieldOptions {
	/** 保存する data URL の最大長(バイト) */
	maxStoredBytes: number;
	/** 長辺の上限(px) */
	maxEdge: number;
	/** 画質の下限(0〜1) */
	minQuality: number;
	/** 縮小していく長辺の下限(px)。これを下回るとエラー */
	minEdge: number;
	/** ギャラリーの最大枚数(単一画像の widget では使わない) */
	maxItems: number;
}

/** seed などでフィールド定義に書く options(どれも省略できる) */
export type FieldOptionsInput = Partial<FieldOptions>;

const INTEGER_OPTIONS: ReadonlySet<keyof FieldOptions> = new Set([
	"maxStoredBytes",
	"maxEdge",
	"minEdge",
	"maxItems",
]);

/**
 * フィールド定義の `options` から、適用する options を作る。
 * - `options` がオブジェクトでなければ、すべて既定値にする(widget の props には選択肢の配列が来ることもある)。
 * - 各項目は、有限の数値なら範囲内に丸める(整数の項目は小数点以下を切り捨てる)。数値でなければ既定値にする。
 * - `minEdge` は `maxEdge` 以下にする。
 */
export function normalizeFieldOptions(options: unknown): FieldOptions {
	const source = isRecord(options) ? options : {};
	const maxEdge = readOption(source, "maxEdge");
	return {
		maxStoredBytes: readOption(source, "maxStoredBytes"),
		maxEdge,
		minQuality: readOption(source, "minQuality"),
		minEdge: Math.min(readOption(source, "minEdge"), maxEdge),
		maxItems: readOption(source, "maxItems"),
	};
}

/** フィールド定義の `widget` が、このプラグインの widget なら種類を返す。そうでなければ null */
export function getWidgetKind(widget: unknown): WidgetKind | null {
	if (widget === WIDGET_IDS.image) return "image";
	if (widget === WIDGET_IDS.gallery) return "gallery";
	return null;
}

function readOption(source: Record<string, unknown>, key: keyof FieldOptions): number {
	const value = Object.hasOwn(source, key) ? source[key] : undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_FIELD_OPTIONS[key];
	const { min, max } = FIELD_OPTION_RANGES[key];
	const number = INTEGER_OPTIONS.has(key) ? Math.floor(value) : value;
	return Math.min(Math.max(number, min), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
