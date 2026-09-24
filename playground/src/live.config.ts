/**
 * EmDash の live content collection の登録(EmDash のテンプレートと同じ定型)。
 *
 * `getEmDashCollection()` / `getEmDashEntry()` は、この `_emdash` コレクションを通してデータベースを読む。
 */

import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "emdash/runtime";

export const collections = {
	_emdash: defineLiveCollection({ loader: emdashLoader() }),
};
