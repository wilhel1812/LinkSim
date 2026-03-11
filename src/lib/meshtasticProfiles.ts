export type MeshtasticRfPreset = {
  id: string;
  label: string;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  antennaHeightM: number;
  environmentLossDb: number;
};

export const MESHTASTIC_RF_PRESETS: MeshtasticRfPreset[] = [
  {
    id: "meshtastic-default-handheld",
    label: "Meshtastic Handheld (Default)",
    txPowerDbm: 22,
    txGainDbi: 2,
    rxGainDbi: 2,
    cableLossDb: 0.5,
    antennaHeightM: 2,
    environmentLossDb: 12,
  },
  {
    id: "meshtastic-rooftop-omni",
    label: "Meshtastic Rooftop Omni",
    txPowerDbm: 22,
    txGainDbi: 5,
    rxGainDbi: 5,
    cableLossDb: 1.2,
    antennaHeightM: 6,
    environmentLossDb: 10,
  },
  {
    id: "meshtastic-longrange-directional",
    label: "Meshtastic Long-Range Directional",
    txPowerDbm: 22,
    txGainDbi: 9,
    rxGainDbi: 9,
    cableLossDb: 1.8,
    antennaHeightM: 8,
    environmentLossDb: 8,
  },
];

export const findMeshtasticPreset = (id: string): MeshtasticRfPreset | undefined =>
  MESHTASTIC_RF_PRESETS.find((preset) => preset.id === id);
