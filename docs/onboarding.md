# LinkSim Onboarding

## Scenarios
- A **simulation** is a complete setup of sites, links, and radio/model settings.
- Open an existing simulation from **Simulation Library** or create a new one.
- Use clear names so teammates can find simulations quickly.

## Sites
- Sites are physical node locations with coordinates, ground elevation, and antenna height.
- Manage your reusable site collection in **Site Library**.
- Add sites by coordinates, map pick, search, or Meshtastic MQTT sources.
- Add sites from the library into the current simulation as needed.
- Click on the map to create a temporary site pin, drag to refine position, then use **Save to Library** or **Dismiss**.
- Drag existing sites to test alternative positions instantly, then use **Save Positions** or **Dismiss** to commit/revert temporary moves.
- Both sites and simulations can be shared with other users.

## Links
- A link is a **From -> To** path between two sites used for path analysis.
- Links let you compare multiple candidate paths in one simulation.
- Start with the two sites you care about most, then add relay candidate links.

## Other Settings
- **Channel**: frequency, bandwidth, SF, coding rate, TX power, gains, cable loss.
- **Propagation model**: FSPL, TwoRay, or ITM (terrain-aware approximation).
- **Terrain**: fetch and refresh terrain before relying on pass/fail decisions.
- **RX target**: your decision threshold; pass/fail is based on this target.

## Map and Plots
- The map can display several plot/overlay modes. Use them for different questions:

| Plot / Overlay | What it shows | What to use it for |
| --- | --- | --- |
| Heatmap | Continuous RX strength estimate (dBm) across sampled area | Quick quality overview and hotspot discovery |
| Bands (Contours) | Stepped strength zones (same RX model as heatmap, grouped levels) | Fast threshold-oriented planning and area segmentation |
| Pass/Fail | Four-state check: green (clear+pass), yellow (blocked+pass), orange (clear+fail), red (blocked+fail) | Clear threshold + terrain context in one view |
| Relay | Best relay-candidate regions for selected From/To pair | Find where a third node could bridge weak links |
| Terrain overlay | Terrain raster used by simulation in current area | Confirm what elevation input the model is actually using |
| Path profile | Elevation profile + link geometry between selected endpoints | Validate LOS/Fresnel context and understand obstructions |

- Practical workflow:
  1. Start with **Pass/Fail** for decision clarity.
  2. Switch to **Heatmap/Bands** for quality gradients.
  3. Use **Relay** to locate candidate repeater sites.
  4. Confirm terrain and inspect **Path profile** before finalizing.

## User Rights and Permissions
- User roles: **Pending**, **User**, **Moderator**, **Admin**.
- Important: treat all content in LinkSim as potentially visible to other users and operators. Do not store passwords, private keys, API secrets, or other sensitive material in sites/simulations/profile fields.
- Resource visibility:
  - **Private**: only owner/admin can view and edit.
  - **Public**: everyone can view; owner/moderator/admin can edit.
  - **Shared**: everyone can view and edit; only owner/moderator/admin can delete.
- Visibility levels are for collaboration/clutter control, not secret storage guarantees.
- Collaborators grant edit rights on a site or simulation.
- Moderation/admin actions are audited; use least privilege where possible.

## Recommended Workflow
1. Open or create a simulation.
2. Add sites from Site Library.
3. Create links for the paths you want to evaluate.
4. Auto-fetch terrain data.
5. Set channel + model, then inspect map + path profile.
6. Save the simulation and share/collaborate as needed.
