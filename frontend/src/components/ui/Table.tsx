import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function Table({ className = '', ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={`w-full border-collapse text-left text-sm ${className}`} {...props} />
    </div>
  );
}

export function THead({ className = '', ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-muted/60 ${className}`} {...props} />;
}

export function TR({ className = '', ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-border last:border-b-0 ${className}`} {...props} />;
}

export function TH({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase leading-[18px] tracking-wider text-muted-foreground ${className}`}
      {...props}
    />
  );
}

export function TD({ className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 align-middle ${className}`} {...props} />;
}
