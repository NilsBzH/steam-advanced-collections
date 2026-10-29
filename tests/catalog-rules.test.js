import { test, expect } from 'bun:test';
import { evaluate } from '../frontend/rules/evaluate';
import { isRule, ruleFingerprint } from '../frontend/rules/model';
import { newCondition } from '../frontend/rules/editing';
import { steamLanguages, steamReviewCategories } from '../frontend/steam/catalog-labels';
import { readFileSync } from 'node:fs';
import { couldAffectUnknown } from '../frontend/steam/supplemental';

const numeric = (field, comparison, value, upper) => ({ type: 'condition', field, ...(field === 'reviews' ? { mode: 'score' } : {}), comparison, value, ...(upper === undefined ? {} : { upper }) });
const not = (child) => ({ type: 'not', child });
test('multiple creators match exact case-insensitive names without substring or publisher fallback', () => {
	const facts = { developers: [' FromSoftware ', 'Studio TWO'], publishers: ['SEGA'] };
	for (const [field, value, expected] of [['developer', 'fromsoftware', true], ['developer', 'studio two', true], ['developer', 'Software', false], ['publisher', 'sega', true], ['publisher', 'FromSoftware', false]]) {
		const rule = { type: 'condition', field, value }; expect(evaluate(rule, facts)).toBe(expected); expect(evaluate(not(rule), facts)).toBe(!expected);
		expect(evaluate(rule, {})).toBeUndefined(); expect(evaluate(not(rule), {})).toBeUndefined();
	}
	expect(evaluate({ type: 'condition', field: 'developer', value: 'SEGA' }, { developers: [] })).toBe(false);
});
test('review and achievement percentages support boundaries, exact zero, inclusive ranges and unknown', () => {
	for (const field of ['reviews', 'achievementProgress']) {
		const facts = field === 'reviews' ? { reviewScore: 75 } : { achievementProgress: 75 };
		for (const [op, value, upper, result] of [['gt', 75, undefined, false], ['lt', 76, undefined, true], ['eq', 75, undefined, true], ['between', 75, 100, true], ['between', 0, 74.99, false]]) expect(evaluate(numeric(field, op, value, upper), facts)).toBe(result);
		expect(evaluate(numeric(field, 'eq', 0), field === 'reviews' ? { reviewScore: 0 } : { achievementProgress: 0 })).toBe(true);
		expect(evaluate(not(numeric(field, 'eq', 100)), {})).toBeUndefined();
		for (const value of [-1, 100.01, NaN, Infinity, null]) expect(isRule(numeric(field, 'eq', value))).toBe(false);
		expect(isRule(numeric(field, 'between', 100, 0))).toBe(false); expect(isRule(numeric(field, 'between', 0))).toBe(false);
		expect(isRule(numeric(field, 'between', 0, 100))).toBe(true);
	}
	for (const op of ['gt', 'lt', 'eq', 'between']) expect(evaluate(numeric('achievementProgress', op, 100, 100), { achievementProgress: null })).toBe(false);
});
test('review categories come from Steam independently of percentage and no-score stays unknown', () => {
	const rule = { type: 'condition', field: 'reviews', mode: 'category', value: 9 };
	expect(evaluate(rule, { reviewScore: 99 })).toBeUndefined();
	expect(evaluate(rule, { reviewScore: 50, reviewCategory: 9 })).toBe(true);
	for (const value of [0, 10, 8.5]) expect(isRule({ ...rule, value })).toBe(false);
});
test('language modes remain independent through nested NOT/AND/OR and missing modes stay unknown', () => {
	const rule = { type: 'condition', field: 'language', support: 'audio', value: 2 };
	const facts = { languages: { interface: new Set([2]), subtitles: new Set([2]), audio: new Set([0]) } };
	expect(evaluate(rule, facts)).toBe(false); expect(evaluate({ ...rule, support: 'interface' }, facts)).toBe(true);
	expect(evaluate(not(rule), { languages: { interface: new Set([2]) } })).toBeUndefined();
	const group = { type: 'group', operator: 'and', children: [not(rule), { type: 'group', operator: 'or', children: [{ ...rule, support: 'subtitles' }, numeric('reviews', 'gt', 90)] }] };
	expect(evaluate(group, facts)).toBe(true);
	for (const support of ['any', 'full_audio', '']) expect(isRule({ ...rule, support })).toBe(false);
	for (const value of [-1, 32, 2.5]) expect(isRule({ ...rule, value })).toBe(false);
});
test('all new rules validate and fingerprints distinguish review modes and language support', () => {
	for (const field of ['developer', 'publisher']) {
		expect(isRule(newCondition(field))).toBe(false); expect(isRule({ ...newCondition(field), value: 'SEGA' })).toBe(true);
	}
	const wrap = (expression) => ({ version: 1, enabled: true, expression });
	expect(ruleFingerprint(wrap({ type: 'condition', field: 'reviews', mode: 'category', value: 8 }))).not.toBe(ruleFingerprint(wrap(numeric('reviews', 'eq', 8))));
	expect(ruleFingerprint(wrap(newCondition('language')))).not.toBe(ruleFingerprint(wrap({ ...newCondition('language'), support: 'audio' })));
});

test('complementary demand follows three-valued outcomes through AND/OR/NOT without loading inconsequential metadata', () => {
	const creator = { type: 'condition', field: 'developer', value: 'Studio' }, local = { type: 'condition', field: 'library', value: 'E:' };
	for (const operator of ['and', 'or']) {
		const rule = { type: 'group', operator, children: [local, creator] };
		for (const inverted of [false, true]) for (const fallback of [false, true]) {
			const tree = inverted ? not(rule) : rule;
			const outcomes = [undefined, [], ['Studio']].map((developers) => evaluate(tree, { developers }) ?? fallback);
			expect(couldAffectUnknown(tree, {}, fallback)).toBe(outcomes.some((value) => value !== fallback));
		}
	}
	expect(couldAffectUnknown(creator, {}, false)).toBe(true);
	expect(couldAffectUnknown({ type: 'group', operator: 'and', children: [local, creator] }, { library: null }, false)).toBe(false);
});
test('review labels and language IDs match the installed Steam primary sources when available', () => {
	let localization, library;
	try {
		localization = readFileSync('C:/Program Files (x86)/Steam/steamui/localization/steamui_english-json.js', 'utf8');
		library = readFileSync('C:/Program Files (x86)/Steam/steamui/library.js', 'utf8');
	} catch { return; }
	steamReviewCategories.forEach((label, id) => expect(localization).toContain(`"SteamReviewScore_${id}":"${label}"`));
	expect(library).toContain('st=0,ot=1,ut=2'); expect(library).toContain('case ut:return"french"');
	expect(steamLanguages[2]).toBe('French'); expect(steamLanguages[30]).toBe('Indonesian');
});
