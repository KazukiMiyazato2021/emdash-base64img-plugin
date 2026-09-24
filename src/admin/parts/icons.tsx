/**
 * 部品で使う小さなアイコン(装飾。スクリーンリーダーからは隠す)。
 *
 * EmDash の管理画面は `@phosphor-icons/react` を使うが、このプラグインの peerDependencies に無いので、
 * 自前の SVG にした(線の太さ・端の形は Phosphor の regular に近づけた)。
 */

import type { ReactNode } from "react";

interface IconProps {
	/** 一辺の大きさ(px) */
	readonly size?: number | undefined;
}

function SvgIcon({ size = 16, children }: IconProps & { readonly children: ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{children}
		</svg>
	);
}

/** 上向きの矢印とトレイ(ドロップゾーン) */
export function UploadIcon({ size }: IconProps) {
	return (
		<SvgIcon size={size}>
			<path d="M12 15V4" />
			<path d="m7 9 5-5 5 5" />
			<path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
		</SvgIcon>
	);
}

/** 斜線の入った画像(画像が見つからない) */
export function ImageMissingIcon({ size }: IconProps) {
	return (
		<SvgIcon size={size}>
			<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
			<path d="m3.5 16 5-5 4 4 2.5-2.5 5 5" />
			<path d="m3 3 18 18" />
		</SvgIcon>
	);
}

/** 円の中の感嘆符(エラー・注意) */
export function WarningIcon({ size }: IconProps) {
	return (
		<SvgIcon size={size}>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7.5v5.5" />
			<path d="M12 16.5v.01" />
		</SvgIcon>
	);
}
