import { log, type AdvancedCollections } from '../app';
import { isDynamicEditor } from '../diagnostics/runtime';

export interface EditorTarget { editor: HTMLElement; root: HTMLElement; id: string }

export function isOpenEditor(editor: HTMLElement, id: string): boolean {
	return editor.isConnected && editor.getAttribute('data-sac-editor-open') === 'true' && editor.getAttribute('data-sac-collection-id') === id;
}

function removeTarget(app: AdvancedCollections, target: EditorTarget): void {
	// Restore before removing the portal, without waiting for a passive React effect.
	app.closePreview?.(target.editor);
	target.root.remove();
}

/** Only explicit markers on editable dynamic collections can receive a portal. */
export function collectTargets(document: Document, app: AdvancedCollections, owned: Map<HTMLElement, EditorTarget>): EditorTarget[] {
	const live = new Set<HTMLElement>();
	for (const element of document.querySelectorAll<HTMLElement>('[data-sac-editor-open="true"][data-sac-collection-id]')) {
		const id = element.getAttribute('data-sac-collection-id');
		if (!id) continue;
		let collection;
		try { collection = app.environment.collectionStore?.GetCollection?.(id); } catch { continue; }
		if (!isDynamicEditor(collection, true)) continue;
		live.add(element);
		let target = owned.get(element);
		if (target && (target.root.parentNode !== element || target.id !== id)) { removeTarget(app, target); owned.delete(element); target = undefined; }
		if (!target && !element.querySelector('[data-sac-root]')) {
			const root = document.createElement('div');
			root.setAttribute('data-sac-root', 'advanced-filters');
			root.style.width = '100%'; root.style.flexBasis = '100%';
			element.appendChild(root);
			target = { editor: element, root, id }; owned.set(element, target);
			log('editor.portal mounted');
		}
	}
	for (const [editor, target] of owned) if (!live.has(editor)) { removeTarget(app, target); owned.delete(editor); log('editor.portal removed'); }
	return Array.from(owned.values());
}
