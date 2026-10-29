import { afterPatch, beforePatch, definePlugin, EUIMode, findModuleExport, routerHook } from 'millennium';
import { AdvancedCollections, log } from './app';
import { RuleRepository } from './rules/repository';
import { millenniumConfigPort } from './rules/millennium-config';
import { EditorPortals } from './ui/EditorPortals';
import { startDiagnostics, type SteamEnvironment } from './diagnostics/runtime';

let application: AdvancedCollections | undefined;
let stopDiagnostics: (() => void) | undefined;
let mounted = false;

/** Sanitized capability report for local Millennium logs; never loads metadata. */
/** @ffi */
export function metadataStatus(): string {
	const environment = application?.environment;
	const store = environment?.storeItemCache;
	return JSON.stringify({ storeFound: !!store, storeInitialized: store?.m_bInitialized === true, storeTransport: !!store?.m_serviceTransport, storeQueue: typeof store?.QueueAppRequest === 'function', associationCache: !!environment?.appDetailsCache, achievementCache: !!environment?.appAchievementProgressCache, personalAchievements: typeof environment?.SteamClient?.Apps?.GetMyAchievementsForApp === 'function', achievementNotifications: typeof environment?.SteamClient?.GameSessions?.RegisterForAchievementNotification === 'function', cache: application?.metadata.supplemental.diagnostics() });
}

/** The source patch consults this bridge dynamically; missing/stopped plugins use native behavior. */
/** @ffi */
export const integration = {
	hasRules: (collection: Record<string, any>): boolean => application?.membership.hasRules(collection) ?? false,
	matches: (collection: Record<string, any>, game: Record<string, any>): boolean | undefined => application?.membership.matches(collection, game),
};

/** @ffi */
export function disposePlugin(): boolean {
	if (mounted) { try { routerHook.removeGlobalComponent('SteamAdvancedCollectionsEditors', EUIMode.Desktop); } catch { log('editor.cleanup unavailable'); } }
	mounted = false;
	application?.dispose(); application = undefined;
	stopDiagnostics?.(); stopDiagnostics = undefined;
	window.removeEventListener('beforeunload', disposePlugin);
	return true;
}

export default definePlugin(() => {
	disposePlugin();
	// Keep the native globals untouched. Resolve the existing initialized store
	// cache through Millennium's module lookup, never a private network endpoint.
	const environment = Object.create(globalThis) as SteamEnvironment;
	try {
		const store = findModuleExport((value) => typeof value?.Get === 'function' && typeof value?.prototype?.QueueAppRequest === 'function' && typeof value?.prototype?.GetApp === 'function');
		environment.storeItemCache = store?.Get?.();
		log('metadata.sources', { store: environment.storeItemCache?.m_bInitialized === true, associations: !!environment.appDetailsCache, achievements: !!environment.appAchievementProgressCache });
	} catch { log('metadata.store unavailable; unknown values retain native results'); }
	const repository = new RuleRepository(millenniumConfigPort());
	const running = new AdvancedCollections(environment, repository, (target, method, callback) => {
		const patch = afterPatch(target, method, (args, result) => {
			try { callback(args, result); } catch { /* Preserve native event processing. */ }
			return result;
		});
		return () => patch.unpatch();
	});
	application = running;
	stopDiagnostics = startDiagnostics({
		environment,
		observe: (target, method, callback) => {
			const patch = beforePatch(target, method, callback);
			return () => patch.unpatch();
		},
		findFamilyService: () => findModuleExport((value) =>
			value != null && typeof value.GetSharedLibraryApps === 'function'),
		log: (record) => console.info('[SAC:POC]', JSON.stringify(record)),
	});
	try {
		routerHook.addGlobalComponent('SteamAdvancedCollectionsEditors', () => <EditorPortals app={running} />, EUIMode.Desktop);
		mounted = true;
	} catch { log('editor.mount unavailable; rules and diagnostics remain isolated'); }
	// Configuration and Steam stores do not become ready in a fixed order.
	// The application restores rules as soon as both are ready, without an editor.
	void running.start();
	window.addEventListener('beforeunload', disposePlugin);
	return {
		icon: <span aria-hidden="true">◇</span>,
		onDismount: () => { disposePlugin(); },
	};
});
