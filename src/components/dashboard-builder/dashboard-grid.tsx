"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DashboardWidget } from "./dashboard-widget";
import { sizeToCols } from "@/lib/integrations/ulink-agent/widgets";
import type { WidgetPatch } from "@/lib/integrations/ulink-agent/widgets";
import type { Widget } from "@/lib/integrations/ulink-agent/types";

const SPAN_CLASS: Record<number, string> = {
  4: "md:col-span-4",
  6: "md:col-span-6",
  12: "md:col-span-12",
};

function SortableCell({
  widget,
  editing,
  onRefresh,
  onPatch,
  onRemove,
  onEditQuery,
}: {
  widget: Widget;
  editing: boolean;
  onRefresh: () => void;
  onPatch: (patch: WidgetPatch) => void;
  onRemove: () => void;
  onEditQuery: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={SPAN_CLASS[sizeToCols(widget.size)] ?? "md:col-span-6"}>
      <DashboardWidget
        widget={widget}
        editing={editing}
        dragHandleProps={{ ...attributes, ...listeners }}
        onRefresh={onRefresh}
        onPatch={onPatch}
        onRemove={onRemove}
        onEditQuery={onEditQuery}
      />
    </div>
  );
}

export function DashboardGrid({
  widgets,
  editing,
  onReorder,
  onRefreshWidget,
  onPatchWidget,
  onRemoveWidget,
  onEditQuery,
  children,
}: {
  widgets: Widget[];
  editing: boolean;
  onReorder: (orderedIds: string[]) => void;
  onRefreshWidget: (id: string) => void;
  onPatchWidget: (id: string, patch: WidgetPatch) => void;
  onRemoveWidget: (id: string) => void;
  onEditQuery: (id: string) => void;
  children?: React.ReactNode; // the "Add widget" tile, rendered after the cells
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = widgets.map((w) => w.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {widgets.map((w) => (
            <SortableCell
              key={w.id}
              widget={w}
              editing={editing}
              onRefresh={() => onRefreshWidget(w.id)}
              onPatch={(patch) => onPatchWidget(w.id, patch)}
              onRemove={() => onRemoveWidget(w.id)}
              onEditQuery={() => onEditQuery(w.id)}
            />
          ))}
          {children}
        </div>
      </SortableContext>
    </DndContext>
  );
}
