import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, description, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();
      document.body.style.overflow = 'hidden';
    } else {
      dialog.close();
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={handleBackdropClick}
      className={cn(
        "backdrop:bg-secondary-950/50 backdrop:backdrop-blur-sm",
        "bg-white dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800",
        "rounded-xl shadow-2xl p-0 w-full max-w-lg",
        "animate-in fade-in zoom-in-95 duration-200",
        "open:flex flex-col m-auto", // Centers dialog natively
        className
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-100 dark:border-secondary-800">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900 dark:text-secondary-50">{title}</h2>
          {description && (
            <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">{description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 hover:bg-secondary-100 dark:hover:bg-secondary-800 text-secondary-500 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-6 overflow-y-auto">
        {children}
      </div>
    </dialog>
  );
}
