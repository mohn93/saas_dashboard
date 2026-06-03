"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Replaces the browser-native window.prompt() (a cramped one-line OS dialog)
// with a roomy, resizable textarea so a real question fits and is readable.
// Mount this only while editing and key it by widget id so each open starts
// fresh from that widget's current question.
export function EditQueryModal({
  initialQuestion,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initialQuestion: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (question: string) => void;
}) {
  const [text, setText] = useState(initialQuestion);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent
        title="Edit widget query"
        description="Re-ask the agent for this widget"
        className="w-[min(40rem,94vw)]"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-ask the agent for this widget. The new query replaces the current one.
          </p>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={busy}
            aria-label="Widget query"
            placeholder="e.g. signups per week over the last 12 weeks"
            className="w-full resize-y rounded-lg border border-border/50 bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-violet-500 disabled:opacity-60"
          />
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-border/50 px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(text.trim())}
              disabled={busy || !text.trim()}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Run
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
