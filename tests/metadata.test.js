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
	expect(f.metadata.catalog().categories).toEqual([{ value: '2', label: 'Steam category #2' }]);
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
