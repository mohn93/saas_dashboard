"use client";

import { useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDateRange } from "@/hooks/use-date-range";
import { cn } from "@/lib/utils";

const presets = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export function DateRangePicker() {
  const { days, setDays, setCustomRange, isCustom, customStart, customEnd } =
    useDateRange();
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    if (isCustom && customStart && customEnd) {
      return { from: parseISO(customStart), to: parseISO(customEnd) };
    }
    return undefined;
  });

  function handlePreset(presetDays: number) {
    setDays(presetDays);
    setShowCalendar(false);
    setOpen(false);
  }

  function handleApply() {
    if (range?.from && range?.to) {
      setCustomRange(range.from, range.to);
      setShowCalendar(false);
      setOpen(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setShowCalendar(false);
    }
  }

  const triggerLabel = isCustom
    ? `${format(parseISO(customStart!), "MMM d")} - ${format(parseISO(customEnd!), "MMM d, yyyy")}`
    : `Last ${days} days`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[220px] justify-start gap-2">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        {!showCalendar ? (
          <div className="p-2 space-y-1">
            {presets.map((preset) => (
              <button
                key={preset.days}
                onClick={() => handlePreset(preset.days)}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                  !isCustom && days === preset.days && "bg-accent font-medium"
                )}
              >
                {preset.label}
              </button>
            ))}
            <div className="border-t my-1" />
            <button
              onClick={() => {
                if (!range?.from) {
                  setRange({
                    from: subDays(new Date(), 30),
                    to: new Date(),
                  });
                }
                setShowCalendar(true);
              }}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                isCustom && "bg-accent font-medium"
              )}
            >
              Custom range...
            </button>
          </div>
        ) : (
          <div className="p-3">
            <button
              onClick={() => setShowCalendar(false)}
              className="mb-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              &larr; Back to presets
            </button>
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
              defaultMonth={range?.from || subDays(new Date(), 30)}
            />
            <div className="flex items-center justify-between border-t pt-3 mt-3">
              <p className="text-xs text-muted-foreground">
                {range?.from && range?.to
                  ? `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`
                  : "Pick start and end dates"}
              </p>
              <Button
                size="sm"
                disabled={!range?.from || !range?.to}
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
