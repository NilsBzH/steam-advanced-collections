import { test, expect } from 'bun:test';
import { steamFeatureLabel, steamFeatureChoices } from '../frontend/steam/features';
import { editableFields } from '../frontend/rules/editing';
import { evaluate } from '../frontend/rules/evaluate';
import { RuleRepository, ruleKey } from '../frontend/rules/repository';
import verified from './fixtures/steam-features-2026-10-29.json';

test('feature ID/name associations match the recorded official Steam responses', () => {
	for (const [id, name] of Object.entries(verified.labels)) {
		expect(steamFeatureLabel(Number(id))).toBe(name);
		expect(new URL(verified.evidence[id]).hostname).toBe('store.steampowered.com');
	}
	// The controller search filter calls 18 Xbox support, but appdetails' actual
	// category 18 is Partial Controller Support. Do not conflate the two APIs.
	expect(steamFeatureLabel(18)).toBe('Partial Controller Support');
	expect(steamFeatureLabel(31)).toBe('VR Support'); expect(steamFeatureLabel(54)).toBe('VR Only');
});
test('unknown feature IDs remain explicit instead of guessing from adjacent IDs', () => {
	for (const id of [3, 12, 45, 46, 60, 123456]) expect(steamFeatureLabel(id)).toBe(`Unknown Steam feature (ID: ${id})`);
	expect(steamFeatureChoices([23, 2, 23, 0])).toEqual([{ value: '2', label: 'Single-player' }, { value: '23', label: 'Steam Cloud' }]);
});
test('existing nested category/drive rules restore and evaluate unchanged with no automatic migration', async () => {
	const saved = { version: 1, enabled: true, expression: { type: 'group', operator: 'and', children: [
		{ type: 'condition', field: 'category', value: 23 },
		{ type: 'not', child: { type: 'condition', field: 'drive', value: 'D:' } },
	] } };
	const key = ruleKey('76561198000000001', 'legacy'), disk = { [key]: structuredClone(saved) }; let writes = 0;
	const repository = new RuleRepository({ getAll: async () => structuredClone(disk), set: async (key, value) => { disk[key] = structuredClone(value); writes++; }, subscribe: () => () => {} });
	try {
		await repository.load(); expect(repository.get('76561198000000001', 'legacy')).toEqual(saved); expect(writes).toBe(0);
		expect(evaluate(saved.expression, { categories: new Set([23]), drive: 'e:' })).toBe(true);
		expect(evaluate(saved.expression, { categories: new Set([23]), drive: 'd:' })).toBe(false);
		expect(evaluate(saved.expression, { categories: new Set([23]) })).toBeUndefined();
		await repository.save('76561198000000001', 'legacy', saved);
		expect(disk[key]).toEqual(saved); expect(editableFields).toContain('category'); expect(editableFields).toContain('library'); expect(editableFields).not.toContain('drive');
	} finally { repository.dispose(); }
});
