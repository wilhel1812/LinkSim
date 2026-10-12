# Meshtastic 2.8 radio presets

The additive catalogue is pinned to firmware `v2.8.1.8e6a88d` (34 regions, 16 modem families, 265 supported combinations). Existing regional/local IDs and radio values remain compatible. UNSET is excluded. No hardware configuration is performed.

## Sources and frequency mapping

- [Modem parameters and region structures](https://github.com/meshtastic/firmware/blob/v2.8.1.8e6a88d/src/mesh/MeshRadio.h)
- [Region profiles, bands, explicit slots, djb2 and frequency calculation](https://github.com/meshtastic/firmware/blob/v2.8.1.8e6a88d/src/mesh/RadioInterface.cpp)
- [Channel display names](https://github.com/meshtastic/firmware/blob/v2.8.1.8e6a88d/src/DisplayFormatters.cpp)
- [Unnamed primary Channel uses the modem name](https://github.com/meshtastic/firmware/blob/v2.8.1.8e6a88d/src/mesh/Channels.cpp)

Each new ID is `mt-<lowercase-region>-<kebab-preset>`. One canonical frequency is provided per supported modem/region pair, without a custom Channel name, override frequency or frequency offset. Explicit regional slots take precedence; otherwise the firmware uint32 djb2 hash of its modem display name selects the slot. LongModerate uses firmware's `LongMod` channel name. Slot counts use firmware's rounding rule, region spacing/padding and region-specific normal/2.4 GHz bandwidth. Frequencies are represented to six decimal MHz places; existing frequency controls allow other values.

The complete new ID/radio/Channel manifest and preserved legacy radio values are in [the pinned test fixture](../src/lib/__fixtures__/meshtastic-2.8.1.json). The fixture was derived independently from the pinned source tables.

## Default and compatibility

EU_N_868 NarrowFast Channel 1 uses 869.44165 MHz, BW62.5 kHz, SF7 and CR6. The default profile retains a −130 dBm RX planning target by maintainer choice. Other new entries use the existing conservative −120 dBm Meshtastic planning target. RX targets, environment loss and propagation settings are planning assumptions, not firmware measurements.

Fresh starter/demo state and new Simulations without a user preference use this default. Explicit user presets/custom overrides and saved/imported radio values remain authoritative. Simulations configured to inherit account defaults continue that existing behavior; explicit per-Simulation overrides remain fixed. Oslo Local remains selectable under its existing ID. Licensed amateur profiles use the existing Amateur / Reference group and are identified in their notes; all other new profiles use Meshtastic Regional.

## Complete region/profile matrix

| Region | Supported modem families | Canonical slot rule |
|---|---|---|
| US | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| EU_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| EU_868 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate | Firmware modem-name hash |
| EU_866 | LiteFast, LiteSlow | Firmware modem-name hash |
| EU_N_868 | NarrowFast, NarrowSlow | Channel 1 |
| CN | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| JP | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| ANZ | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| ANZ_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| RU | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| KR | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| TW | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| IN | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| NZ_865 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| TH | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| UA_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| MY_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| MY_919 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| SG_923 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| PH_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| PH_868 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| PH_915 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| KZ_433 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| KZ_863 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| NP_865 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| BR_902 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
| ITU1_2M | TinyFast, TinySlow | Channel 26 |
| ITU2_2M | TinyFast, TinySlow | Channel 51 |
| ITU3_2M | TinyFast, TinySlow | Channel 33 |
| ITU2_125CM | NarrowFast, NarrowSlow | Channel 37 |
| ITU1_70CM | NarrowFast, NarrowSlow | Channel 37 |
| ITU2_70CM | NarrowFast, NarrowSlow | Channel 137 |
| ITU3_70CM | NarrowFast, NarrowSlow | Channel 37 |
| LORA_24 | LongFast, LongSlow, MediumSlow, MediumFast, ShortSlow, ShortFast, LongModerate, ShortTurbo, LongTurbo, MediumTurbo | Firmware modem-name hash |
