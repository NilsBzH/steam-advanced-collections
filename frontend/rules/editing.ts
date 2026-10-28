import type { Condition, Field, Rule } from './model';

/** Drive stays in the model/evaluator for old rules, but cannot be added anew. */
export const editableFields = ['tag', 'category', 'ownership', 'installed', 'library', 'playtime', 'lastPlayed', 'installSize', 'releaseDate'] as const satisfies readonly Field[];
export type EditableField = typeof editableFields[number];

export function newCondition(field: EditableField): Condition {
	switch (field) {
		case 'tag': case 'category': return { type: 'condition', field, value: 0 };
		case 'ownership': return { type: 'condition', field, value: 'personal' };
		case 'installed': return { type: 'condition', field, value: true };
		case 'library': return { type: 'condition', field, value: '' };
		case 'playtime': return { type: 'condition', field, comparison: 'gt', period: 'total', value: null };
		case 'lastPlayed': return { type: 'condition', field, comparison: 'gt', unit: 'months', value: null };
		case 'installSize': return { type: 'condition', field, comparison: 'gt', unit: 'GB', value: null };
		case 'releaseDate': return { type: 'condition', field, comparison: 'before', value: null };
	}
}
/** Existing nested NOT wrappers remain readable without technical wrapper rows. */
export function describeRule(rule: Rule): { node: Exclude<Rule, { type: 'not' }>; inverted: boolean } {
	let inverted = false;
	while (rule.type === 'not') { inverted = !inverted; rule = rule.child; }
	return { node: rule, inverted };
}
export function invertRule(node: Rule, inverted: boolean): Rule { return inverted ? { type: 'not', child: node } : node; }
export function editorRoot(rule: Rule): Rule {
	return describeRule(rule).node.type === 'group' ? rule : { type: 'group', operator: 'and', children: [rule] };
}
