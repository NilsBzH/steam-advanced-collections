import { test, expect } from 'bun:test';
import { RuleRepository, ruleKey } from '../frontend/rules/repository';

const value = { version: 1, enabled: true, expression: { type: 'condition', field: 'tag', value: 10 } };
function fixture(initial = {}) {
	const disk = { ...initial }, writes = []; let listener;
	const port = {
		getAll: async () => ({ ...disk }),
		set: async (key, value) => { writes.push(key); disk[key] = structuredClone(value); },
		subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
	};
	return { disk, writes, port, repository: new RuleRepository(port), emit: (key, next) => listener?.(key, next) };
}
test('saving updates one collection key and survives a new repository instance', async () => {
	const other = ruleKey('account', 'other'), key = ruleKey('account', 'uc-1+*');
	const f = fixture({ [other]: value, unrelated: { keep: true } });
	await f.repository.load(); await f.repository.save('account', 'uc-1+*', value);
	expect(f.writes).toEqual([key]); expect(f.disk[other]).toEqual(value); expect(f.disk.unrelated).toEqual({ keep: true });
	const reloaded = new RuleRepository(f.port); await reloaded.load();
	expect(reloaded.get('account', 'uc-1+*')).toEqual(value); expect(reloaded.get('other-account', 'uc-1+*')).toBeUndefined();
	f.repository.dispose(); reloaded.dispose();
});
test('unsupported persisted schemas remain untouched and cannot be overwritten', async () => {
	const key = ruleKey('account', 'one'), unsupported = { version: 99, future: ['retain'] };
	const f = fixture({ [key]: unsupported }); await f.repository.load();
	expect(f.repository.hasUnsupported('account', 'one')).toBe(true);
	await expect(f.repository.save('account', 'one', value)).rejects.toThrow();
	expect(f.writes).toEqual([]); expect(f.disk[key]).toEqual(unsupported); f.repository.dispose();
});
test('failed persistence does not silently replace the previous rules', async () => {
	const key = ruleKey('account', 'one'), f = fixture({ [key]: value }); await f.repository.load();
	f.port.set = async () => { throw Error('disk full'); };
	await expect(f.repository.save('account', 'one', { ...value, enabled: false })).rejects.toThrow();
	expect(f.repository.get('account', 'one')).toEqual(value); f.repository.dispose();
});
test('a live config change wins over an older initial read', async () => {
	const key = ruleKey('account', 'one'), f = fixture(); let resolve;
	f.port.getAll = () => new Promise((done) => { resolve = done; });
	const loading = f.repository.load();
	const newer = { ...value, enabled: false }; f.emit(key, newer);
	resolve({ [key]: value }); await loading;
	expect(f.repository.get('account', 'one')).toEqual(newer); f.repository.dispose();
});
test('account and opaque collection IDs cannot collide', () => {
	expect(ruleKey('a:b', 'c')).not.toBe(ruleKey('a', 'b:c'));
	expect(ruleKey('a', '__proto__')).not.toBe(ruleKey('a', 'constructor'));
});
test('successful IPC with a shifted key/value is rejected instead of reporting a cached save', async () => {
	const f = fixture(); await f.repository.load();
	// Reproduce 0.2.0: the compiler-injected plugin ID shifted the SDK arguments.
	f.port.set = async (key) => { f.disk['com.steamadvancedcollections.plugin'] = key; };
	await expect(f.repository.save('account', 'one', value)).rejects.toThrow('could not be verified');
	expect(f.repository.get('account', 'one')).toBeUndefined(); f.repository.dispose();
});
test('save verification tolerates Millennium JSON object key ordering', async () => {
	const f = fixture(); await f.repository.load();
	f.port.set = async (key, rule) => { f.disk[key] = { expression: { value: rule.expression.value, field: 'tag', type: 'condition' }, enabled: true, version: 1 }; };
	await f.repository.save('account', 'one', value);
	expect(f.repository.get('account', 'one')).toEqual(value); f.repository.dispose();
});
test('disposing during configuration loading cannot restore or notify afterwards', async () => {
	const f = fixture(); let resolve, notifications = 0;
	f.port.getAll = () => new Promise((done) => { resolve = done; });
	f.repository.subscribe(() => { notifications++; });
	const loading = f.repository.load(); f.repository.dispose();
	resolve({ [ruleKey('account', 'one')]: value }); await loading;
	expect(f.repository.isLoaded()).toBe(false); expect(notifications).toBe(0);
});
