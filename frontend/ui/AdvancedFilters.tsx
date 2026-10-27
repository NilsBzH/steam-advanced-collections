import { useEffect, useState } from 'react';
import type { AdvancedCollections } from '../app';
import { emptyRules, isSavedRules, type SavedRules } from '../rules/model';
import { accountId } from '../steam/metadata';
import { RuleEditor } from './RuleEditor';

export function AdvancedFilters({ app, collectionId }: { app: AdvancedCollections; collectionId: string }) {
	const [, render] = useState(0);
	useEffect(() => app.subscribe(() => render((value) => value + 1)), [app]);
	const account = accountId(app.environment);
	const collection = app.environment.collectionStore?.GetCollection?.(collectionId);
	const [draft, setDraft] = useState<SavedRules>(emptyRules);
	const [baseline, setBaseline] = useState('');
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const stored = account && app.ready ? JSON.stringify(app.repository.get(account, collectionId) ?? emptyRules()) : '';
	useEffect(() => {
		if (stored && !dirty) { setDraft(JSON.parse(stored)); setBaseline(stored); }
	}, [stored, dirty]);
	if (collection?.bIsDynamic !== true || collection.bIsEditable !== true) return null;
	if (!app.ready) return <section className="sac-advanced-filters"><h3>Advanced Filters</h3><p role="status">{app.error ?? 'Loading rules…'}</p></section>;
	if (!account) return <section className="sac-advanced-filters"><h3>Advanced Filters</h3><p role="status">Steam account information is unavailable. Rules have not been changed.</p></section>;
	if (app.repository.hasUnsupported(account, collectionId)) return <section className="sac-advanced-filters"><h3>Advanced Filters</h3><p role="alert">This collection has an unsupported rule format. Its saved rules have been preserved.</p></section>;
	const conflict = dirty && baseline !== stored;
	const valid = isSavedRules(draft);
	const change = (value: SavedRules) => { setDraft(value); setDirty(true); setError(undefined); };
	const save = async () => {
		if (!valid || conflict || saving) return;
		setSaving(true); setError(undefined);
		try {
			// Recheck the current account and native collection immediately before writing.
			if (accountId(app.environment) !== account || collection.bIsDynamic !== true || collection.bIsEditable !== true) throw Error('Collection changed');
			await app.repository.save(account, collectionId, draft);
			setBaseline(JSON.stringify(draft)); setDirty(false);
		} catch { setError('Rules could not be saved. Your draft is retained.'); }
		finally { setSaving(false); }
	};
	return <section className="sac-advanced-filters" aria-label="Advanced Filters" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}>
		<div className="sac-heading"><h3>Advanced Filters</h3><label><input type="checkbox" checked={draft.enabled} disabled={saving} onChange={(event) => change({ ...draft, enabled: event.currentTarget.checked })} /> Enable advanced rules</label></div>
		<p className="sac-hint">Steam filters AND the rules below. Steam’s manual additions and exclusions retain their priority.</p>
		{!app.membership.canApply(collection) && <p className="sac-warning" role="status">The native calculation bridge is unavailable. You can save rules; restart Steam to load the integration.</p>}
		<fieldset disabled={saving} className="sac-rule-fieldset"><RuleEditor rule={draft.expression} catalog={app.metadata.catalog()} onChange={(expression) => change({ ...draft, expression })} /></fieldset>
		<p className="sac-hint">Missing metadata keeps Steam’s native result. Library and drive rules use local installations.</p>
		{conflict && <p role="alert" className="sac-warning">Saved rules changed elsewhere. Cancel this draft to load the latest version.</p>}
		{!valid && <p role="status">Choose a value for every condition.</p>}
		{error && <p role="alert" className="sac-warning">{error}</p>}
		<div className="sac-rule-row">
			<button type="button" disabled={!dirty || !valid || conflict || saving} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save'}</button>
			<button type="button" disabled={!dirty || saving} onClick={() => { setDraft(JSON.parse(stored)); setDirty(false); setError(undefined); }}>Cancel</button>
			<span className="sac-hint" role="status">{dirty ? 'Unsaved changes' : 'Rules saved'}</span>
		</div>
	</section>;
}
