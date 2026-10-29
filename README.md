# Steam Advanced Collections

**First public beta — v0.5.1-beta**

Build smarter dynamic collections in Steam, without leaving your library. Steam Advanced Collections adds an **Advanced Filters** panel to Steam's existing dynamic collection editor, powered by [Millennium](https://steambrew.app/).

Combine conditions, exclude games and create nested groups. Your results appear in Steam's own cover grid, alongside the native filtering experience.

[Download the beta](https://github.com/NilsBzH/steam-advanced-collections/releases/tag/v0.5.1-beta) · [Report a bug](https://github.com/NilsBzH/steam-advanced-collections/issues) · [Technical reference](docs/TECHNICAL.md)

## What you can do

- Extend **dynamic collections** with advanced rules. Static collections are untouched.
- Combine Steam's native filters **AND** your advanced expression; Steam's manual additions and exclusions keep their priority.
- Organize conditions into collapsible, nested **AND / OR / NOT** groups.
- Preview edits directly in Steam's native cover grid after a short delay, about 250 ms once the required data is available.
- **Save** rules per collection and Steam account, and restore them automatically after restarting Steam.
- **Cancel**, close the editor or switch collections to discard unsaved changes and restore the saved result. Drafts stay in memory only.
- Refresh saved collections automatically when relevant Steam data changes, with a periodic fallback for missed events.

### Available filters

| Filter | Examples |
| --- | --- |
| **Steam tag** | Include or exclude tags from your library. |
| **Steam Features** | Single-player, Multi-player, Steam Cloud, Steam Achievements and other verified Steam features. |
| **Ownership** | Personally owned or shared through Steam Families. This is a license classification, not proof of purchase. |
| **Installation status** | Installed locally or not installed locally. |
| **Steam library** | A specific Steam library folder. |
| **Playtime** | Total or last two weeks, with comparisons and ranges in hours. |
| **Last Played** | More or less than a number of days, months or years ago; or a range. |
| **Install Size** | Local Steam disk usage, in MB or GB. |
| **Release Date** | Release year before, after or between selected years. |
| **Developer / Publisher** | Exact names, with suggestions from metadata already available in your library. |
| **Steam Reviews** | All-time review percentage or Steam's named review category. |
| **Achievement Progress** | Your unlocked achievement percentage, with comparisons and ranges. |
| **Languages** | Interface, Subtitles or Full Audio support for a selected language. |

Numeric filters offer the comparisons appropriate to each field. Between includes its endpoints; Greater than and Less than are strict. You can exclude individual conditions and entire groups.

Previously saved **Installation Drive** conditions still work, but new conditions use **Steam library**. Existing Steam Category rules also remain compatible with **Steam Features**.

## How groups work

- **AND — All conditions must match:** keep games that satisfy every condition in the group.
- **OR — At least one condition must match:** keep games that satisfy any condition in the group.
- **NOT — Is not, Exclude or Invert group:** exclude an individual match or invert a whole group.

For example: personally owned **AND** (Single-player **OR** Co-op) **AND NOT** completed achievements. Add a group inside another group to express the alternatives exactly where you need them.

Steam's native filters always apply in addition to this expression. Unknown metadata remains unknown even under NOT; it does not become a match just because you exclude a condition.

## Screenshots

Real screenshots will be added here; none are included in this beta yet.

| Planned screenshot | Status |
| --- | --- |
| Advanced Filters inside Steam's dynamic collection editor | Awaiting capture |
| Nested AND / OR groups with an excluded condition | Awaiting capture |
| Live preview in Steam's native cover grid | Awaiting capture |

<!-- Replace the slots above with actual screenshots. Do not use generated or simulated Steam UI images. -->

## Requirements and compatibility

- The **desktop Steam client on Windows** and [Millennium](https://docs.steambrew.app/users/getting-started/installation) installed.
- **Tested with Millennium 3.6.2** and the maintainer's current Steam client. Use a Millennium version supporting Starlight `.star` plugins. Other versions are not guaranteed to work.
- Linux, Steam Deck and Big Picture have **not been validated** for this beta.
- The plugin interface is **English only**.

This is an independent community plugin, not affiliated with Valve or an official Steam feature. This beta is distributed through GitHub only; it has not been submitted to the SteamBrew catalog.

## Manual installation

1. Open the [v0.5.1-beta release](https://github.com/NilsBzH/steam-advanced-collections/releases/tag/v0.5.1-beta) and download **`com.steamadvancedcollections.plugin.star`** from **Assets**. The automatically generated source-code ZIP is not the installable plugin.
2. **Fully exit Steam**, including its system-tray process.
3. Copy the `.star` file into your Steam installation's **`millennium/plugins`** folder. On a typical Windows installation:

   ```text
   C:\Program Files (x86)\Steam\millennium\plugins\com.steamadvancedcollections.plugin.star
   ```

   Use your actual Steam installation folder if it differs. Keep the archive as a `.star` file; do not extract it. When upgrading, replace only the existing archive with this name.
4. Start Steam. Open **Steam → Millennium → Plugins** and enable **Steam Advanced Collections** if it is not already enabled. Restart Steam if Millennium requests it.
5. Open a **dynamic collection**, click its editing gear and find **Advanced Filters** below Steam's native filters. Enable advanced rules, add conditions and click **Save** when satisfied.

The release also provides `SHA256SUMS.txt` to verify the downloaded archive. This first beta archive is **unsigned**; Millennium may identify it as untrusted.

To disable the plugin, use Millennium's plugin settings and restart Steam. Its saved advanced rules remain available if you enable it again. Installation and use do not require editing Steam's internal configuration files.

## Known limitations

- Integration uses internal Steam interfaces. Steam or Millennium updates, other plugins, or missing integration markers may prevent the panel or advanced calculation from loading. The plugin falls back to native Steam behavior when its integration is unavailable.
- Some metadata loads asynchronously. The first preview can take longer than 250 ms; broad filters may need time to load all relevant data. Requests are shared, cached and rate-limited rather than prefetched unconditionally for the entire library.
- Missing or unavailable data is **unknown**, never an assumed zero. An unknown expression retains the existing native Steam result; a collection with no native filters can therefore remain empty until its required data arrives.
- **Achievement Progress:** the 0.5.1 fix loads personal achievements through Steam when the aggregate cache is missing. No achievements differs from 0% and 100%. Comparisons use the unrounded fraction, so Steam's displayed 31% can represent 22/69 ≈ 31.88%. Offline or unavailable personal statistics may remain unknown.
- **Ownership:** Steam Families detection depends on the licenses and family information exposed by Steam. It does not inventory every family member's copies.
- **Installation:** Remote Play-only installations do not count as local. Disconnected libraries and unavailable size data remain unknown. MB/GB use 1024-based units.
- **Other metadata:** developer and publisher names use case-insensitive exact matching; release years depend on available Steam dates; language modes use separate flags and the 32 verified client language IDs. Additional Store-only languages are not offered.

The plugin preserves existing collections and saved rules. It does not directly edit Steam's internal configuration files or call collection Save/AddApps/RemoveApps to apply advanced membership. See the [technical reference](docs/TECHNICAL.md) for data sources, unknown-value behavior and compatibility details.

## Reporting a bug

[Open a GitHub Issue](https://github.com/NilsBzH/steam-advanced-collections/issues/new) with:

- Plugin version, operating system, Steam stable/beta channel and Millennium version.
- Steps to reproduce, the exact conditions/groups, and expected versus actual results.
- An example game and whether the issue occurs in live preview, after Save, or after restarting Steam.
- Relevant screenshots and a short log excerpt, when available. Plugin messages begin with `[SAC]` or `[SAC:POC]`.

Remove account identifiers, personal paths, authentication data and unrelated log content before posting. Do not upload your full Steam or Millennium configuration. If the panel disappears after an update, restart Steam and check the plugin logs before recreating any collections.

## Development

Sources and automated tests are included. The current compiled-UI tests require **Windows**, Bun and Starlight's Windows executable. A local Steam installation enables extra compatibility checks; those checks skip when the client files are absent.

```sh
bun install --frozen-lockfile
bun run prepare
```

Create `.millennium/build` if it does not exist, then run:

```sh
bun test
bun run typecheck
bun run build
bun run build -- --release
```

Builds stay local at `.millennium/build/com.steamadvancedcollections.plugin.star`; they do not install or restart the plugin. Verify an archive with `starlight verify <archive>` using the installed compiler in `node_modules/.bin`. Use the release build for distribution. No account data, caches or dependencies belong in the release asset.

For architecture and data semantics, see [docs/TECHNICAL.md](docs/TECHNICAL.md). For assisted commit attribution, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## AI assistance

Development of Steam Advanced Collections has been assisted by OpenAI Codex. Project direction, feature specifications, testing, and release decisions are managed by the project maintainer.

## License

[MIT](LICENSE).
