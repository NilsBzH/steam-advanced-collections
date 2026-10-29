import { normalizeLocation, type GameFacts, type Field } from '../rules/model';
import type { SteamEnvironment, SteamObject } from '../diagnostics/runtime';
import { steamFeatureChoices } from './features';
import { SupplementalMetadata, type MetadataChange } from './supplemental';

export interface Choice { value: string; label: string }
export interface Catalog { tags: Choice[]; categories: Choice[]; libraries: Choice[]; drives: Choice[]; developers?: Choice[]; publishers?: Choice[] }
export function accountId(environment: SteamEnvironment): string | undefined {
	try {
		const id = environment.App?.GetCurrentUser?.()?.strSteamID;
		return typeof id === 'string' && /^\d{16,20}$/.test(id) ? id : undefined;
	} catch { return undefined; }
}

function numbers(value: unknown): ReadonlySet<number> | undefined {
	if (value && typeof value === 'object' && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
		const items = Array.from(value as Iterable<unknown>);
		return items.every((item) => Number.isSafeInteger(item)) ? new Set(items as number[]) : undefined;
	}
	return undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
/** Native disk counters may be numbers or uint64 decimal strings. Reject lossy values. */
function byteCount(value: unknown): number | undefined {
	if (typeof value === 'string' && /^\d+$/.test(value)) return nonnegativeInteger(Number(value));
	return nonnegativeInteger(value);
}

/** Resolve only local installation data. Remote Play installations never count as local. */
export class SteamMetadata {
	private folders: SteamObject[] = [];
	private locations = new Map<number, { library: string; drive?: string; mounted: boolean; sizeBytes?: number }>();
	private requestId = 0;
	private disposed = false;
	private cachedCatalog?: Catalog;
	private listeners = new Set<() => void>();
	private supplementalListeners = new Set<(change: MetadataChange) => void>();
	readonly supplemental: SupplementalMetadata;
	constructor(private environment: SteamEnvironment) {
		this.supplemental = new SupplementalMetadata(environment, (change) => {
			this.invalidate(); for (const listener of this.supplementalListeners) { try { listener(change); } catch { /* Isolate consumers. */ } }
		});
	}
	async refresh(): Promise<void> {
		const id = ++this.requestId;
		const get = this.environment.SteamClient?.InstallFolder?.GetInstallFolders;
		if (typeof get !== 'function') return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const folders = await Promise.race([
				get.call(this.environment.SteamClient!.InstallFolder),
				new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Installation metadata timed out')), 5000); }),
			]);
			if (!Array.isArray(folders)) throw Error('Unexpected installation metadata');
			if (this.disposed || id !== this.requestId) return;
			const locations = new Map<number, { library: string; drive?: string; mounted: boolean; sizeBytes?: number }>();
			for (const folder of folders) {
				if (typeof folder.strFolderPath !== 'string' || !Array.isArray(folder.vecApps)) continue;
				const library = normalizeLocation(folder.strFolderPath);
				const drive = /^[a-z]:/i.exec(library)?.[0];
				for (const app of folder.vecApps) if (Number.isSafeInteger(app.nAppID)) locations.set(app.nAppID, { library, drive, mounted: folder.bIsMounted !== false, sizeBytes: byteCount(app.nUsedSize) });
			}
			this.folders = folders;
			this.locations = locations;
			this.changed();
		} catch (error) {
			if (!this.disposed && id === this.requestId) { this.locations.clear(); this.folders = []; this.changed(); }
			throw error;
		} finally { clearTimeout(timer); }
	}
	facts(app: SteamObject, fields: ReadonlySet<Field> = new Set()): GameFacts {
		const facts: GameFacts = {};
		try { facts.tags = numbers(typeof app.GetStoreTags === 'function' ? app.GetStoreTags() : app.store_tag); } catch { /* unavailable */ }
		try { facts.categories = numbers(app.store_category); } catch { /* unavailable */ }
		try {
			// AppOverview getters honor Steam's off-topic review preference and expose
			// all-time scores. Category 0 means no score, not 0% positive reviews.
			const category = nonnegativeInteger(app.review_score), score = nonnegativeInteger(app.review_percentage);
			if (category !== undefined && category >= 1 && category <= 9) {
				facts.reviewCategory = category;
				if (score !== undefined && score <= 100) facts.reviewScore = score;
			}
		} catch { /* Unknown review coverage remains unknown. */ }
		try { facts.playtimeMinutes = nonnegativeInteger(app.minutes_playtime_forever); } catch { /* unavailable */ }
		try { facts.playtimeRecentMinutes = nonnegativeInteger(app.minutes_playtime_last_two_weeks); } catch { /* unavailable */ }
		try {
			const last = nonnegativeInteger(app.rt_last_time_played);
			// Steam's GetLastTimePlayed rejects early-epoch sentinels. Zero only
			// means never played when the client also reports zero total minutes.
			if (last !== undefined && last >= 31536000) facts.lastPlayed = last * 1000;
			else if (last === 0 && facts.playtimeMinutes === 0) facts.lastPlayed = null;
		} catch { /* Unknown history is not a never-played game. */ }
		try {
			// Same priority as Steam's GetCanonicalReleaseDate: original, then Steam.
			const original = nonnegativeInteger(app.rt_original_release_date);
			const steam = nonnegativeInteger(app.rt_steam_release_date);
			const seconds = original && original > 0 ? original : steam;
			if (seconds && seconds > 0) {
				const year = new Date(seconds * 1000).getUTCFullYear();
				if (Number.isInteger(year) && year >= 1 && year <= 9999) facts.releaseYear = year;
			}
		} catch { /* No Store request and no inferred release year. */ }
		try {
			if (typeof app.BIsOwned === 'function' && typeof app.BIsBorrowed === 'function') {
				if (app.BIsOwned() && !app.BIsBorrowed()) facts.ownership = 'personal';
				else if (app.owner_account_id && this.environment.App?.BIsFamilyGroupMember?.(app.owner_account_id) === true) facts.ownership = 'family';
			}
		} catch { /* Do not treat unknown/legacy sharing as family ownership. */ }
		try {
			const local = app.local_per_client_data;
			if (typeof local?.installed === 'boolean') facts.installed = local.installed;
			if (facts.installed === false) { facts.library = null; facts.drive = null; }
			else if (facts.installed === true) {
				const location = this.locations.get(app.appid);
				if (location?.mounted) { facts.library = location.library; facts.drive = location.drive; facts.installSizeBytes = location.sizeBytes; }
			}
		} catch { /* A detached drive has unknown current installation metadata. */ }
		try {
			this.supplemental.setAccount(accountId(this.environment) ?? '');
			Object.assign(facts, this.supplemental.read(app, fields));
		} catch { /* Incompatible complementary metadata must never interrupt Steam. */ }
		return facts;
	}
	catalog(): Catalog {
		if (this.cachedCatalog) return this.cachedCatalog;
		const tags = new Set<number>(), categories = new Set<number>();
		const developers = new Map<string, string>(), publishers = new Map<string, string>();
		for (const app of this.environment.appStore?.allApps ?? []) {
			const facts = this.facts(app);
			facts.tags?.forEach((id) => tags.add(id));
			facts.categories?.forEach((id) => categories.add(id));
			const creators = this.supplemental.names(app.appid);
			creators.developers?.forEach((name) => developers.set(name.toLowerCase(), name));
			creators.publishers?.forEach((name) => publishers.set(name.toLowerCase(), name));
		}
		const libraries = this.folders.filter((f) => typeof f.strFolderPath === 'string').map((f) => ({ value: normalizeLocation(f.strFolderPath), label: f.strFolderPath + (f.bIsMounted === false ? ' (offline)' : '') }));
		const drives = Array.from(new Set(libraries.map((f) => /^[a-z]:/i.exec(f.value)?.[0]).filter((value): value is string => !!value))).map((value) => ({ value, label: value.toUpperCase() }));
		return this.cachedCatalog = {
			tags: Array.from(tags).map((id) => {
				let label: string | undefined;
				try { label = this.environment.appStore?.GetLocalizationForStoreTag?.(id); } catch { /* ID is always usable. */ }
				return { value: String(id), label: typeof label === 'string' && label ? label : `Tag #${id}` };
			}).sort((a, b) => a.label.localeCompare(b.label)),
			categories: steamFeatureChoices(categories),
			libraries, drives,
			developers: [...developers.values()].sort((a, b) => a.localeCompare(b, 'en')).map((name) => ({ value: name, label: name })),
			publishers: [...publishers.values()].sort((a, b) => a.localeCompare(b, 'en')).map((name) => ({ value: name, label: name })),
		};
	}
	invalidate(): void { this.cachedCatalog = undefined; }
	subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
	subscribeSupplemental(listener: (change: MetadataChange) => void): () => void { this.supplementalListeners.add(listener); return () => { this.supplementalListeners.delete(listener); }; }
	private changed(): void { this.invalidate(); for (const listener of this.listeners) { try { listener(); } catch { /* Isolate consumers. */ } } }
	dispose(): void { this.disposed = true; this.requestId++; this.listeners.clear(); this.supplementalListeners.clear(); this.supplemental.dispose(); }
}
