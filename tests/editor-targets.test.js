import { test, expect } from 'bun:test';
import { collectTargets } from '../frontend/steam/editor-targets';

class Element {
	constructor(id) { this.id = id; this.children = []; this.style = {}; this.attributes = {}; }
	getAttribute() { return this.id; }
	setAttribute(key, value) { this.attributes[key] = value; }
	querySelector() { return this.children.find((child) => child.attributes['data-sac-root']); }
	appendChild(child) { this.children.push(child); child.parentNode = this; }
	remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = undefined; }
}
test('only marked editable dynamic collections receive one root; close removes it', () => {
	const dynamic = new Element('dynamic+*'), staticEditor = new Element('static'), system = new Element('system');
	let visible = [dynamic, staticEditor, system];
	const document = { querySelectorAll: () => visible, createElement: () => new Element() };
	const app = { environment: { collectionStore: { GetCollection: (id) => ({ bIsDynamic: id !== 'static', bIsEditable: id !== 'system' }) } } };
	const owned = new Map(); const targets = collectTargets(document, app, owned);
	expect(targets.length).toBe(1); expect(dynamic.children.length).toBe(1);
	expect(staticEditor.children.length).toBe(0); expect(system.children.length).toBe(0);
	expect(collectTargets(document, app, owned)[0]).toBe(targets[0]); expect(dynamic.children.length).toBe(1);
	visible = []; expect(collectTargets(document, app, owned)).toEqual([]); expect(dynamic.children).toEqual([]);
});
test('reused native editor nodes switch collections and orphaned roots are recreated', () => {
	const editor = new Element('first'), owned = new Map();
	const document = { querySelectorAll: () => [editor], createElement: () => new Element() };
	const app = { environment: { collectionStore: { GetCollection: () => ({ bIsDynamic: true, bIsEditable: true }) } } };
	const first = collectTargets(document, app, owned)[0]; editor.id = 'second';
	const second = collectTargets(document, app, owned)[0]; expect(second.id).toBe('second'); expect(first.root.parentNode).toBeUndefined();
	second.root.remove(); expect(collectTargets(document, app, owned)[0].root.parentNode).toBe(editor);
});
test('missing collections or failed lookups never modify the native editor', () => {
	const editor = new Element('missing'), owned = new Map();
	const document = { querySelectorAll: () => [editor], createElement: () => { throw Error('must not create'); } };
	const app = { environment: { collectionStore: { GetCollection: () => { throw Error('not loaded'); } } } };
	expect(collectTargets(document, app, owned)).toEqual([]); expect(editor.children).toEqual([]);
});
