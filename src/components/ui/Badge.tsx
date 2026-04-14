import { Globe, Lock, EthernetPort, Globe2, GlobeOff, FlaskConical } from 'lucide-react';
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'private' | 'public' | 'shared' | 'mqtt' | 'local' | 'staging';

type BadgeProps = {
  variant: BadgeVariant;
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

const variantClassName: Record<BadgeVariant, string> = {
  private: 'access-badge',
  public: 'access-badge',
  shared: 'access-badge',
  mqtt: 'access-badge mqtt-source-badge',
  local: 'access-badge',
  staging: 'access-badge',
};

export function Badge({ variant, className, children, ...rest }: BadgeProps) {
  const Icon = variantIcon[variant];
  return (
    <span className={`${variantClassName[variant]} ${className ?? ''}`} {...rest}>
      <Icon aria-hidden size={10} strokeWidth={2.2} style={{ marginRight: 4 }} />
      {children}
    </span>
  );
}