'use client';

/**
 * Shared table primitives, shadcn/ui-style: composable pieces over a plain
 * semantic `<table>`, restyled with this app's own design tokens instead of
 * shadcn's defaults. Every table in the product (Tasks, Pending approvals,
 * Master data, People, Activity log, Reports) had converged on nearly
 * identical hand-rolled classes — this makes that one system instead of six
 * copies that drift the next time one of them changes.
 *
 * `Table` owns the horizontal-scroll container and a minimum width, so on a
 * narrow screen the table scrolls as a whole instead of every column being
 * squeezed until its content is unreadable.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { minWidth?: number }
>(({ className, minWidth = 760, style, ...props }, ref) => (
  <div className="w-full overflow-x-auto">
    <table
      ref={ref}
      style={{ minWidth, ...style }}
      className={cn('w-full table-fixed border-collapse text-left', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-surface-raised', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-line', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn('group transition-colors', className)}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      'text-label px-4 py-3 align-middle border-b border-line whitespace-normal',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('px-4 py-3 align-top text-[13.5px] text-fg', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('sr-only', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
