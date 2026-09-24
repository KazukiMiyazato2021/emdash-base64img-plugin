import { useEffect, useRef } from "react";

/**
 * 最後に描画したときの値を持つ ref を返す。非同期の処理(アップロードの途中など)から、最新の props を読むために使う。
 * 値は描画が確定したあと(effect)に入れる。描画の途中で ref に書かない(React の描画は捨てられることがある)。
 */
export function useLatest<T>(value: T): { readonly current: T } {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	});
	return ref;
}
