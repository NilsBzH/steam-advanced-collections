import { useId } from 'react';
import type { Condition } from '../rules/model';
import type { Catalog } from '../steam/metadata';
import { steamLanguages, steamReviewCategories } from '../steam/catalog-labels';
import { MeasurementEditor } from './MeasurementEditor';

type CatalogCondition = Extract<Condition, { field: 'developer' | 'publisher' | 'reviews' | 'language' }>;
function CreatorEditor({ rule, catalog, onChange }: { rule: Extract<Condition, { field: 'library' | 'drive' | 'developer' | 'publisher' }>; catalog: Catalog; onChange: (rule: Condition) => void }) {
	const id = useId();
	const choices = (rule.field === 'developer' ? catalog.developers : catalog.publishers) ?? [];
	return <><input className="sac-creator" type="text" list={id} aria-label="Creator name" placeholder="Search or enter an exact name…" maxLength={512} value={rule.value} onChange={(event) => onChange({ ...rule, value: event.currentTarget.value })} />
		<datalist id={id}>{choices.map((choice) => <option key={choice.value} value={choice.value} />)}</datalist></>;
}
export function CatalogEditor({ rule, catalog, onChange }: { rule: CatalogCondition; catalog: Catalog; onChange: (rule: Condition) => void }) {
	if (rule.field === 'developer' || rule.field === 'publisher') return <CreatorEditor rule={rule} catalog={catalog} onChange={onChange} />;
	if (rule.field === 'language') return <>
		<select aria-label="Language support" value={rule.support} onChange={(event) => onChange({ ...rule, support: event.currentTarget.value as typeof rule.support })}>
			<option value="interface">Interface</option><option value="subtitles">Subtitles</option><option value="audio">Full Audio</option>
		</select><span className="sac-hint">includes</span>
		<select aria-label="Language" value={rule.value} onChange={(event) => onChange({ ...rule, value: Number(event.currentTarget.value) })}>
			{steamLanguages.map((label, value) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label, 'en')).map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
		</select>
	</>;
	if (rule.field !== 'reviews') return null;
	return <>
		<select aria-label="Review mode" value={rule.mode} onChange={(event) => onChange(event.currentTarget.value === 'score' ? { type: 'condition', field: 'reviews', mode: 'score', comparison: 'gt', value: null } : { type: 'condition', field: 'reviews', mode: 'category', value: 8 })}>
			<option value="score">Review score</option><option value="category">Review category</option>
		</select>
		{rule.mode === 'score' ? <MeasurementEditor rule={rule} onChange={onChange} /> : <select aria-label="Review category" value={rule.value} onChange={(event) => onChange({ ...rule, value: Number(event.currentTarget.value) })}>
			{steamReviewCategories.map((label, value) => value > 0 && <option key={value} value={value}>{label}</option>)}
		</select>}
	</>;
}
