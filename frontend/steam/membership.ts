import { evaluate } from '../rules/evaluate';
import { hasRules } from '../rules/model';
import type { RuleRepository } from '../rules/repository';
import type { SteamEnvironment, SteamObject } from '../diagnostics/runtime';
import { accountId, type SteamMetadata } from './metadata';

/** Bridge called only by the narrowly scoped native UpdateApps source patch. */
export class MembershipBridge {
	private active = true;
	private observed = new WeakSet<object>();
	private managed = new WeakSet<object>();
	private warnedUnknown = new Set<string>();
	constructor(
		private environment: SteamEnvironment,
		private repository: RuleRepository,
		private metadata: SteamMetadata,
		private log: (message: string, details?: unknown) => void,
	) {}
	private eligible(collection: SteamObject): boolean {
		return this.active && collection?.bIsDynamic === true && collection.bIsEditable === true && typeof collection.id === 'string';
	}
	canApply(collection: SteamObject): boolean {
		try { return this.eligible(collection) && collection.__sacNativeBridgeV1?.() === 1 && typeof collection.UpdateAllApps === 'function'; }
		catch { return false; }
	}
	/** Never changes the native filter object, exceptions, or serialized collection data. */
	hasRules(collection: SteamObject): boolean {
		try {
			if (!this.eligible(collection) || !this.repository.isLoaded()) return false;
			if (!this.observed.has(collection)) {
				this.observed.add(collection);
				this.log('membership.hook observed');
			}
			const account = accountId(this.environment);
			const enabled = !!account && hasRules(this.repository.get(account, collection.id));
			if (enabled) this.managed.add(collection);
			return enabled;
		} catch { return false; }
	}
	matches(collection: SteamObject, app: SteamObject): boolean | undefined {
		let rules;
		try {
			if (!this.eligible(collection) || !this.repository.isLoaded()) return undefined;
			const account = accountId(this.environment);
			rules = account ? this.repository.get(account, collection.id) : undefined;
			if (!hasRules(rules)) return undefined;
		} catch { return undefined; }
		// Preserve native exceptions: advanced metadata failures must not rerun a native predicate.
		const native = collection.internalAppFilter.Matches(app);
		if (!native) return false;
		const fallback = collection.internalAppFilter.bIsEmpty ? false : native;
		try {
			const result = evaluate(rules!.expression, this.metadata.facts(app));
			if (result === undefined && !this.warnedUnknown.has(collection.id)) {
				this.warnedUnknown.add(collection.id);
				this.log('membership.metadata unavailable; native result retained');
			}
			return result ?? fallback;
		} catch { return fallback; }
	}
	isObserved(collection: SteamObject): boolean { return this.observed.has(collection); }
	/** Only request native recalculation when the exact source bridge is present. */
	refresh(): { configured: number; applied: number; unavailable: number } {
		const result = { configured: 0, applied: 0, unavailable: 0 };
		if (!this.active || !this.repository.isLoaded()) return result;
		try {
			for (const collection of this.environment.collectionStore?.collectionsFromStorage?.values?.() ?? []) {
				const account = accountId(this.environment);
				const configured = !!account && hasRules(this.repository.get(account, collection.id));
				if (!this.eligible(collection)) continue;
				if (configured) result.configured++;
				if (this.canApply(collection) && (configured || this.managed.has(collection))) {
					try { collection.UpdateAllApps(); result.applied++; } catch { this.log('membership.refresh failed; native collection retained'); }
					if (!configured) this.managed.delete(collection);
				} else if (configured) result.unavailable++;
			}
		} catch { this.log('membership.refresh unavailable'); }
		return result;
	}
	dispose(): void {
		if (!this.active) return;
		// Disable the bridge first, then restore native computed results without saving anything.
		this.active = false;
		try {
			for (const collection of this.environment.collectionStore?.collectionsFromStorage?.values?.() ?? []) {
				if (collection.bIsDynamic === true && collection.bIsEditable === true && this.managed.has(collection)) {
					try { collection.UpdateAllApps?.(); } catch { /* Shutdown may already have detached Steam. */ }
				}
			}
		} catch { /* Steam may be shutting down. */ }
	}
}
