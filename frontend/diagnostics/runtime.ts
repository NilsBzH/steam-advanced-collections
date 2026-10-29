/** The only untyped boundary with Steam internals. No collection mutator is called. */
export type SteamObject = Record<string, any>;
export interface SteamEnvironment {
	collectionStore?: SteamObject;
	appStore?: SteamObject;
	installFolderStore?: SteamObject;
	App?: SteamObject;
	SteamClient?: SteamObject;
	storeItemCache?: SteamObject;
	appDetailsStore?: SteamObject;
	appDetailsCache?: SteamObject;
	appAchievementProgressCache?: SteamObject;
}
export interface DiagnosticRecord {
	capability: string;
	status: 'confirmed' | 'available' | 'unavailable' | 'failed' | 'observed' | 'stopped';
	evidence: Record<string, unknown>;
}
interface Options {
	environment: SteamEnvironment;
	observe: (target: SteamObject, method: string, callback: (args: any[]) => void) => () => void;
	findFamilyService?: () => unknown;
	log: (record: DiagnosticRecord) => void;
	readyAttempts?: number;
	retryMs?: number;
	requestTimeoutMs?: number;
}
const hasMethod = (object: SteamObject | undefined, key: string): boolean =>
	typeof object?.[key] === 'function';

export function readCollections(environment: SteamEnvironment): SteamObject[] | undefined {
	const stored = environment.collectionStore?.collectionsFromStorage;
	return stored && typeof stored.values === 'function' ? Array.from(stored.values()) : undefined;
}

export function isDynamicEditor(collection: SteamObject | undefined, editorOpen: unknown): boolean {
	try {
		return editorOpen === true && collection?.bIsDynamic === true && collection.bIsEditable === true;
	} catch { return false; }
}

/** In-memory comparison only. Never calls ToStorageFormat, Matches, UpdateApps or Save. */
export function collectionFingerprint(collections: SteamObject[]): string {
	return JSON.stringify(collections.map((collection) => ({
		id: collection.id,
		dynamic: collection.bIsDynamic,
		filter: collection.internalAppFilter?.m_filterSpec,
		members: Array.from(collection.apps ?? []).sort(),
		added: Array.from(collection.internalAddedList ?? []).sort(),
		removed: Array.from(collection.internalRemovedList ?? []).sort(),
	})).sort((left, right) => String(left.id).localeCompare(String(right.id))));
}

export function startDiagnostics(options: Options): () => void {
	const { environment } = options;
	let active = true;
	let eventsSeen = 0;
	const cleanup: Array<() => void> = [];
	const pending = new Set<() => void>();
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	const timeoutMs = options.requestTimeoutMs ?? 5000;
	const emit = (capability: string, status: DiagnosticRecord['status'], evidence: Record<string, unknown> = {}) => {
		if (!active) return;
		try { options.log({ capability, status, evidence }); } catch { /* Preserve Steam even if logging fails. */ }
	};
	const safely = (dispose: () => void) => {
		try { dispose(); } catch { emit('cleanup', 'failed'); }
	};
	const observe = (target: SteamObject | undefined, method: string, capability: string) => {
		if (!hasMethod(target, method)) { emit(capability, 'unavailable', { method }); return; }
		try {
			cleanup.push(options.observe(target!, method, (args) => {
				try {
					emit(capability, 'observed', {
						changed: Array.isArray(args[0]) ? args[0].length : undefined,
						removed: Array.isArray(args[1]) ? args[1].length : undefined,
						eventsSeen: ++eventsSeen,
					});
				} catch { /* The native call must continue, including with malformed event data. */ }
			}));
			emit(capability, 'available', { method, passiveObserver: true, observed: false });
		} catch { emit(capability, 'failed', { method }); }
	};

	/** Handles synchronous first values, late responses, timeouts, and unloading. */
	const request = <T,>(subscribe: (resolve: (value: T) => void, reject: (error: unknown) => void) => (() => void) | void): Promise<T> =>
		new Promise((resolve, reject) => {
			let settled = false;
			let dispose: (() => void) | void;
			const cancel = () => finish(new Error('Diagnostic request cancelled'));
			const finish = (error?: unknown, value?: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				pending.delete(cancel);
				if (dispose) { safely(dispose); dispose = undefined; }
				error ? reject(error) : resolve(value as T);
			};
			const timer = setTimeout(() => finish(new Error('Diagnostic request timeout')), timeoutMs);
			pending.add(cancel);
			try {
				dispose = subscribe((value) => finish(undefined, value), (error) => finish(error));
				if (settled && dispose) { safely(dispose); dispose = undefined; }
			} catch (error) { finish(error); }
		});

	const scan = async () => {
		const collections = readCollections(environment)!;
		const baseline = collectionFingerprint(collections);
		const dynamic = collections.filter((item) => item.bIsDynamic === true && item.bIsEditable === true);
		emit('collections', 'confirmed', {
			stored: collections.length, editableDynamic: dynamic.length,
			getCollection: hasMethod(environment.collectionStore, 'GetCollection'),
		});
		emit('calculation', dynamic.length ? 'available' : 'unavailable', {
			samples: dynamic.map((item) => ({
				updateApps: hasMethod(item, 'UpdateApps'),
				matches: hasMethod(item.internalAppFilter, 'Matches'),
				isEmpty: item.internalAppFilter?.bIsEmpty,
			})),
			invoked: false, patched: false,
		});
		// Observe existing consumers instead of registering callbacks with no documented cleanup.
		observe(environment.collectionStore, 'OnAppOverviewChange', 'events.apps');
		observe(environment.collectionStore, 'OnCloudStorageChanged', 'events.collections');
		observe(environment.App, 'OnCurrentUserChanges', 'events.account');
		observe(environment.installFolderStore, 'OnInstallFolderChanges', 'events.installFolders');
		emit('events.nativeSubscriptions', 'available', {
			appOverview: hasMethod(environment.SteamClient?.Apps, 'RegisterForAppOverviewChanges'),
			installFolders: hasMethod(environment.SteamClient?.InstallFolder, 'RegisterForInstallFolderChanges'),
			currentUser: hasMethod(environment.SteamClient?.User, 'RegisterForCurrentUserChanges'),
			subscribedDirectly: false,
		});

		const apps = environment.appStore?.allApps;
		const games: SteamObject[] = Array.isArray(apps) ? apps.filter((app) => app.app_type === 1 || app.canonicalAppType === 1) : [];
		let personal = 0, borrowed = 0, unknown = 0;
		for (const game of games) {
			try {
				if (!hasMethod(game, 'BIsOwned') || !hasMethod(game, 'BIsBorrowed')) unknown++;
				else if (game.BIsBorrowed()) borrowed++;
				else if (game.BIsOwned()) personal++;
				else unknown++;
			} catch { unknown++; }
		}
		emit('ownership.localSignals', personal + borrowed > 0 ? 'confirmed' : 'unavailable', {
			games: games.length, personalLicenseSignal: personal, borrowedSignal: borrowed, unknown,
			meaning: 'Native license signals, not proof of purchase or exhaustive family ownership',
		});
		try {
			emit('ownership.familyService', options.findFamilyService?.() ? 'available' : 'unavailable', {
				invoked: false, authenticationTransportValidated: false,
			});
		} catch { emit('ownership.familyService', 'failed'); }

		const foldersApi = environment.SteamClient?.InstallFolder;
		if (hasMethod(foldersApi, 'GetInstallFolders')) {
			try {
				const folders = await request<SteamObject[]>((resolve, reject) => {
					Promise.resolve(foldersApi!.GetInstallFolders()).then(resolve, reject);
				});
				if (!Array.isArray(folders)) throw new Error('Unexpected folder response');
				emit('installFolders', 'confirmed', {
					folders: folders.map((folder) => ({
						index: folder.nFolderIndex, pathAvailable: typeof folder.strFolderPath === 'string',
						mounted: folder.bIsMounted, driveAvailable: typeof folder.strDriveName === 'string',
						apps: Array.isArray(folder.vecApps) ? folder.vecApps.length : undefined,
					})),
				});
			} catch { emit('installFolders', 'failed', { reason: 'Failed request, timeout or unexpected response' }); }
		} else emit('installFolders', 'unavailable');

		const detailsApi = environment.SteamClient?.Apps;
		const sample = games.find((game) => game.local_per_client_data?.installed) ?? games[0];
		if (active && sample && hasMethod(detailsApi, 'RegisterForAppDetails')) {
			try {
				const details = await request<SteamObject>((resolve) => {
					const subscription = detailsApi!.RegisterForAppDetails(sample.appid, (data: SteamObject) => {
						if (data) resolve(data);
					});
					return hasMethod(subscription, 'unregister') ? () => subscription.unregister() : undefined;
				});
				emit('appDetails', 'confirmed', {
					installFolderIndex: details.iInstallFolder,
					ownershipFlagsAvailable: typeof details.eAppOwnershipFlags === 'number',
					ownerIdAvailable: typeof details.strOwnerSteamID === 'string',
					sampleInstalled: sample.local_per_client_data?.installed === true,
				});
			} catch { emit('appDetails', 'failed', { reason: 'Failed request or timeout' }); }
		} else emit('appDetails', 'unavailable');
		if (active) emit('scan.complete', 'confirmed', {
			collectionStateUnchanged: baseline === collectionFingerprint(readCollections(environment) ?? []),
			comparison: 'Native configuration, manual exceptions and members; natural Steam changes may affect the comparison',
		});
	};
	const attempt = (remaining: number) => {
		if (!active) return;
		try {
			if (readCollections(environment) && Array.isArray(environment.appStore?.allApps) && environment.appStore?.m_bIsInitialized !== false) {
				void scan().catch(() => emit('scan', 'failed', { reason: 'Unexpected client shape; Steam left untouched' }));
				return;
			}
		} catch { /* Stores may still be initializing. */ }
		if (remaining > 1) retryTimer = setTimeout(() => attempt(remaining - 1), options.retryMs ?? 1000);
		else emit('initialization', 'unavailable', { reason: 'Steam stores not ready within the diagnostic window' });
	};
	emit('initialization', 'available', { readOnly: true });
	attempt(options.readyAttempts ?? 30);
	return () => {
		if (!active) return;
		emit('lifecycle', 'stopped', { observers: cleanup.length });
		active = false;
		clearTimeout(retryTimer);
		for (const cancel of pending) cancel();
		for (const dispose of cleanup.reverse()) safely(dispose);
	};
}
