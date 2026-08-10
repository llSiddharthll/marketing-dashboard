import type { Task } from '@/types/dashboard';

export interface TaskLinkInfo {
  url: string;
  label: string;
  type: 'spreadsheet' | 'drive' | 'image' | 'generic';
}

/**
 * Resolves the primary external link for a task (Report Link, Google Drive, BOQ, or Attachment).
 */
export function getPrimaryTaskLink(task: Task): TaskLinkInfo | null {
  const url =
    task.reportLink?.trim() ||
    task.boqLink?.trim() ||
    (task.attachments && task.attachments.length > 0 ? task.attachments[0]?.url?.trim() : undefined);

  if (!url) return null;

  let label = 'Report Link';
  if (task.reportLink?.trim()) {
    label = 'Google / Report Link';
  } else if (task.boqLink?.trim()) {
    label = 'BOQ / Google Link';
  } else if (task.attachments && task.attachments.length > 0 && task.attachments[0]?.url?.trim()) {
    label = task.attachments[0].label || 'Attachment Link';
  }

  let type: TaskLinkInfo['type'] = 'generic';
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('docs.google.com/spreadsheets') || lowerUrl.includes('sheets.google') || lowerUrl.includes('sheet')) {
    type = 'spreadsheet';
  } else if (lowerUrl.includes('drive.google.com') || lowerUrl.includes('drive')) {
    type = 'drive';
  } else if (
    /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(lowerUrl) ||
    lowerUrl.includes('photo') ||
    lowerUrl.includes('image')
  ) {
    type = 'image';
  }

  return { url, label, type };
}
