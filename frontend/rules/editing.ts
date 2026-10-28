import type { Condition, Field, Rule } from './model';

export function newCondition(field: Field): Condition {
	switch (field) {
		case 'tag': case 'category': return { type: 'condition', field, value: 0 };
		case 'ownership': return { type: 'condition', field, value: 'personal' };
		case 'installed': return { type: 'condition', field, value: true };
		case 'library': case 'drive': return { type: 'condition', field, value: '' };
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
