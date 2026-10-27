import { readFileSync } from 'node:fs';

// Read the shipped Lua definitions, including Lua long-string delimiters and RE2 backreferences.
const lua = readFileSync(new URL('../../backend/diagnostic_patch.lua', import.meta.url), 'utf8');
export const patches = [];
for (const [, name, , value] of lua.matchAll(/(file|find|match|replace)\s*=\s*\[(=*)\[([\s\S]*?)\]\2\]/g)) {
	if (name === 'file') patches.push({ file: value, transforms: [] });
	else if (name === 'find') patches.at(-1).find = value;
	else if (name === 'match') patches.at(-1).transforms.push({ match: value });
	else patches.at(-1).transforms.at(-1).replace = value;
}
export function applyPatches(source, filename = 'C:\\Program Files (x86)\\Steam\\steamui\\sp.js') {
	for (const patch of patches) {
		if (!new RegExp(patch.file).test(filename)) continue;
		const match = new RegExp(patch.find).exec(source);
		if (!match) continue;
		let region = match[0];
		for (const transform of patch.transforms) region = region.replace(new RegExp(transform.match, 'g'), transform.replace.replace(/\\(\d+)/g, (_, number) => '$' + number));
		source = source.slice(0, match.index) + region + source.slice(match.index + match[0].length);
	}
	return source;
}

/** Minimal native algorithm with the real source signature and manual-exception ordering. */
export const nativeCollection = 'return class Collection{constructor(filter,apps,staticCollection=false){this.id="test";this.bIsDynamic=!staticCollection;this.bIsEditable=true;this.m_filter=filter;this.all=apps;this.m_setApps=new Set();this.m_setAddedManually=new Set();this.m_setRemovedManually=new Set();this.calls=0}get internalAppFilter(){return this.m_filter}UpdateApps(changed,removed){const result=new Set(this.m_setApps);if(this.m_filter&&!this.m_filter.bIsEmpty){for(let game of changed.filter(item=>item.visible_in_game_list))this.m_filter.Matches(game)?result.add(game.appid):result.delete(game.appid);for(let id of removed)result.delete(id)}else result.clear();this.m_setAddedManually.forEach(id=>result.add(id));this.m_setRemovedManually.forEach(id=>result.delete(id));this.m_setApps=result;this.calls++}UpdateAllApps(){this.UpdateApps(this.all,[])}Save(){throw Error("Native persistence must not be called")}}';
