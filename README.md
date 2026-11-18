# StreeFight

An original retro-style 2D fighting game. Everything is generated at runtime — pixel art is drawn in code on a 384x216 buffer, sound is synthesized with WebAudio — so there are no asset files and no network access. Packaged with Electron as a Windows 11 installer.

## Game

- 1P vs CPU (Easy / Normal / Hard) or local 2P versus
- Best of three rounds, 60 seconds each
- Hold back (away from the opponent) to block; crouch or jump to avoid projectiles
- Specials cost 35 energy; landing or taking hits builds energy
- Combos: a landed punch cancels into a kick, and any landed normal cancels into a special

| Action | P1 | P2 |
| --- | --- | --- |
| Move | A / D | Left / Right |
| Jump / Crouch | W / S | Up / Down |
| Punch | J | `,` or Numpad 1 |
| Kick | K | `.` or Numpad 2 |
| Special | L, or Down, Down+Forward, Forward + Punch | `/` or Numpad 3, or the same motion |

Esc pauses, M toggles music, F11 toggles fullscreen.

## Windows 11 installers

Pushing to `main` or pushing a `v*` tag runs GitHub Actions and builds three installers:

| File | For |
| --- | --- |
| `StreeFight Setup 1.0.0-x64.exe` (name contains x64) | Intel / AMD 64-bit |
| `StreeFight Setup 1.0.0-arm64.exe` (name contains arm64) | ARM64 (e.g. Snapdragon X) |
| `StreeFight Setup 1.0.0.exe` | Universal: contains both, picks the right one at install time |

- Push to `main`: download from the run's Artifacts on the Actions page
- Push a tag (`git tag v1.0.0 && git push --tags`): installers are attached to the Release

The installers are not code-signed, so Windows SmartScreen will warn on first run: choose "More info" then "Run anyway".

## Development

```bash
npm install
npm start          # run the game
npm run dist       # build all installers on Windows, output in dist/
```

You can also open `src/index.html` directly in a browser.
