# Getting Started

LinkSim plans terrain-aware radio coverage and Paths between reusable Sites. Work is organized in Simulations, and signed-in users can sync and share their Library resources.

## 1. Choose or create a Simulation

- A **Simulation** contains its Sites, saved Paths, radio settings, map state, and calculation settings.
- Open an existing Simulation from the **Simulation Library**, or choose **Create New Simulation** from the welcome screen.
- The Library keeps search visible. Use **Filter and sort** to narrow Simulations by your role or visibility and to sort by name or recent activity.
- Simulations are private by default. Use a clear name before sharing one with collaborators.

## 2. Add Sites

- A **Site** is a physical node location with coordinates, ground elevation, antenna height, and radio values.
- Browse reusable Sites in the **Site Library**. Search and filters work independently in the Sites and Simulations sections.
- Add one or several Library Sites to the current Simulation. On desktop, bulk selection applies to the filtered Site results.
- You can also add a Site from coordinates, map search, a map click, or a visible Meshtastic MQTT source.
- A map click creates a temporary Site pin. Drag it to refine the location, then choose **Save to Library** or **Dismiss**.
- Drag existing Simulation Sites to compare positions, then choose **Save Positions** or **Dismiss** to commit or revert the move.

## 3. Select Sites and inspect a Path

- Select multiple Sites on the map or in the sidebar with **{{MODIFIER}}+Click**.
- One selected Site makes single-Site analysis such as Pass/Fail and Panorama available. Two selected Sites make their Path, Path profile, and Relay analysis available.
- Select two Sites and choose **Save** in the Inspector to keep the Path in the Simulation.
- The browser address follows the active Simulation and Site selection, so the Share action can copy a deep link to the same view.

## 4. Set the Channel and calculation area

- Channel settings include the frequency plan, bandwidth, spreading factor, coding rate, TX power, antenna gains, cable loss, and environment loss. A Site antenna can be omnidirectional or directional; directional Sites add azimuth, up/down tilt, horizontal and vertical beamwidth, and a maximum off-axis attenuation. They can also track another Site as their pointing target.
- LinkSim uses ITM for terrain-aware propagation. FSPL may appear in results as a reference value; it is not a selectable propagation model.
- The **RX target** is the signal threshold used by Pass/Fail and target-line displays.
- Choose the Simulation Resolution and Radius deliberately. Larger areas and higher resolutions require more terrain and calculation time.
- LinkSim fetches Copernicus GLO-30 terrain for the selected area. A Simulation result is not calculated from a partial terrain set: if required terrain is unavailable, LinkSim clears the stale overlay and reports the problem.
- Automatic calculation is convenient for normal work. For expensive settings, use **Start** for a deliberate one-shot run or **Stop** to cancel current terrain and calculation work.

## 5. Choose an overlay or detailed view

The available Simulation Overlay follows the current Site selection. You can switch among the compatible modes in the Inspector.

| Overlay | What it shows | What to use it for |
| --- | --- | --- |
| Heatmap | Strongest predicted Site signal across the selected area | Get a general coverage overview |
| Weakest Site | Weakest signal from each point to any applicable Site | Find locations that must reach every Site |
| Heatmap + Target Line | Heatmap plus the boundary where signal crosses the RX target | See coverage shape and the pass/fail edge together |
| Pass/Fail | Clear/blocked and above/below-target states for one selected Site | Make a terrain-aware go/no-go check |
| Relay | Candidate quality between two selected Sites | Find where a third node could bridge a weak Path |
| Mesh Extension | Bidirectionally connected candidate areas that add terrain coverage | Place a new node that extends the existing mesh |
| Terrain | Copernicus terrain shading for the current area | Confirm the terrain used by the Simulation |

Use the **Path profile** for terrain, line-of-sight, and Fresnel context between two Sites. Use **Panorama** for a terrain-clipped 360-degree view from one Site.

## 6. Save, share, and collaborate

- Simulations and Sites are private by default. Their access settings are independent: a private Site can remain private when referenced by a shared Simulation.
- Share with specific users as viewer or editor, or use the broader visibility options when the resource is intended for wider access.
- Viewers can inspect shared work without editing it. Owners and editors can save permitted changes.
- Library visibility and roles are collaboration controls, not a place to store secrets.
- Cloud sync runs in the background while signed in. The account toolbar shows pending, syncing, offline, and current states.
