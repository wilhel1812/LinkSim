export type FrequencyPresetGroup = "Meshtastic Regional" | "MeshCore Community" | "Amateur / Reference" | "Local / Community";
export type FrequencyPresetSource = "Meshtastic" | "MeshCore" | "Reference" | "Local";
export type FrequencyPresetSourceFamily = "meshtastic" | "meshcore" | "reference" | "local";

export type FrequencyPresetData = {
  id: string;
  label: string;
  source: FrequencyPresetSource;
  sourceFamily: FrequencyPresetSourceFamily;
  group: FrequencyPresetGroup;
  frequencyMHz: number;
  bandwidthKhz: number;
  spreadFactor: number;
  codingRate: number;
  regionCode?: string;
  notes?: string;
};

export const FREQUENCY_PRESET_GROUP_ORDER: FrequencyPresetGroup[] = [
  "Meshtastic Regional",
  "MeshCore Community",
  "Amateur / Reference",
  "Local / Community",
];

export const FREQUENCY_PRESET_DATA_BY_GROUP: Array<{
  group: FrequencyPresetGroup;
  presets: FrequencyPresetData[];
}> = [
  {
    group: "Meshtastic Regional",
    presets: [
      { id: "mt-us", label: "Meshtastic US", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 915.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "US", notes: "902-928 MHz region span" },
      { id: "mt-eu_433", label: "Meshtastic EU_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 433.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "EU_433", notes: "433-434 MHz region span" },
      { id: "mt-eu_868", label: "Meshtastic EU_868", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 869.525, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "EU_868", notes: "869.4-869.65 MHz region span" },
      { id: "mt-cn", label: "Meshtastic CN", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 490.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "CN", notes: "470-510 MHz region span" },
      { id: "mt-jp", label: "Meshtastic JP", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 924.3, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "JP", notes: "920.8-927.8 MHz region span" },
      { id: "mt-anz", label: "Meshtastic ANZ", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 921.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "ANZ", notes: "915-928 MHz region span" },
      { id: "mt-anz_433", label: "Meshtastic ANZ_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 433.92, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "ANZ_433", notes: "433.05-434.79 MHz region span" },
      { id: "mt-kr", label: "Meshtastic KR", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 921.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "KR", notes: "920-923 MHz region span" },
      { id: "mt-tw", label: "Meshtastic TW", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 922.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "TW", notes: "920-925 MHz region span" },
      { id: "mt-ru", label: "Meshtastic RU", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 868.95, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "RU", notes: "868.7-869.2 MHz region span" },
      { id: "mt-in", label: "Meshtastic IN", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 866.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "IN", notes: "865-867 MHz region span" },
      { id: "mt-nz_865", label: "Meshtastic NZ_865", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 866.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "NZ_865", notes: "864-868 MHz region span" },
      { id: "mt-th", label: "Meshtastic TH", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 922.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "TH", notes: "920-925 MHz region span" },
      { id: "mt-ua_433", label: "Meshtastic UA_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 433.85, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "UA_433", notes: "433-434.7 MHz region span" },
      { id: "mt-ua_868", label: "Meshtastic UA_868", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 868.3, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "UA_868", notes: "868-868.6 MHz region span" },
      { id: "mt-my_433", label: "Meshtastic MY_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 434.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "MY_433", notes: "433-435 MHz region span" },
      { id: "mt-my_919", label: "Meshtastic MY_919", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 921.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "MY_919", notes: "919-924 MHz region span" },
      { id: "mt-sg_923", label: "Meshtastic SG_923", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 921.0, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "SG_923", notes: "917-925 MHz region span" },
      { id: "mt-kz_433", label: "Meshtastic KZ_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 433.925, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "KZ_433", notes: "433.075-434.775 MHz region span" },
      { id: "mt-kz_863", label: "Meshtastic KZ_863", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 865.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "KZ_863", notes: "863-868 MHz region span" },
      { id: "mt-ph_433", label: "Meshtastic PH_433", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 433.85, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "PH_433", notes: "433-434.7 MHz region span" },
      { id: "mt-ph_868", label: "Meshtastic PH_868", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 868.7, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "PH_868", notes: "868-869.4 MHz region span" },
      { id: "mt-ph_915", label: "Meshtastic PH_915", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 916.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "PH_915", notes: "915-918 MHz region span" },
      { id: "mt-br_902", label: "Meshtastic BR_902", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 904.75, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "BR_902", notes: "902-907.5 MHz region span" },
      { id: "mt-np_865", label: "Meshtastic NP_865", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 866.5, bandwidthKhz: 250, spreadFactor: 11, codingRate: 5, regionCode: "NP_865", notes: "865-868 MHz region span" },
      { id: "mt-lora_24", label: "Meshtastic LORA_24", source: "Meshtastic", sourceFamily: "meshtastic", group: "Meshtastic Regional", frequencyMHz: 2441.75, bandwidthKhz: 812.5, spreadFactor: 11, codingRate: 5, regionCode: "LORA_24", notes: "2400-2483.5 MHz region span" },
    ],
  },
  {
    group: "MeshCore Community",
    presets: [
      { id: "meshcore-eu-narrow-869525-sf8-bw625-cr5", label: "MeshCore EU Narrow 869.525", source: "MeshCore", sourceFamily: "meshcore", group: "MeshCore Community", frequencyMHz: 869.525, bandwidthKhz: 62.5, spreadFactor: 8, codingRate: 5, regionCode: "EU_868", notes: "MeshCore community narrow profile" },
      { id: "meshcore-eu-fast-869525-sf7-bw625-cr5", label: "MeshCore EU Fast 869.525", source: "MeshCore", sourceFamily: "meshcore", group: "MeshCore Community", frequencyMHz: 869.525, bandwidthKhz: 62.5, spreadFactor: 7, codingRate: 5, regionCode: "EU_868", notes: "MeshCore community fast profile" },
      { id: "meshcore-us-narrow-910525-sf7-bw625-cr5", label: "MeshCore US Narrow 910.525", source: "MeshCore", sourceFamily: "meshcore", group: "MeshCore Community", frequencyMHz: 910.525, bandwidthKhz: 62.5, spreadFactor: 7, codingRate: 5, regionCode: "US", notes: "MeshCore community recommended profile" },
      { id: "meshcore-us-balanced-910525-sf8-bw625-cr5", label: "MeshCore US Balanced 910.525", source: "MeshCore", sourceFamily: "meshcore", group: "MeshCore Community", frequencyMHz: 910.525, bandwidthKhz: 62.5, spreadFactor: 8, codingRate: 5, regionCode: "US", notes: "MeshCore community balanced profile" },
      { id: "meshcore-anz-narrow-917525-sf7-bw625-cr5", label: "MeshCore ANZ Narrow 917.525", source: "MeshCore", sourceFamily: "meshcore", group: "MeshCore Community", frequencyMHz: 917.525, bandwidthKhz: 62.5, spreadFactor: 7, codingRate: 5, regionCode: "ANZ", notes: "MeshCore community narrow profile" },
    ],
  },
  {
    group: "Amateur / Reference",
    presets: [
      { id: "rm-vhf-2m", label: "VHF 2m Reference", source: "Reference", sourceFamily: "reference", group: "Amateur / Reference", frequencyMHz: 145.0, bandwidthKhz: 125, spreadFactor: 11, codingRate: 5 },
      { id: "rm-uhf-70cm", label: "UHF 70cm Reference", source: "Reference", sourceFamily: "reference", group: "Amateur / Reference", frequencyMHz: 433.92, bandwidthKhz: 125, spreadFactor: 11, codingRate: 5 },
      { id: "rm-23cm", label: "23cm Reference", source: "Reference", sourceFamily: "reference", group: "Amateur / Reference", frequencyMHz: 1296.0, bandwidthKhz: 125, spreadFactor: 11, codingRate: 5 },
      { id: "rm-13cm", label: "13cm Reference", source: "Reference", sourceFamily: "reference", group: "Amateur / Reference", frequencyMHz: 2400.0, bandwidthKhz: 125, spreadFactor: 11, codingRate: 5 },
      { id: "rm-6cm", label: "6cm Reference", source: "Reference", sourceFamily: "reference", group: "Amateur / Reference", frequencyMHz: 5800.0, bandwidthKhz: 125, spreadFactor: 11, codingRate: 5 },
    ],
  },
  {
    group: "Local / Community",
    presets: [
      { id: "oslo-local-869618", label: "Oslo Local 869.618", source: "Local", sourceFamily: "local", group: "Local / Community", frequencyMHz: 869.618, bandwidthKhz: 62, spreadFactor: 8, codingRate: 5, regionCode: "EU_868", notes: "Local profile: BW 62kHz, SF8, CR 5" },
    ],
  },
];
