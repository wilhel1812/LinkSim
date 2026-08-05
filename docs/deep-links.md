# Deep Links

LinkSim supports shareable deep links that link directly to a specific simulation, optionally with sites or a link pre-selected.

## URL Format

| Scenario | URL Format | Example |
|----------|------------|---------|
| **Simulation only** | `/<username>/<simulation>` | `/Alice/Blefjell` |
| **Single site** | `/<username>/<simulation>/<site>` | `/Alice/Blefjell/Fyrisjøen` |
| **Multi-site** | `/<username>/<simulation>/<site1>+<site2>+<site3>` | `/Alice/Blefjell/Fyrisjøen+HOEG-ROUTER` |
| **Path** | `/<username>/<simulation>/<site1>~<site2>` | `/Alice/Blefjell/Fyrisjøen~HOEG-ROUTER` |

## Names and matching

- Display names are normalized into path segments: surrounding whitespace is removed, internal spaces become hyphens, and reserved delimiter characters are removed.
- Unicode letters are preserved (for example `Høgevarde` or `한국조선`). Browsers may percent-encode Unicode when copying or displaying the URL; LinkSim safely decodes it when reading the link.
- Matching is case-insensitive and Unicode-normalized while the generated URL preserves the display-name case.

Simulation names are resolved inside the owner username namespace, so different users can use the same Simulation name.

### Delimiters
- **Multi-site selection**: `+` between site names
- **Path selection**: `~` between the two endpoint Sites

The `~` delimiter is used instead of `<>` to avoid browser URL encoding issues (`<` and `>` would appear as `%3C` and `%3E` in the address bar).

### Reserved Characters in Names
The following characters are stripped from names when generating URLs:
- `+` (multi-site delimiter)
- `<` `>` (legacy link delimiter)
- `~` (link delimiter)
- `/` (path separator)

## Access behavior

- A deep link does not bypass Simulation visibility or collaborator permissions.
- Broadly accessible Simulations can be opened read-only by guests when the deployment enables guest deep-link mode.
- Private or specifically shared Simulations require a signed-in user with access.
- The Library is not exposed to anonymous deep-link visitors.

## Legacy format support

Old-style deep links using query parameters are still supported:

```
?dl=1&sim=sim-123&link=lnk-1
```

When accessed, these links will load the Simulation but may not preserve Site or Path selection (legacy limitation).

The previous path-only format `/<simulation>` is no longer a valid deep link because path links now require an owner username segment.

## Generate a deep link

Use the Share action in LinkSim. The generated URL follows the current Simulation and Site or Path selection.
