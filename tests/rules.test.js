import { test, expect } from 'bun:test';
import { evaluate } from '../frontend/rules/evaluate';
import { hasRules, isRule, isSavedRules, normalizeLocation } from '../frontend/rules/model';

const condition = (field, value) => ({ type: 'condition', field, value });
const group = (operator, ...children) => ({ type: 'group', operator, children });
const not = (child) => ({ type: 'not', child });
const leaf = condition('installed', true);

test('AND and OR follow three-valued logic for every pair of known/unknown inputs', () => {
	for (const a of [true, false, undefined]) for (const b of [true, false, undefined]) {
		const facts = { installed: a, ownership: b === undefined ? undefined : b ? 'personal' : 'family' };
		const right = condition('ownership', 'personal');
		expect(evaluate(group('and', leaf, right), facts)).toBe(a === false || b === false ? false : a === undefined || b === undefined ? undefined : true);
		expect(evaluate(group('or', leaf, right), facts)).toBe(a === true || b === true ? true : a === undefined || b === undefined ? undefined : false);
	}
});
test('NOT negates both individual conditions and whole groups without turning unknown into true', () => {
	expect(evaluate(not(leaf), {})).toBeUndefined();
	expect(evaluate(not(group('and', leaf, condition('tag', 10))), { installed: true, tags: new Set([10]) })).toBe(false);
	expect(evaluate(not(not(leaf)), { installed: false })).toBe(false);
});
test('mixed nested expression supports inclusion and exclusion', () => {
	const rule = group('and', group('or', condition('tag', 10), group('and', condition('ownership', 'family'), condition('library', 'D:/SteamLibrary'))), not(condition('category', 5)));
	expect(evaluate(rule, { tags: new Set(), ownership: 'family', library: 'd:\\steamlibrary\\', categories: new Set([2]) })).toBe(true);
	expect(evaluate(rule, { tags: new Set([10]), categories: new Set([5]) })).toBe(false);
	expect(evaluate(rule, { tags: new Set(), ownership: 'personal', categories: new Set() })).toBe(false);
});
test('all criteria use their own metadata, including known absent installation locations', () => {
	const facts = { tags: new Set([10]), categories: new Set([2]), ownership: 'personal', installed: false, library: null, drive: null };
	for (const [field, value, result] of [['tag', 10, true], ['tag', 11, false], ['category', 2, true], ['ownership', 'family', false], ['installed', false, true], ['library', 'D:/Games', false], ['drive', 'D:', false]])
		expect(evaluate(condition(field, value), facts)).toBe(result);
	expect(evaluate(not(condition('drive', 'D:')), facts)).toBe(true);
	expect(evaluate(not(condition('drive', 'D:')), {})).toBeUndefined();
});
test('location comparison is Windows-aware without lowercasing POSIX paths', () => {
	expect(normalizeLocation('D:\\Games\\')).toBe('d:/games');
	expect(evaluate(condition('drive', 'D:'), { drive: 'd:' })).toBe(true);
	expect(evaluate(condition('library', '/Games'), { library: '/games' })).toBe(false);
	expect(normalizeLocation('/')).toBe('/');
});
test('empty groups and disabled rules retain explicit logical identities', () => {
	expect(evaluate(group('and'), {})).toBe(true);
	expect(evaluate(group('or'), {})).toBe(false);
	expect(hasRules({ version: 1, enabled: true, expression: group('and') })).toBe(false);
	expect(hasRules({ version: 1, enabled: true, expression: group('or') })).toBe(true);
	expect(hasRules({ version: 1, enabled: false, expression: leaf })).toBe(false);
});
test('deeply nested rules validate and evaluate without recursive JavaScript calls', () => {
	let rule = leaf;
	for (let index = 0; index < 3000; index++) rule = not(rule);
	expect(isRule(rule)).toBe(true);
	expect(evaluate(rule, { installed: true })).toBe(true);
});
test('invalid, unknown, cyclic or oversized rule structures are rejected', () => {
	for (const value of [null, {}, { type: 'group', operator: 'xor', children: [] }, { type: 'not' }, condition('tag', 0), condition('tag', 1.5), condition('ownership', 'bought'), condition('drive', ''), condition('installed', 1), condition('future', 1)]) expect(isRule(value)).toBe(false);
	const cycle = not(null); cycle.child = cycle;
	expect(isRule(cycle)).toBe(false);
	expect(isRule(group('and', ...Array.from({ length: 10001 }, () => leaf)))).toBe(false);
	expect(isSavedRules({ version: 2, enabled: true, expression: leaf })).toBe(false);
});
test('evaluation does not mutate rule trees or game metadata', () => {
	const rule = Object.freeze(not(Object.freeze(condition('tag', 10))));
	const tags = new Set([10, 20]);
	evaluate(rule, Object.freeze({ tags }));
	expect([...tags]).toEqual([10, 20]);
});
