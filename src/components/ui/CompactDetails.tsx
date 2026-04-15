import { CircleChevronDown, CircleChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

type CompactDetailsProps = {
  children: ReactNode;
  className?: string;
  open?: boolean;
  onToggle?: (event: React.SyntheticEvent<HTMLDetailsElement>) => void;
} & HTMLAttributes<HTMLDetailsElement>;

export function CompactDetails({ children, className, open, onToggle, ...rest }: CompactDetailsProps) {
  return (
    <details className={`compact-details ${className ?? ''}`} open={open} onToggle={onToggle} {...rest}>
      {children}
    </details>
  );
}

type CompactDetailsSummaryProps = {
  children: ReactNode;
  className?: string;
};

export function CompactDetailsSummary({ children, className }: CompactDetailsSummaryProps) {
  return (
    <summary className={className}>
      <CircleChevronRight className="compact-details-icon collapsed" aria-hidden size={16} strokeWidth={2} />
      <CircleChevronDown className="compact-details-icon expanded" aria-hidden size={16} strokeWidth={2} />
      <span>{children}</span>
    </summary>
  );
}
