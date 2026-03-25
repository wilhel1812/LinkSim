# Getting Started

## Simulations
- A **simulation** is a complete setup of sites, links, and radio/model settings.
- Open an existing simulation from the **Simulation Library** or create a new one.
- Use clear names so teammates can find simulations quickly.

## Sites
- Sites are physical node locations with coordinates, ground elevation, and antenna height.
- Manage your reusable site collection in **Site Library**.
- Add sites by coordinates, map click, search, or Meshtastic MQTT sources.
- Add sites from the library into the current simulation as needed.
- Click on the map to create a temporary site pin, drag to refine position, then use **Save to Library** or **Dismiss**.
- Drag existing sites to test alternative positions instantly, then use **Save Positions** or **Dismiss** to commit or revert.

## Links and Site Selection
- **Select multiple sites** on the map or sidebar using **Ctrl/Cmd+Click** to view a link between them.
- The map overlay automatically adjusts based on your selection:
  - **No selection** — Heatmap (quality overview)
  - **One site** — Pass/Fail (threshold + terrain context)
  - **Two sites** — Relay (best relay-candidate regions)
- To save a link permanently, select two sites and press **Save** in the map inspector.
- Links let you compare multiple candidate paths in one simulation.

## Channel and Model Settings
- **Channel**: frequency, bandwidth, SF, coding rate, TX power, gains, cable loss, environment loss.
- **Propagation model**: FSPL, TwoRay, or ITM (terrain-aware approximation).
- **Terrain**: fetch and refresh terrain before relying on pass/fail decisions.
- **RX target**: your decision threshold; pass/fail is based on this target.

## Map Overlays
- The map can display several overlay modes:

| Overlay | What it shows | What to use it for |
| --- | --- | --- |
| Heatmap | Continuous RX strength estimate (dBm) across sampled area | Quick quality overview and hotspot discovery |
| Contours | Stepped strength zones (grouped levels) | Fast threshold-oriented planning and area segmentation |
| Pass/Fail | Four-state check: green (clear+pass), yellow (blocked+pass), orange (clear+fail), red (blocked+fail) | Clear threshold + terrain context in one view |
| Relay | Best relay-candidate regions for selected From/To pair | Find where a third node could bridge weak links |
| Terrain overlay | Terrain raster used by simulation in current area | Confirm what elevation input the model is actually using |
| Path profile | Elevation profile + link geometry between selected endpoints | Validate LOS/Fresnel context and understand obstructions |

- Basemap providers:
  - **CARTO** is the global baseline and fallback.
  - **MapTiler** and **Stadia** are available when admin-configured API keys are present.
  - **Kartverket** is listed under regional providers and is optional.
  - If a selected provider fails (network/quota/style error), LinkSim auto-falls back to CARTO and shows a warning banner.

- Practical workflow:
  1. Start with **Pass/Fail** for decision clarity.
  2. Switch to **Heatmap/Contours** for quality gradients.
  3. Use **Relay** to locate candidate repeater sites.
  4. Confirm terrain and inspect **Path profile** before finalizing.

## Sharing and Permissions
- Everything is **private by default**. Share simulations and sites with specific users when you're ready to collaborate.
- User roles: **Pending**, **User**, **Moderator**, **Admin**.
- Important: treat all content in LinkSim as potentially visible to other users and operators. Do not store passwords, private keys, API secrets, or other sensitive material in sites/simulations/profile fields.

## Recommended Workflow
1. Open or create a simulation.
2. Add sites from Site Library.
3. Select two sites with Ctrl/Cmd+Click to view a link.
4. Auto-fetch terrain data.
5. Set channel + model, then inspect map + path profile.
6. Save the simulation and share/collaborate as needed.
