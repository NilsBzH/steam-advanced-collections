import { evaluate } from '../rules/evaluate';
import { hasRules, isSavedRules, type SavedRules, type Field } from '../rules/model';
import { couldAffectUnknown, ruleFields } from './supplemental';
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
	) {
		metadata.supplemental?.setDemandCheck((appid, fields) => {
			if (!this.active) return false;
			try {
				for (const collection of environment.collectionStore?.collectionsFromStorage?.values?.() ?? []) {
					if (this.eligible(collection) && this.affected(collection, new Map([[appid, fields]]))) return true;
				}
			} catch { /* Stale or closed editors no longer need queued requests. */ }
			return false;
		});
	}
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
			// Resolve cheap local predicates first. An AND already rejected by a tag,
			// library or other known condition must not fetch Store data for that game.
			const local = this.metadata.facts(app);
			let result = evaluate(rules!.expression, local);
			if (result === undefined && couldAffectUnknown(rules!.expression, local, fallback)) result = evaluate(rules!.expression, this.metadata.facts(app, ruleFields(rules!.expression)));
			if (result === undefined && !this.warnedUnknown.has(collection.id)) {
				this.warnedUnknown.add(collection.id);
				this.log('membership.metadata unavailable; native result retained');
			}
			return result ?? fallback;
		} catch { return fallback; }
	}
	isObserved(collection: SteamObject): boolean { return this.observed.has(collection); }
	/** Only request native recalculation when the exact source bridge is present. */
	refresh(changes?: ReadonlyMap<number, ReadonlySet<Field>>): { configured: number; applied: number; unavailable: number } {
		const result = { configured: 0, applied: 0, unavailable: 0 };
		if (!this.active || !this.repository.isLoaded()) return result;
		try {
			for (const collection of this.environment.collectionStore?.collectionsFromStorage?.values?.() ?? []) {
				const configured = hasRules(this.rulesFor(collection));
				if (!this.eligible(collection)) continue;
				if (changes && !this.affected(collection, changes)) continue;
				if (configured) result.configured++;
				if (this.canApply(collection) && (configured || this.managed.has(collection))) {
					try { collection.UpdateAllApps(); result.applied++; } catch { this.log('membership.refresh failed; native collection retained'); }
					if (!configured) this.managed.delete(collection);
				} else if (configured) result.unavailable++;
			}
		} catch { this.log('membership.refresh unavailable'); }
		return result;
	}
	private affected(collection: SteamObject, changes: ReadonlyMap<number, ReadonlySet<Field>>): boolean {
		const rules = this.rulesFor(collection); if (!hasRules(rules)) return false;
		const fields = ruleFields(rules!.expression);
		for (const [appid, changed] of changes) {
			if (![...changed].some((field) => fields.has(field))) continue;
			const app = this.environment.appStore?.GetAppOverviewByAppID?.(appid) ?? this.environment.appStore?.allApps?.find((item: SteamObject) => item.appid === appid);
			if (app && collection.internalAppFilter?.Matches?.(app)) return true;
		}
		return false;
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
