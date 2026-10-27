# Steam Advanced Collections

An extension of Steam's native dynamic collections for Millennium. The **Advanced Filters** panel appears only when the native dynamic collection editor is open. No separate collection management interface is introduced, and static collections are left untouched.

## Features and Behavior

- Filter games by Steam tags, categories, personal ownership or Steam Families, local installation status, Steam library folder, and Windows drive.
- Create nested AND / OR condition groups and apply NOT negation to individual conditions or entire groups.
- Draft changes never affect the collection. **Save** persists the rules for the current collection through Millennium's configuration system and triggers native membership recalculation. **Cancel** discards the draft.
- Advanced filters are combined with Steam's native filter predicate using AND. Steam's manual additions and exclusions retain their native priority.
- Rules are stored separately for each Steam account and opaque collection ID, using `rules.v1:*` configuration keys. No internal Steam configuration files are modified directly.
- Steam events trigger deferred recalculation. An installation check every 30 seconds handles potentially missed notifications.

## Development and Building

Millennium >= 3.4.0 and Bun are required. Integration has been verified against the installed Steam client's JavaScript using Millennium 3.6.2. Steam's internal interfaces may change independently of Millennium.

```sh
bun install
bun test
bun run typecheck
bun run build
```

The compiled archive is generated at `.millennium/build/com.steamadvancedcollections.plugin.star`.

Builds are local only: compiling the plugin does not install it or restart Steam. The output directory must exist (`mkdir .millennium/build` if necessary).

Use `starlight verify <archive>` to validate the generated package.

To install a new build, close Steam, replace only the plugin archive in the `millennium/plugins` directory, then launch Steam and enable the plugin. A full restart is required to reload both JavaScript integration points.

## Persistence — Version 0.2.1 Fix

Configuration calls use the plugin context injected by Starlight. Each saved configuration is read back from Millennium before success is confirmed.

At startup, rules are loaded independently of the editor. The plugin waits for the Steam account and collection objects to become available before recalculating native collection membership. Initial configuration errors are automatically retried.

The `[SAC] rules.restored` log entry reports the number of rules loaded for the current account and the number of collections recalculated.

Version 0.2.0 could incorrectly save the configuration key name instead of its associated rule expression because the plugin identifier was passed twice. Expressions missing from persistent storage cannot be recovered and must be entered again. Existing data is preserved.

The regression test compiles the actual configuration adapter using Starlight, saves data to disk, and restores it in a new context.

Startup tests cover delayed account and collection availability, collection object replacement, and initially unavailable configuration.

## Architecture

- `frontend/rules/`: Validated rule model, pure three-valued evaluation, and per-collection persistence. The evaluator is iterative and independent of React and Steam.
- `frontend/steam/`: Metadata adaptation, collection editor targeting, and native membership bridge.
- `frontend/ui/`: Visual rule editor and React portals mounted inside marked native collection editors.
- `frontend/diagnostics/`: Preserved proof-of-concept diagnostics.
- `backend/diagnostic_patch.lua`: Two scoped transformations of the served JavaScript, without modifying Steam files. The first marks the editor; the second extends the existing membership calculation. The selector supports both Windows and POSIX path separators.

The membership bridge requires the `__sacNativeBridgeV1` marker, injected alongside the predicate, before requesting any recalculation.

It preserves native method calls, manual membership exceptions, and Steam's collection counters.

It never calls `Save`, `AddApps`, `RemoveApps`, or `FreezeToStatic`.

When the plugin is disabled, supported collections return to their native filtering behavior while advanced rules remain saved.

## Metadata and Compatibility

A missing value is distinct from an unknown value. Applying NOT to unknown metadata still produces an unknown result.

When evaluation produces an unknown result, native Steam filtering behavior is preserved. No personal or family ownership information is invented.

Ownership classification relies on license signals available from the Steam client and the lender's membership in the family group. It does not prove that a game was purchased, nor does it provide an exhaustive inventory of copies owned by every family member.

Remote Play installations are not considered local installations.

A disconnected drive produces an unknown installation location.

Physical Linux drives are not inferred from filesystem paths, although their Steam library folders remain available for filtering.

Tag names are provided by Steam. Categories are currently displayed using their identifiers.

Millennium imposes limits on the number and size of configuration values. Save errors are displayed without deleting existing rules to free storage space.

Unknown configuration formats are preserved and cannot be overwritten by this editor.

Changes to Steam's internal APIs or conflicts with other plugins may make integration markers unavailable.

In such cases, native Steam filtering remains operational, and the panel reports that the membership bridge is unavailable.

If the panel disappears following an update, check the logs and restart Steam rather than recreating collections.

## Testing in Steam

1. Open a dynamic collection and click its gear icon. The **Advanced Filters** panel should appear below the native filters. Close the editor or open a static collection to verify that the panel disappears.
2. Add a condition or group, toggle NOT, then click **Cancel** to verify that draft changes are discarded without modifying saved rules.
3. To test actual filtering, choose a known condition, enable advanced rules, and click **Save**. Verify the resulting games, native filters, and manual membership exceptions. Disable advanced rules and click **Save** to restore native filtering behavior.
4. Restart Steam to verify persistence. Installation or library changes can then be tested when desired.

Functional log messages begin with `[SAC]`, while preserved diagnostic messages begin with `[SAC:POC]`.

`editor.portal mounted` confirms that the panel was mounted successfully.

`membership.hook observed` confirms that the native membership bridge was executed.

Automated tests cover the rule engine, persistence, metadata, editor targeting, transformations against actual Steam client code, and simulated native membership calculations.

Activating and persisting rules on actual user collections remains an explicit manual verification step.
