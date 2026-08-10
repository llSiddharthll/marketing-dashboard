'use client';

import React from 'react';
import type { Task } from '@/types/dashboard';
import { getPrimaryTaskLink } from '@/lib/tasks/taskLinks';
import { ExternalLink, FileSpreadsheet, Folder, Image as ImageIcon } from 'lucide-react';

interface TaskLinkButtonProps {
  task: Task;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

export const TaskLinkButton: React.FC<TaskLinkButtonProps> = ({
  task,
  size = 'sm',
  showLabel = false,
  className = '',
}) => {
  const linkInfo = getPrimaryTaskLink(task);
  if (!linkInfo) return null;

  const renderIcon = () => {
    switch (linkInfo.type) {
      case 'spreadsheet':
        return <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case 'drive':
        return <Folder className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />;
      case 'image':
        return <ImageIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />;
      default:
        return <ExternalLink className="w-3.5 h-3.5 text-accent shrink-0" />;
    }
  };

  return (
    <a
      href={linkInfo.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()} // Don't open task drawer when clicking direct link
      title={`Open ${linkInfo.label}: ${linkInfo.url}`}
      aria-label={`Open ${linkInfo.label}`}
      className={`inline-flex items-center gap-1.5 ${
        size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-[12.5px]'
      } rounded-md bg-surface-sunken hover:bg-accent-soft border border-line hover:border-accent/40 font-medium text-fg-muted hover:text-accent transition-all ${className}`}
    >
      {renderIcon()}
      {showLabel ? <span className="truncate max-w-[120px]">{linkInfo.label}</span> : <span className="text-[11px] font-semibold text-accent">Link</span>}
    </a>
  );
};
