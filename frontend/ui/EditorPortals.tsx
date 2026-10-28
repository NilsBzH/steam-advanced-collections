import { Component, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { log, type AdvancedCollections } from '../app';
import { accountId } from '../steam/metadata';
import { collectTargets, type EditorTarget } from '../steam/editor-targets';
import { AdvancedFilters } from './AdvancedFilters';
import { css } from './styles';
import { text } from './text';

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch() { log('editor.render failed; native editor preserved'); }
	render() { return this.state.failed ? <p className="sac-warning">{text.panelFailed}</p> : this.props.children; }
}

export function EditorPortals({ app }: { app: AdvancedCollections }) {
	const anchor = useRef<HTMLSpanElement>(null);
	const [targets, setTargets] = useState<EditorTarget[]>([]);
	const [, render] = useState(0);
	useLayoutEffect(() => {
		const document = anchor.current?.ownerDocument;
		if (!document?.documentElement) return undefined;
		const owned = new Map<HTMLElement, EditorTarget>();
		let active = true;
		const scan = () => {
			if (!active) return;
			try {
				const next = collectTargets(document, app, owned);
				setTargets((previous) => previous.length === next.length && previous.every((target, index) => target === next[index]) ? previous : next);
			} catch { log('editor.target scan failed'); }
		};
		const Observer = document.defaultView?.MutationObserver ?? MutationObserver;
		const observer = new Observer(scan);
		observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sac-editor-open', 'data-sac-collection-id'] });
		const unsubscribe = app.subscribe(() => { scan(); render((value) => value + 1); });
		scan(); log('editor.marker observer ready');
		return () => {
			active = false; observer.disconnect(); unsubscribe();
			for (const target of owned.values()) { app.closePreview(target.editor); target.root.remove(); } owned.clear();
		};
	}, [app]);
	return <><span hidden ref={anchor} />{targets.map((target) => createPortal(
		<PanelBoundary key={`${accountId(app.environment) ?? ''}:${target.id}`}><style>{css}</style><AdvancedFilters app={app} collectionId={target.id} editor={target.editor} /></PanelBoundary>,
		target.root, target.id,
	))}</>;
}
