export type FrequencyPreset = {
  id: string;
  label: string;
  source: "RadioMobile" | "Meshtastic" | "Local";
  frequencyMHz: number;
  bandwidthKhz: number;
  spreadFactor: number;
  codingRate: number;
  regionCode?: string;
  notes?: string;
};

const rm = (id: string, label: string, frequencyMHz: number): FrequencyPreset => ({
  id,
  label,
  source: "RadioMobile",
  frequencyMHz,
  bandwidthKhz: 125,
  spreadFactor: 11,
  codingRate: 5,
});

const mt = (
  regionCode: string,
  startMHz: number,
  endMHz: number,
  wideLora = false,
): FrequencyPreset => ({
  id: `mt-${regionCode.toLowerCase()}`,
  label: `Meshtastic ${regionCode}`,
  source: "Meshtastic",
  regionCode,
  frequencyMHz: Number(((startMHz + endMHz) / 2).toFixed(3)),
  bandwidthKhz: wideLora ? 812.5 : 250,
  spreadFactor: 11,
  codingRate: 5,
  notes: `${startMHz}-${endMHz} MHz region span`,
});

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  rm("rm-vhf-2m", "Radio Mobile VHF (2m)", 145.0),
  rm("rm-uhf-70cm", "Radio Mobile UHF (70cm)", 433.92),
  rm("rm-23cm", "Radio Mobile 23cm", 1296.0),
  rm("rm-13cm", "Radio Mobile 13cm", 2400.0),
  rm("rm-6cm", "Radio Mobile 6cm", 5800.0),

  mt("US", 902.0, 928.0),
  mt("EU_433", 433.0, 434.0),
  mt("EU_868", 869.4, 869.65),
  mt("CN", 470.0, 510.0),
  mt("JP", 920.5, 923.5),
  mt("ANZ", 915.0, 928.0),
  mt("ANZ_433", 433.05, 434.79),
  mt("RU", 868.7, 869.2),
  mt("KR", 920.0, 923.0),
  mt("TW", 920.0, 925.0),
  mt("IN", 865.0, 867.0),
  mt("NZ_865", 864.0, 868.0),
  mt("TH", 920.0, 925.0),
  mt("UA_433", 433.0, 434.7),
  mt("UA_868", 868.0, 868.6),
  mt("MY_433", 433.0, 435.0),
  mt("MY_919", 919.0, 924.0),
  mt("SG_923", 917.0, 925.0),
  mt("PH_433", 433.0, 434.7),
  mt("PH_868", 868.0, 869.4),
  mt("PH_915", 915.0, 918.0),
  mt("KZ_433", 433.075, 434.775),
  mt("KZ_863", 863.0, 868.0),
  mt("NP_865", 865.0, 868.0),
  mt("BR_902", 902.0, 907.5),
  mt("LORA_24", 2400.0, 2483.5, true),

  {
    id: "oslo-local-869618",
    label: "Oslo Local 869.618",
    source: "Local",
    regionCode: "EU_868",
    frequencyMHz: 869.618,
    bandwidthKhz: 62,
    spreadFactor: 8,
    codingRate: 5,
    notes: "Local profile: BW 62kHz, SF8, CR 5",
  },
];

export const findPresetById = (id: string): FrequencyPreset | undefined =>
  FREQUENCY_PRESETS.find((preset) => preset.id === id);
