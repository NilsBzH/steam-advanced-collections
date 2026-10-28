import { evaluate } from '../rules/evaluate';
import { hasRules, isSavedRules, type SavedRules } from '../rules/model';
import type { RuleRepository } from '../rules/repository';
import type { SteamEnvironment, SteamObject } from '../diagnostics/runtime';
import { accountId, type SteamMetadata } from './metadata';

/** Bridge called only by the narrowly scoped native UpdateApps source patch. */
export class MembershipBridge {
	private active = true;
	private observed = new WeakSet<object>();
	private managed = new WeakSet<object>();
	private warnedUnknown = new Set<string>();
	private previews = new Map<SteamObject, { account: string; owner: object; value: SavedRules; current: () => boolean }>();
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
	/** A preview overrides advanced rules only, for one exact collection object/account. */
	private rulesFor(collection: SteamObject): SavedRules | undefined {
		const account = accountId(this.environment);
		if (!account) return undefined;
		const preview = this.previews.get(collection);
		if (preview?.account === account) {
			try { if (preview.current()) return preview.value; } catch { /* Closed/stale editors fall back to saved rules. */ }
		}
		return this.repository.get(account, collection.id);
	}
	applyPreview(collection: SteamObject, account: string, owner: object, value: SavedRules, current: () => boolean): boolean {
		try {
			if (!this.repository.isLoaded() || !this.canApply(collection) || accountId(this.environment) !== account || !current() || !isSavedRules(value)) return false;
			const filter = collection.internalAppFilter;
			if (typeof filter?.Matches !== 'function' || typeof filter.bIsEmpty !== 'boolean' || typeof collection.m_setAddedManually?.forEach !== 'function' || typeof collection.m_setRemovedManually?.forEach !== 'function') return false;
			this.previews.set(collection, { account, owner, value: JSON.parse(JSON.stringify(value)), current });
			// Also track disabled/empty drafts: unloading must restore their native result.
			this.managed.add(collection);
			try { collection.UpdateAllApps(); return true; }
			catch { this.releasePreview(collection, owner); this.log('preview calculation failed; saved rules restored'); return false; }
		} catch { return false; }
	}
	/** Restore immediately after Cancel/close, or after verified Save (force=true). */
	releasePreview(collection: SteamObject, owner: object, force = false, restore = true): void {
		const preview = this.previews.get(collection);
		if (preview && preview.owner !== owner) return;
		if (preview) this.previews.delete(collection);
		if (restore && (preview || force) && this.canApply(collection)) {
			try { collection.UpdateAllApps(); } catch { this.log('preview restoration unavailable; native data preserved'); }
		}
	}
	/** Never changes the native filter object, exceptions, or serialized collection data. */
	hasRules(collection: SteamObject): boolean {
		try {
			if (!this.eligible(collection) || !this.repository.isLoaded()) return false;
			if (!this.observed.has(collection)) {
				this.observed.add(collection);
				this.log('membership.hook observed');
			}
			const enabled = hasRules(this.rulesFor(collection));
			if (enabled) this.managed.add(collection);
			return enabled;
		} catch { return false; }
	}
	matches(collection: SteamObject, app: SteamObject): boolean | undefined {
		let rules;
		try {
			if (!this.eligible(collection) || !this.repository.isLoaded()) return undefined;
			rules = this.rulesFor(collection);
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
				const configured = hasRules(this.rulesFor(collection));
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
		this.previews.clear();
		try {
			for (const collection of this.environment.collectionStore?.collectionsFromStorage?.values?.() ?? []) {
				if (collection.bIsDynamic === true && collection.bIsEditable === true && this.managed.has(collection)) {
					try { collection.UpdateAllApps?.(); } catch { /* Shutdown may already have detached Steam. */ }
				}
			}
		} catch { /* Steam may be shutting down. */ }
	}
}
