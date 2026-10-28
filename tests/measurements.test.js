import { test, expect } from 'bun:test';
import { evaluate } from '../frontend/rules/evaluate';
import { isRule, ruleFingerprint } from '../frontend/rules/model';
import { subtractCalendar } from '../frontend/rules/measurements';
import { newCondition } from '../frontend/rules/editing';

const numeric = (field, comparison, value, extra = {}) => ({ type: 'condition', field, comparison, value, ...(field === 'playtime' ? { period: 'total' } : field === 'installSize' ? { unit: 'GB' } : field === 'lastPlayed' ? { unit: 'months' } : {}), ...extra });
const not = (child) => ({ type: 'not', child });
const date = (value) => new Date(value).getTime();
test('playtime and install-size comparisons use strict boundaries, exact equality and inclusive ranges', () => {
	for (const [field, facts] of [['playtime', { playtimeMinutes: 600 }], ['installSize', { installSizeBytes: 10 * 1024 ** 3 }]]) {
		for (const [op, threshold, upper, expected] of [['gt', 9, undefined, true], ['gt', 10, undefined, false], ['lt', 11, undefined, true], ['lt', 10, undefined, false], ['eq', 10, undefined, true], ['eq', 9, undefined, false], ['between', 10, 20, true], ['between', 2, 10, true], ['between', 11, 20, false]]) {
			const rule = numeric(field, op, threshold, upper === undefined ? {} : { upper }); expect(isRule(rule)).toBe(true); expect(evaluate(rule, facts)).toBe(expected);
		}
	}
});
test('hour decimals, two-week minutes and binary MB/GB use the correct conversions without rounding', () => {
	expect(evaluate(numeric('playtime', 'eq', 0.1), { playtimeMinutes: 6 })).toBe(true);
	expect(evaluate(numeric('playtime', 'eq', 0), { playtimeMinutes: 0 })).toBe(true);
	expect(evaluate(numeric('playtime', 'eq', 0), {})).toBeUndefined();
	expect(evaluate(numeric('playtime', 'eq', 0.5, { period: 'twoWeeks' }), { playtimeMinutes: 600, playtimeRecentMinutes: 30 })).toBe(true);
	expect(evaluate(numeric('playtime', 'eq', 0, { period: 'twoWeeks' }), { playtimeMinutes: 0 })).toBeUndefined();
	for (const [unit, value] of [['MB', 2048], ['GB', 2]]) expect(evaluate(numeric('installSize', 'eq', value, { unit }), { installSizeBytes: 2 * 1024 ** 3 })).toBe(true);
	expect(evaluate(numeric('installSize', 'eq', 0.5), { installSizeBytes: 512 * 1024 ** 2 })).toBe(true);
});
test('calendar subtraction clamps months and leap years and preserves the UTC time of day', () => {
	expect(subtractCalendar(date('2024-03-31T12:34:56.123Z'), 1, 'months')).toBe(date('2024-02-29T12:34:56.123Z'));
	expect(subtractCalendar(date('2025-03-31T12:34:56Z'), 1, 'months')).toBe(date('2025-02-28T12:34:56Z'));
	expect(subtractCalendar(date('2024-02-29T12:34:56Z'), 1, 'years')).toBe(date('2023-02-28T12:34:56Z'));
	expect(subtractCalendar(date('2025-01-31T12:34:56Z'), 2, 'months')).toBe(date('2024-11-30T12:34:56Z'));
	expect(subtractCalendar(date('2024-03-11T01:00:00Z'), 1, 'days')).toBe(date('2024-03-10T01:00:00Z'));
});
test('last played compares calendar cutoffs; never played differs from unknown and future metadata', () => {
	const now = date('2024-03-31T12:00:00Z'), boundary = date('2024-02-29T12:00:00Z');
	expect(evaluate(numeric('lastPlayed', 'gt', 1), { lastPlayed: boundary - 1 }, now)).toBe(true);
	expect(evaluate(numeric('lastPlayed', 'gt', 1), { lastPlayed: boundary }, now)).toBe(false);
	expect(evaluate(numeric('lastPlayed', 'lt', 1), { lastPlayed: boundary + 1 }, now)).toBe(true);
	expect(evaluate(numeric('lastPlayed', 'between', 1, { upper: 2 }), { lastPlayed: boundary }, now)).toBe(true);
	expect(evaluate(numeric('lastPlayed', 'between', 1, { upper: 2 }), { lastPlayed: date('2024-01-31T12:00:00Z') }, now)).toBe(true);
	const rule = numeric('lastPlayed', 'gt', 6);
	expect(evaluate(rule, { lastPlayed: null }, now)).toBe(false); expect(evaluate(not(rule), { lastPlayed: null }, now)).toBe(true);
	expect(evaluate(rule, {}, now)).toBeUndefined(); expect(evaluate(not(rule), {}, now)).toBeUndefined();
	expect(evaluate(rule, { lastPlayed: now + 1000 }, now)).toBeUndefined();
});
test('relative rules use the supplied evaluation clock and change as time advances', () => {
	const rule = numeric('lastPlayed', 'gt', 30, { unit: 'days' }), facts = { lastPlayed: date('2024-01-01T12:00:00Z') };
	expect(evaluate(rule, facts, date('2024-01-15T12:00:00Z'))).toBe(false);
	expect(evaluate(rule, facts, date('2024-02-15T12:00:00Z'))).toBe(true);
});
test('release years use strict before/after and inclusive between with no invented missing year', () => {
	for (const [op, value, upper, expected] of [['before', 2010, undefined, false], ['after', 2010, undefined, false], ['before', 2011, undefined, true], ['after', 2009, undefined, true], ['between', 2000, 2010, true]]) expect(evaluate(numeric('releaseDate', op, value, { upper }), { releaseYear: 2010 })).toBe(expected);
	expect(evaluate(not(numeric('releaseDate', 'before', 2010)), {})).toBeUndefined();
});
test('new comparisons preserve unknown values through nested AND/OR/NOT', () => {
	for (const field of ['playtime', 'installSize', 'releaseDate', 'lastPlayed']) {
		const rule = numeric(field, field === 'releaseDate' ? 'after' : 'gt', 10);
		expect(evaluate(rule, {})).toBeUndefined(); expect(evaluate(not(rule), {})).toBeUndefined();
		expect(evaluate({ type: 'group', operator: 'or', children: [rule, { type: 'condition', field: 'installed', value: true }] }, { installed: true })).toBe(true);
	}
});
test('validation rejects negatives, incomplete or reversed ranges, non-finite values and invalid domains', () => {
	for (const field of ['playtime', 'lastPlayed', 'installSize', 'releaseDate']) {
		const op = field === 'releaseDate' ? 'before' : 'gt';
		for (const value of [null, -1, NaN, Infinity, '10']) expect(isRule(numeric(field, op, value))).toBe(false);
		for (const upper of [null, undefined, -1, 1]) expect(isRule(numeric(field, 'between', 10, { upper }))).toBe(false);
		expect(isRule(newCondition(field))).toBe(false);
	}
	expect(isRule(numeric('lastPlayed', 'eq', 1))).toBe(false);
	expect(isRule(numeric('lastPlayed', 'gt', 1.5))).toBe(false);
	expect(isRule(numeric('lastPlayed', 'gt', 1, { unit: 'weeks' }))).toBe(false);
	expect(isRule(numeric('installSize', 'gt', 10, { unit: 'TB' }))).toBe(false);
	expect(isRule(numeric('playtime', 'gt', 10, { period: 'session' }))).toBe(false);
	for (const value of [0, 10000, 2020.5]) expect(isRule(numeric('releaseDate', 'after', value))).toBe(false);
});
test('fingerprints include operators, units, periods and upper bounds', () => {
	const wrap = (expression) => ({ version: 1, enabled: true, expression });
	const first = numeric('playtime', 'between', 2, { upper: 20 });
	for (const delta of [{ comparison: 'gt' }, { upper: 21 }, { period: 'twoWeeks' }]) expect(ruleFingerprint(wrap({ ...first, ...delta }))).not.toBe(ruleFingerprint(wrap(first)));
	const size = numeric('installSize', 'eq', 10);
	expect(ruleFingerprint(wrap({ ...size, unit: 'MB' }))).not.toBe(ruleFingerprint(wrap(size)));
});
