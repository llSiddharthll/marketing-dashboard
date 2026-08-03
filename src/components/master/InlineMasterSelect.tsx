'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useData } from '@/context/DataContext';
import type { MasterCategory } from '@/types/dashboard';
import { Check, X } from 'lucide-react';

interface InlineMasterSelectProps {
  label: string;
  category: MasterCategory;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  /** Inline validation message from the shared validator. */
  error?: string;
}

/** "Vendors" -> "vendor", for button and placeholder copy. */
function singular(category: MasterCategory): string {
  return category === 'Team Members'
    ? 'team member'
    : category.replace(/s$/, '').toLowerCase();
}

/**
 * A dropdown backed by a master list, with an inline "add new" path so someone
 * filling in a task does not have to leave the form to create a missing project
 * or vendor.
 */
export const InlineMasterSelect: React.FC<InlineMasterSelectProps> = ({
  label,
  category,
  value,
  onChange,
  required = false,
  error,
}) => {
  const { getActiveMasterOptions, getAllMasterOptions, addMasterItem } =
    useData();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const activeOptions = getActiveMasterOptions(category);
  const allItems = getAllMasterOptions(category);

  // A historical task can reference a now-inactive item. It stays selectable so
  // saving the task does not silently blank the field.
  const current = allItems.find((item) => item.name === value);
  const isValueInactive = current?.status === 'Inactive';

  const fieldId = `master-${category.replace(/\s+/g, '-').toLowerCase()}`;
  const errorId = `${fieldId}-error`;

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const added = await addMasterItem(
      category,
      trimmed,
      `Added while creating a task`
    );
    if (added) onChange(added.name);
    setNewName('');
    setIsAdding(false);
  };

  if (isAdding) {
    return (
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-new`} className="field-label">
          New {singular(category)}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${fieldId}-new`}
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              // Enter saves, Escape backs out — expected of an inline editor.
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAdd();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setIsAdding(false);
                setNewName('');
              }
            }}
            placeholder={`Name of the new ${singular(category)}`}
            autoFocus
            className="field flex-1"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!newName.trim()}
            aria-label={`Save new ${singular(category)}`}
            className="shrink-0 p-2 bg-accent text-accent-fg rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAdding(false);
              setNewName('');
            }}
            aria-label="Cancel"
            className="shrink-0 p-2 bg-surface-sunken text-fg-muted rounded-lg hover:text-fg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={fieldId} className="field-label mb-0">
          {label}
          {required && (
            <span className="text-rose-500 ml-0.5" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only">(required)</span>}
        </label>
        <Link
          href="/master-data"
          className="text-[12px] text-fg-subtle hover:text-fg transition-colors shrink-0"
        >
          Manage
        </Link>
      </div>

      <select
        id={fieldId}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          if (event.target.value === '__ADD_NEW__') setIsAdding(true);
          else onChange(event.target.value);
        }}
        className={`field ${error ? 'border-rose-400 dark:border-rose-700' : ''}`}
      >
        <option value="">Select {singular(category)}…</option>

        {isValueInactive && (
          <option value={value}>{value} (no longer active)</option>
        )}

        {activeOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}

        <option value="__ADD_NEW__">+ Add a new {singular(category)}…</option>
      </select>

      {error && (
        <p id={errorId} className="text-[12.5px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};
