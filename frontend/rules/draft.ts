import { emptyRules, isSavedRules, type SavedRules } from './model';

const copy = (value: SavedRules): SavedRules => JSON.parse(JSON.stringify(value));
// Millennium may reorder JSON object keys. Draft conflict checks compare rule
// content, not the serializer's property order (the 0.2.1 repository does too).
const fingerprint = (value: SavedRules): string => JSON.stringify(value, ['version', 'enabled', 'expression', 'type', 'operator', 'children', 'child', 'field', 'value']);

/** An editor owns a detached draft. Only save() can cross the persistence boundary. */
export class RuleDraft {
	value: SavedRules;
	dirty = false;
	saving = false;
	private baseline: string;
	private listeners = new Set<() => void>();
	constructor(private current: () => SavedRules | undefined, private persist: (value: SavedRules) => Promise<void>, private writable: () => boolean) {
		this.value = copy(current() ?? emptyRules());
		this.baseline = fingerprint(this.value);
	}
	get conflict(): boolean { return this.dirty && this.baseline !== fingerprint(this.current() ?? emptyRules()); }
	get valid(): boolean { return isSavedRules(this.value); }
	change(value: SavedRules): void {
		if (this.saving) return;
		this.value = value; this.dirty = fingerprint(value) !== this.baseline; this.notify();
	}
	sync(): void {
		if (this.dirty || this.saving) return;
		const current = this.current() ?? emptyRules(), next = fingerprint(current);
		if (next === this.baseline && fingerprint(this.value) === next) return;
		this.value = copy(current); this.baseline = next; this.notify();
	}
	cancel(): void {
		if (this.saving) return;
		this.dirty = false; this.sync();
	}
	async save(): Promise<void> {
		if (this.saving || !this.dirty || !this.valid || this.conflict || !this.writable()) throw Error('Draft cannot be saved safely');
		this.saving = true; this.notify();
		try {
			await this.persist(copy(this.value));
			this.dirty = false; this.baseline = fingerprint(this.value);
		} finally { this.saving = false; this.notify(); }
	}
	subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
	private notify(): void { for (const callback of this.listeners) callback(); }
}
