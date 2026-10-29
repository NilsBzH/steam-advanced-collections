import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { RuleRepository, ruleKey } from '../frontend/rules/repository';

// Exercise the real compiler's namespace injection. Mocking ConfigPort alone
// missed the 0.2.0 bug because the source calls acquired an extra argument.
test('compiled Millennium configuration adapter persists rules across a cold reload', async () => {
	const root = resolve(import.meta.dir, '..');
	const directory = mkdtempSync(join(root, '.millennium', 'persistence-test-'));
	const plugin = 'com.sac.persistence-regression';
	const account = '76561198111189155', collection = 'uc-fztprRujSoR1';
	const rules = { version: 1, enabled: true, expression: { type: 'group', operator: 'and', children: [{ type: 'condition', field: 'tag', value: 10 }, { type: 'not', child: { type: 'condition', field: 'ownership', value: 'family' } }] } };
	rules.expression.children.push(
		{ type: 'condition', field: 'playtime', comparison: 'between', value: 2.5, upper: 20, period: 'twoWeeks' },
		{ type: 'condition', field: 'lastPlayed', comparison: 'gt', value: 6, unit: 'months' },
		{ type: 'condition', field: 'installSize', comparison: 'between', value: 5, upper: 20, unit: 'GB' },
		{ type: 'condition', field: 'releaseDate', comparison: 'between', value: 2000, upper: 2010 },
		{ type: 'condition', field: 'developer', value: 'FromSoftware' },
		{ type: 'condition', field: 'publisher', value: 'SEGA' },
		{ type: 'condition', field: 'reviews', mode: 'score', comparison: 'between', value: 75.5, upper: 100 },
		{ type: 'condition', field: 'reviews', mode: 'category', value: 8 },
		{ type: 'condition', field: 'achievementProgress', comparison: 'eq', value: 0 },
		{ type: 'condition', field: 'language', support: 'audio', value: 2 },
	);
	const diskPath = join(directory, 'millennium-config.json');
	let first, restored;
	try {
		mkdirSync(join(directory, 'output'));
		writeFileSync(join(directory, 'millennium.toml'), `[plugin]\nid = "${plugin}"\nname = "Persistence regression"\nversion = "1.0.0"\nauthor = "test"\n[frontend]\nentry = "entry.ts"\n[assets]\nresources = []\n`);
		writeFileSync(join(directory, 'entry.ts'), `import { millenniumConfigPort } from ${JSON.stringify(join(root, 'frontend/rules/millennium-config.ts').replaceAll('\\', '/'))};\nexport default function() { return millenniumConfigPort(); }\n`);
		const compiler = join(root, 'node_modules/.bin/starlight.exe');
		const run = (args) => {
			const result = Bun.spawnSync([compiler, ...args], { cwd: root });
			if (result.exitCode !== 0) throw Error(result.stdout.toString() + result.stderr.toString());
			return result.stdout.toString();
		};
		run(['--dir', directory, '--of', join(directory, 'output'), 'pack']);
		const bundle = run(['--if', join(directory, 'output', `${plugin}.star`), '--query', 'frontend:bundle.js']);
		writeFileSync(diskPath, JSON.stringify({ plugins: { [plugin]: { config: { unrelated: 'preserve' } } } }));
		const subscriptions = [];
		function coldAdapter() {
			const api = {
				pluginConfig: {
					async getAll(...args) { expect(args).toEqual([plugin]); return JSON.parse(readFileSync(diskPath, 'utf8')).plugins[plugin].config; },
					async set(...args) {
						expect(args.length).toBe(3); expect(args[0]).toBe(plugin);
						const disk = JSON.parse(readFileSync(diskPath, 'utf8'));
						disk.plugins[args[0]].config[args[1]] = args[2];
						writeFileSync(diskPath, JSON.stringify(disk));
					},
				},
				subscribePluginConfig(...args) { expect(args.length).toBe(2); expect(args[0]).toBe(plugin); expect(typeof args[1]).toBe('function'); subscriptions.push(args[1]); return () => {}; },
			};
			const window = { MILLENNIUM_API: api, PLUGIN_LIST: {}, MILLENNIUM_BACKEND_IPC: { postMessage() {} } };
			runInNewContext(bundle, { window, console, MILLENNIUM_BACKEND_IPC: window.MILLENNIUM_BACKEND_IPC });
			return window.PLUGIN_LIST[plugin].default();
		}
		first = new RuleRepository(coldAdapter()); await first.load();
		await first.save(account, collection, rules); first.dispose();
		restored = new RuleRepository(coldAdapter()); await restored.load();
		expect(restored.get(account, collection)).toEqual(rules);
		expect(restored.get('76561198111189156', collection)).toBeUndefined();
		expect(JSON.parse(readFileSync(diskPath, 'utf8')).plugins[plugin].config.unrelated).toBe('preserve');
		expect(restored.count(account)).toBe(1);
		// The compiled callback must also receive live changes in the right namespace.
		subscriptions.at(-1)(ruleKey(account, collection), { ...rules, enabled: false });
		expect(restored.get(account, collection).enabled).toBe(false);
	} finally {
		first?.dispose(); restored?.dispose();
		// Only the exact directory created by this test, within the project, is removed.
		rmSync(directory, { recursive: true, force: true });
	}
}, 20000);
