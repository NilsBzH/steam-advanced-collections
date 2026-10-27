import type { Condition, Field, Rule } from '../rules/model';
import type { Catalog, Choice } from '../steam/metadata';

export function newCondition(field: Field): Condition {
	switch (field) {
		case 'tag': case 'category': return { type: 'condition', field, value: 0 };
		case 'ownership': return { type: 'condition', field, value: 'personal' };
		case 'installed': return { type: 'condition', field, value: true };
		case 'library': case 'drive': return { type: 'condition', field, value: '' };
	}
}
function Choices({ choices, value, onChange, label }: { choices: Choice[]; value: string; onChange: (value: string) => void; label: string }) {
	return <select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
		<option value="">Choose a value…</option>
		{value && !choices.some((choice) => choice.value === value) && <option value={value}>{value}</option>}
		{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
	</select>;
}
function ConditionEditor({ rule, catalog, onChange }: { rule: Condition; catalog: Catalog; onChange: (rule: Condition) => void }) {
	let editor;
	switch (rule.field) {
		case 'tag': case 'category':
			editor = <Choices choices={rule.field === 'tag' ? catalog.tags : catalog.categories} value={rule.value ? String(rule.value) : ''} label="Condition value" onChange={(value) => onChange({ ...rule, value: Number(value) })} />;
			break;
		case 'ownership':
			editor = <Choices choices={[{ value: 'personal', label: 'Personal license' }, { value: 'family', label: 'Steam Families' }]} value={rule.value} label="Ownership" onChange={(value) => onChange({ ...rule, value: value as 'personal' | 'family' })} />;
			break;
		case 'installed':
			editor = <Choices choices={[{ value: 'true', label: 'Installed locally' }, { value: 'false', label: 'Not installed locally' }]} value={String(rule.value)} label="Installation status" onChange={(value) => onChange({ ...rule, value: value === 'true' })} />;
			break;
		case 'library': case 'drive':
			editor = <Choices choices={rule.field === 'library' ? catalog.libraries : catalog.drives} value={rule.value} label="Installation location" onChange={(value) => onChange({ ...rule, value })} />;
			break;
	}
	return <>
		<select aria-label="Condition type" value={rule.field} onChange={(event) => onChange(newCondition(event.currentTarget.value as Field))}>
			<option value="tag">Steam tag</option><option value="category">Steam category</option>
			<option value="ownership">Ownership</option><option value="installed">Installation status</option>
			<option value="library">Steam library folder</option><option value="drive">Installation drive</option>
		</select>
		{editor}
	</>;
}

export function RuleEditor({ rule, catalog, onChange, onRemove }: { rule: Rule; catalog: Catalog; onChange: (rule: Rule) => void; onRemove?: () => void }) {
	const negated = rule.type === 'not';
	const node = negated ? rule.child : rule;
	const change = (next: Rule) => onChange(negated ? { type: 'not', child: next } : next);
	return <div className={`sac-rule ${node.type === 'group' ? 'sac-group' : ''}`}>
		<div className="sac-rule-row">
			<button type="button" aria-label="Negate condition or group" aria-pressed={negated} className={negated ? 'sac-selected' : ''} onClick={() => onChange(negated ? node : { type: 'not', child: rule })}>NOT</button>
			{node.type === 'group' ? <select aria-label="Group operator" value={node.operator} onChange={(event) => change({ ...node, operator: event.currentTarget.value as 'and' | 'or' })}>
				<option value="and">AND — all conditions</option><option value="or">OR — any condition</option>
			</select> : node.type === 'condition' ? <ConditionEditor rule={node} catalog={catalog} onChange={change} /> : <span>NOT group</span>}
			<button type="button" aria-label="Wrap in a new group" onClick={() => onChange({ type: 'group', operator: 'and', children: [rule] })}>Group</button>
			{onRemove && <button type="button" aria-label="Remove condition or group" onClick={onRemove}>Remove</button>}
		</div>
		{node.type === 'group' ? <>
			<div className="sac-children">{node.children.map((child, index) => <RuleEditor key={index} rule={child} catalog={catalog}
				onChange={(next) => change({ ...node, children: node.children.map((value, i) => i === index ? next : value) })}
				onRemove={() => change({ ...node, children: node.children.filter((_, i) => i !== index) })} />)}</div>
			<div className="sac-rule-row">
				<button type="button" onClick={() => change({ ...node, children: [...node.children, newCondition('tag')] })}>+ Condition</button>
				<button type="button" onClick={() => change({ ...node, children: [...node.children, { type: 'group', operator: 'and', children: [] }] })}>+ Group</button>
				{node.children.length === 0 && <span className="sac-hint">{node.operator === 'and' ? 'No additional constraint' : 'Empty OR matches no games'}</span>}
			</div>
		</> : node.type === 'not' ? <div className="sac-children"><RuleEditor rule={node} catalog={catalog} onChange={change} /></div> : null}
	</div>;
}
