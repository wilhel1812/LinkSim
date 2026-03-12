export const SUPPORTED_LOCALES = [
  "ara",
  "bra",
  "dan",
  "deu",
  "eng",
  "fra",
  "gre",
  "ita",
  "ned",
  "nor",
  "pol",
  "spa",
  "svk",
  "tur",
  "ukr",
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<LocaleCode, string> = {
  ara: "Arabic",
  bra: "Brazilian Portuguese",
  dan: "Danish",
  deu: "German",
  eng: "English",
  fra: "French",
  gre: "Greek",
  ita: "Italian",
  ned: "Dutch",
  nor: "Norwegian",
  pol: "Polish",
  spa: "Spanish",
  svk: "Slovak",
  tur: "Turkish",
  ukr: "Ukrainian",
};

export type TranslationKey =
  | "appTitle"
  | "workspaceSubtitle"
  | "networkCoverageWorkspace"
  | "model"
  | "links"
  | "sites"
  | "terrainData"
  | "rfSummary"
  | "loadHgt"
  | "syncSiteElevations"
  | "legacyAssets"
  | "pathProfile"
  | "profileSubtitle";

type TranslationTable = Record<TranslationKey, string>;

const ENGLISH: TranslationTable = {
  appTitle: "LinkSim",
  workspaceSubtitle: "Propagation workspace",
  networkCoverageWorkspace: "Network and Coverage Workspace",
  model: "Model",
  links: "Links",
  sites: "Sites",
  terrainData: "Terrain Data",
  rfSummary: "RF Summary",
  loadHgt: "Load .hgt tiles",
  syncSiteElevations: "Sync site elevations (online)",
  legacyAssets: "Legacy Assets",
  pathProfile: "Path Profile",
  profileSubtitle: "Terrain, line-of-sight, and first Fresnel zone",
};

export const TRANSLATIONS: Record<LocaleCode, TranslationTable> = {
  ara: { ...ENGLISH, appTitle: "LinkSim", model: "النموذج", links: "الروابط", sites: "المواقع", terrainData: "بيانات التضاريس", rfSummary: "ملخص RF" },
  bra: { ...ENGLISH, appTitle: "LinkSim", model: "Modelo", links: "Enlaces", sites: "Locais", terrainData: "Dados de terreno", rfSummary: "Resumo RF" },
  dan: { ...ENGLISH, model: "Model", links: "Links", sites: "Steder", terrainData: "Terrændata", rfSummary: "RF-oversigt" },
  deu: { ...ENGLISH, model: "Modell", links: "Verbindungen", sites: "Standorte", terrainData: "Geländedaten", rfSummary: "HF-Zusammenfassung" },
  eng: ENGLISH,
  fra: { ...ENGLISH, model: "Modèle", links: "Liaisons", sites: "Sites", terrainData: "Données terrain", rfSummary: "Résumé RF" },
  gre: { ...ENGLISH, model: "Μοντέλο", links: "Σύνδεσμοι", sites: "Τοποθεσίες", terrainData: "Δεδομένα εδάφους", rfSummary: "Περίληψη RF" },
  ita: { ...ENGLISH, model: "Modello", links: "Collegamenti", sites: "Siti", terrainData: "Dati terreno", rfSummary: "Riepilogo RF" },
  ned: { ...ENGLISH, model: "Model", links: "Links", sites: "Locaties", terrainData: "Terreingegevens", rfSummary: "RF-overzicht" },
  nor: { ...ENGLISH, model: "Modell", links: "Lenker", sites: "Steder", terrainData: "Terrengdata", rfSummary: "RF-oversikt" },
  pol: { ...ENGLISH, model: "Model", links: "Łącza", sites: "Lokalizacje", terrainData: "Dane terenu", rfSummary: "Podsumowanie RF" },
  spa: { ...ENGLISH, model: "Modelo", links: "Enlaces", sites: "Sitios", terrainData: "Datos de terreno", rfSummary: "Resumen RF" },
  svk: { ...ENGLISH, model: "Model", links: "Spoje", sites: "Lokality", terrainData: "Dáta terénu", rfSummary: "RF súhrn" },
  tur: { ...ENGLISH, model: "Model", links: "Bağlantılar", sites: "Sahalar", terrainData: "Arazi verisi", rfSummary: "RF Özeti" },
  ukr: { ...ENGLISH, model: "Модель", links: "Лінії", sites: "Сайти", terrainData: "Дані рельєфу", rfSummary: "RF зведення" },
};

export const t = (locale: LocaleCode, key: TranslationKey): string =>
  TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.eng[key];
