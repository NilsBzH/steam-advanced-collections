import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { applyPatches, patches } from './helpers/patches';

const fragment = 'className:C().CollectionEditor,style:{height:open?"auto":0,opacity:open?1:0,pointerEvents:open?"initial":"none"},children:(0,R.jsx)(F.k,{appFilter:collection.internalAppFilter,bUseWideFormat:width.o.rightPanelWidth>=1028,bHideSaveButton:!0,fnOnChange:()=>collection.Save()})';
test('native editor receives markers without depending on plugin/React load order', () => {
	const render = new Function('R', 'C', 'F', 'collection', 'width', 'open', 'return (0,R.jsx)("div",{' + applyPatches(fragment) + '});');
	const jsx = (type, props) => ({ type, props });
	const c = { id: 'opaque+*', bIsDynamic: true, bIsEditable: true, internalAppFilter: {}, Save() { throw Error('Save called'); } };
	const args = [{ jsx }, () => ({ CollectionEditor: 'native-class' }), { k: 'native-filter' }, c, { o: { rightPanelWidth: 1500 } }];
	const result = render(...args, true);
	expect(result.props.children.type).toBe('native-filter');
	expect(result.props.children.props.appFilter).toBe(c.internalAppFilter);
	expect(result.props['data-sac-editor-open']).toBe('true');
	expect(result.props['data-sac-collection-id']).toBe('opaque+*');
	expect(render(...args, false).props['data-sac-editor-open']).toBeUndefined();
	c.bIsDynamic = false;
	expect(render(...args, true).props['data-sac-editor-open']).toBeUndefined();
	expect(render(...args, true).props['data-sac-collection-id']).toBeUndefined();
});
test('file selection accepts Windows, POSIX, URLs and basenames', () => {
	for (const filename of ['C:\\Program Files (x86)\\Steam\\steamui\\sp.js', '/steam/steamui/sp.js', 'https://steamloopback.host/sp.js?contenthash=abc', 'sp.js'])
		for (const patch of patches) expect(new RegExp(patch.file).test(filename)).toBe(true);
});
test('unrelated/static editor source remains byte-for-byte unchanged', () => {
	const source = fragment.replace('CollectionEditor', 'StaticCollectionEditor');
	expect(applyPatches(source)).toBe(source);
});
const steamFile = 'C:/Program Files (x86)/Steam/steamui/sp.js';
test.skipIf(!existsSync(steamFile))('installed Steam has one editor and one calculation insertion; transformed JS parses', () => {
	const source = readFileSync(steamFile, 'utf8');
	expect(patches.length).toBe(2);
	for (const patch of patches) expect([...source.matchAll(new RegExp(patch.find, 'g'))].length).toBe(1);
	const transformed = applyPatches(source, steamFile);
	expect(transformed).not.toBe(source);
	expect(transformed).toContain('__sacNativeBridgeV1');
	expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(transformed)).not.toThrow();
});
