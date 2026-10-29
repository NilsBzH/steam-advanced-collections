import { test, expect } from 'bun:test';
import { MembershipBridge } from '../frontend/steam/membership';
import { RuleRepository, ruleKey, PLUGIN_ID } from '../frontend/rules/repository';
import { SteamMetadata } from '../frontend/steam/metadata';
import { applyPatches, nativeCollection } from './helpers/patches';

const account = '76561197960265729';
const saved = (expression) => ({ version: 1, enabled: true, expression });
const tag = (value) => ({ type: 'condition', field: 'tag', value });
async function fixture({ empty = false, expression = tag(10), patched = true } = {}) {
	const window = { PLUGIN_LIST: {} };
	const Class = new Function('window', patched ? applyPatches(nativeCollection) : nativeCollection)(window);
	const games = [1, 2, 3].map((appid) => ({ appid, visible_in_game_list: true, store_tag: appid === 2 ? [20] : [10] }));
	let nativeCalls = 0;
	const filter = { bIsEmpty: empty, m_filterSpec: { native: true }, Matches: (game) => { nativeCalls++; return empty || game.appid !== 3; } };
	const collection = new Class(filter, games);
	const staticCollection = new Class(undefined, games, true); staticCollection.id = 'static'; staticCollection.m_setAddedManually.add(2);
	const disk = { [ruleKey(account, 'test')]: saved(expression) };
	const repository = new RuleRepository({ getAll: async () => ({ ...disk }), set: async (key, value) => { disk[key] = structuredClone(value); }, subscribe: () => () => {} });
	await repository.load();
	const environment = { App: { GetCurrentUser: () => ({ strSteamID: account }) }, appStore: { allApps: games }, collectionStore: { collectionsFromStorage: new Map([['test', collection], ['static', staticCollection]]) } };
	const bridge = new MembershipBridge(environment, repository, new SteamMetadata(environment), () => {});
	window.PLUGIN_LIST[PLUGIN_ID] = { integration: bridge };
	return { bridge, collection, staticCollection, repository, games, filter, window, environment, nativeCalls: () => nativeCalls };
}
test('native predicate AND advanced rules, with exactly one native call per candidate', async () => {
	const f = await fixture(); f.bridge.refresh();
	expect([...f.collection.m_setApps]).toEqual([1]); expect(f.nativeCalls()).toBe(3);
	expect(f.filter.m_filterSpec).toEqual({ native: true }); expect(f.staticCollection.calls).toBe(0);
});
test('native manual additions and exclusions keep their original precedence', async () => {
	const f = await fixture(); f.collection.m_setAddedManually.add(2); f.collection.m_setRemovedManually.add(1);
	f.bridge.refresh(); expect([...f.collection.m_setApps]).toEqual([2]);
	expect([...f.collection.m_setAddedManually]).toEqual([2]); expect([...f.collection.m_setRemovedManually]).toEqual([1]);
});
test('advanced-only rules work when the native filter is empty', async () => {
	const f = await fixture({ empty: true }); f.bridge.refresh(); expect([...f.collection.m_setApps]).toEqual([1, 3]);
});
test('unavailable metadata retains the actual native behavior, including an empty native filter', async () => {
	const expression = { type: 'not', child: { type: 'condition', field: 'ownership', value: 'family' } };
	const f = await fixture({ expression }); f.bridge.refresh(); expect([...f.collection.m_setApps]).toEqual([1, 2]);
	const empty = await fixture({ expression, empty: true }); empty.bridge.refresh(); expect([...empty.collection.m_setApps]).toEqual([]);
});
test('missing bridge marker prevents native recalculation', async () => {
	const f = await fixture({ patched: false }); f.bridge.refresh(); expect(f.collection.calls).toBe(0); expect(f.bridge.canApply(f.collection)).toBe(false);
});
test('missing frontend globals preserve native calculation', () => {
	const Class = new Function('window', applyPatches(nativeCollection))({});
	const c = new Class({ bIsEmpty: false, Matches: () => true }, [{ appid: 1, visible_in_game_list: true }]);
	c.UpdateAllApps(); expect([...c.m_setApps]).toEqual([1]);
});
test('disabling rules or unloading restores native results without invoking persistence', async () => {
	const f = await fixture(); f.bridge.refresh();
	await f.repository.save(account, 'test', { ...saved(tag(10)), enabled: false }); f.bridge.refresh();
	expect([...f.collection.m_setApps]).toEqual([1, 2]);
	await f.repository.save(account, 'test', saved(tag(10))); f.bridge.refresh();
	f.bridge.dispose(); expect([...f.collection.m_setApps]).toEqual([1, 2]); expect(f.staticCollection.calls).toBe(0);
});
test('switching accounts cannot apply the previous account rules to a same-ID collection', async () => {
	const f = await fixture(); f.bridge.refresh();
	// A new client context consults its own account identity on every calculation.
	const other = new MembershipBridge({ App: { GetCurrentUser: () => ({ strSteamID: '76561197960265730' }) } }, f.repository, new SteamMetadata({}), () => {});
	f.window.PLUGIN_LIST[PLUGIN_ID].integration = other;
	f.collection.UpdateAllApps(); expect([...f.collection.m_setApps]).toEqual([1, 2]);
});

test('asynchronous metadata only recalculates collections using the changed criterion and native candidate', async () => {
	const f = await fixture({ expression: { type: 'condition', field: 'reviews', mode: 'score', comparison: 'gt', value: 80 } });
	f.games.forEach((game) => { game.review_score = 8; game.review_percentage = game.appid === 1 ? 90 : 70; });
	f.bridge.refresh(); const calls = f.collection.calls;
	f.bridge.refresh(new Map([[1, new Set(['language'])]])); expect(f.collection.calls).toBe(calls);
	f.bridge.refresh(new Map([[3, new Set(['reviews'])]])); expect(f.collection.calls).toBe(calls);
	f.bridge.refresh(new Map([[1, new Set(['reviews'])]])); expect(f.collection.calls).toBe(calls + 1);
	expect([...f.collection.m_setApps]).toEqual([1]); expect(f.staticCollection.calls).toBe(0); f.bridge.dispose();
});

test('known rejecting AND predicates prevent complementary requests for unrelated library games', async () => {
	const f = await fixture({ expression: { type: 'group', operator: 'and', children: [tag(10), { type: 'condition', field: 'developer', value: 'Studio' }] } });
	const requested = [];
	f.environment.storeItemCache = { m_bInitialized: true, GetApp: () => undefined, QueueAppRequest: async (id) => { requested.push(id); return 2; } };
	f.bridge.refresh(); await Bun.sleep(15);
	expect(requested).toEqual([1]); f.bridge.dispose();
});

test('unknown local library blockers in an advanced-only collection do not fetch the whole uninstalled library', async () => {
	const f = await fixture({ empty: true, expression: { type: 'group', operator: 'and', children: [{ type: 'condition', field: 'library', value: 'E:' }, { type: 'condition', field: 'language', support: 'interface', value: 0 }] } });
	const requested = []; f.environment.storeItemCache = { m_bInitialized: true, GetApp: () => undefined, QueueAppRequest: async (id) => { requested.push(id); return 2; } };
	f.bridge.refresh(); await Bun.sleep(15); expect(requested).toEqual([]); expect([...f.collection.m_setApps]).toEqual([]); f.bridge.dispose();
});
