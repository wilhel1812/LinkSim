import { Globe, Lock, EthernetPort, Globe2, GlobeOff, FlaskConical } from 'lucide-react';
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'private' | 'public' | 'shared' | 'mqtt' | 'local' | 'staging';
type BadgeTone = 'subtle' | 'prominent';

type BadgeProps = {
  variant: BadgeVariant;
  tone?: BadgeTone;
  className?: string;
  children: string;
} & HTMLAttributes<HTMLSpanElement>;

const variantIcon = {
  private: Lock,
  public: Globe2,
  shared: Globe,
  mqtt: EthernetPort,
  local: GlobeOff,
  staging: FlaskConical,
};

const defaultTone: Record<BadgeVariant, BadgeTone> = {
  private: 'subtle',
  public: 'subtle',
  shared: 'subtle',
  mqtt: 'subtle',
  local: 'prominent',
  staging: 'prominent',
};

export function Badge({ variant, tone, className, children, ...rest }: BadgeProps) {
  const Icon = variantIcon[variant];
  const effectiveTone = tone ?? defaultTone[variant];
  const isMqtt = variant === 'mqtt';
  return (
    <span className={`ui-badge ${effectiveTone === 'prominent' ? 'prominent' : ''} ${isMqtt ? 'mqtt-source-badge' : ''} ${className ?? ''}`} {...rest}>
      <Icon aria-hidden size={10} strokeWidth={2.2} style={{ marginRight: 4 }} />
      {children}
    </span>
  );
}