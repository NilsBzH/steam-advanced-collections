import { test, expect } from 'bun:test';
import { collectionFingerprint, isDynamicEditor, startDiagnostics } from '../frontend/diagnostics/runtime';

const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
const forbidden = () => { throw new Error('Collection mutation/calculation is forbidden'); };
function fixture(mode = 'sync') {
  const records = []; let releases = 0;
  const collection = Object.freeze({
    id: 'test', bIsDynamic: true, bIsEditable: true,
    apps: new Set([10]), internalAddedList: new Set(), internalRemovedList: new Set(),
    internalAppFilter: Object.freeze({ m_filterSpec: { nFormatVersion: 2 }, bIsEmpty: false, Matches: forbidden }),
    UpdateApps: forbidden, UpdateAllApps: forbidden, Save: forbidden, AddApps: forbidden, RemoveApps: forbidden,
  });
  const environment = {
    collectionStore: {
      collectionsFromStorage: new Map([['test', collection]]), GetCollection: forbidden,
      OnAppOverviewChange(changed, removed) { return { receiver: this, changed, removed }; },
      OnCloudStorageChanged() {},
    },
    appStore: { allApps: [{ appid: 10, app_type: 1, BIsOwned: () => true, BIsBorrowed: () => false, local_per_client_data: { installed: true } }] },
    installFolderStore: { OnInstallFolderChanges() {} },
    App: { OnCurrentUserChanges() {} },
    SteamClient: {
      InstallFolder: {
        GetInstallFolders: async () => [{ nFolderIndex: 0, strFolderPath: 'D:/SteamLibrary', strDriveName: 'D:', bIsMounted: true, vecApps: [{ nAppID: 10 }] }],
        RegisterForInstallFolderChanges: forbidden,
      },
      Apps: {
        RegisterForAppOverviewChanges: forbidden,
        RegisterForAppDetails(_id, callback) {
          const data = { iInstallFolder: 0, eAppOwnershipFlags: 1, strOwnerSteamID: 'private-id' };
          if (mode === 'sync') callback(data);
          if (mode === 'late') setTimeout(() => callback(data), 40);
          return { unregister() { releases++; } };
        },
      },
    },
  };
  const original = environment.collectionStore.OnAppOverviewChange;
  const observe = (target, method, cb) => {
    const original = target[method];
    target[method] = function(...args) { cb(args); return Reflect.apply(original, this, args); };
    return () => { target[method] = original; };
  };
  return { environment, records, original, releases: () => releases,
    options: { environment, observe, log: r => records.push(r), requestTimeoutMs: 10 } };
}
test('scan leaves members/configuration unchanged and never invokes a mutator or calculator', async () => {
  const f = fixture();
  const before = collectionFingerprint([...f.environment.collectionStore.collectionsFromStorage.values()]);
  const stop = startDiagnostics(f.options); await pause();
  expect(f.records.find(r => r.capability === 'scan.complete').evidence.collectionStateUnchanged).toBe(true);
  expect(collectionFingerprint([...f.environment.collectionStore.collectionsFromStorage.values()])).toBe(before);
  expect(f.records.find(r => r.capability === 'appDetails').status).toBe('confirmed');
  expect(f.releases()).toBe(1);
  expect(JSON.stringify(f.records)).not.toContain('private-id');
  expect(JSON.stringify(f.records)).not.toContain('D:/SteamLibrary');
  stop();
});
test('passive observation preserves native arguments/receiver/result and is removed on unload', async () => {
  const f = fixture(); const stop = startDiagnostics(f.options);
  const changed = [{ appid: 10 }], removed = [20];
  expect(f.environment.collectionStore.OnAppOverviewChange(changed, removed)).toEqual({ receiver: f.environment.collectionStore, changed, removed });
  expect(f.records.some(r => r.capability === 'events.apps' && r.status === 'observed')).toBe(true);
  await pause(); stop(); stop();
  expect(f.environment.collectionStore.OnAppOverviewChange).toBe(f.original);
  const count = f.records.length;
  f.environment.collectionStore.OnAppOverviewChange([], []);
  expect(f.records.length).toBe(count);
});
test('throwing logger cannot interrupt native events', async () => {
  const f = fixture();
  const stop = startDiagnostics({ ...f.options, log: () => { throw Error('logger'); } });
  expect(() => f.environment.collectionStore.OnAppOverviewChange([], [])).not.toThrow();
  await pause(); stop();
});
test('missing stores/methods produce unavailable results', async () => {
  const records = [];
  const stop = startDiagnostics({ environment: {}, observe: forbidden, log: r => records.push(r), readyAttempts: 1 });
  expect(records.at(-1).status).toBe('unavailable'); stop();
  const f = fixture(); f.environment.SteamClient = {};
  const stop2 = startDiagnostics(f.options); await pause(); stop2();
  expect(f.records.find(r => r.capability === 'installFolders').status).toBe('unavailable');
});
test('timeout releases subscription; late response cannot log or release twice', async () => {
  const f = fixture('late'); const stop = startDiagnostics(f.options); await pause(30);
  expect(f.records.find(r => r.capability === 'appDetails').status).toBe('failed');
  expect(f.releases()).toBe(1);
  stop(); const count = f.records.length; await pause(50);
  expect(f.records.length).toBe(count); expect(f.releases()).toBe(1);
});
test('unload cancels pending requests and readiness polling', async () => {
  const f = fixture('never'); const stop = startDiagnostics({ ...f.options, requestTimeoutMs: 1000 });
  await pause(1); stop(); await pause(); expect(f.releases()).toBe(1);
  const records = [];
  const stop2 = startDiagnostics({ environment: {}, observe: forbidden, log: r => records.push(r), retryMs: 1 });
  stop2(); const count = records.length; await pause(); expect(records.length).toBe(count);
});
test('unknown ownership stays unknown; failed folder API stays failed', async () => {
  const f = fixture(); f.environment.appStore.allApps = [{ appid: 10, app_type: 1 }];
  f.environment.SteamClient.InstallFolder.GetInstallFolders = async () => { throw Error('offline'); };
  const stop = startDiagnostics(f.options); await pause(); stop();
  const e = f.records.find(r => r.capability === 'ownership.localSignals').evidence;
  expect(e.unknown).toBe(1); expect(e.personalLicenseSignal).toBe(0);
  expect(f.records.find(r => r.capability === 'installFolders').status).toBe('failed');
});
test('probe rejects static, non-editable, closed and malformed editors', () => {
  expect(isDynamicEditor({ bIsDynamic: true, bIsEditable: true }, true)).toBe(true);
  for (const c of [undefined, {}, { bIsDynamic: false, bIsEditable: true }, { bIsDynamic: true, bIsEditable: false }])
    expect(isDynamicEditor(c, true)).toBe(false);
  expect(isDynamicEditor({ bIsDynamic: true, bIsEditable: true }, false)).toBe(false);
  expect(isDynamicEditor({ get bIsDynamic() { throw Error('unsupported'); } }, true)).toBe(false);
});
