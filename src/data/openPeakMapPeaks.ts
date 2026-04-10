export type OpenPeakMapPeak = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM?: number;
};

// Subset derived from OpenPeakMap summit records for v1 Panorama labeling.
export const OPEN_PEAK_MAP_PEAKS: OpenPeakMapPeak[] = [
  { id: "no-galdhopiggen", name: "Galdhopiggen", lat: 61.6369, lon: 8.3124, elevationM: 2469 },
  { id: "no-glittertind", name: "Glittertind", lat: 61.6528, lon: 8.5533, elevationM: 2464 },
  { id: "no-store-skagastolstind", name: "Store Skagastolstind", lat: 61.4625, lon: 7.8718, elevationM: 2405 },
  { id: "no-storen", name: "Storen", lat: 61.4658, lon: 7.8744, elevationM: 2405 },
  { id: "no-snutan", name: "Snutan", lat: 61.5138, lon: 8.1418, elevationM: 2348 },
  { id: "no-surtningssue", name: "Surtningssue", lat: 61.5609, lon: 8.4512, elevationM: 2368 },
  { id: "no-store-ringstind", name: "Store Ringstind", lat: 61.4411, lon: 7.9092, elevationM: 2124 },
  { id: "no-fanaraken", name: "Fanaraken", lat: 61.5146, lon: 7.9075, elevationM: 2068 },
  { id: "no-snofjellet", name: "Snofjellet", lat: 62.3353, lon: 9.2756, elevationM: 2286 },
  { id: "no-snofjell", name: "Snohøtta", lat: 62.3095, lon: 9.2682, elevationM: 2286 },
  { id: "no-harteigen", name: "Harteigen", lat: 60.5648, lon: 7.5839, elevationM: 1690 },
  { id: "no-gaustatoppen", name: "Gaustatoppen", lat: 59.8535, lon: 8.6539, elevationM: 1883 },
  { id: "no-hallingskarvet", name: "Folarskardnuten", lat: 60.7618, lon: 7.9352, elevationM: 1933 },
  { id: "no-rondeslottet", name: "Rondeslottet", lat: 61.8982, lon: 9.8366, elevationM: 2178 },
  { id: "no-jerkhytta", name: "Hogronden", lat: 61.9308, lon: 9.8525, elevationM: 2118 },
  { id: "no-tron", name: "Tron", lat: 62.2011, lon: 10.8589, elevationM: 1666 },
  { id: "no-stetind", name: "Stetind", lat: 68.173, lon: 16.347, elevationM: 1391 },
  { id: "no-lofoten-higravtinden", name: "Higravtinden", lat: 68.3384, lon: 14.9101, elevationM: 1146 },
  { id: "se-kebnekaise", name: "Kebnekaise", lat: 67.9025, lon: 18.515, elevationM: 2096 },
  { id: "se-sarek", name: "Sarektjakka", lat: 67.6508, lon: 17.611, elevationM: 2089 },
  { id: "se-are-skutan", name: "Areskutan", lat: 63.3997, lon: 13.0818, elevationM: 1420 },
  { id: "se-helsingland-berget", name: "Hagelberget", lat: 62.1639, lon: 16.3772, elevationM: 740 },
  { id: "fi-halta", name: "Halti", lat: 69.3082, lon: 21.2652, elevationM: 1324 },
  { id: "fi-yllas", name: "Yllas", lat: 67.5551, lon: 24.1927, elevationM: 718 },
  { id: "dk-yding-skovhoj", name: "Yding Skovhoj", lat: 55.9564, lon: 9.5271, elevationM: 172 },
  { id: "is-hvannadalshnukur", name: "Hvannadalshnukur", lat: 64.0119, lon: -16.6486, elevationM: 2110 },
  { id: "is-snaefellsjokull", name: "Snaefellsjokull", lat: 64.8042, lon: -23.7738, elevationM: 1446 },
  { id: "ch-matterhorn", name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevationM: 4478 },
  { id: "ch-dom", name: "Dom", lat: 46.094, lon: 7.8619, elevationM: 4545 },
  { id: "ch-dufourspitze", name: "Dufourspitze", lat: 45.9369, lon: 7.8664, elevationM: 4634 },
  { id: "it-monte-bianco", name: "Mont Blanc", lat: 45.8326, lon: 6.8652, elevationM: 4808 },
  { id: "it-gran-paradiso", name: "Gran Paradiso", lat: 45.5211, lon: 7.2734, elevationM: 4061 },
  { id: "fr-meije", name: "La Meije", lat: 45.0071, lon: 6.3044, elevationM: 3983 },
  { id: "es-aneto", name: "Aneto", lat: 42.6319, lon: 0.6578, elevationM: 3404 },
  { id: "de-zugspitze", name: "Zugspitze", lat: 47.421, lon: 10.985, elevationM: 2962 },
  { id: "at-grossglockner", name: "Grossglockner", lat: 47.0747, lon: 12.6933, elevationM: 3798 },
  { id: "si-triglav", name: "Triglav", lat: 46.3783, lon: 13.8369, elevationM: 2864 },
  { id: "uk-ben-nevis", name: "Ben Nevis", lat: 56.7969, lon: -5.0036, elevationM: 1345 },
  { id: "pl-rysy", name: "Rysy", lat: 49.1794, lon: 20.0883, elevationM: 2501 },
  { id: "sk-gerlach", name: "Gerlachovsky stit", lat: 49.1642, lon: 20.1346, elevationM: 2655 },
  { id: "us-denali", name: "Denali", lat: 63.0695, lon: -151.0074, elevationM: 6190 },
  { id: "us-rainier", name: "Mount Rainier", lat: 46.8523, lon: -121.7603, elevationM: 4392 },
  { id: "us-whitney", name: "Mount Whitney", lat: 36.5786, lon: -118.2919, elevationM: 4421 },
  { id: "ca-robson", name: "Mount Robson", lat: 53.1106, lon: -119.1569, elevationM: 3954 },
];

