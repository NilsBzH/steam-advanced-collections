import { isSavedRules, type SavedRules } from '../rules/model';
import type { SteamObject } from '../diagnostics/runtime';
import type { MembershipBridge } from './membership';

/** One editor's memory-only lease on the existing native calculation bridge.
 * No native event subscription: UpdateAllApps must never schedule itself again.
 */
export class NativePreview {
	private timer?: ReturnType<typeof setTimeout>;
	private disposed = false;
	private active = false;
	private owner = {};
	constructor(
		private bridge: MembershipBridge,
		private collection: SteamObject,
		private account: string,
		private current: () => boolean,
		private onActive: (active: boolean) => void,
		private onDispose: () => void = () => {},
		private delay = 250,
	) {}
	update(value: SavedRules, dirty: boolean): void {
		if (this.disposed) return;
		clearTimeout(this.timer);
		if (!dirty || !isSavedRules(value)) { this.cancel(); return; }
		// Take a detached snapshot now; later React edits cannot change a pending run.
		let snapshot: SavedRules;
		try { snapshot = JSON.parse(JSON.stringify(value)); } catch { this.cancel(); return; }
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (!this.isCurrent()) { this.dispose(); return; }
			const applied = this.bridge.applyPreview(this.collection, this.account, this.owner, snapshot, () => this.isCurrent());
			if (!applied) this.bridge.releasePreview(this.collection, this.owner);
			this.setActive(applied);
		}, this.delay);
	}
	cancel(): void {
		if (this.disposed) return;
		clearTimeout(this.timer); this.timer = undefined;
		this.bridge.releasePreview(this.collection, this.owner);
		this.setActive(false);
	}
	/** Call only after persistence has been verified; saved rules now own the result. */
	commit(): void {
		if (this.disposed) return;
		clearTimeout(this.timer); this.timer = undefined;
		this.bridge.releasePreview(this.collection, this.owner, true);
		this.setActive(false);
	}
	private isCurrent(): boolean { try { return !this.disposed && this.current(); } catch { return false; } }
	private setActive(active: boolean): void {
		if (active === this.active) return;
		this.active = active;
		try { this.onActive(active); } catch { /* React may already be unmounted. */ }
	}
	dispose(restore = true): void {
		if (this.disposed) return;
		this.disposed = true; clearTimeout(this.timer); this.timer = undefined;
		this.bridge.releasePreview(this.collection, this.owner, false, restore);
		this.setActive(false); this.onDispose();
	}
}
