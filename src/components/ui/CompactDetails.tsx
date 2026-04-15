import { CircleChevronDown, CircleChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { InfoTip } from "../InfoTip";

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
  infoTipText?: string;
};

export function CompactDetailsSummary({ children, className, infoTipText }: CompactDetailsSummaryProps) {
  return (
    <summary className={`section-heading ${className ?? ''}`}>
      <span className="compact-details-header">
        <CircleChevronRight className="compact-details-icon collapsed" aria-hidden size={16} strokeWidth={2} />
        <CircleChevronDown className="compact-details-icon expanded" aria-hidden size={16} strokeWidth={2} />
        <h2>{children}</h2>
      </span>
      {infoTipText ? <InfoTip text={infoTipText} /> : null}
    </summary>
  );
}
