import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Render the actual compiled JSX with a tiny hook/element host. No React or DOM
// package is added to the plugin merely to test its controlled editor actions.
test('compiled editor supports readable operators, nesting, collapsing and removal without altering a draft on render', () => {
	const root = resolve(import.meta.dir, '..'), directory = mkdtempSync(join(root, '.millennium', 'editor-test-'));
	const plugin = 'com.sac.editor-regression';
	try {
		mkdirSync(join(directory, 'output'));
		writeFileSync(join(directory, 'millennium.toml'), `[plugin]\nid="${plugin}"\nname="Editor test"\nversion="1.0.0"\nauthor="test"\n[frontend]\nentry="entry.tsx"\n[assets]\nresources=[]\n`);
		writeFileSync(join(directory, 'entry.tsx'), `import { RuleEditor } from ${JSON.stringify(join(root, 'frontend/ui/RuleEditor.tsx').replaceAll('\\', '/'))};\nexport default () => ({ RuleEditor });`);
		const run = (args) => { const r = Bun.spawnSync([join(root, 'node_modules/.bin/starlight.exe'), ...args]); if (r.exitCode) throw Error(r.stdout.toString() + r.stderr.toString()); return r.stdout.toString(); };
		run(['--dir', directory, '--of', join(directory, 'output'), 'pack']);
		const bundle = run(['--if', join(directory, 'output', `${plugin}.star`), '--query', 'frontend:bundle.js']);
		const hooks = new Map(); let currentPath, hookIndex;
		const useState = (initial) => {
			const key = `${currentPath}:hook${hookIndex++}`;
			if (!hooks.has(key)) hooks.set(key, initial);
			return [hooks.get(key), (value) => hooks.set(key, value)];
		};
		const jsx = (type, props, key) => ({ type, props, key });
		const window = { PLUGIN_LIST: {}, MILLENNIUM_API: {}, SP_REACT: { useState }, SP_JSX_FACTORY: { jsx, jsxs: jsx }, MILLENNIUM_BACKEND_IPC: { postMessage() {} } };
		runInNewContext(bundle, { window, console, MILLENNIUM_BACKEND_IPC: window.MILLENNIUM_BACKEND_IPC });
		const { RuleEditor } = window.PLUGIN_LIST[plugin].default();
		let rule = { type: 'condition', field: 'tag', value: 10 }, edits = 0;
		const before = JSON.stringify(rule);
		const render = (element, path = 'root') => {
			if (element == null || typeof element !== 'object') return element;
			if (Array.isArray(element)) return element.map((child, i) => render(child, `${path}/${i}`));
			if (typeof element.type === 'function') { currentPath = path; hookIndex = 0; return render(element.type(element.props), `${path}/component`); }
			return { ...element, children: render(element.props?.children, `${path}/children`) };
		};
		const tree = () => render(jsx(RuleEditor, { rule, catalog: { tags: [{ value: '10', label: 'Action' }], categories: [], libraries: [], drives: [] }, onChange: (value) => { rule = value; edits++; } }));
		const flatten = (node) => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.children)];
		const label = (node) => Array.isArray(node) ? node.map(label).join('') : node && typeof node === 'object' ? label(node.children) : String(node ?? '');
		const find = (predicate) => flatten(tree()).find(predicate);
		const button = (name) => find((node) => node.type === 'button' && label(node).includes(name));
		tree(); expect(JSON.stringify(rule)).toBe(before); expect(edits).toBe(0);
		expect(find((node) => node.type === 'option' && label(node) === 'All conditions must match')).toBeDefined();
		find((node) => node.props?.['aria-label'] === 'Condition operator').props.onChange({ currentTarget: { value: 'not' } });
		expect(rule.children[0].type).toBe('not');
		button('Add group').props.onClick(); expect(rule.children[1].type).toBe('group');
		const addButtons = flatten(tree()).filter((node) => node.type === 'button' && label(node).includes('Add condition'));
		addButtons[0].props.onClick(); expect(rule.children[1].children.length).toBe(1);
		const snapshot = JSON.stringify(rule);
		find((node) => node.props?.['aria-label'] === 'Collapse group').props.onClick();
		expect(find((node) => node.props?.['aria-label'] === 'Condition type')).toBeUndefined(); expect(JSON.stringify(rule)).toBe(snapshot);
		find((node) => node.props?.['aria-label'] === 'Expand group').props.onClick();
		expect(find((node) => node.props?.['aria-label'] === 'Condition type')).toBeDefined();
		find((node) => node.props?.['aria-label'] === 'Remove group').props.onClick(); expect(rule.children.length).toBe(1);
		// New criteria expose Steam Features but never offer a drive condition.
		const criterion = find((node) => node.props?.['aria-label'] === 'Condition type');
		expect(flatten(criterion).some((node) => node.type === 'option' && label(node) === 'Steam Features')).toBe(true);
		expect(flatten(criterion).some((node) => node.type === 'option' && node.props.value === 'drive')).toBe(false);
		// Saved categories absent from today's catalog must not fall back to a bare ID.
		rule = { type: 'condition', field: 'category', value: 23 }; const categorySnapshot = JSON.stringify(rule), oldEdits = edits;
		let values = find((node) => node.props?.['aria-label'] === 'Condition value');
		expect(flatten(values).some((node) => node.type === 'option' && label(node) === 'Steam Cloud' && node.props.value === '23')).toBe(true);
		expect(JSON.stringify(rule)).toBe(categorySnapshot); expect(edits).toBe(oldEdits);
		values.props.onChange({ currentTarget: { value: '22' } }); expect(rule.children[0]).toEqual({ type: 'condition', field: 'category', value: 22 });
		rule = { type: 'condition', field: 'category', value: 9999 };
		values = find((node) => node.props?.['aria-label'] === 'Condition value');
		expect(flatten(values).some((node) => node.type === 'option' && label(node) === 'Unknown Steam feature (ID: 9999)')).toBe(true);
		// Legacy drive rows remain visible/editable without silently replacing them.
		rule = { type: 'condition', field: 'drive', value: 'E:' }; const driveSnapshot = JSON.stringify(rule), driveEdits = edits;
		const legacy = find((node) => node.props?.['aria-label'] === 'Condition type');
		expect(flatten(legacy).some((node) => node.type === 'option' && node.props.value === 'drive' && node.props.disabled && label(node) === 'Installation Drive (legacy)')).toBe(true);
		expect(JSON.stringify(rule)).toBe(driveSnapshot); expect(edits).toBe(driveEdits);
		legacy.props.onChange({ currentTarget: { value: 'library' } }); expect(rule.children[0].field).toBe('library');
		expect(find((node) => node.type === 'option' && node.props.value === 'drive')).toBeUndefined();
	} finally { rmSync(directory, { recursive: true, force: true }); }
}, 20000);
