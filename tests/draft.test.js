import { test, expect } from 'bun:test';
import { RuleDraft } from '../frontend/rules/draft';
import { describeRule, invertRule, editorRoot } from '../frontend/rules/editing';
import { evaluate } from '../frontend/rules/evaluate';

const rules = (value = 10) => ({ version: 1, enabled: true, expression: { type: 'condition', field: 'tag', value } });
function fixture() {
	let current = rules(), writable = true, writes = 0;
	const session = new RuleDraft(() => current, async (value) => { current = value; writes++; }, () => writable);
	return { session, current: () => current, writes: () => writes, replace: (value) => { current = value; }, lock: () => { writable = false; } };
}
test('draft values are detached from persisted data and Cancel never writes', () => {
	const f = fixture(); f.session.value.expression.value = 20;
	expect(f.current()).toEqual(rules()); f.session.cancel(); expect(f.session.value).toEqual(rules()); expect(f.writes()).toBe(0);
});
test('external changes preserve dirty drafts and block stale saves until Cancel', async () => {
	const f = fixture(); f.session.change(rules(20)); f.replace(rules(30)); f.session.sync();
	expect(f.session.value).toEqual(rules(20)); expect(f.session.conflict).toBe(true);
	await expect(f.session.save()).rejects.toThrow(); expect(f.writes()).toBe(0);
	f.session.cancel(); expect(f.session.value).toEqual(rules(30)); expect(f.session.conflict).toBe(false);
});
test('save failure retains the draft; account or collection changes block persistence', async () => {
	const f = fixture(); f.session.change(rules(20)); f.lock();
	await expect(f.session.save()).rejects.toThrow(); expect(f.session.dirty).toBe(true); expect(f.writes()).toBe(0);
	const session = new RuleDraft(() => rules(), async () => { throw Error('disk unavailable'); }, () => true);
	session.change(rules(20)); await expect(session.save()).rejects.toThrow();
	expect(session.value).toEqual(rules(20)); expect(session.saving).toBe(false); expect(session.dirty).toBe(true);
});
test('an in-flight save cannot be changed, cancelled or submitted twice', async () => {
	let finish;
	const session = new RuleDraft(() => rules(), () => new Promise((resolve) => { finish = resolve; }), () => true);
	session.change(rules(20)); const saving = session.save();
	session.change(rules(30)); session.cancel(); await expect(session.save()).rejects.toThrow();
	expect(session.value).toEqual(rules(20)); finish(); await saving; expect(session.dirty).toBe(false);
});
test('Millennium property reordering after Save does not create a false conflict on the next edit', async () => {
	let persisted = rules();
	const session = new RuleDraft(() => persisted, async (value) => { persisted = { expression: { value: value.expression.value, field: 'tag', type: 'condition' }, enabled: value.enabled, version: 1 }; }, () => true);
	session.change(rules(20)); await session.save(); session.change(rules(30));
	expect(session.conflict).toBe(false); await session.save(); expect(persisted.expression.value).toBe(30);
});
test('unchanged runtime notifications do not clone the draft or publish repeated changes', () => {
	const f = fixture(); let notifications = 0; const before = f.session.value;
	f.session.subscribe(() => { notifications++; });
	for (let i = 0; i < 20; i++) f.session.sync();
	expect(f.session.value).toBe(before); expect(notifications).toBe(0);
});
test('legacy root conditions and repeated negations retain their three-valued meaning', () => {
	const condition = rules().expression;
	const nested = { type: 'not', child: { type: 'not', child: { type: 'not', child: condition } } };
	const { node, inverted } = describeRule(nested);
	for (const facts of [{}, { tags: new Set([10]) }, { tags: new Set([20]) }]) {
		expect(evaluate(editorRoot(nested), facts)).toBe(evaluate(nested, facts));
		expect(evaluate(invertRule(node, inverted), facts)).toBe(evaluate(nested, facts));
	}
	expect(editorRoot(condition).children).toEqual([condition]); expect(nested.child.type).toBe('not');
});
test('operator-only, period-only and upper-bound edits are dirty and Cancel restores the full condition', () => {
	const saved = { version: 1, enabled: true, expression: { type: 'condition', field: 'playtime', comparison: 'between', value: 2, upper: 20, period: 'total' } };
	const draft = new RuleDraft(() => saved, async () => { throw Error('must not write'); }, () => true);
	for (const change of [{ comparison: 'gt' }, { upper: 30 }, { period: 'twoWeeks' }]) {
		draft.change({ ...saved, expression: { ...saved.expression, ...change } }); expect(draft.dirty).toBe(true); draft.cancel(); expect(draft.value).toEqual(saved); expect(draft.dirty).toBe(false);
	}
});
