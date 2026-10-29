import type { MeasurementCondition } from '../rules/model';
import { text } from './text';

export function MeasurementEditor({ rule, onChange }: { rule: MeasurementCondition; onChange: (rule: MeasurementCondition) => void }) {
	const year = rule.field === 'releaseDate', age = rule.field === 'lastPlayed';
	const percent = rule.field === 'reviews' || rule.field === 'achievementProgress';
	const operators = year ? ['before', 'after', 'between'] as const : age ? ['gt', 'lt', 'between'] as const : ['gt', 'lt', 'eq', 'between'] as const;
	const input = (upper: boolean) => <input className="sac-number" type="number" min={year ? 1 : 0} max={year ? 9999 : percent ? 100 : undefined} step={year || age ? 1 : 'any'}
		aria-label={upper ? text.upperValue : text.lowerValue} placeholder={year ? text.year : text.numberPlaceholder}
		value={(upper ? rule.upper : rule.value) ?? ''} onChange={(event) => {
			const number = event.currentTarget.valueAsNumber;
			onChange({ ...rule, [upper ? 'upper' : 'value']: Number.isFinite(number) ? number : null });
		}} />;
	return <>
		{rule.field === 'playtime' && <select aria-label={text.playtimePeriod} value={rule.period} onChange={(event) => onChange({ ...rule, period: event.currentTarget.value as 'total' | 'twoWeeks' })}>
			<option value="total">{text.totalPlaytime}</option><option value="twoWeeks">{text.recentPlaytime}</option>
		</select>}
		<select className="sac-measure-operator" aria-label={text.conditionOperator} value={rule.comparison} onChange={(event) => {
			const { upper, ...rest } = rule;
			const comparison = event.currentTarget.value;
			onChange((comparison === 'between' ? { ...rest, comparison, upper: upper ?? null } : { ...rest, comparison }) as MeasurementCondition);
		}}>{operators.map((operator) => <option key={operator} value={operator}>{age && operator === 'gt' ? text.moreThan : age && operator === 'lt' ? text.lessThan : text.comparisons[operator]}</option>)}</select>
		{input(false)}
		{rule.comparison === 'between' && <><span className="sac-hint">{text.andValue}</span>{input(true)}</>}
		{percent && <span className="sac-hint">%</span>}
		{rule.field === 'playtime' ? <span className="sac-hint">{text.hours}</span> : rule.field === 'installSize' ?
			<select aria-label={text.sizeUnit} value={rule.unit} onChange={(event) => onChange({ ...rule, unit: event.currentTarget.value as 'MB' | 'GB' })}><option value="MB">MB</option><option value="GB">GB</option></select> : rule.field === 'lastPlayed' ?
			<><select aria-label={text.ageUnit} value={rule.unit} onChange={(event) => onChange({ ...rule, unit: event.currentTarget.value as 'days' | 'months' | 'years' })}><option value="days">{text.days}</option><option value="months">{text.months}</option><option value="years">{text.years}</option></select><span className="sac-hint">{text.ago}</span></> : null}
	</>;
}
