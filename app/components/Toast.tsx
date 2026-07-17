import React, { useEffect } from 'react';
import { XCircle, CheckCircle, X } from '@phosphor-icons/react';

interface ToastProps {
  message: string | null;
  type: 'error' | 'success';
  onClose: () => void;
}

/**
 * Transient notification at the bottom-right of the viewport.
 *
 * Accessibility:
 *   - role="alert" + aria-live="assertive" for errors so screen readers
 *     interrupt and announce immediately (user needs to know now).
 *   - role="status" + aria-live="polite" for success so the announcement
 *     queues behind in-progress speech (less urgent).
 *   - Dismiss button has a visible aria-label since the X icon is the
 *     only visual indicator.
 */
export function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, type === 'error' ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [message, type, onClose]);

  if (!message) return null;

  const isError = type === 'error';
  const Icon = isError ? XCircle : CheckCircle;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 text-white flex items-center gap-3 max-w-md ${
        isError ? 'bg-red-600' : 'bg-green-600'
      }`}
    >
      <Icon size={20} weight="fill" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="text-white/80 hover:text-white transition cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
