import { test, expect } from 'bun:test';
import { SteamMetadata, accountId } from '../frontend/steam/metadata';

function fixture() {
	let folders = [{ strFolderPath: 'D:\\SteamLibrary', bIsMounted: true, vecApps: [{ nAppID: 10 }] }];
	const environment = {
		App: { GetCurrentUser: () => ({ strSteamID: '76561197960265729' }), BIsFamilyGroupMember: (id) => id === 123 },
		appStore: { allApps: [], GetLocalizationForStoreTag: (id) => id === 10 ? 'Strategy' : undefined },
		SteamClient: { InstallFolder: { GetInstallFolders: async () => folders } },
	};
	return { environment, metadata: new SteamMetadata(environment), folders: (next) => { folders = next; } };
}
test('local installation folder maps to library and Windows drive', async () => {
	const f = fixture(); await f.metadata.refresh();
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: true } })).toMatchObject({ installed: true, library: 'd:/steamlibrary', drive: 'd:' });
	f.folders([{ strFolderPath: 'E:/Games', bIsMounted: true, vecApps: [{ nAppID: 10 }] }]); await f.metadata.refresh();
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: true } }).drive).toBe('e:'); f.metadata.dispose();
});
test('uninstalled and remote-only games have no local location; detached drives remain unknown', async () => {
	const f = fixture(); await f.metadata.refresh();
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: false }, most_available_per_client_data: { installed: true } })).toMatchObject({ installed: false, library: null, drive: null });
	f.folders([{ strFolderPath: 'D:/SteamLibrary', bIsMounted: false, vecApps: [{ nAppID: 10 }] }]); await f.metadata.refresh();
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: true } }).library).toBeUndefined(); f.metadata.dispose();
});
test('ownership uses personal licenses and confirmed family membership, not any lender', () => {
	const f = fixture();
	expect(f.metadata.facts({ BIsOwned: () => true, BIsBorrowed: () => false }).ownership).toBe('personal');
	expect(f.metadata.facts({ BIsOwned: () => true, BIsBorrowed: () => true, owner_account_id: 123 }).ownership).toBe('family');
	expect(f.metadata.facts({ BIsOwned: () => false, BIsBorrowed: () => false, owner_account_id: 123 }).ownership).toBe('family');
	expect(f.metadata.facts({ BIsOwned: () => true, BIsBorrowed: () => true, owner_account_id: 456 }).ownership).toBeUndefined();
	expect(accountId(f.environment)).toBe('76561197960265729'); expect(accountId({ App: { GetCurrentUser: () => ({ strAccountName: 'name' }) } })).toBeUndefined();
});
test('tags/categories and tag labels use local Steam metadata, including iterable sets from other realms', () => {
	const f = fixture(); const app = { appid: 10, GetStoreTags: () => ({ *[Symbol.iterator]() { yield 10; } }), store_category: [2] };
	f.environment.appStore.allApps = [app];
	expect(f.metadata.facts(app).tags.has(10)).toBe(true);
	expect(f.metadata.catalog().tags).toEqual([{ value: '10', label: 'Strategy' }]);
	expect(f.metadata.catalog().categories).toEqual([{ value: '2', label: 'Single-player' }]);
});
test('Steam features use official names sorted alphabetically while preserving distinct numeric IDs', () => {
	const f = fixture();
	f.environment.appStore.allApps = [{ store_category: [23, 9999, 22, 2, 1, 30, 51, 23] }];
	expect(f.metadata.catalog().categories).toEqual([
		{ value: '1', label: 'Multi-player' }, { value: '2', label: 'Single-player' },
		{ value: '22', label: 'Steam Achievements' }, { value: '23', label: 'Steam Cloud' },
		{ value: '30', label: 'Steam Workshop' }, { value: '51', label: 'Steam Workshop' },
		{ value: '9999', label: 'Unknown Steam feature (ID: 9999)' },
	]);
	expect([...f.metadata.facts(f.environment.appStore.allApps[0]).categories]).toEqual([23, 9999, 22, 2, 1, 30, 51]);
	f.metadata.dispose();
});
test('an unavailable folder refresh discards stale paths instead of silently using them', async () => {
	const f = fixture(); await f.metadata.refresh();
	f.environment.SteamClient.InstallFolder.GetInstallFolders = async () => { throw Error('offline'); };
	await expect(f.metadata.refresh()).rejects.toThrow();
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: true } }).library).toBeUndefined(); f.metadata.dispose();
});
test('late folder requests cannot replace a newer snapshot or revive a disposed adapter', async () => {
	const f = fixture(); let resolve;
	f.environment.SteamClient.InstallFolder.GetInstallFolders = () => new Promise((done) => { resolve = done; });
	const older = f.metadata.refresh();
	f.environment.SteamClient.InstallFolder.GetInstallFolders = async () => [{ strFolderPath: 'E:/Games', vecApps: [{ nAppID: 10 }] }];
	await f.metadata.refresh(); resolve([{ strFolderPath: 'D:/Games', vecApps: [{ nAppID: 10 }] }]); await older;
	expect(f.metadata.facts({ appid: 10, local_per_client_data: { installed: true } }).drive).toBe('e:'); f.metadata.dispose();
});
test('playtime and last session distinguish reported zero, never played and unavailable history', () => {
	const f = fixture();
	expect(f.metadata.facts({ minutes_playtime_forever: 0, minutes_playtime_last_two_weeks: 0, rt_last_time_played: 0 })).toMatchObject({ playtimeMinutes: 0, playtimeRecentMinutes: 0, lastPlayed: null });
	expect(f.metadata.facts({ minutes_playtime_forever: 123, minutes_playtime_last_two_weeks: 30, rt_last_time_played: 1700000000 })).toMatchObject({ playtimeMinutes: 123, playtimeRecentMinutes: 30, lastPlayed: 1700000000000 });
	for (const app of [{}, { minutes_playtime_forever: 20, rt_last_time_played: 0 }, { minutes_playtime_forever: 0 }, { rt_last_time_played: 100 }]) expect(f.metadata.facts(app).lastPlayed).toBeUndefined();
	for (const value of [null, -1, NaN, '20']) expect(f.metadata.facts({ minutes_playtime_forever: value }).playtimeMinutes).toBeUndefined();
});
test('installed size uses mounted local storage usage, never remote or overview download estimates', async () => {
	const f = fixture(); const app = { appid: 10, size_on_disk: '99999999999', local_per_client_data: { installed: true } };
	f.folders([{ strFolderPath: 'D:/SteamLibrary', vecApps: [{ nAppID: 10, nUsedSize: '2147483648' }] }]); await f.metadata.refresh();
	expect(f.metadata.facts(app).installSizeBytes).toBe(2147483648);
	expect(f.metadata.facts({ ...app, local_per_client_data: { installed: false }, most_available_per_client_data: { installed: true } }).installSizeBytes).toBeUndefined();
	for (const value of [undefined, -1, 'bad', '12.5', '9007199254740993']) {
		f.folders([{ strFolderPath: 'D:/SteamLibrary', vecApps: [{ nAppID: 10, nUsedSize: value }] }]); await f.metadata.refresh(); expect(f.metadata.facts(app).installSizeBytes).toBeUndefined();
	}
	f.folders([{ strFolderPath: 'E:/Games', vecApps: [{ nAppID: 10, nUsedSize: 0 }] }]); await f.metadata.refresh(); expect(f.metadata.facts(app).installSizeBytes).toBe(0);
	f.folders([{ strFolderPath: 'E:/Games', bIsMounted: false, vecApps: [{ nAppID: 10, nUsedSize: 100 }] }]); await f.metadata.refresh(); expect(f.metadata.facts(app).installSizeBytes).toBeUndefined(); f.metadata.dispose();
});
test('release year follows the native original-then-Steam date priority without a network request', () => {
	const f = fixture(), timestamp = (value) => Date.parse(value) / 1000;
	expect(f.metadata.facts({ rt_original_release_date: timestamp('2010-01-01T00:00:00Z'), rt_steam_release_date: timestamp('2020-01-01T00:00:00Z') }).releaseYear).toBe(2010);
	expect(f.metadata.facts({ rt_original_release_date: 0, rt_steam_release_date: timestamp('2020-01-01T00:00:00Z') }).releaseYear).toBe(2020);
	for (const app of [{}, { rt_original_release_date: 0, rt_steam_release_date: 0 }, { rt_original_release_date: -1 }, { rt_original_release_date: 'bad' }]) expect(f.metadata.facts(app).releaseYear).toBeUndefined();
});
