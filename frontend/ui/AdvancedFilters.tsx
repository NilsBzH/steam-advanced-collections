import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdvancedCollections } from '../app';
import { RuleDraft } from '../rules/draft';
import { accountId } from '../steam/metadata';
import type { SteamObject } from '../diagnostics/runtime';
import type { SavedRules } from '../rules/model';
import type { NativePreview } from '../steam/preview';
import { isOpenEditor } from '../steam/editor-targets';
import { RuleEditor } from './RuleEditor';
import { text } from './text';

export function AdvancedFilters({ app, collectionId, editor }: { app: AdvancedCollections; collectionId: string; editor: HTMLElement }) {
	const [, render] = useState(0);
	useEffect(() => app.subscribe(() => render((value) => value + 1)), [app]);
	const account = accountId(app.environment);
	const collection = app.environment.collectionStore?.GetCollection?.(collectionId);
	if (collection?.bIsDynamic !== true || collection.bIsEditable !== true) return null;
	let message;
	if (!app.ready) message = app.error ?? text.loading;
	else if (!account) message = text.missingAccount;
	else if (app.repository.hasUnsupported(account, collectionId)) message = text.unsupported;
	if (message || !account) return <section className="sac-advanced-filters"><h3>{text.title}</h3><p role="status">{message}</p></section>;
	return <ReadyFilters key={`${account}:${collectionId}`} app={app} account={account} collection={collection} editor={editor} />;
}

function ReadyFilters({ app, account, collection, editor }: { app: AdvancedCollections; account: string; collection: SteamObject; editor: HTMLElement }) {
	const [, render] = useState(0);
	const [live, setLive] = useState(false);
	const preview = useRef<NativePreview | undefined>(undefined);
	const collectionId = collection.id as string;
	const [session] = useState(() => new RuleDraft(
		() => app.repository.get(account, collectionId),
		(value) => app.repository.save(account, collectionId, value),
		() => {
			const current = app.environment.collectionStore?.GetCollection?.(collectionId);
			return accountId(app.environment) === account && app.ready && current?.bIsDynamic === true && current.bIsEditable === true && isOpenEditor(editor, collectionId);
		},
	));
	const [error, setError] = useState<string>();
	useEffect(() => session.subscribe(() => render((value) => value + 1)), [session]);
	useLayoutEffect(() => {
		const current = () => app.ready && accountId(app.environment) === account && app.environment.collectionStore?.GetCollection?.(collectionId) === collection && isOpenEditor(editor, collectionId);
		const lease = app.openPreview(editor, collection, account, current, setLive);
		preview.current = lease;
		return () => { if (preview.current === lease) preview.current = undefined; lease.dispose(); };
	}, [app, account, collection, collectionId, editor]);
	useEffect(() => {
		const changed = () => { session.sync(); render((value) => value + 1); };
		const unsubscribers = [app.subscribe(changed), app.repository.subscribe(changed)];
		return () => { for (const unsubscribe of unsubscribers) unsubscribe(); };
	}, [app, collection, session]);
	const save = async () => {
		setError(undefined);
		try { await session.save(); preview.current?.commit(); } catch { setError(text.saveFailed); }
	};
	const change = (value: SavedRules) => {
		session.change(value); setError(undefined);
		preview.current?.update(session.value, session.dirty);
	};
	return <section className="sac-advanced-filters" aria-label={text.title} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}>
		<div className="sac-heading"><h3>{text.title}</h3>{live && <span className="sac-live-preview" role="status">{text.livePreview}</span>}<label className="sac-enable"><input type="checkbox" checked={session.value.enabled} disabled={session.saving} onChange={(event) => change({ ...session.value, enabled: event.currentTarget.checked })} />{text.enable}</label></div>
		<p className="sac-hint sac-intro">{text.intro}</p>
		{!app.membership.canApply(collection) && <p className="sac-warning" role="status">{text.bridge}</p>}
		<fieldset disabled={session.saving} className="sac-rule-fieldset"><RuleEditor rule={session.value.expression} catalog={app.metadata.catalog()} onChange={(expression) => change({ ...session.value, expression })} /></fieldset>
		{session.conflict && <p role="alert" className="sac-warning">{text.conflict}</p>}
		{!session.valid && <p role="status" className="sac-hint">{text.invalid}</p>}
		{error && <p role="alert" className="sac-warning">{error}</p>}
		<div className="sac-footer">
			<button className="sac-primary" type="button" disabled={!session.dirty || !session.valid || session.conflict || session.saving} onClick={() => { void save(); }}>{session.saving ? text.saving : text.save}</button>
			<button type="button" disabled={!session.dirty || session.saving} onClick={() => { session.cancel(); preview.current?.cancel(); setError(undefined); }}>{text.cancel}</button>
			<span className="sac-hint" role="status">{session.dirty ? text.unsaved : text.saved}</span>
		</div>
	</section>;
}
