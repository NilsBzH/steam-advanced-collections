import type { AgeUnit, GameFacts, MeasurementCondition } from './model';

/** UTC calendar subtraction, clamped to the last day of the target month.
 * Mar 31 - 1 month = Feb 28/29; Feb 29 - 1 year = Feb 28.
 */
export function subtractCalendar(now: number, amount: number, unit: AgeUnit): number {
	const date = new Date(now);
	if (unit === 'days') date.setUTCDate(date.getUTCDate() - amount);
	else {
		const day = date.getUTCDate();
		const month = date.getUTCMonth() - amount * (unit === 'years' ? 12 : 1);
		date.setUTCDate(1); date.setUTCMonth(month);
		const end = new Date(date.getTime()); end.setUTCMonth(end.getUTCMonth() + 1, 0);
		date.setUTCDate(Math.min(day, end.getUTCDate()));
	}
	return date.getTime();
}
function compare(actual: number | undefined, rule: MeasurementCondition): boolean | undefined {
	if (actual === undefined || !Number.isFinite(actual) || rule.value === null || !Number.isFinite(rule.value)) return undefined;
	switch (rule.comparison) {
		case 'gt': case 'after': return actual > rule.value;
		case 'lt': case 'before': return actual < rule.value;
		case 'eq': return actual === rule.value;
		case 'between': return rule.upper == null ? undefined : actual >= rule.value && actual <= rule.upper;
	}
}
export function evaluateMeasurement(rule: MeasurementCondition, facts: GameFacts, now: number): boolean | undefined {
	switch (rule.field) {
		case 'playtime': {
			const minutes = rule.period === 'total' ? facts.playtimeMinutes : facts.playtimeRecentMinutes;
			return compare(minutes === undefined ? undefined : minutes / 60, rule);
		}
		case 'installSize': return compare(facts.installSizeBytes === undefined ? undefined : facts.installSizeBytes / (rule.unit === 'MB' ? 1024 ** 2 : 1024 ** 3), rule);
		case 'releaseDate': return compare(facts.releaseYear, rule);
		case 'lastPlayed': {
			const last = facts.lastPlayed;
			if (last === undefined || !Number.isFinite(now) || rule.value === null) return undefined;
			if (last === null) return false; // No last session exists, distinct from missing history.
			if (!Number.isFinite(last) || last > now) return undefined;
			const recent = subtractCalendar(now, rule.value, rule.unit);
			if (!Number.isFinite(recent)) return undefined;
			if (rule.comparison === 'gt') return last < recent;
			if (rule.comparison === 'lt') return last > recent;
			const older = rule.upper == null ? NaN : subtractCalendar(now, rule.upper, rule.unit);
			return Number.isFinite(older) ? last >= older && last <= recent : undefined;
		}
	}
}
