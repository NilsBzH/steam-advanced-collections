# Steam Advanced Collections 0.4.0

An extension of Steam's native dynamic collections for Millennium. The **Advanced Filters** panel appears only when the native dynamic collection editor is open. No separate collection management interface is introduced, and static collections are left untouched.

## Features and Behavior

- Filter games by Steam tags, **Steam Features**, personal ownership or Steam Families, local installation status, and Steam library folder.
- Filter by **Playtime**, **Last Played**, **Install Size**, and **Release Date**, with numeric comparisons and inclusive ranges.
- Build collapsible, nested groups using **All conditions must match** or **At least one condition must match**. Use **Is / Is not** on conditions and **Invert group** to exclude a whole group. Add and remove conditions and groups where they belong, without technical wrapper controls.
- The Steam-inspired panel uses compact selectors, distinct group borders and responsive rows. UI copy is centralized in `frontend/ui/text.ts` for future localization; this version is English only.
- Draft changes temporarily update the open collection's native Steam cover grid. **Save** persists the rules through Millennium's verified configuration path. **Cancel**, closing the editor, or switching collections discards the temporary override and restores saved rules immediately.
- Advanced filters are combined with Steam's native filter predicate using AND. Steam's manual additions and exclusions retain their native priority.
- Rules are stored separately for each Steam account and opaque collection ID, using `rules.v1:*` configuration keys. No internal Steam configuration files are modified directly.
- Steam events trigger deferred recalculation. An installation check every 30 seconds handles potentially missed notifications.

## Playtime, Last Played, Install Size and Release Date — 0.4.0

| Criterion | Operators and input | Client data used |
| --- | --- | --- |
| **Playtime** | Greater than, Less than, Equal to, Between; decimal hours. Select Total or Last two weeks. | App overview `minutes_playtime_forever` and `minutes_playtime_last_two_weeks`. |
| **Last Played** | More than, Less than, Between; whole Days, Months or Years ago. | App overview `rt_last_time_played`, with total minutes to distinguish Steam's never-played state. |
| **Install Size** | Greater than, Less than, Equal to, Between; decimal MB or GB. | Local `SteamClient.InstallFolder.GetInstallFolders()` entries: mounted folder, `vecApps[].nAppID`, and `nUsedSize`, gated by `local_per_client_data.installed`. |
| **Release Date** | Before, After, Between; years 1–9999. | App overview `rt_original_release_date`, falling back to `rt_steam_release_date`, as in Steam's `GetCanonicalReleaseDate()`. |

All four criteria support nested groups, Exclude/NOT, native AND filtering, manual exceptions, live cover-grid preview, Save/Cancel and the existing verified per-account persistence. Existing rules and their `rules.v1:*` keys are unchanged. Save verification and draft conflict detection include the comparison, upper bound, unit and playtime period. Empty, negative, non-finite, reversed or otherwise invalid inputs cannot be saved or previewed; no invalid value is silently changed to zero.

**Comparison boundaries:** Greater/More than, Less than, Before and After are strict. Between includes both endpoints. Equality compares the actual reported quantity without rounding. Steam reports whole playtime minutes; a decimal hour threshold does not add sub-minute precision. MB and GB use 1024² and 1024³ bytes, matching Steam's library size grouping.

**Calendar rules:** Last Played subtracts UTC calendar periods from the current evaluation time. Month/year subtraction clamps the day at the end of the target month (March 31 minus one month is February 28/29; February 29 minus one year is February 28). UTC avoids daylight-saving ambiguities. Release Date compares the UTC year of the supplied canonical release timestamp; it does not invent a release date or substitute an installation/purchase date.

**Unknown data:** A reported zero playtime is valid; a missing counter is unknown. Only an explicit last-played timestamp of zero together with zero total minutes is treated as Steam's never-played state. Never-played games do not match a last-session interval; applying Exclude includes that known state. Missing, contradictory or unusable history stays unknown, including under NOT. Positive last-session timestamps in the future are treated as unknown. As with earlier versions, an unknown advanced result retains the existing native Steam fallback.

Install Size means the usage Steam reports in its local storage manager, including the associated components counted by that manager; no filesystem scan or download-size estimate is used. Uninstalled games, Remote Play-only installations, unavailable storage data, disconnected libraries and invalid/lossy size counters have **unknown** installed size, never an assumed zero. Combine this criterion with **Installation status Is Installed locally** if uninstalled games should be excluded explicitly. A locally installed game with an explicitly reported zero-byte usage remains a real zero.

**Updates and limitations:** These fields and units were checked against the installed client's `steamui/sp.js` app-overview schema, canonical-date methods and storage-manager usage. No external API, Store request, per-game backend call or new dependency is introduced. The adapter reads the metadata Steam has already loaded; missing metadata and offline/stale client statistics remain limitations. Playtime precision and original-release-date availability depend on Steam. Installation changes and moves refresh the existing folder snapshot; the existing 30-second fallback also re-evaluates relative dates without Steam events. There is no new preview refresh loop.

## Steam Features and Legacy Drive Rules — 0.3.2

**Steam Features** replaces the old **Steam category** label. Available features use verified official English names (for example, Single-player, Multi-player, Steam Cloud and Steam Achievements), sorted alphabetically. The catalog still uses the numeric `store_category` IDs internally, and saved `category` conditions need no migration. A saved selection absent from today's library catalog still displays its verified name. Unconfirmed IDs are labeled **Unknown Steam feature (ID: …)** rather than assigned a guessed meaning. Distinct IDs remain distinct even when Steam uses the same official label for them.

The bundled mapping contains 63 verified ID/name associations, checked on **2026-10-29** against Steam's [English search filters](https://store.steampowered.com/search/?l=english) and official Store `appdetails` responses, including [Portal 2](https://store.steampowered.com/api/appdetails?appids=620&filters=categories&l=english) and [Dota 2](https://store.steampowered.com/api/appdetails?appids=570&filters=categories&l=english). API `categories[].description` is authoritative where available; remaining verified labels come from the search page's category/player/accessibility filters. Controller-search labels are not assumed to equal category labels (notably ID 18). Per-ID source evidence is recorded in [the test fixture](tests/fixtures/steam-features-2026-10-29.json). Names are bundled locally; the plugin makes no new Store network requests at runtime. Future or undocumented IDs keep the explicit fallback until verified.

**Installation Drive** is no longer offered for new conditions. **Steam library** is the location criterion for new filters. Existing `drive` conditions continue to evaluate, preview, persist and restore unchanged. Their editor row remains visible as **Installation Drive (legacy)** and can be removed or manually converted to another criterion. Opening the editor never replaces or deletes an old rule automatically.

## Live Preview

After a **250 ms debounce**, a valid draft temporarily overrides the advanced rules consulted by the existing membership bridge for the exact open collection object and Steam account. Only that collection's native `UpdateAllApps` method is requested. Steam updates its own cover grid; there is no parallel grid, text list, estimated count, or separate full-library preview scan. A discreet **Live preview** indicator appears while a temporary override is active.

Steam's native filter remains combined with the advanced expression using AND. Its original calculation still applies manual additions and removals in their native order. Unknown metadata keeps the existing three-valued fallback. Native filter changes naturally use the active draft through the same bridge; the preview does not observe `UpdateApps` or schedule a recalculation from a recalculation event.

Drafts exist **only in memory**. Previewing never writes Millennium configuration or invokes native `Save`, `AddApps`, or `RemoveApps`. **Save** verifies persistent storage before releasing the override and retaining the saved result. **Cancel** restores saved membership synchronously. Editor removal releases the draft before the React portal is removed; changing collections also disposes the previous editor's timer and override. Account changes, replaced collection objects, plugin unload, and Steam restarts cannot reuse a temporary draft. An incomplete condition cancels the active preview until the draft is valid again.

Each settled edit requests one targeted recalculation. Rendering, collapsing groups and unchanged runtime notifications do not schedule preview work. Pending timers are cancelled on edits and cleanup. Existing library/install event handling and its 30-second fallback remain available for automatic saved-collection updates. No new source patches or dependencies were added.

Live preview requires the existing native bridge marker and initialized native filter/exception fields. If those APIs are unavailable, no temporary calculation is attempted; native behavior and saved data are preserved. As before, Steam's internal API compatibility and the availability of ownership/install metadata remain limitations.

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

- `frontend/rules/`: Validated rule model, pure three-valued evaluation, per-collection persistence, and isolated draft sessions. The evaluator is iterative and independent of React and Steam. Nesting has no new business depth limit; existing configuration size and validation safeguards still apply.
- `frontend/steam/`: Metadata adaptation, editor targeting, native membership bridge, and memory-only preview leases with debounced targeted recalculation.
- `frontend/ui/`: Visual rule editor, live-preview indicator, centralized English copy, scoped styles, and React portals mounted inside marked native collection editors.
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

Tag names are provided by Steam. Steam feature names use the verified bundled mapping described above; unconfirmed IDs have an explicit unknown label.

Millennium imposes limits on the number and size of configuration values. Save errors are displayed without deleting existing rules to free storage space.

Unknown configuration formats are preserved and cannot be overwritten by this editor.

Changes to Steam's internal APIs or conflicts with other plugins may make integration markers unavailable.

In such cases, native Steam filtering remains operational, and the panel reports that the membership bridge is unavailable.

If the panel disappears following an update, check the logs and restart Steam rather than recreating collections.

## Testing in Steam

1. Open a dynamic collection and click its gear icon. The **Advanced Filters** panel should appear below the native filters. Close the editor or open a static collection to verify that the panel disappears.
2. Change a known condition with advanced rules enabled. After about 250 ms, **Live preview** should appear and the native cover grid should change. Click **Cancel**: the original covers and saved rules must return immediately. Repeat an edit, then close the editor or switch collections to verify the same restoration.
3. Repeat a known edit and click **Save**. The displayed result should remain and the rule should persist on reopening. Native filters and manual exceptions retain their priority. Disable advanced rules and click **Save** to restore native filtering behavior.
4. Restart Steam to verify persistence. Installation or library changes can then be tested when desired.

Functional log messages begin with `[SAC]`, while preserved diagnostic messages begin with `[SAC:POC]`.

`editor.portal mounted` confirms that the panel was mounted successfully.

`membership.hook observed` confirms that the native membership bridge was executed.

Automated tests cover the rule engine, compiled persistence adapter, startup restoration, metadata, editor targeting, transformations against actual Steam client code, and simulated native membership calculations. They also cover compiled JSX interactions, Save/Cancel conflicts, temporary native membership, closing and switching editors, exact account/object isolation, no draft persistence, plugin unload/restart, missing APIs, manual exceptions, unknown metadata, debounce cancellation and the absence of recalculation loops. Feature-label tests verify official source associations, alphabetical sorting, unknown and saved-but-unlisted IDs, numeric category compatibility, and continued support for legacy drive rules without exposing them as new criteria. Measurement tests cover strict and inclusive operators, exact zeros, hour/byte conversions, two-week counters, missing/uninstalled data, UTC month-end/leap-year boundaries, the evaluation clock, periodic re-evaluation without events, numeric editor controls, and verified restoration of all new condition properties.

Activating and persisting rules on actual user collections remains an explicit manual verification step.
