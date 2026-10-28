import type { SteamEnvironment, SteamObject } from './diagnostics/runtime';
import { RuleRepository } from './rules/repository';
import { SteamMetadata, accountId } from './steam/metadata';
import { MembershipBridge } from './steam/membership';
import { NativePreview } from './steam/preview';

export type ObserveAfter = (target: SteamObject, method: string, handler: (args: any[], result: any) => void) => () => void;
export class AdvancedCollections {
	readonly metadata: SteamMetadata;
	readonly membership: MembershipBridge;
	ready = false;
	error?: string;
	private active = true;
	private listeners = new Set<() => void>();
	private disposers: Array<() => void> = [];
	private pending?: ReturnType<typeof setTimeout>;
	private periodic?: ReturnType<typeof setInterval>;
	private readinessPoll?: ReturnType<typeof setInterval>;
	private refreshFolders = false;
	private started = false;
	private initializing = false;
	private currentAccount?: string;
	private currentCollections: SteamObject[] = [];
	private watched = new WeakMap<object, Set<string>>();
	private unavailableEvents = new Set<string>();
	private previews = new Map<object, NativePreview>();
	constructor(readonly environment: SteamEnvironment, readonly repository: RuleRepository, private observe: ObserveAfter, private options: { readinessIntervalMs?: number } = {}) {
		this.metadata = new SteamMetadata(environment);
		this.membership = new MembershipBridge(environment, repository, this.metadata, log);
	}
	async start(): Promise<void> {
		if (this.started || !this.active) return;
		this.started = true;
		this.disposers.push(this.repository.subscribe(() => this.schedule()));
		// Account IDs and collection objects can arrive after the initial library
		// event. Keep watching readiness; never require opening the editor to restore.
		this.readinessPoll = setInterval(() => { void this.ensureReady(); }, this.options.readinessIntervalMs ?? 1000);
		this.periodic = setInterval(() => this.schedule(true), 30000);
		await this.ensureReady();
	}
	private steamSnapshot(): { account: string; collections: SteamObject[] } | undefined {
		try {
			const account = accountId(this.environment);
			const apps = this.environment.appStore;
			const stored = this.environment.collectionStore?.collectionsFromStorage;
			if (!account || !Array.isArray(apps?.allApps) || apps.m_bIsInitialized === false || typeof stored?.values !== 'function') return undefined;
			return { account, collections: Array.from(stored.values()) };
		} catch { return undefined; }
	}
	private async ensureReady(): Promise<void> {
		if (!this.active || this.initializing) return;
		this.initializing = true;
		try {
			if (!this.repository.isLoaded()) await this.repository.load();
			if (!this.active) return;
			const snapshot = this.steamSnapshot();
			if (!snapshot) {
				this.ready = false;
				this.error = 'Waiting for the Steam account and library to finish loading…';
				this.notify();
				return;
			}
			this.watch(this.environment.collectionStore, 'OnAppOverviewChange');
			this.watch(this.environment.collectionStore, 'OnCloudStorageChanged');
			this.watch(this.environment.App, 'OnCurrentUserChanges', true);
			this.watch(this.environment.installFolderStore, 'OnInstallFolderChanges', true);
			const changed = !this.ready || snapshot.account !== this.currentAccount || snapshot.collections.length !== this.currentCollections.length || snapshot.collections.some((collection, index) => collection !== this.currentCollections[index]);
			if (!changed) return;
			this.ready = false;
			try { await this.metadata.refresh(); } catch { log('installations unavailable; other criteria remain available'); }
			if (!this.active) return;
			const latest = this.steamSnapshot();
			if (!latest || latest.account !== snapshot.account) return;
			this.currentAccount = latest.account;
			this.currentCollections = latest.collections;
			this.error = undefined;
			this.ready = true;
			this.refreshFolders = false;
			const restored = this.membership.refresh();
			log('rules.restored', { stored: this.repository.count(latest.account), collections: latest.collections.length, ...restored });
			this.notify();
		} catch {
			this.ready = false;
			this.error = 'Millennium configuration is not ready. Existing rules are preserved; retrying automatically…';
			log('rules.load failed; retrying without changing saved rules');
			this.notify();
		} finally { this.initializing = false; }
	}
	private watch(target: SteamObject | undefined, method: string, folders = false): void {
		if (typeof target?.[method] !== 'function') {
			if (!this.unavailableEvents.has(method)) { this.unavailableEvents.add(method); log('event unavailable', { method }); }
			return;
		}
		if (this.watched.get(target)?.has(method)) return;
		try {
			this.disposers.push(this.observe(target, method, (_args, result) => {
				try {
					// Preserve the original return value/promise; schedule after asynchronous stores finish.
					if (result && typeof result.then === 'function') void Promise.resolve(result).then(() => this.schedule(folders), () => {});
					else this.schedule(folders);
				} catch { /* Never interrupt a native event. */ }
			}));
			let methods = this.watched.get(target);
			if (!methods) { methods = new Set(); this.watched.set(target, methods); }
			methods.add(method);
		} catch { log('event observer failed', { method }); }
	}
	private schedule(folders = false): void {
		if (!this.active) return;
		this.refreshFolders ||= folders;
		if (this.pending) return;
		this.pending = setTimeout(() => {
			this.pending = undefined;
			void this.flush();
		}, 150);
	}
	private async flush(): Promise<void> {
		if (!this.active || !this.ready) return;
		if (this.refreshFolders) {
			this.refreshFolders = false;
			try { await this.metadata.refresh(); } catch { log('installation metadata refresh failed'); }
		}
		if (!this.active) return;
		this.metadata.invalidate();
		this.membership.refresh();
		this.notify();
	}
	subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
	openPreview(scope: object, collection: SteamObject, account: string, current: () => boolean, onActive: (active: boolean) => void): NativePreview {
		// Navigation can mount the next editor before React disposes the previous one.
		for (const preview of this.previews.values()) preview.dispose();
		const preview: NativePreview = new NativePreview(this.membership, collection, account, () => this.active && current(), onActive, () => {
			if (this.previews.get(scope) === preview) this.previews.delete(scope);
		});
		this.previews.set(scope, preview);
		if (!this.active) preview.dispose(false);
		return preview;
	}
	closePreview(scope: object): void { this.previews.get(scope)?.dispose(); }
	private notify(): void { for (const callback of this.listeners) { try { callback(); } catch { /* Isolate render consumers. */ } } }
	dispose(): void {
		this.active = false;
		for (const preview of this.previews.values()) preview.dispose(false);
		this.previews.clear();
		clearTimeout(this.pending); clearInterval(this.periodic); clearInterval(this.readinessPoll);
		for (const dispose of this.disposers.reverse()) { try { dispose(); } catch { /* Another plugin may have replaced the method. */ } }
		this.repository.dispose();
		this.membership.dispose();
		this.metadata.dispose(); this.listeners.clear();
	}
}

export function log(message: string, details?: unknown): void {
	try { console.info('[SAC]', message, details ?? ''); } catch { /* Logging must never affect Steam. */ }
}
