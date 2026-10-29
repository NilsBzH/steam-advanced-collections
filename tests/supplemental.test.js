import { test, expect } from 'bun:test';
import { SupplementalMetadata, achievementFacts, creatorNames } from '../frontend/steam/supplemental';
import { SteamMetadata } from '../frontend/steam/metadata';

const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(options = {}) {
	const apps = new Map(), calls = [], changes = [];
	const env = { storeItemCache: { m_bInitialized: true, GetApp: (id) => apps.get(id), QueueAppRequest: async (id, flags) => {
		calls.push({ id, flags }); apps.set(id, item()); return 1;
	} } };
	const cache = new SupplementalMetadata(env, (change) => changes.push(change), { spacingMs: 1, ...options }); cache.setAccount('account-a');
	return { env, apps, cache, calls, changes };
}
function item() { return { BContainDataRequest: () => true, m_BasicInfo: { developers: [{ name: 'Studio One' }, { name: 'Studio Two' }], publishers: [{ name: 'Publisher' }] }, m_rgSupportedLanguages: [{ elanguage: 2, supported: true, subtitles: true, full_audio: false }, { elanguage: 0, supported: true, subtitles: false, full_audio: true }] }; }
test('no startup prefetch; only used criteria load, identical requests share a cache and creator suggestions cause no requests', async () => {
	const f = fixture();
	f.cache.read({ appid: 1 }, new Set(['playtime', 'reviews'])); f.cache.names(2); expect(f.calls).toHaveLength(0);
	for (let n = 0; n < 20; n++) { f.cache.read({ appid: 1 }, new Set(['developer'])); f.cache.read({ appid: 1 }, new Set(['publisher'])); }
	await sleep(); expect(f.calls).toHaveLength(1); expect(f.changes).toHaveLength(1);
	expect(f.cache.read({ appid: 1 }, new Set(['developer', 'publisher']))).toEqual({ developers: ['Studio One', 'Studio Two'], publishers: ['Publisher'] });
	expect(f.cache.names(1).publishers).toEqual(['Publisher']); f.cache.dispose();
});
test('local association cache avoids Store requests and never substitutes developer for missing publisher', async () => {
	const f = fixture(); f.env.appDetailsCache = { GetCachedDataForApp: async (...args) => { expect(args).toEqual([1, 'associations', 2]); return { rgDevelopers: [{ strName: 'Local Studio' }], rgPublishers: [] }; } };
	f.cache.read({ appid: 1 }, new Set(['developer'])); await sleep(); expect(f.calls).toHaveLength(0);
	expect(f.cache.read({ appid: 1 }, new Set(['publisher']))).toEqual({ developers: ['Local Studio'], publishers: [] });
	expect(creatorNames([{ strName: '  SEGA ' }, { strName: 'SEGA' }])).toEqual(['SEGA']); expect(creatorNames([{}])).toBeUndefined(); f.cache.dispose();
});
test('language flags remain separate; malformed/incomplete language data never becomes known absence', async () => {
	const f = fixture(); f.cache.read({ appid: 1 }, new Set(['language'])); await sleep();
	const langs = f.cache.read({ appid: 1 }, new Set(['language'])).languages;
	expect([...langs.interface]).toEqual([2, 0]); expect([...langs.subtitles]).toEqual([2]); expect([...langs.audio]).toEqual([0]);
	f.apps.set(2, { ...item(), m_rgSupportedLanguages: [{ elanguage: 2, supported: true }] });
	f.env.storeItemCache.QueueAppRequest = async () => 1;
	f.cache.read({ appid: 2 }, new Set(['language'])); await sleep(); expect(f.cache.read({ appid: 2 }, new Set(['language'])).languages).toBeUndefined(); f.cache.dispose();
});
test('TTL rechecks shared native metadata while failures have a five-minute default retry backoff', async () => {
	let now = 0; const f = fixture({ now: () => now, ttlMs: 100 });
	f.cache.read({ appid: 1 }, new Set(['developer'])); await sleep();
	now = 99; expect(f.cache.read({ appid: 1 }, new Set(['developer'])).developers).toBeDefined();
	now = 101; expect(f.cache.read({ appid: 1 }, new Set(['developer'])).developers).toBeUndefined(); await sleep(); expect(f.calls).toHaveLength(1); // native cache reused
	f.env.storeItemCache.QueueAppRequest = async () => { f.calls.push('failed'); throw Error('rate limit'); };
	f.cache.read({ appid: 3 }, new Set(['language'])); await sleep();
	for (let n = 0; n < 10; n++) f.cache.read({ appid: 3 }, new Set(['language']));
	await sleep(); expect(f.calls).toHaveLength(2);
	now += 300001; f.cache.read({ appid: 3 }, new Set(['language'])); await sleep(); expect(f.calls).toHaveLength(3); f.cache.dispose();
});
test('concurrency stays bounded even after timeouts, and late results cannot revive disposed cache', async () => {
	const f = fixture({ timeoutMs: 5 }); let active = 0, maximum = 0; const finishes = [];
	f.env.storeItemCache.QueueAppRequest = (id) => { active++; maximum = Math.max(maximum, active); return new Promise((resolve) => finishes.push(() => { active--; f.apps.set(id, item()); resolve(1); })); };
	for (let id = 1; id <= 15; id++) f.cache.read({ appid: id }, new Set(['language']));
	await sleep(25); expect(maximum).toBe(2); expect(finishes).toHaveLength(2);
	f.cache.dispose(); finishes.forEach((done) => done()); await sleep(); expect(f.changes).toHaveLength(0); expect(f.cache.read({ appid: 1 }, new Set(['language']))).toEqual({});
});
test('account changes discard data and in-flight replies; cancelled draft demand drops queued work', async () => {
	const f = fixture(); let finish;
	f.env.storeItemCache.QueueAppRequest = () => new Promise((resolve) => { finish = resolve; });
	f.cache.read({ appid: 1 }, new Set(['language'])); await sleep(); f.cache.setAccount('account-b');
	f.apps.set(1, item()); finish(1); await sleep(); expect(f.changes).toHaveLength(0);
	f.cache.setDemandCheck(() => false); f.cache.read({ appid: 2 }, new Set(['language'])); await sleep(); expect(f.changes).toHaveLength(0); f.cache.dispose();
});
test('achievement summary separates 0%, not applicable, stale, queued, account mismatch and unknown without querying achievements', () => {
	const rows = new Map(), queued = new Map();
	const env = { appAchievementProgressCache: { m_achievementProgress: { mapCache: rows }, m_mapQueuedCacheMisses: queued, GetAchievementProgress: () => { throw Error('must not query individual games'); } } };
	const app = { appid: 1, rt_last_time_played: 100 };
	expect(achievementFacts(env, app)).toBeUndefined();
	rows.set(1, { total: 10, unlocked: 0, cache_time: 100 }); expect(achievementFacts(env, app)).toBe(0);
	rows.get(1).unlocked = 10; expect(achievementFacts(env, app)).toBe(100);
	rows.set(1, { total: 0, unlocked: 0, cache_time: 100 }); expect(achievementFacts(env, app)).toBeNull();
	rows.get(1).cache_time = 99; expect(achievementFacts(env, app)).toBeUndefined();
	rows.get(1).cache_time = 100; queued.set(1, true); expect(achievementFacts(env, app)).toBeUndefined(); queued.clear();
	env.appAchievementProgressCache.CMInterface = { steamid: { ConvertTo64BitString: () => 'other-account' } }; expect(achievementFacts(env, app)).toBeUndefined();
});
test('native aggregate progress updates publish once per actual change without any self-refresh loop', () => {
	const f = fixture(), app = { appid: 1, rt_last_time_played: 100 };
	const rows = new Map([[1, { total: 4, unlocked: 1, cache_time: 100 }]]);
	f.env.appAchievementProgressCache = { m_achievementProgress: { mapCache: rows } }; f.env.appStore = { allApps: [app] };
	expect(f.cache.read(app, new Set(['achievementProgress'])).achievementProgress).toBe(25);
	for (let i = 0; i < 5; i++) f.cache.pollAchievements(); expect(f.changes).toHaveLength(0);
	rows.get(1).unlocked = 3; f.cache.pollAchievements(); expect(f.changes).toHaveLength(1);
	for (let i = 0; i < 5; i++) f.cache.pollAchievements(); expect(f.changes).toHaveLength(1); f.cache.dispose();
});
test('AppOverview review category validates coverage and retains explicit zero score', () => {
	const metadata = new SteamMetadata({});
	expect(metadata.facts({ review_score: 1, review_percentage: 0 })).toMatchObject({ reviewScore: 0, reviewCategory: 1 });
	for (const category of [0, 10, undefined]) expect(metadata.facts({ review_score: category, review_percentage: 99 }).reviewScore).toBeUndefined();
	expect(metadata.facts({ review_score: 9, review_percentage: 101 }).reviewScore).toBeUndefined(); metadata.dispose();
});

test('closing the last interested editor drops waiting requests while an active request may safely finish', async () => {
	const f = fixture({ spacingMs: 5 }); let needed = true, finish;
	f.cache.setDemandCheck(() => needed);
	f.env.storeItemCache.QueueAppRequest = (id) => { f.calls.push(id); return new Promise((resolve) => { finish = resolve; }); };
	for (let id = 1; id <= 10; id++) f.cache.read({ appid: id }, new Set(['language']));
	needed = false; await sleep(15); expect(f.calls).toHaveLength(1);
	f.apps.set(1, item()); finish(1); await sleep(15); expect(f.calls).toHaveLength(1); f.cache.dispose();
});

test('an incompatible achievement interface cannot block creator/language reads or leak identifiers through diagnostics', async () => {
	const f = fixture();
	f.env.appAchievementProgressCache = { get CMInterface() { throw Error('Steam context detached'); } };
	expect(achievementFacts(f.env, { appid: 1 })).toBeUndefined();
	f.cache.read({ appid: 1 }, new Set(['achievementProgress', 'developer', 'language'])); await sleep(20);
	expect(f.cache.read({ appid: 1 }, new Set(['developer'])).developers).toEqual(['Studio One', 'Studio Two']);
	expect(f.cache.read({ appid: 1 }, new Set(['language'])).languages.interface.has(2)).toBe(true);
	expect(f.cache.diagnostics().progress).toEqual({ known: 0, notApplicable: 0, unknown: 1 });
	expect(JSON.stringify(f.cache.diagnostics())).not.toContain('account-a'); f.cache.dispose();
});
