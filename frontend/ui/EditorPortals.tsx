import { Component, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { log, type AdvancedCollections } from '../app';
import { accountId } from '../steam/metadata';
import { collectTargets, type EditorTarget } from '../steam/editor-targets';
import { AdvancedFilters } from './AdvancedFilters';

const css = `
.sac-advanced-filters{box-sizing:border-box;width:100%;padding:16px;margin:12px 0;background:rgba(17,27,39,.72);border:1px solid #445568;border-radius:4px;color:#d6d7d8;font-size:14px;text-align:left}
.sac-advanced-filters h3{font-size:16px;margin:0 0 10px;color:#fff;font-weight:600}
.sac-advanced-filters label{display:inline-flex;align-items:center;gap:8px}
.sac-advanced-filters input[type=checkbox]{accent-color:#66c0f4}
.sac-advanced-filters button,.sac-advanced-filters select{font:inherit;background:#2d4053;color:#e5e9ee;border:1px solid #53677a;border-radius:3px;padding:6px 9px;max-width:100%;min-height:32px}
.sac-advanced-filters select{min-width:130px;flex:1}
.sac-advanced-filters button{cursor:pointer;flex:none}
.sac-advanced-filters button:hover:not(:disabled){background:#3d607c}
.sac-advanced-filters :focus-visible{outline:2px solid #66c0f4;outline-offset:2px}
.sac-advanced-filters :disabled{opacity:.5;cursor:default}
.sac-advanced-filters .sac-selected{background:#744e30;border-color:#c49769}
.sac-rule{padding:8px 0}.sac-group{padding:10px;border:1px solid #435367;border-radius:3px;margin:8px 0;background:rgba(255,255,255,.025)}
.sac-rule-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.sac-children{margin:6px 0 8px 12px;padding-left:10px;border-left:2px solid #435367}
.sac-hint{color:#aebdca;font-size:12px;line-height:1.5}.sac-warning{color:#f1c47a}.sac-rule-fieldset{border:0;margin:10px 0;padding:0;min-width:0}
`;

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch() { log('editor.render failed; native editor preserved'); }
	render() { return this.state.failed ? <p className="sac-warning">Advanced Filters is unavailable. Steam’s filters remain active.</p> : this.props.children; }
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
			for (const target of owned.values()) target.root.remove(); owned.clear();
		};
	}, [app]);
	return <><span hidden ref={anchor} />{targets.map((target) => createPortal(
		<PanelBoundary key={`${accountId(app.environment) ?? ''}:${target.id}`}><style>{css}</style><AdvancedFilters app={app} collectionId={target.id} /></PanelBoundary>,
		target.root, target.id,
	))}</>;
}
