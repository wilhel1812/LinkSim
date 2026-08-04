import { ChevronRight, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";

export type SettingsNavItem<SectionId extends string = string> = {
  id: SectionId;
  label: string;
  description: string;
  icon?: typeof UserRound;
};

type SettingsNavProps<SectionId extends string> = {
  activeSection: SectionId;
  ariaLabel?: string;
  items: SettingsNavItem<SectionId>[];
  onSelect: (section: SectionId) => void;
  layout: "sidebar" | "list";
};

export function SettingsNav<SectionId extends string>({
  activeSection,
  ariaLabel = "Settings sections",
  items,
  onSelect,
  layout,
}: SettingsNavProps<SectionId>) {
  return (
    <nav
      className={`settings-nav settings-nav-${layout}`}
      aria-label={ariaLabel}
    >
      <ul>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeSection;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`settings-nav-item${isActive ? " settings-nav-item-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(item.id)}
              >
                {Icon ? (
                  <span className="settings-nav-item-icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                ) : null}
                <span className="settings-nav-item-copy">
                  <span className="settings-nav-item-label">{item.label}</span>
                  {layout === "list" ? (
                    <span className="settings-nav-item-description">{item.description}</span>
                  ) : null}
                </span>
                {layout === "list" ? (
                  <ChevronRight className="settings-nav-item-chevron" size={18} aria-hidden="true" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const settingsNavIcons = {
  profile: UserRound,
  preferences: SlidersHorizontal,
  admin: ShieldCheck,
};
