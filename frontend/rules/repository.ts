import { isSavedRules, ruleFingerprint, type SavedRules } from './model';

export const PLUGIN_ID = 'com.steamadvancedcollections.plugin';
const prefix = 'rules.v1:';

/** Compare rule semantics regardless of the JSON object key order used by Millennium. */
function sameRules(left: SavedRules, right: unknown): right is SavedRules {
	return isSavedRules(right) && ruleFingerprint(left) === ruleFingerprint(right);
}
export interface ConfigPort {
	getAll(): Promise<Record<string, unknown>>;
	set(key: string, value: SavedRules): Promise<void>;
	subscribe(callback: (key: string, value: unknown) => void): () => void;
}
export function ruleKey(account: string, collection: string): string {
	return `${prefix}${encodeURIComponent(account)}:${encodeURIComponent(collection)}`;
}

/** Each save writes exactly one collection key; unknown schemas are kept and never reset. */
export class RuleRepository {
	private values = new Map<string, unknown>();
	private valid = new Map<string, SavedRules>();
	private listeners = new Set<() => void>();
	private unsubscribe?: () => void;
	private changesDuringLoad = new Set<string>();
	private loaded = false;
	private disposed = false;
	constructor(private port: ConfigPort) {}
	async load(): Promise<void> {
		if (this.loaded || this.disposed) return;
		this.changesDuringLoad.clear();
		this.unsubscribe?.();
		this.unsubscribe = this.port.subscribe((key, value) => {
			if (!key.startsWith(prefix)) return;
			this.changesDuringLoad.add(key);
			this.put(key, value);
			this.notify();
		});
		try {
			const existing = await this.port.getAll();
			if (this.disposed) return;
			if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw Error('Invalid plugin configuration');
			for (const [key, value] of Object.entries(existing)) if (key.startsWith(prefix) && !this.changesDuringLoad.has(key)) this.put(key, value);
			this.loaded = true;
			this.notify();
		} catch (error) { this.unsubscribe?.(); this.unsubscribe = undefined; throw error; }
	}
	isLoaded(): boolean { return this.loaded; }
	get(account: string, collection: string): SavedRules | undefined {
		return this.valid.get(ruleKey(account, collection));
	}
	hasUnsupported(account: string, collection: string): boolean {
		const value = this.values.get(ruleKey(account, collection));
		return value != null && !this.valid.has(ruleKey(account, collection));
	}
	async save(account: string, collection: string, value: SavedRules): Promise<void> {
		if (!this.loaded || !isSavedRules(value) || this.hasUnsupported(account, collection)) throw Error('Rules cannot be saved safely');
		const key = ruleKey(account, collection);
		// Match Millennium's documented implementation limits before attempting a write.
		if (new TextEncoder().encode(key).length > 512 || new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024) throw Error('Rules exceed Millennium configuration limits');
		await this.port.set(key, value);
		// A successful IPC response alone does not prove that the intended key was
		// persisted. Read it back before acknowledging Save or applying cached rules.
		const persisted = (await this.port.getAll())?.[key];
		if (!sameRules(value, persisted)) throw Error('Saved rules could not be verified in Millennium configuration');
		this.put(key, persisted);
		this.notify();
	}
	count(account: string): number {
		const accountPrefix = `${prefix}${encodeURIComponent(account)}:`;
		return Array.from(this.valid.keys()).filter((key) => key.startsWith(accountPrefix)).length;
	}
	private put(key: string, value: unknown): void {
		this.values.set(key, value);
		if (isSavedRules(value)) this.valid.set(key, value); else this.valid.delete(key);
	}
	subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
	private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* Isolate UI listeners. */ } } }
	dispose(): void { this.disposed = true; this.unsubscribe?.(); this.listeners.clear(); }
}
