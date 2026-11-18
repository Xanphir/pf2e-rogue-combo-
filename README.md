# PF2e Rogue Combo Points

A homebrew Foundry VTT module for the Pathfinder 2e system (built for Foundry v13).

## Rules
- A Rogue earns 1 combo point (max 2) the first time each round they successfully Strike an off-guard target during combat.
- Eviscerate: spend 1 or 2 points to add +1d6 precision damage per point spent to the next Strike. The bonus ends when Strike damage is rolled.
- Points and any unused Eviscerate clear when the combat is deleted.

## What it adds
- Diamond pips above a Rogue's token showing combo points.
- A "Combo points" bar on the character sheet with Eviscerate buttons.
- A side panel (Alt+K) with the same controls, plus -1 / +1 for the GM.
- "Combo Points" and "Eviscerate" action items added automatically to each Rogue's sheet.

A GM must be logged in: the GM's client awards points and adds the sheet items.

## Install
1. In Foundry's setup screen open Add-on Modules, then Install Module.
2. Paste this into Manifest URL (replace the placeholders) and click Install:
   `https://github.com/YOUR-USERNAME/YOUR-REPO/releases/latest/download/module.json`
3. Enable the module in your Pathfinder 2e world under Manage Modules.

Characters with the Rogue class are tracked automatically. Track any other character by selecting the token and running:
`game.modules.get("pf2e-rogue-combo").api.toggleEnabled(canvas.tokens.controlled[0].actor)`

## Release a new version
1. Commit your changes to the repo.
2. On GitHub: Releases > Draft a new release > create a tag such as `v0.2.1` > Publish release.
3. The Release workflow (Actions tab) attaches `module.json` and `module.zip` within about a minute.
4. In Foundry: Add-on Modules > Check For Updates > Update, then reload the world.

The repo must be public for Foundry to download the release.

## Troubleshooting
Turn on "Debug logging" in the module settings and check the browser console (F12) for lines starting `pf2e-rogue-combo |`.
