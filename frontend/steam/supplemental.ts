import type { SteamEnvironment, SteamObject } from '../diagnostics/runtime';
import type { Field, GameFacts, Rule } from '../rules/model';
import { evaluate } from '../rules/evaluate';

const complementary = new Set<Field>(['developer', 'publisher', 'language', 'achievementProgress']);
/** Dependency analysis only: possible false/true/unknown outcomes (bits 1/2/4).
 * No fabricated facts enter the evaluator. If every possible complementary
 * outcome retains the current fallback, requesting it cannot change membership.
 */
export function couldAffectUnknown(rule: Rule, facts: GameFacts, fallback: boolean): boolean {
	const stack = [{ node: rule, visited: false }], masks = new Map<Rule, number>();
	while (stack.length) {
		const { node, visited } = stack.pop()!;
		if (node.type === 'condition') {
			const value = evaluate(node, facts);
			masks.set(node, value === undefined ? complementary.has(node.field) ? 7 : 4 : value ? 2 : 1);
		} else if (!visited) {
			stack.push({ node, visited: true });
			if (node.type === 'not') stack.push({ node: node.child, visited: false });
			else node.children.forEach((child) => stack.push({ node: child, visited: false }));
		} else if (node.type === 'not') {
			const value = masks.get(node.child)!; masks.set(node, (value & 1 ? 2 : 0) | (value & 2 ? 1 : 0) | (value & 4));
		} else {
			let combined = node.operator === 'and' ? 2 : 1;
			for (const child of node.children) {
				let next = 0;
				for (const left of [1, 2, 4]) for (const right of [1, 2, 4]) if ((combined & left) && (masks.get(child)! & right)) {
					next |= node.operator === 'and' ? left === 1 || right === 1 ? 1 : left === 2 && right === 2 ? 2 : 4 : left === 2 || right === 2 ? 2 : left === 1 && right === 1 ? 1 : 4;
				}
				combined = next;
			}
			masks.set(node, combined);
		}
	}
	return !!(masks.get(rule)! & (fallback ? 1 : 2));
}

const dependencies = new WeakMap<Rule, ReadonlySet<Field>>();
export function ruleFields(rule: Rule): ReadonlySet<Field> {
	const cached = dependencies.get(rule); if (cached) return cached;
	const fields = new Set<Field>(), pending = [rule];
	while (pending.length) {
		const node = pending.pop()!;
		if (node.type === 'condition') fields.add(node.field);
		else if (node.type === 'not') pending.push(node.child);
		else pending.push(...node.children);
	}
	dependencies.set(rule, fields); return fields;
}
export function creatorNames(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry?.strName === 'string' && entry.strName.trim())) return undefined;
	return [...new Set(value.map((entry) => entry.strName.trim()))];
}
function basicFacts(data: SteamObject | undefined): GameFacts {
	return { developers: creatorNames(data?.rgDevelopers), publishers: creatorNames(data?.rgPublishers) };
}
function storeFacts(item: SteamObject | undefined, kind: 'basic' | 'languages'): GameFacts | undefined {
	const flags = kind === 'basic' ? { include_basic_info: true } : { include_supported_languages: true };
	if (item?.BContainDataRequest?.(flags) !== true) return undefined;
	if (kind === 'basic') {
		const data = item.m_BasicInfo;
		return basicFacts({ rgDevelopers: data?.developers?.map((value: SteamObject) => ({ strName: value.name })), rgPublishers: data?.publishers?.map((value: SteamObject) => ({ strName: value.name })) });
	}
	const entries = item.m_rgSupportedLanguages;
	if (!Array.isArray(entries) || !entries.every((entry) => Number.isSafeInteger(entry.elanguage) && ['supported', 'subtitles', 'full_audio'].every((key) => typeof entry[key] === 'boolean'))) return undefined;
	return { languages: {
		interface: new Set(entries.filter((entry) => entry.supported).map((entry) => entry.elanguage)),
		subtitles: new Set(entries.filter((entry) => entry.subtitles).map((entry) => entry.elanguage)),
		audio: new Set(entries.filter((entry) => entry.full_audio).map((entry) => entry.elanguage)),
	} };
}
/** Read only an explicit, current, aggregate cache record. Steam's convenience
 * GetAchievementProgress returns 0 on a cache miss and MUST NOT be used as data.
 */
export function achievementFacts(environment: SteamEnvironment, app: SteamObject): number | null | undefined {
	try {
		const cache = environment.appAchievementProgressCache;
		const owner = cache?.CMInterface?.steamid?.ConvertTo64BitString?.();
		if (owner && owner !== environment.App?.GetCurrentUser?.()?.strSteamID) return undefined;
		const row = cache?.m_achievementProgress?.mapCache?.get?.(app.appid);
		if (cache?.m_mapQueuedCacheMisses?.has?.(app.appid)) return undefined;
		if (!row || !Number.isSafeInteger(row.total) || !Number.isSafeInteger(row.unlocked) || row.total < 0 || row.unlocked < 0 || row.unlocked > row.total || !Number.isFinite(row.cache_time) || row.cache_time <= 0 || (app.rt_last_time_played ?? 0) > row.cache_time) return undefined;
		return row.total === 0 ? null : row.unlocked * 100 / row.total;
	} catch { return undefined; } // A detached cache must not hide other complementary facts.
}
/** GetMyAchievementsForApp is the API used by Steam's native achievement page.
 * Its successful complete array includes locked and hidden achievements alike.
 */
export function personalAchievementFacts(response: SteamObject | undefined): number | null | undefined {
	if (response?.result !== 1 || !Array.isArray(response.data?.rgAchievements)) return undefined;
	const rows = response.data.rgAchievements as SteamObject[], ids = new Set<string>();
	for (const row of rows) {
		if (typeof row?.bAchieved !== 'boolean' || typeof row.strID !== 'string' || !row.strID || ids.has(row.strID)) return undefined;
		ids.add(row.strID);
	}
	return rows.length ? rows.filter((row) => row.bAchieved).length * 100 / rows.length : null;
}
type Kind = 'basic' | 'languages' | 'achievements';
const kindFields = (kind: Kind): ReadonlySet<Field> => new Set<Field>(kind === 'basic' ? ['developer', 'publisher'] : kind === 'languages' ? ['language'] : ['achievementProgress']);
interface Entry { value: GameFacts; expires: number; played?: number }
interface Job { key: string; id: number; kind: Kind; account: string; generation: number; revision: number; played?: number }
export interface MetadataChange { appid: number; fields: ReadonlySet<Field> }
/** Shared memory-only cache. At most two native requests at once; starts are
 * spaced 250ms for Store data and 1s for personal achievements. No startup prefetch.
 */
export class SupplementalMetadata {
	private entries = new Map<string, Entry>();
	private queued = new Set<string>();
	private jobs: Job[] = [];
	private active = 0;
	private timer?: ReturnType<typeof setTimeout>;
	private deadlines = new Set<ReturnType<typeof setTimeout>>();
	private needed: (id: number, fields: ReadonlySet<Field>) => boolean = () => true;
	private generation = 0;
	private account = '';
	private disposed = false;
	private observedAchievements = new Map<number, number | null | undefined>();
	private progressRevisions = new Map<number, number>();
	private nativeProgressBypass = new Set<number>();
	private lastRequest: Record<string, unknown> = {};
	private skipped = 0;
	constructor(private environment: SteamEnvironment, private changed: (change: MetadataChange) => void, private options: { now?: () => number; spacingMs?: number; timeoutMs?: number; ttlMs?: number; retryMs?: number } = {}) {}
	setDemandCheck(needed: (id: number, fields: ReadonlySet<Field>) => boolean): void { this.needed = needed; }
	diagnostics(): Record<string, unknown> {
		const progress = { known: 0, notApplicable: 0, unknown: 0 };
		for (const value of this.observedAchievements.values()) {
			if (value === undefined) progress.unknown++; else if (value === null) progress.notApplicable++; else progress.known++;
		}
		return { cached: this.entries.size, waiting: this.jobs.length, active: this.active, skipped: this.skipped, lastRequest: this.lastRequest, progress };
	}
	setAccount(account: string): void {
		if (this.account === account) return;
		this.account = account; this.generation++; this.entries.clear(); this.jobs = []; this.queued.clear(); this.observedAchievements.clear(); this.progressRevisions.clear(); this.nativeProgressBypass.clear();
		clearTimeout(this.timer); this.timer = undefined;
	}
	read(app: SteamObject, fields: ReadonlySet<Field>): GameFacts {
		const facts: GameFacts = {};
		if (this.disposed) return facts;
		if (fields.has('achievementProgress')) {
			facts.achievementProgress = this.progress(app);
			this.observedAchievements.set(app.appid, facts.achievementProgress);
		}
		if (fields.has('developer') || fields.has('publisher')) Object.assign(facts, this.get(app.appid, 'basic'));
		if (fields.has('language')) Object.assign(facts, this.get(app.appid, 'languages'));
		return facts;
	}
	/** Suggestions read already loaded associations only; rendering never starts requests. */
	names(id: number): GameFacts {
		try { return { ...basicFacts(this.environment.appDetailsStore?.m_mapAppData?.get?.(id)?.associationData), ...this.entries.get(`${id}:basic`)?.value }; }
		catch { return {}; }
	}
	private progress(app: SteamObject): number | null | undefined {
		const key = `${app.appid}:achievements`, entry = this.entries.get(key);
		if (entry && entry.played !== app.rt_last_time_played) this.invalidateProgress(app.appid);
		if (!this.nativeProgressBypass.has(app.appid)) {
			const native = achievementFacts(this.environment, app);
			if (native !== undefined) return native;
		}
		return this.get(app.appid, 'achievements', app.rt_last_time_played)?.achievementProgress;
	}
	/** Notifications and changed play history invalidate data; recalculation never does. */
	invalidateProgress(id: number): void {
		if (!this.observedAchievements.has(id) && !this.entries.has(`${id}:achievements`)) return;
		this.entries.delete(`${id}:achievements`); this.nativeProgressBypass.add(id);
		this.progressRevisions.set(id, (this.progressRevisions.get(id) ?? 0) + 1);
		if (this.observedAchievements.has(id)) this.changed({ appid: id, fields: kindFields('achievements') });
	}
	private get(id: number, kind: Kind, played?: number): GameFacts | undefined {
		if (!Number.isSafeInteger(id) || id <= 0 || !this.account) return undefined;
		const key = `${id}:${kind}`, entry = this.entries.get(key);
		if (entry && entry.expires > this.now()) return entry.value;
		// Do not serve expired data, and coalesce all collections/drafts on this key.
		if (!this.queued.has(key)) {
			if (kind === 'achievements') this.nativeProgressBypass.add(id);
			this.queued.add(key); this.jobs.push({ key, id, kind, account: this.account, generation: this.generation, revision: this.progressRevisions.get(id) ?? 0, played }); this.pump();
		}
		return undefined;
	}
	private now(): number { return this.options.now?.() ?? Date.now(); }
	private pump(): void {
		if (this.disposed || this.timer || this.active >= 2 || !this.jobs.length) return;
		let job: Job | undefined;
		while (this.jobs.length) {
			const candidate = this.jobs.shift()!;
			if (this.needed(candidate.id, kindFields(candidate.kind))) { job = candidate; break; }
			this.queued.delete(candidate.key);
			this.skipped++;
		}
		if (!job) return;
		const current = job; this.active++;
		this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, this.options.spacingMs ?? (current.kind === 'achievements' ? 1000 : 250));
		void this.load(current).then((value) => {
			if (this.disposed || current.generation !== this.generation || current.account !== this.account) return;
			if (current.kind === 'achievements' && current.revision !== (this.progressRevisions.get(current.id) ?? 0)) return;
			const known = current.kind === 'basic' ? value?.developers !== undefined || value?.publishers !== undefined : current.kind === 'languages' ? value?.languages !== undefined : value?.achievementProgress !== undefined;
			const complete = current.kind === 'basic' ? value?.developers !== undefined && value?.publishers !== undefined : known;
			this.entries.set(current.key, { value: value ?? {}, expires: this.now() + (complete ? this.options.ttlMs ?? (current.kind === 'achievements' ? 300000 : 86400000) : this.options.retryMs ?? 300000), played: current.played });
			if (known) this.changed({ appid: current.id, fields: kindFields(current.kind) });
		}).catch(() => {
			if (!this.disposed && current.generation === this.generation && (current.kind !== 'achievements' || current.revision === (this.progressRevisions.get(current.id) ?? 0))) this.entries.set(current.key, { value: {}, expires: this.now() + (this.options.retryMs ?? 300000), played: current.played });
		}).finally(() => {
			this.active--; if (current.generation === this.generation) this.queued.delete(current.key);
			if (!this.disposed && current.generation === this.generation && current.kind === 'achievements' && current.revision !== (this.progressRevisions.get(current.id) ?? 0)) this.changed({ appid: current.id, fields: kindFields('achievements') });
			this.pump();
		});
	}
	private async load(job: Job): Promise<GameFacts | undefined> {
		let expired = false;
		// Native requests are not cancellable. A timed-out request keeps its slot
		// until it settles: a hung service can never spawn unlimited concurrent calls.
		const timeout = setTimeout(() => { expired = true; this.deadlines.delete(timeout); }, this.options.timeoutMs ?? 8000);
		this.deadlines.add(timeout);
		try {
			const value = await this.request(job, () => expired);
			return expired ? undefined : value;
		} finally { clearTimeout(timeout); this.deadlines.delete(timeout); }
	}
	private async request(job: Job, expired: () => boolean): Promise<GameFacts | undefined> {
		this.lastRequest = { kind: job.kind, stage: 'local' };
		if (job.kind === 'achievements') {
			const api = this.environment.SteamClient?.Apps;
			if (typeof api?.GetMyAchievementsForApp !== 'function') return undefined;
			this.lastRequest = { kind: job.kind, stage: 'client-request' };
			const response = await api.GetMyAchievementsForApp(String(job.id));
			const progress = personalAchievementFacts(response);
			this.lastRequest = { kind: job.kind, stage: 'client-reply', result: typeof response?.result === 'number' ? response.result : 'unexpected', covered: progress !== undefined, progress: progress ?? (progress === null ? 'not-applicable' : 'unknown') };
			return { achievementProgress: progress };
		}
		let local: GameFacts | undefined;
		if (job.kind === 'basic') {
			try {
				let data = this.environment.appDetailsStore?.m_mapAppData?.get?.(job.id)?.associationData;
				if (!data) data = await this.environment.appDetailsCache?.GetCachedDataForApp?.(job.id, 'associations', 2);
				local = basicFacts(data);
				if (local.developers !== undefined && local.publishers !== undefined) { this.lastRequest.stage = 'local-hit'; return local; }
			} catch { /* A missing local cache must not hide an available Store interface. */ }
		}
		if (expired() || this.disposed || job.generation !== this.generation) return undefined;
		const store = this.environment.storeItemCache;
		if (store?.m_bInitialized !== true || typeof store.GetApp !== 'function') return local;
		const existing = storeFacts(store.GetApp(job.id), job.kind);
		if (existing) { this.lastRequest.stage = 'store-hit'; return { ...local, ...existing }; }
		const flags = job.kind === 'basic' ? { include_basic_info: true } : { include_supported_languages: true };
		if (typeof store.QueueAppRequest !== 'function') return local;
		this.lastRequest.stage = 'store-request';
		const result = await store.QueueAppRequest(job.id, flags);
		const item = store.GetApp(job.id);
		this.lastRequest = { kind: job.kind, stage: 'store-reply', result: typeof result === 'number' ? result : 'unexpected', item: !!item, covered: item?.BContainDataRequest?.(flags) === true, developers: item?.m_BasicInfo?.developers?.length, publishers: item?.m_BasicInfo?.publishers?.length, languages: item?.m_rgSupportedLanguages?.length };
		if (result !== 1 || expired() || this.disposed || job.generation !== this.generation) return local;
		return { ...local, ...storeFacts(store.GetApp(job.id), job.kind) };
	}
	/** Native aggregate cache updates and the existing periodic tick share this path. */
	pollAchievements(): void {
		for (const [id, previous] of this.observedAchievements) {
			try {
				if (!this.needed(id, kindFields('achievements'))) { this.observedAchievements.delete(id); continue; }
				const app = this.environment.appStore?.GetAppOverviewByAppID?.(id) ?? this.environment.appStore?.allApps?.find((value: SteamObject) => value.appid === id);
				if (!app) continue;
				const next = this.progress(app);
				if (next !== previous) { this.observedAchievements.set(id, next); this.changed({ appid: id, fields: new Set(['achievementProgress']) }); }
			} catch { /* A detached Steam cache must not break the periodic refresh. */ }
		}
	}
	dispose(): void { this.disposed = true; this.generation++; clearTimeout(this.timer); this.deadlines.forEach(clearTimeout); this.deadlines.clear(); this.jobs = []; this.queued.clear(); this.entries.clear(); this.observedAchievements.clear(); this.progressRevisions.clear(); this.nativeProgressBypass.clear(); }
}
