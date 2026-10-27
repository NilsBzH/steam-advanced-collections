import { pluginConfig, subscribePluginConfig } from 'millennium';
import type { ConfigPort } from './repository';

/** Starlight prepends the current plugin ID to these calls during compilation.
 * Supplying an explicit ID here shifts the key/value and silently loses the rules.
 */
export function millenniumConfigPort(): ConfigPort {
	return {
		getAll: () => pluginConfig.getAll(),
		// SDK declarations describe the expanded call's string key argument. This is
		// only a type assertion: the scoped value remains a structured JSON object.
		set: (key, value) => pluginConfig.set(key, value as unknown as string),
		subscribe: (callback) => subscribePluginConfig(callback),
	};
}
