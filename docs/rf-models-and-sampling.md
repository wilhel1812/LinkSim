# RF Models and Coverage Sampling

## Propagation models
- `FSPL`: free-space path loss only. Fast and optimistic. No terrain blocking.
- `TwoRay`: direct plus ground reflection. Useful on flatter/open terrain. No terrain profile blocking.
- `ITM` (default): terrain-aware approximation in LinkSim. Uses loaded terrain elevation for diffraction/excess-loss estimation.

## Coverage map sampling modes
- `BestSite`: each sample point takes strongest predicted site signal.
- `Polar`: radial sampling around selected `From` site.
- `Cartesian`: regular grid across analysis bounds.
- `Route`: samples along a path corridor.

## Pass/Fail interpretation
- Pass/Fail compares predicted calibrated RX dBm to RX target dBm.
- `PASS` means `RX >= target`.
- Terrain influences this result when `ITM` is selected and terrain tiles are loaded.

