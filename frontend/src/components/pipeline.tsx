'use client'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { type Lead, type Stage, stages } from '../lib/demo'
import { Avatar, Source, Status } from './dashboard'
function Card({ row, open, move }: { row: Lead; open: () => void; move: (s: Stage) => void }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: row._id })
  return (
    <article
      ref={setNodeRef}
      className="pipeline-card"
      style={
        transform
          ? {
              transform: 'translate3d(' + transform.x + 'px,' + transform.y + 'px,0)',
              zIndex: isDragging ? 3 : undefined,
            }
          : undefined
      }
    >
      <div className="customer">
        <Avatar name={row.name} />
        <button className="text-button" onClick={open}>
          {row.name}
        </button>
        <button
          className="icon-button drag"
          aria-label={'Drag ' + row.name}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </button>
      </div>
      <p>{row.campaign || row.phone || 'Manual lead'}</p>
      <Source name={row.source} />
      <select
        aria-label={'Stage for ' + row.name}
        value={row.status}
        onChange={(e) => move(e.target.value as Stage)}
      >
        {stages.map((stage) => (
          <option key={stage}>{stage}</option>
        ))}
      </select>
    </article>
  )
}
function Column({
  stage,
  rows,
  open,
  move,
}: {
  stage: Stage
  rows: Lead[]
  open: (id: string) => void
  move: (id: string, status: Stage) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <section ref={setNodeRef} className={'pipeline-column ' + (isOver ? 'drag-over' : '')}>
      <header>
        <Status value={stage} />
        <span>{rows.length}</span>
      </header>
      {rows.map((row) => (
        <Card
          key={row._id}
          row={row}
          open={() => open(row._id)}
          move={(status) => move(row._id, status)}
        />
      ))}
    </section>
  )
}
export function Pipeline({
  rows,
  open,
  move,
}: {
  rows: Lead[]
  open: (id: string) => void
  move: (id: string, status: Stage) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor),
  )
  function dropped({ active, over }: DragEndEvent) {
    if (
      over &&
      stages.includes(over.id as Stage) &&
      rows.find((row) => row._id === active.id)?.status !== over.id
    )
      move(String(active.id), over.id as Stage)
  }
  return (
    <DndContext sensors={sensors} onDragEnd={dropped}>
      <div className="pipeline">
        {stages.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            rows={rows.filter((row) => row.status === stage)}
            open={open}
            move={move}
          />
        ))}
      </div>
    </DndContext>
  )
}
