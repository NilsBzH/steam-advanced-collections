import { test, expect } from 'bun:test';
import { NativePreview } from '../frontend/steam/preview';
import { AdvancedCollections } from '../frontend/app';
import { RuleRepository, ruleKey, PLUGIN_ID } from '../frontend/rules/repository';
import { RuleDraft } from '../frontend/rules/draft';
import { applyPatches, nativeCollection } from './helpers/patches';

const account = '76561198111189155';
const tag = (value) => ({ type: 'condition', field: 'tag', value });
const saved = (expression = tag(10), enabled = true) => ({ version: 1, enabled, expression });
async function fixture({ empty = false, patched = true, persisted = saved() } = {}) {
	const window = { PLUGIN_LIST: {} }, Class = new Function('window', patched ? applyPatches(nativeCollection) : nativeCollection)(window);
	const games = [1, 2, 3].map((appid) => ({ appid, visible_in_game_list: true, store_tag: appid === 2 ? [20] : [10] }));
	const filter = { bIsEmpty: empty, m_filterSpec: { keep: true }, Matches: (game) => empty || game.appid !== 3 };
	const collection = new Class(filter, games), other = new Class(filter, games), staticCollection = new Class(undefined, games, true);
	other.id = 'other'; staticCollection.id = 'static';
	const disk = persisted ? { [ruleKey(account, 'test')]: structuredClone(persisted) } : {};
	let writes = 0, currentAccount = account, subscriptions = 0;
	const repository = new RuleRepository({ getAll: async () => structuredClone(disk), set: async (key, value) => { writes++; disk[key] = structuredClone(value); }, subscribe: () => () => {} });
	await repository.load();
	const collections = new Map([['test', collection], ['other', other], ['static', staticCollection]]);
	const environment = { App: { GetCurrentUser: () => ({ strSteamID: currentAccount }) }, appStore: { allApps: games }, collectionStore: { collectionsFromStorage: collections, GetCollection: (id) => collections.get(id) } };
	const app = new AdvancedCollections(environment, repository, () => { subscriptions++; return () => {}; });
	app.ready = true; window.PLUGIN_LIST[PLUGIN_ID] = { integration: app.membership }; app.membership.refresh();
	const status = [], scope = { open: true };
	const current = () => scope.open && collections.get('test') === collection && currentAccount === account;
	const preview = new NativePreview(app.membership, collection, account, current, (active) => status.push(active), undefined, 5);
	const draft = new RuleDraft(() => repository.get(account, 'test'), (value) => repository.save(account, 'test', value), current);
	return { app, repository, collection, other, staticCollection, collections, games, filter, disk, preview, draft, status, scope, current, writes: () => writes, subscriptions: () => subscriptions, switchAccount: () => { currentAccount = '76561198111189156'; }, dispose: () => { preview.dispose(); app.dispose(); } };
}
const members = (collection) => [...collection.m_setApps].sort((a, b) => a - b);
test('a temporary rule changes native membership after debounce, with no persistence or filter changes', async () => {
	const f = await fixture(); const before = structuredClone(f.disk);
	try {
		f.preview.update(saved(tag(20)), true); expect(members(f.collection)).toEqual([1]);
		await Bun.sleep(15); expect(members(f.collection)).toEqual([2]); expect(f.status).toEqual([true]);
		expect(f.disk).toEqual(before); expect(f.writes()).toBe(0); expect(f.filter.m_filterSpec).toEqual({ keep: true }); expect(f.staticCollection.calls).toBe(0);
	} finally { f.dispose(); }
});
test('Cancel restores saved rules synchronously and cancels a pending newer edit', async () => {
	const f = await fixture();
	try {
		f.draft.change(saved(tag(20))); f.preview.update(f.draft.value, f.draft.dirty); await Bun.sleep(15);
		f.preview.update(saved(tag(30)), true); f.draft.cancel(); f.preview.cancel();
		expect(members(f.collection)).toEqual([1]); const calls = f.collection.calls;
		await Bun.sleep(30); expect(f.collection.calls).toBe(calls); expect(f.writes()).toBe(0); expect(f.status).toEqual([true, false]);
	} finally { f.dispose(); }
});
test('Save verifies persistence, releases the temporary override and preserves the displayed result', async () => {
	const f = await fixture();
	try {
		f.draft.change(saved(tag(20))); f.preview.update(f.draft.value, true); await Bun.sleep(15);
		await f.draft.save(); f.preview.commit(); expect(members(f.collection)).toEqual([2]); expect(f.writes()).toBe(1);
		f.preview.dispose(); expect(members(f.collection)).toEqual([2]); expect(f.disk[ruleKey(account, 'test')]).toEqual(saved(tag(20)));
	} finally { f.dispose(); }
});
test('Save before the debounce expires applies saved rules and cancels the pending preview', async () => {
	const f = await fixture();
	try {
		f.draft.change(saved(tag(20))); f.preview.update(f.draft.value, true); await f.draft.save(); f.preview.commit();
		expect(members(f.collection)).toEqual([2]); const calls = f.collection.calls;
		await Bun.sleep(30); expect(f.collection.calls).toBe(calls); expect(f.status).toEqual([]);
	} finally { f.dispose(); }
});
test('closing the editor without Save restores saved membership and disposes all pending work', async () => {
	const f = await fixture();
	try {
		f.preview.update(saved(tag(20)), true); await Bun.sleep(15); f.scope.open = false;
		f.preview.dispose(); expect(members(f.collection)).toEqual([1]); const calls = f.collection.calls;
		f.preview.update(saved(tag(30)), true); await Bun.sleep(25); expect(f.collection.calls).toBe(calls); expect(f.writes()).toBe(0);
	} finally { f.dispose(); }
});
test('closing during debounce never applies a transient draft', async () => {
	const f = await fixture();
	try { const calls = f.collection.calls; f.preview.update(saved(tag(20)), true); f.preview.dispose(); await Bun.sleep(20); expect(f.collection.calls).toBe(calls); expect(members(f.collection)).toEqual([1]); }
	finally { f.dispose(); }
});
test('switching editors restores the old collection and never leaks its draft to the next collection', async () => {
	const f = await fixture();
	try {
		const first = f.app.openPreview(f.scope, f.collection, account, f.current, () => {});
		first.update(saved(tag(20)), true); await Bun.sleep(280); expect(members(f.collection)).toEqual([2]);
		const next = f.app.openPreview({}, f.other, account, () => true, () => {});
		expect(members(f.collection)).toEqual([1]); f.other.UpdateAllApps(); expect(members(f.other)).toEqual([1, 2]);
		next.update(saved(tag(20)), true); f.app.closePreview(f.scope); await Bun.sleep(280);
		expect(members(f.other)).toEqual([2]); expect(members(f.collection)).toEqual([1]); expect(f.writes()).toBe(0);
	} finally { f.dispose(); }
});
test('account changes and replacement collection objects cannot reuse an old draft', async () => {
	const f = await fixture();
	try {
		f.preview.update(saved(tag(20)), true); await Bun.sleep(15); f.switchAccount();
		f.collection.UpdateAllApps(); expect(members(f.collection)).toEqual([1, 2]);
		f.collections.set('test', f.other); f.other.id = 'test'; f.other.UpdateAllApps(); expect(members(f.other)).toEqual([1, 2]);
	} finally { f.dispose(); }
});
test('native filters and manual exceptions retain their original AND and precedence', async () => {
	const f = await fixture();
	try {
		f.collection.m_setAddedManually.add(3); f.collection.m_setRemovedManually.add(2);
		f.preview.update(saved({ type: 'group', operator: 'or', children: [tag(10), tag(20)] }), true); await Bun.sleep(15);
		expect(members(f.collection)).toEqual([1, 3]);
		f.filter.Matches = (game) => game.appid === 2; f.collection.UpdateAllApps(); expect(members(f.collection)).toEqual([3]);
		expect([...f.collection.m_setAddedManually]).toEqual([3]); expect([...f.collection.m_setRemovedManually]).toEqual([2]);
	} finally { f.dispose(); }
});
test('unknown metadata keeps native behavior, including an empty native filter', async () => {
	for (const empty of [false, true]) {
		const f = await fixture({ empty });
		try {
			f.preview.update(saved({ type: 'not', child: { type: 'condition', field: 'ownership', value: 'family' } }), true); await Bun.sleep(15);
			expect(members(f.collection)).toEqual(empty ? [] : [1, 2]);
		} finally { f.dispose(); }
	}
});
test('disabled, invalid or reverted drafts restore saved behavior and never write', async () => {
	const f = await fixture();
	try {
		f.preview.update(saved(tag(10), false), true); await Bun.sleep(15); expect(members(f.collection)).toEqual([1, 2]);
		f.preview.update(saved(tag(0)), true); expect(members(f.collection)).toEqual([1]);
		f.preview.update(saved(tag(20)), true); await Bun.sleep(15); f.preview.update(saved(), false); expect(members(f.collection)).toEqual([1]);
		expect(f.writes()).toBe(0);
	} finally { f.dispose(); }
});
test('an advanced-only unsaved draft restores the empty native collection when no saved rules exist', async () => {
	const f = await fixture({ persisted: null, empty: true });
	try {
		f.preview.update(saved(tag(20)), true); await Bun.sleep(15); expect(members(f.collection)).toEqual([2]);
		f.preview.cancel(); expect(members(f.collection)).toEqual([]); expect(f.disk).toEqual({}); expect(f.writes()).toBe(0);
	} finally { f.dispose(); }
});
test('missing bridge and static collections do not trigger calculations', async () => {
	const f = await fixture({ patched: false });
	try {
		f.preview.update(saved(tag(20)), true); await Bun.sleep(15); expect(f.collection.calls).toBe(0); expect(f.status).toEqual([]);
		const lease = new NativePreview(f.app.membership, f.staticCollection, account, () => true, () => {}, undefined, 5);
		lease.update(saved(tag(20)), true); await Bun.sleep(15); lease.dispose(); expect(f.staticCollection.calls).toBe(0);
	} finally { f.dispose(); }
});
test('preview recalculates once per settled edit, with no UpdateApps observers or self-refresh loop', async () => {
	const f = await fixture();
	try {
		const lease = f.app.openPreview(f.scope, f.collection, account, f.current, () => {}); const before = f.collection.calls;
		lease.update(saved(tag(30)), true); await Bun.sleep(80); lease.update(saved(tag(20)), true);
		await Bun.sleep(200); expect(f.collection.calls).toBe(before);
		await Bun.sleep(90); expect(f.collection.calls).toBe(before + 1);
		await Bun.sleep(550); expect(f.collection.calls).toBe(before + 1); expect(f.subscriptions()).toBe(0);
	} finally { f.dispose(); }
});
test('plugin unload and a fresh runtime restore only saved rules; no draft survives restart', async () => {
	const f = await fixture();
	try {
		const lease = f.app.openPreview(f.scope, f.collection, account, f.current, () => {});
		lease.update(saved(tag(20)), true); await Bun.sleep(280); expect(members(f.collection)).toEqual([2]);
		f.app.dispose(); expect(members(f.collection)).toEqual([1, 2]);
		const reloaded = new RuleRepository({ getAll: async () => structuredClone(f.disk), set: async () => { throw Error('must not write'); }, subscribe: () => () => {} }); await reloaded.load();
		expect(reloaded.get(account, 'test')).toEqual(saved()); expect(f.writes()).toBe(0); reloaded.dispose();
	} finally { f.dispose(); }
});
