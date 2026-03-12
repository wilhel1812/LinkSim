# LinkSim Onboarding

## 1. Scenarios
- A **simulation** is your working setup: selected sites, links, and radio/model settings.
- Open an existing simulation from **Simulation Library** or create a new one.
- Use clear names so teammates can find simulations quickly.

## 2. Sites
- Sites are physical node locations with coordinates, ground elevation, and antenna height.
- Manage your reusable site collection in **Site Library**.
- Add sites by coordinates, map pick, search, or Meshtastic sources.
- Add sites from the library into the current simulation as needed.

## 3. Links
- A link is a **From -> To** path between two sites used for path analysis.
- Links let you compare multiple candidate paths in one simulation.
- Start with the two sites you care about most, then add relay candidate links.

## 4. Other Settings
- **Channel**: frequency, bandwidth, SF, coding rate, TX power, gains, cable loss.
- **Propagation model**: FSPL, TwoRay, or ITM (terrain-aware approximation).
- **Terrain**: fetch and refresh terrain before relying on pass/fail decisions.
- **RX target**: your decision threshold; pass/fail is based on this target.

## 5. Map and Plots
- The map shows channel/coverage overlays for the selected simulation and link.
- Use map controls to fit, inspect terrain, and switch visualization modes.
- The **path profile** shows terrain, LOS/Fresnel context, and endpoint relationship.
- Use overlays to find potential relay positions and validate route quality.

## 6. User Rights and Permissions
- User roles: **Pending**, **User**, **Moderator**, **Admin**.
- Resource visibility: **Private**, **Public**, **Shared**.
- Collaborators grant edit rights on a site or simulation.
- Moderation/admin actions are audited; use least privilege where possible.

## Recommended Workflow
1. Open or create a simulation.
2. Add sites from Site Library.
3. Create links for the paths you want to evaluate.
4. Auto-fetch terrain data.
5. Set channel + model, then inspect map + path profile.
6. Save the simulation and share/collaborate as needed.
