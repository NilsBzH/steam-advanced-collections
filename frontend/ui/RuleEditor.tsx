import { useState } from 'react';
import type { Condition, Rule } from '../rules/model';
import { describeRule, editableFields, editorRoot, invertRule, newCondition, type EditableField } from '../rules/editing';
import type { Catalog, Choice } from '../steam/metadata';
import { steamFeatureChoices } from '../steam/features';
import { text } from './text';
import { MeasurementEditor } from './MeasurementEditor';

function Choices({ choices, value, onChange }: { choices: Choice[]; value: string; onChange: (value: string) => void }) {
	return <select className="sac-value" aria-label={text.conditionValue} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
		<option value="">{text.choose}</option>
		{value && !choices.some((choice) => choice.value === value) && <option value={value}>{value}</option>}
		{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
	</select>;
}
function ConditionEditor({ rule, catalog, onChange }: { rule: Condition; catalog: Catalog; onChange: (rule: Condition) => void }) {
	switch (rule.field) {
		case 'tag':
			return <Choices choices={catalog.tags} value={rule.value ? String(rule.value) : ''} onChange={(value) => onChange({ ...rule, value: Number(value) })} />;
		case 'category':
			// A saved feature absent from the current library still gets a verified
			// label (or explicit unknown fallback), in the same alphabetical list.
			return <Choices choices={steamFeatureChoices([...catalog.categories.map((choice) => Number(choice.value)), rule.value])} value={rule.value ? String(rule.value) : ''} onChange={(value) => onChange({ ...rule, value: Number(value) })} />;
		case 'ownership':
			return <Choices choices={[{ value: 'personal', label: text.personal }, { value: 'family', label: text.family }]} value={rule.value} onChange={(value) => onChange({ ...rule, value: value as 'personal' | 'family' })} />;
		case 'installed':
			return <Choices choices={[{ value: 'true', label: text.installed }, { value: 'false', label: text.uninstalled }]} value={String(rule.value)} onChange={(value) => onChange({ ...rule, value: value === 'true' })} />;
		case 'library': case 'drive':
			return <Choices choices={rule.field === 'library' ? catalog.libraries : catalog.drives} value={rule.value} onChange={(value) => onChange({ ...rule, value })} />;
		case 'playtime': case 'lastPlayed': case 'installSize': case 'releaseDate':
			return <MeasurementEditor rule={rule} onChange={onChange} />;
	}
}
function Remove({ group, onRemove }: { group?: boolean; onRemove?: () => void }) {
	return onRemove ? <button className="sac-remove" type="button" title={group ? text.removeGroup : text.removeCondition} aria-label={group ? text.removeGroup : text.removeCondition} onClick={onRemove}>×</button> : null;
}

function RuleNode({ rule, catalog, onChange, onRemove }: { rule: Rule; catalog: Catalog; onChange: (rule: Rule) => void; onRemove?: () => void }) {
	const [collapsed, setCollapsed] = useState(false);
	const { node, inverted } = describeRule(rule);
	const change = (next: Rule) => onChange(invertRule(next, inverted));
	const measurement = node.type === 'condition' && (node.field === 'playtime' || node.field === 'lastPlayed' || node.field === 'installSize' || node.field === 'releaseDate');
	if (node.type === 'condition') return <div className="sac-condition">
		<select className="sac-field" aria-label={text.conditionType} value={node.field} onChange={(event) => {
			const field = event.currentTarget.value as EditableField;
			if (editableFields.includes(field)) change(newCondition(field));
		}}>
			{editableFields.map((field) => <option key={field} value={field}>{text.fields[field]}</option>)}
			{node.field === 'drive' && <option value="drive" disabled>{text.fields.drive}</option>}
		</select>
		{!measurement && <select className="sac-operator" aria-label={text.conditionOperator} value={inverted ? 'not' : 'is'} onChange={(event) => onChange(invertRule(node, event.currentTarget.value === 'not'))}>
			<option value="is">{text.is}</option><option value="not">{text.isNot}</option>
		</select>}
		<ConditionEditor rule={node} catalog={catalog} onChange={change} />
		{measurement && <label className="sac-invert"><input type="checkbox" checked={inverted} onChange={(event) => onChange(invertRule(node, event.currentTarget.checked))} />{text.exclude}</label>}
		<Remove onRemove={onRemove} />
		{measurement && <span className="sac-measure-hint">{text.measurementHints[node.field as keyof typeof text.measurementHints]}</span>}
	</div>;
	return <div className={`sac-group${inverted ? ' sac-inverted' : ''}`}>
		<div className="sac-group-heading">
			<button className="sac-disclosure" type="button" aria-label={collapsed ? text.expand : text.collapse} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '▾'}</button>
			<select className="sac-group-match" aria-label={text.groupMatch} value={node.operator} onChange={(event) => change({ ...node, operator: event.currentTarget.value as 'and' | 'or' })}>
				<option value="and">{text.all}</option><option value="or">{text.any}</option>
			</select>
			<label className="sac-invert"><input type="checkbox" checked={inverted} onChange={(event) => onChange(invertRule(node, event.currentTarget.checked))} />{text.invertGroup}</label>
			<Remove group onRemove={onRemove} />
		</div>
		{collapsed ? <p className="sac-group-summary">{inverted ? `${text.invertedGroup} · ` : ''}{text.conditionCount(node.children.length)}</p> : <>
			<div className="sac-children">{node.children.map((child, index) => <RuleNode key={index} rule={child} catalog={catalog}
				onChange={(next) => change({ ...node, children: node.children.map((value, i) => i === index ? next : value) })}
				onRemove={() => change({ ...node, children: node.children.filter((_, i) => i !== index) })} />)}
				{node.children.length === 0 && <p className="sac-hint sac-empty">{node.operator === 'and' ? text.emptyAll : text.emptyAny}</p>}
			</div>
			<div className="sac-group-actions">
				<button type="button" onClick={() => change({ ...node, children: [...node.children, newCondition('tag')] })}>+ {text.addCondition}</button>
				<button type="button" onClick={() => change({ ...node, children: [...node.children, { type: 'group', operator: 'and', children: [] }] })}>+ {text.addGroup}</button>
			</div>
		</>}
	</div>;
}

export function RuleEditor({ rule, catalog, onChange }: { rule: Rule; catalog: Catalog; onChange: (rule: Rule) => void }) {
	// Legacy single-condition rules get a virtual group without a storage rewrite.
	return <RuleNode rule={editorRoot(rule)} catalog={catalog} onChange={onChange} />;
}
