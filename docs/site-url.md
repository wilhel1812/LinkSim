# Create a Site from a URL

Open a LinkSim URL like
`https://linksim.link/?site=1&lat=60.12&lon=10.34&name=Hill%20Relay&source=868.no`.
It opens a temporary one-Site Simulation. The URL provides the Site data, so
the sender can use any data source. Use URL encoding for each parameter value.

| Parameter | Meaning and default |
| --- | --- |
| `site` | Required. Use `1` for this format. |
| `lat`, `lon` | Required WGS 84 decimal degrees, within ±90 and ±180. |
| `name`, `description` | Site name and notes. The default name is Imported Site. |
| `groundElevationM` | Metres above sea level. When omitted, LinkSim samples terrain when available and uses 0 m until then. |
| `antennaHeightM` | Metres above ground. Defaults to 2 m. |
| `txPowerDbm`, `txGainDbi`, `rxGainDbi`, `cableLossDb` | Defaults are 22 dBm, 2 dBi, 2 dBi, and 1 dB. |
| `antennaMode` | `omnidirectional` (default) or `directional`. |
| `antennaAzimuthDeg`, `antennaTiltDeg` | Defaults to 0° for both. Ranges are 0°–360° and −90°–90°. |
| `antennaHorizontalBeamwidthDeg`, `antennaVerticalBeamwidthDeg` | Each accepts 1°–180°. Defaults to 60° and 30°. |
| `antennaMaxAttenuationDb` | Accepts 0–60 dB. Defaults to 25 dB. |
| `iconKey` | Any [Site icon key](../src/lib/siteIcons.ts). Omit for automatic selection. |
| `iconColor` | Simulation icon color as three or six hexadecimal digits preceded by `#`. Encode the hash as `%23`. |
| `source`, `sourceUrl` | Caller-supplied attribution label and absolute HTTPS link. If only the link is provided, its hostname becomes the label. |

All fields after longitude are optional. Use finite decimal numbers and
nonnegative antenna height and cable loss. LinkSim rejects repeated supported
parameters and invalid supplied values. It ignores unknown parameters.

Guests can edit the Site and calculate coverage. Signed-in users can explicitly
save a Library copy with the source attribution. Reloading restores the URL
values and defaults. Moving the Site samples terrain at the new coordinates
when available. A manually entered elevation takes precedence for those
coordinates. If terrain is unavailable, LinkSim retains the previous elevation.

To integrate an external map, build the query with `URLSearchParams` from the
selected location. Supply coordinates, the name if known, and optional
attribution. Test with the corresponding staging URL before using the production
host in the map action.

When changing Site fields, defaults, validation, save behavior, or the URL
parser, review this contract and its tests together.
