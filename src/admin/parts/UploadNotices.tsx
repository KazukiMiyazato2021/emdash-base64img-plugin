/**
 * 入力の注意の表示(仕様書 6.5: GIF は最初のフレームだけの静止画になる)。エラーではない。
 *
 * - 文言は T14 の `getNoticeMessage`。注意のコードは T12 の `decoded.notices`。
 * - `aria-live="polite"` の領域は、注意が無いときも残す。widget はこの部品を常に描画し、`notices` だけを変える。
 */

import { Banner } from "@cloudflare/kumo";

import { getNoticeMessage } from "../../client/error-messages";
import { useLocale } from "../../client/i18n";
import type { NoticeCode } from "../../shared/errors";
import { WarningIcon } from "./icons";

export interface UploadNoticesProps {
	/** 注意のコード。同じコードは 1 回だけ出す。空なら何も出さない */
	readonly notices: readonly NoticeCode[];
	/** 見出し(どのファイルの注意か。ギャラリーの「IMG_0002.gif」など)。省略すると本文だけ */
	readonly title?: string | undefined;
}

/** 注意の表示(Kumo の Banner の `alert`) */
export function UploadNotices({ notices, title }: UploadNoticesProps) {
	const locale = useLocale();
	const codes = Array.from(new Set(notices));
	return (
		<div aria-live="polite" className="grid gap-2">
			{codes.map((code) => (
				<Banner
					key={code}
					variant="alert"
					icon={<WarningIcon />}
					{...(title === undefined ? {} : { title })}
					description={getNoticeMessage(code, locale)}
				/>
			))}
		</div>
	);
}
