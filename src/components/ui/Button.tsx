'use client';

/**
 * Button, with one definition of each variant.
 *
 * Consolidates roughly a dozen bespoke class strings that had drifted apart —
 * three different paddings for "primary" alone — and guarantees a visible focus
 * ring and a real disabled state everywhere.
 */

import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Leading icon. Decorative — the label carries the meaning. */
  icon?: React.ReactNode;
  /** Renders a spinner and blocks interaction. */
  loading?: boolean;
  /**
   * Required when the button has no text label, so it is not announced as
   * "button" with no name.
   */
  iconOnly?: boolean;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent shadow-sm',
  secondary:
    'bg-surface text-fg hover:bg-surface-sunken border border-line-strong',
  ghost:
    'bg-transparent text-fg-muted hover:text-fg hover:bg-surface-sunken border border-transparent',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 border border-transparent shadow-sm',
  'danger-ghost':
    'bg-transparent text-fg-subtle hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent',
};

const SIZES: Record<Size, string> = {
  sm: 'text-[13px] px-2.5 py-1.5 gap-1.5 rounded-lg',
  md: 'text-sm px-3.5 py-2 gap-2 rounded-lg',
  lg: 'text-sm px-4 py-2.5 gap-2 rounded-xl',
};

const ICON_SIZES: Record<Size, string> = {
  // Square, so an icon-only button is not a lopsided rectangle.
  sm: 'p-1.5 rounded-lg',
  md: 'p-2 rounded-lg',
  lg: 'p-2.5 rounded-xl',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  iconOnly = false,
  fullWidth = false,
  className = '',
  disabled,
  children,
  type = 'button',
  ...rest
}) => {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      // Announce the busy state rather than only showing a spinner.
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap
        transition-colors duration-100
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${iconOnly ? ICON_SIZES[size] : SIZES[size]}
        ${VARIANTS[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
};

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Task view". */
  label: string;
}

/**
 * Used for the table/board switch. Built as a radio group rather than buttons so
 * arrow keys move between options, which is what a keyboard user expects from a
 * segmented control.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 p-0.5 bg-surface-sunken border border-line rounded-lg"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              selected
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-subtle hover:text-fg'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
