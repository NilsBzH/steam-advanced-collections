/** Official English Steam feature/category labels, verified 2026-10-29.
 * Sources: https://store.steampowered.com/search/?l=english (category2/3, accessibility)
 * and https://store.steampowered.com/api/appdetails?appids=<id>&filters=categories&l=english
 * for 220, 440, 550, 570, 620, 730, 250820, 413150 and 620980.
 * Per-ID source evidence is retained in tests/fixtures/steam-features-2026-10-29.json.
 * Do not infer names from adjacent IDs or merge distinct IDs with equal labels.
 */
const labels: Readonly<Partial<Record<number, string>>> = {
	1: "Multi-player",
	2: "Single-player",
	8: "Valve Anti-Cheat enabled",
	9: "Co-op",
	13: "Captions available",
	14: "Commentary available",
	15: "Stats",
	16: "Includes Source SDK",
	17: "Includes level editor",
	18: "Partial Controller Support",
	22: "Steam Achievements",
	23: "Steam Cloud",
	24: "Shared/Split Screen",
	25: "Steam Leaderboards",
	27: "Cross-Platform Multiplayer",
	28: "Full controller support",
	29: "Steam Trading Cards",
	30: "Steam Workshop",
	31: "VR Support",
	35: "In-App Purchases",
	36: "Online PvP",
	37: "Shared/Split Screen PvP",
	38: "Online Co-op",
	39: "Shared/Split Screen Co-op",
	40: "SteamVR Collectibles",
	41: "Remote Play on Phone",
	42: "Remote Play on Tablet",
	43: "Remote Play on TV",
	44: "Remote Play Together",
	47: "LAN PvP",
	48: "LAN Co-op",
	49: "PvP",
	50: "Additional High-Quality Audio",
	51: "Steam Workshop",
	52: "Tracked Controller Support",
	54: "VR Only",
	55: "DualShock Controller Support",
	56: "DualShock Controller Support",
	57: "DualSense Controller Support",
	58: "DualSense Controller Support",
	59: "Steam Input API Support",
	61: "HDR available",
	62: "Family Sharing",
	63: "Steam Timeline",
	64: "Adjustable Text Size",
	65: "Subtitle Options",
	66: "Color Alternatives",
	67: "Camera Comfort",
	68: "Custom Volume Controls",
	69: "Stereo Sound",
	70: "Surround Sound",
	71: "Narrated Game Menus",
	72: "Chat Speech-to-text",
	73: "Chat Text-to-speech",
	74: "Playable without Timed Input",
	75: "Keyboard Only Option",
	76: "Mouse Only Option",
	77: "Touch Only Option",
	78: "Adjustable Difficulty",
	79: "Save Anytime",
	80: "Playable at Your Own Pace",
	81: "Playable without Vision",
	82: "Contrast Controls",
};

export function steamFeatureLabel(id: number): string {
	return labels[id] ?? `Unknown Steam feature (ID: ${id})`;
}

/** Keep numeric category IDs unchanged; only their presentation is renamed. */
export function steamFeatureChoices(ids: Iterable<number>): Array<{ value: string; label: string }> {
	return Array.from(new Set(ids)).filter((id) => Number.isSafeInteger(id) && id > 0)
		.map((id) => ({ value: String(id), label: steamFeatureLabel(id) }))
		.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || Number(a.value) - Number(b.value));
}
