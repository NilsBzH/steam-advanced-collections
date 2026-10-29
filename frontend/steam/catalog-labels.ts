/** Verified against Steam's library.js ELanguage constants and shared English
 * localization, and Steamworks /doc/store/localization/languages (2026-10-29).
 * Do not infer interface/audio/subtitle flags from the overview language bitfield.
 */
export const steamLanguages = [
	'English', 'German', 'French', 'Italian', 'Korean', 'Spanish - Spain',
	'Chinese - Simplified', 'Chinese - Traditional', 'Russian', 'Thai', 'Japanese',
	'Portuguese - Portugal', 'Polish', 'Danish', 'Dutch', 'Finnish', 'Norwegian',
	'Swedish', 'Hungarian', 'Czech', 'Romanian', 'Turkish', 'Portuguese - Brazil',
	'Bulgarian', 'Greek', 'Arabic', 'Ukrainian', 'Spanish - Latin America',
	'Vietnamese', 'SteamChina - Simplified Chinese', 'Indonesian', 'Malay',
] as const;
/** Native SteamReviewScore_1..9 labels, not thresholds inferred from percentages. */
export const steamReviewCategories = [
	'No Review Score', 'Overwhelmingly Negative', 'Very Negative', 'Negative',
	'Mostly Negative', 'Mixed', 'Mostly Positive', 'Positive', 'Very Positive', 'Overwhelmingly Positive',
] as const;

