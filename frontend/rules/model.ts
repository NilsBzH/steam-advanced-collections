export type Field = 'tag' | 'category' | 'ownership' | 'installed' | 'library' | 'drive' | 'playtime' | 'lastPlayed' | 'installSize' | 'releaseDate';
export type NumericComparison = 'gt' | 'lt' | 'eq' | 'between';
export type AgeUnit = 'days' | 'months' | 'years';
export type SizeUnit = 'MB' | 'GB';
interface RangeInput { value: number | null; upper?: number | null }
export type MeasurementCondition =
	({ type: 'condition'; field: 'playtime'; comparison: NumericComparison; period: 'total' | 'twoWeeks' } & RangeInput) |
	({ type: 'condition'; field: 'lastPlayed'; comparison: 'gt' | 'lt' | 'between'; unit: AgeUnit } & RangeInput) |
	({ type: 'condition'; field: 'installSize'; comparison: NumericComparison; unit: SizeUnit } & RangeInput) |
	({ type: 'condition'; field: 'releaseDate'; comparison: 'before' | 'after' | 'between' } & RangeInput);
export type Condition =
	{ type: 'condition'; field: 'tag' | 'category'; value: number } |
	{ type: 'condition'; field: 'ownership'; value: 'personal' | 'family' } |
	{ type: 'condition'; field: 'installed'; value: boolean } |
	{ type: 'condition'; field: 'library' | 'drive'; value: string } | MeasurementCondition;
export type Rule = Condition | { type: 'group'; operator: 'and' | 'or'; children: Rule[] } | { type: 'not'; child: Rule };
export interface SavedRules { version: 1; enabled: boolean; expression: Rule }
export interface GameFacts {
	tags?: ReadonlySet<number>;
	categories?: ReadonlySet<number>;
	ownership?: 'personal' | 'family';
	installed?: boolean;
	/** null = known absence; undefined = unavailable metadata. */
	library?: string | null;
	drive?: string | null;
	playtimeMinutes?: number;
	playtimeRecentMinutes?: number;
	/** Unix milliseconds; null means Steam reports never played, undefined unknown. */
	lastPlayed?: number | null;
	installSizeBytes?: number;
	releaseYear?: number;
}
export const emptyRules = (): SavedRules => ({ version: 1, enabled: false, expression: { type: 'group', operator: 'and', children: [] } });

/** Include every semantic condition property in both Save verification and draft conflicts. */
export function ruleFingerprint(value: SavedRules): string {
	return JSON.stringify(value, ['version', 'enabled', 'expression', 'type', 'operator', 'children', 'child', 'field', 'value', 'comparison', 'upper', 'unit', 'period']);
}

function validMeasurement(node: Record<string, unknown>): boolean {
	let operators: string[], valid: (value: unknown) => boolean;
	const finite = (value: unknown, maximum: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
	if (node.field === 'playtime') {
		if (node.period !== 'total' && node.period !== 'twoWeeks') return false;
		operators = ['gt', 'lt', 'eq', 'between']; valid = (value) => finite(value, Number.MAX_SAFE_INTEGER / 60);
	} else if (node.field === 'installSize') {
		if (node.unit !== 'MB' && node.unit !== 'GB') return false;
		const factor = node.unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
		operators = ['gt', 'lt', 'eq', 'between']; valid = (value) => finite(value, Number.MAX_SAFE_INTEGER / factor);
	} else if (node.field === 'lastPlayed') {
		if (node.unit !== 'days' && node.unit !== 'months' && node.unit !== 'years') return false;
		const days = node.unit === 'years' ? 366 : node.unit === 'months' ? 31 : 1;
		operators = ['gt', 'lt', 'between']; valid = (value) => Number.isSafeInteger(value) && finite(value, 100000000 / days);
	} else {
		operators = ['before', 'after', 'between']; valid = (value) => Number.isSafeInteger(value) && finite(value, 9999) && (value as number) >= 1;
	}
	return operators.includes(node.comparison as string) && valid(node.value) &&
		(node.comparison !== 'between' || (valid(node.upper) && (node.value as number) <= (node.upper as number)));
}

/** Keep Windows comparisons case-insensitive and POSIX comparisons case-sensitive. */
export function normalizeLocation(path: string): string {
	const value = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	return /^[a-z]:/i.test(value) || value.startsWith('//') ? value.toLowerCase() : value || '/';
}

/** Iterative validation supports deeply nested JSON; the node budget rejects abusive/cyclic payloads. */
export function isRule(value: unknown): value is Rule {
	const pending: unknown[] = [value];
	const seen = new Set<object>();
	while (pending.length) {
		const item = pending.pop();
		if (!item || typeof item !== 'object' || Array.isArray(item) || seen.has(item) || seen.size >= 10000) return false;
		seen.add(item);
		const node = item as Record<string, unknown>;
		if (node.type === 'group') {
			if ((node.operator !== 'and' && node.operator !== 'or') || !Array.isArray(node.children)) return false;
			if (node.children.length > 10000 - seen.size) return false;
			pending.push(...node.children);
		} else if (node.type === 'not') pending.push(node.child);
		else if (node.type === 'condition') {
			switch (node.field) {
				case 'tag': case 'category': if (!Number.isSafeInteger(node.value) || (node.value as number) <= 0) return false; break;
				case 'ownership': if (node.value !== 'personal' && node.value !== 'family') return false; break;
				case 'installed': if (typeof node.value !== 'boolean') return false; break;
				case 'library': case 'drive': if (typeof node.value !== 'string' || !node.value.trim() || node.value.length > 4096) return false; break;
				case 'playtime': case 'lastPlayed': case 'installSize': case 'releaseDate': if (!validMeasurement(node)) return false; break;
				default: return false;
			}
		} else return false;
	}
	return true;
}

export function isSavedRules(value: unknown): value is SavedRules {
	if (!value || typeof value !== 'object') return false;
	const saved = value as Record<string, unknown>;
	return saved.version === 1 && typeof saved.enabled === 'boolean' && isRule(saved.expression);
}

/** An untouched AND group adds no constraint and must not change an empty native collection. */
export function hasRules(saved: SavedRules | undefined): boolean {
	return !!saved?.enabled && !(saved.expression.type === 'group' && saved.expression.operator === 'and' && saved.expression.children.length === 0);
}
