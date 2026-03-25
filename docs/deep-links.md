# Deep Links

LinkSim supports shareable deep links that link directly to a specific simulation, optionally with sites or a link pre-selected.

## URL Format

| Scenario | URL Format | Example |
|----------|------------|---------|
| **Simulation only** | `/<simulation>` | `/Blefjell` |
| **Single site** | `/<simulation>/<site>` | `/Blefjell/Fyrisjøen` |
| **Multi-site** | `/<simulation>/<site1>+<site2>+<site3>` | `/Blefjell/Fyrisjøen+HOEG-ROUTER` |
| **Link** | `/<simulation>/<site1>~<site2>` | `/Blefjell/Fyrisjøen~HOEG-ROUTER` |

## Features

### Unicode & Emoji Support
- Unicode characters are preserved in URLs (e.g., `Høgevarde`, `한국조선`)
- Emoji are preserved (e.g., `💩`, `🏝️~🌋`)
- No URL encoding required for special characters

### Case Handling
- URLs preserve original case (e.g., `/Blefjell` not `/blefjell`)
- Matching is case-insensitive using canonical slug comparison

### Delimiters
- **Multi-site selection**: `+` between site names
- **Link selection**: `~` between the two endpoint sites

The `~` delimiter is used instead of `<>` to avoid browser URL encoding issues (`<` and `>` would appear as `%3C` and `%3E` in the address bar).

### Reserved Characters in Names
The following characters are stripped from names when generating URLs:
- `+` (multi-site delimiter)
- `<` `>` (legacy link delimiter)
- `~` (link delimiter)
- `/` (path separator)

## Legacy Format Support

Old-style deep links using query parameters are still supported:

```
?dl=1&sim=sim-123&link=lnk-1
```

When accessed, these links will load the simulation but may not preserve site/link selection (legacy limitation).

## Generating Deep Links

Deep links are automatically generated when using the Share functionality in the app. The appropriate format is chosen based on current selection state.
