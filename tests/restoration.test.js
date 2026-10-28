import { test, expect } from 'bun:test';
import { AdvancedCollections } from '../frontend/app';
import { RuleRepository, ruleKey, PLUGIN_ID } from '../frontend/rules/repository';
import { applyPatches, nativeCollection } from './helpers/patches';

const account = '76561198111189155';
const rules = { version: 1, enabled: true, expression: { type: 'condition', field: 'tag', value: 10 } };
async function until(predicate) {
	const end = Date.now() + 2000;
	while (!predicate()) { if (Date.now() > end) throw Error('Restoration did not finish'); await Bun.sleep(5); }
}
function fixture() {
	const disk = { [ruleKey(account, 'test')]: rules };
	const port = { getAll: async () => structuredClone(disk), set: async () => { throw Error('Restoration must not write configuration'); }, subscribe: () => () => {} };
	const window = { PLUGIN_LIST: {} };
	const Class = new Function('window', applyPatches(nativeCollection))(window);
	const games = [{ appid: 1, visible_in_game_list: true, store_tag: [10] }, { appid: 2, visible_in_game_list: true, store_tag: [20] }];
	let currentAccount;
	const environment = { App: { GetCurrentUser: () => ({ strSteamID: currentAccount }) }, appStore: { allApps: games, m_bIsInitialized: false }, collectionStore: { collectionsFromStorage: new Map() } };
	const repository = new RuleRepository(port);
	const app = new AdvancedCollections(environment, repository, () => () => {}, { readinessIntervalMs: 5 });
	window.PLUGIN_LIST[PLUGIN_ID] = { integration: app.membership };
	const create = (isStatic = false) => new Class({ bIsEmpty: false, Matches: () => true }, games, isStatic);
	return { app, port, repository, environment, disk, create, window, login: () => { currentAccount = account; environment.appStore.m_bIsInitialized = true; } };
}
test('cold startup restores persisted rules without opening an editor, even with late account and collections', async () => {
	const f = fixture(); const before = structuredClone(f.disk);
	try {
		await f.app.start(); expect(f.app.ready).toBe(false);
		f.login(); await until(() => f.app.ready);
		const collection = f.create(), staticCollection = f.create(true); staticCollection.id = 'static';
		// No Steam notification and no editor action: collection objects arrive later.
		f.environment.collectionStore.collectionsFromStorage.set('test', collection);
		f.environment.collectionStore.collectionsFromStorage.set('static', staticCollection);
		await until(() => collection.calls > 0);
		expect([...collection.m_setApps]).toEqual([1]); expect(staticCollection.calls).toBe(0);
		const replacement = f.create();
		f.environment.collectionStore.collectionsFromStorage.set('test', replacement);
		await until(() => replacement.calls > 0); expect([...replacement.m_setApps]).toEqual([1]);
		expect(f.disk).toEqual(before);
	} finally { f.app.dispose(); }
});
test('configuration unavailable on the first attempt is retried and restored automatically', async () => {
	const f = fixture(); let reads = 0;
	f.port.getAll = async () => { if (++reads === 1) throw Error('SDK starting'); return structuredClone(f.disk); };
	const collection = f.create(); f.environment.collectionStore.collectionsFromStorage.set('test', collection); f.login();
	try {
		await f.app.start(); expect(f.app.ready).toBe(false);
		await until(() => collection.calls > 0);
		expect(f.app.ready).toBe(true); expect([...collection.m_setApps]).toEqual([1]); expect(reads).toBe(2);
	} finally { f.app.dispose(); }
});
test('a different Steam account never restores another account rules', async () => {
	const f = fixture(); f.login();
	f.environment.App.GetCurrentUser = () => ({ strSteamID: '76561198111189156' });
	const collection = f.create(); f.environment.collectionStore.collectionsFromStorage.set('test', collection);
	try { await f.app.start(); expect(f.app.ready).toBe(true); expect(collection.calls).toBe(0); }
	finally { f.app.dispose(); }
});
test('the periodic fallback re-evaluates relative dates without any Steam event', async () => {
	const f = fixture(); f.login(); const now = Date.now, base = Date.parse('2026-01-15T12:00:00Z'); let clock = base;
	f.disk[ruleKey(account, 'test')] = { version: 1, enabled: true, expression: { type: 'condition', field: 'lastPlayed', comparison: 'gt', value: 30, unit: 'days' } };
	for (const game of f.environment.appStore.allApps) { game.rt_last_time_played = Date.parse('2026-01-01T12:00:00Z') / 1000; game.minutes_playtime_forever = 120; }
	const collection = f.create(); f.environment.collectionStore.collectionsFromStorage.set('test', collection);
	const app = new AdvancedCollections(f.environment, f.repository, () => () => {}, { periodicIntervalMs: 20 });
	f.window.PLUGIN_LIST[PLUGIN_ID] = { integration: app.membership };
	// Replace only Date.now; timer scheduling still uses the real clock.
	Date.now = () => clock;
	try {
		await app.start(); expect([...collection.m_setApps]).toEqual([]);
		clock = Date.parse('2026-03-15T12:00:00Z'); await Bun.sleep(220);
		expect([...collection.m_setApps].sort()).toEqual([1, 2]);
	} finally { app.dispose(); f.app.dispose(); Date.now = now; }
});
