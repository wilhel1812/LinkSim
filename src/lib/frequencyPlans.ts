import {
  FREQUENCY_PRESET_DATA_BY_GROUP,
  FREQUENCY_PRESET_GROUP_ORDER,
  type FrequencyPresetData,
  type FrequencyPresetGroup,
  type FrequencyPresetSource,
  type FrequencyPresetSourceFamily,
} from "./frequencyPresets.data";

export type FrequencyPreset = {
  id: string;
  label: string;
  source: FrequencyPresetSource;
  sourceFamily: FrequencyPresetSourceFamily;
  group: FrequencyPresetGroup;
  sortOrder: number;
  frequencyMHz: number;
  bandwidthKhz: number;
  spreadFactor: number;
  codingRate: number;
  regionCode?: string;
  notes?: string;
};

const buildFrequencyPresets = (): FrequencyPreset[] => {
  const presets: FrequencyPreset[] = [];
  let sortOrder = 0;
  for (const groupEntry of FREQUENCY_PRESET_DATA_BY_GROUP) {
    for (const preset of groupEntry.presets) {
      sortOrder += 10;
      presets.push({ ...preset, sortOrder });
    }
  }
  return presets;
};

export const FREQUENCY_PRESETS: FrequencyPreset[] = buildFrequencyPresets();

export const findPresetById = (id: string): FrequencyPreset | undefined =>
  FREQUENCY_PRESETS.find((preset) => preset.id === id);

export const frequencyPresetGroups = (
  presets: FrequencyPreset[] = FREQUENCY_PRESETS,
): Array<{ group: FrequencyPresetGroup; presets: FrequencyPreset[] }> => {
  const grouped = new Map<FrequencyPresetGroup, FrequencyPreset[]>();
  for (const group of FREQUENCY_PRESET_GROUP_ORDER) grouped.set(group, []);
  for (const preset of presets) {
    const list = grouped.get(preset.group) ?? [];
    list.push(preset);
    grouped.set(preset.group, list);
  }
  return FREQUENCY_PRESET_GROUP_ORDER
    .map((group) => ({
      group,
      presets: (grouped.get(group) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    }))
    .filter((entry) => entry.presets.length > 0);
};

export type { FrequencyPresetData };
