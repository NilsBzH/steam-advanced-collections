import { normalizeLocation, type Condition, type GameFacts, type Rule } from './model';
import { evaluateMeasurement } from './measurements';

/** undefined denotes unknown; in particular NOT(unknown) stays unknown. */
export type Truth = boolean | undefined;
function condition(rule: Condition, facts: GameFacts, now: number): Truth {
	switch (rule.field) {
		case 'tag': return facts.tags?.has(rule.value);
		case 'category': return facts.categories?.has(rule.value);
		case 'ownership': return facts.ownership === undefined ? undefined : facts.ownership === rule.value;
		case 'installed': return facts.installed === undefined ? undefined : facts.installed === rule.value;
		case 'developer': case 'publisher': {
			const names = rule.field === 'developer' ? facts.developers : facts.publishers;
			return names?.some((name) => name.trim().toLowerCase() === rule.value.trim().toLowerCase());
		}
		case 'language': return facts.languages?.[rule.support]?.has(rule.value);
		case 'reviews': return rule.mode === 'category' ? facts.reviewCategory === undefined ? undefined : facts.reviewCategory === rule.value : evaluateMeasurement(rule, facts, now);
		case 'achievementProgress': return evaluateMeasurement(rule, facts, now);
		case 'playtime': case 'lastPlayed': case 'installSize': case 'releaseDate': return evaluateMeasurement(rule, facts, now);
		case 'library': case 'drive': {
			const value = facts[rule.field];
			return value === undefined ? undefined : value !== null && normalizeLocation(value) === normalizeLocation(rule.value);
		}
	}
}

/** Pure evaluator. Validated rules can have arbitrary nesting without recursive JS calls. */
export function evaluate(rule: Rule, facts: GameFacts, now = Date.now()): Truth {
	const stack: Array<{ rule: Rule; visited: boolean }> = [{ rule, visited: false }];
	const values = new Map<Rule, Truth>();
	let nodes = 0;
	while (stack.length) {
		if (++nodes > 20000) return undefined;
		const frame = stack.pop()!;
		const node = frame.rule;
		if (node.type === 'condition') values.set(node, condition(node, facts, now));
		else if (!frame.visited) {
			stack.push({ rule: node, visited: true });
			if (node.type === 'not') stack.push({ rule: node.child, visited: false });
			else for (const child of node.children) stack.push({ rule: child, visited: false });
		} else if (node.type === 'not') {
			const result = values.get(node.child);
			values.set(node, result === undefined ? undefined : !result);
		} else {
			const results = node.children.map((child) => values.get(child));
			values.set(node, node.operator === 'and'
				? results.includes(false) ? false : results.includes(undefined) ? undefined : true
				: results.includes(true) ? true : results.includes(undefined) ? undefined : false);
		}
	}
	return values.get(rule);
}
