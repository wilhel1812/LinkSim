import { Globe, Lock, EthernetPort, Globe2 } from 'lucide-react';
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'private' | 'public' | 'shared' | 'mqtt';

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
};

const variantClassName = {
  private: 'access-badge',
  public: 'access-badge',
  shared: 'access-badge',
  mqtt: 'access-badge mqtt-source-badge',
};

export function Badge({ variant, className, children, ...rest }: BadgeProps) {
  const Icon = variantIcon[variant];
  return (
    <span className={`${variantClassName[variant]} ${className ?? ''}`} {...rest}>
      <Icon aria-hidden size={10} strokeWidth={2.2} style={{ display: 'inline-flex', marginRight: 4, verticalAlign: 'middle' }} />
      {children}
    </span>
  );
}