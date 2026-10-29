import { test, expect } from 'bun:test';
import { SupplementalMetadata, personalAchievementFacts } from '../frontend/steam/supplemental';
import { evaluate } from '../frontend/rules/evaluate';
import { AdvancedCollections } from '../frontend/app';
import { RuleRepository, ruleKey, PLUGIN_ID } from '../frontend/rules/repository';
import { applyPatches, nativeCollection } from './helpers/patches';

const sleep = (ms = 10) => Bun.sleep(ms);
const response = (unlocked = 31, total = 100) => ({ result: 1, data: { rgAchievements: Array.from({ length: total }, (_, id) => ({ strID: `achievement-${id}`, bAchieved: id < unlocked, bHidden: id % 2 === 0 })) } });
const condition = (comparison, value, upper) => ({ type: 'condition', field: 'achievementProgress', comparison, value, ...(upper === undefined ? {} : { upper }) });
const not = (child) => ({ type: 'not', child });
test('the real 31% case uses the complete native personal achievement response, including hidden achievements', () => {
	const facts = { achievementProgress: personalAchievementFacts(response()) };
	expect(facts.achievementProgress).toBe(31);
	for (const progress of [facts.achievementProgress, personalAchievementFacts(response(22, 69))]) {
		for (const [rule, expected] of [[condition('gt', 20), true], [condition('gt', 50), false], [condition('between', 20, 40), true], [not(condition('gt', 50)), true]]) expect(evaluate(rule, { achievementProgress: progress })).toBe(expected);
	}
	expect(evaluate(condition('eq', 31), facts)).toBe(true); expect(evaluate(condition('lt', 31), facts)).toBe(false);
	expect(personalAchievementFacts(response(22, 69))).toBe(22 * 100 / 69); // Steam may display a rounded/truncated 31%.
});
test('zero, completion, no achievements, failed responses and malformed/incomplete data remain distinct under NOT', () => {
	expect(personalAchievementFacts(response(0))).toBe(0); expect(personalAchievementFacts(response(100))).toBe(100);
	expect(personalAchievementFacts(response(0, 0))).toBeNull();
	expect(evaluate(condition('eq', 100), { achievementProgress: null })).toBe(false);
	expect(evaluate(not(condition('eq', 100)), { achievementProgress: null })).toBe(true);
	expect(evaluate(condition('eq', 0), { achievementProgress: 0 })).toBe(true);
	expect(evaluate(condition('eq', 100), { achievementProgress: 100 })).toBe(true);
	for (const data of [undefined, { result: 2, data: { rgAchievements: [] } }, { result: 1, data: {} }, { result: 1, data: { rgAchievements: [{ strID: 'a' }] } }, { result: 1, data: { rgAchievements: [{ strID: 'a', bAchieved: true }, { strID: 'a', bAchieved: false }] } }]) {
		const value = personalAchievementFacts(data); expect(value).toBeUndefined(); expect(evaluate(not(condition('gt', 50)), { achievementProgress: value })).toBeUndefined();
	}
});
test('a missing library aggregate triggers one shared personal request only when a progress criterion is used', async () => {
	const changes = []; let calls = 0;
	const environment = { SteamClient: { Apps: { GetMyAchievementsForApp: async (id) => { expect(id).toBe('2515020'); calls++; return response(); } } } };
	const cache = new SupplementalMetadata(environment, (change) => changes.push(change), { spacingMs: 1 }); cache.setAccount('account');
	cache.read({ appid: 2515020 }, new Set(['publisher'])); expect(calls).toBe(0);
	for (let i = 0; i < 20; i++) expect(cache.read({ appid: 2515020 }, new Set(['achievementProgress'])).achievementProgress).toBeUndefined();
	await sleep(); expect(calls).toBe(1); expect(changes).toHaveLength(1);
	expect(cache.read({ appid: 2515020 }, new Set(['achievementProgress'])).achievementProgress).toBe(31); cache.dispose();
});
test('TTL, unlock events and last-played changes invalidate progress without a polling/recalculation request loop', async () => {
	let now = 0, calls = 0, unlocked = 31; const changes = [], app = { appid: 1, rt_last_time_played: 100 };
	const env = { appStore: { allApps: [app] }, SteamClient: { Apps: { GetMyAchievementsForApp: async () => { calls++; return response(unlocked); } } } };
	const cache = new SupplementalMetadata(env, (change) => changes.push(change), { now: () => now, ttlMs: 100, spacingMs: 1 }); cache.setAccount('a');
	cache.read(app, new Set(['achievementProgress'])); await sleep();
	for (let i = 0; i < 10; i++) { cache.read(app, new Set(['achievementProgress'])); cache.pollAchievements(); }
	expect(calls).toBe(1);
	unlocked = 32; cache.invalidateProgress(1); expect(cache.read(app, new Set(['achievementProgress'])).achievementProgress).toBeUndefined(); await sleep();
	expect(cache.read(app, new Set(['achievementProgress'])).achievementProgress).toBe(32); expect(calls).toBe(2);
	app.rt_last_time_played = 101; cache.pollAchievements(); await sleep(); expect(calls).toBe(3);
	now = 101; cache.pollAchievements(); await sleep(); expect(calls).toBe(4); cache.dispose();
});
test('an unlock during an in-flight request rejects that old reply and permits one fresh request', async () => {
	let finish; const changes = [];
	const cache = new SupplementalMetadata({ SteamClient: { Apps: { GetMyAchievementsForApp: () => new Promise((resolve) => { finish = resolve; }) } } }, (change) => changes.push(change), { spacingMs: 1 }); cache.setAccount('a');
	const app = { appid: 1 }; cache.read(app, new Set(['achievementProgress'])); cache.invalidateProgress(1); finish(response(31)); await sleep();
	expect(cache.read(app, new Set(['achievementProgress'])).achievementProgress).toBeUndefined(); finish(response(32)); await sleep();
	expect(cache.read(app, new Set(['achievementProgress'])).achievementProgress).toBe(32); cache.dispose();
});

test('failed personal requests stay unknown under NOT and back off instead of retrying on every recalculation', async () => {
	let calls = 0, now = 0; const app = { appid: 1 }, fields = new Set(['achievementProgress']);
	const cache = new SupplementalMetadata({ appStore: { allApps: [app] }, SteamClient: { Apps: { GetMyAchievementsForApp: async () => { calls++; return { result: 2 }; } } } }, () => {}, { now: () => now, spacingMs: 1 }); cache.setAccount('a');
	cache.read(app, fields); await sleep();
	for (let i = 0; i < 20; i++) { expect(evaluate(not(condition('gt', 50)), cache.read(app, fields))).toBeUndefined(); cache.pollAchievements(); }
	expect(calls).toBe(1); now = 300001; cache.pollAchievements(); await sleep(); expect(calls).toBe(2); cache.dispose();
});

test('personal achievement replies cannot cross accounts or revive an unloaded cache, and cancelled demand drops waiting requests', async () => {
	const finishes = []; let calls = 0, needed = true; const changes = [], fields = new Set(['achievementProgress']);
	const cache = new SupplementalMetadata({ SteamClient: { Apps: { GetMyAchievementsForApp: () => { calls++; return new Promise((resolve) => finishes.push(resolve)); } } } }, (change) => changes.push(change), { spacingMs: 5 }); cache.setAccount('a');
	cache.setDemandCheck(() => needed);
	cache.read({ appid: 1 }, fields); cache.setAccount('b'); finishes.shift()(response()); await sleep(); expect(changes).toHaveLength(0);
	expect(cache.read({ appid: 1 }, fields).achievementProgress).toBeUndefined();
	cache.read({ appid: 2 }, fields); needed = false; await sleep(); expect(calls).toBe(2);
	cache.dispose(); finishes.shift()(response()); await sleep(); expect(changes).toHaveLength(0); expect(cache.read({ appid: 1 }, fields)).toEqual({});
});
test('native membership at 31% updates asynchronously, supports NOT and Cancel, preserves static data and unregisters notifications', async () => {
	const account = '76561198000000001', game = { appid: 2515020, visible_in_game_list: true, store_tag: [10] }, window = { PLUGIN_LIST: {} };
	const Class = new Function('window', applyPatches(nativeCollection))(window);
	const collection = new Class({ bIsEmpty: false, Matches: () => true }, [game]), other = new Class({ bIsEmpty: false, Matches: () => true }, [game]), staticCollection = new Class(undefined, [game], true); other.id = 'other'; staticCollection.id = 'static';
	const original = { version: 1, enabled: true, expression: { type: 'condition', field: 'tag', value: 10 } }, disk = { [ruleKey(account, 'test')]: original }; let writes = 0, resolve, notify, unregistered = 0;
	const repository = new RuleRepository({ getAll: async () => structuredClone(disk), set: async () => { writes++; }, subscribe: () => () => {} });
	const env = { App: { GetCurrentUser: () => ({ strSteamID: account }) }, appStore: { allApps: [game] }, collectionStore: { collectionsFromStorage: new Map([['test', collection], ['other', other], ['static', staticCollection]]) }, SteamClient: { Apps: { GetMyAchievementsForApp: () => new Promise((done) => { resolve = done; }) }, GameSessions: { RegisterForAchievementNotification: (callback) => { notify = callback; return { unregister: () => { unregistered++; } }; } } } };
	const app = new AdvancedCollections(env, repository, () => () => {}); window.PLUGIN_LIST[PLUGIN_ID] = { integration: app.membership };
	try {
		await app.start(); const otherCalls = other.calls;
		const preview = app.openPreview({}, collection, account, () => true, () => {});
		preview.update({ ...original, expression: condition('gt', 20) }, true); await sleep(280); expect([...collection.m_setApps]).toEqual([2515020]); // unknown retains native result
		resolve(response()); await sleep(180); expect([...collection.m_setApps]).toEqual([2515020]);
		for (const [rule, present] of [[condition('gt', 50), false], [condition('between', 20, 40), true], [not(condition('gt', 50)), true]]) {
			preview.update({ ...original, expression: rule }, true); await sleep(280); expect(collection.m_setApps.has(2515020)).toBe(present);
		}
		notify({ unAppID: 2515020 }); await sleep(180); resolve(response(60)); await sleep(180); expect(collection.m_setApps.has(2515020)).toBe(false);
		preview.cancel(); expect(collection.m_setApps.has(2515020)).toBe(true); expect(writes).toBe(0); expect(disk[ruleKey(account, 'test')]).toEqual(original);
		expect(other.calls).toBe(otherCalls); expect(staticCollection.calls).toBe(0);
	} finally { app.dispose(); }
	expect(unregistered).toBe(1);
});
