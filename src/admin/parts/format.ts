/**
 * 部品で表示する数値の書式(言語によらない部分)。
 */

/** 画質(0〜1)を小数 2 桁にする(「0.77」)。圧縮の探索は 0.01 刻みなので、2 桁で表せる */
export function formatQuality(quality: number): string {
	return quality.toFixed(2);
}

/**
 * 保存サイズ(バイト)を KB(1,000 バイト)の小数 1 桁にする(「98.2」)。
 * 上限の表記(仕様書 6.2 の 100,000 バイト、T14 の 40MB)と同じく 10 進で数える。
 */
export function formatKilobytes(bytes: number): string {
	return (bytes / 1_000).toFixed(1);
}

/** 長辺(px) */
export function longEdge(width: number, height: number): number {
	return Math.max(width, height);
}
