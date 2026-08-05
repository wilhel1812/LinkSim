# RF Model and Coverage Calculation

## Propagation model

- LinkSim uses `ITM` for terrain-aware propagation. It applies the loaded terrain profile, atmospheric environment, and radio values when estimating excess loss and obstruction.
- `FSPL` is retained as a reference metric in Path results. It is not a selectable propagation model.
- `TwoRay` is not an available LinkSim propagation model.

## Coverage calculation

- Coverage samples use the strongest applicable Site signal by default.
- **Weakest Site** instead shows the weakest signal to any applicable Simulation Site.
- Simulation Resolution controls the map sample density. Higher settings improve spatial detail but require more work.
- Simulation Radius selects the required analysis area. LinkSim determines the complete Copernicus GLO-30 tile set for that radius before calculating.
- If any required terrain tile is unavailable, the calculation stops and stale coverage is cleared instead of presenting a partial-terrain result.

## Pass/Fail interpretation
- Pass/Fail compares predicted calibrated RX dBm to RX target dBm.
- `PASS` means `RX >= target`.
- LOS obstruction checks (blocked/clear) use the same terrain LOS evaluator across map overlays, path profile hover states, and selected-link analysis.
- Curvature in LOS checks uses effective Earth radius (`k-factor`) derived from atmospheric bending `N-units` in propagation environment settings.
- Map colors in Pass/Fail mode:
  - `green`: clear path and meets target
  - `yellow`: blocked path but still meets target
  - `orange`: clear path but below target
  - `red`: blocked path and below target
- Terrain is part of the ITM result and must be complete for the selected analysis area.

## Other overlays

- **Heatmap + Target Line** draws the RX target boundary over the signal heatmap.
- **Relay** scores candidate positions by the weaker direction through a representative third node between two selected Sites.
- **Mesh Extension** requires bidirectional signal at or above the RX target and scores how much previously uncovered terrain a representative new node would add.
- **Terrain** is a separate visual layer showing the elevation raster used by the Simulation.
