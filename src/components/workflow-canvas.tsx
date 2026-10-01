"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
  applyEdgeChanges,
  applyNodeChanges,
  type NodeChange,
  type NodeHandle,
  useReactFlow,
} from "@xyflow/react";
import { ListChecks, Redo2, Undo2, X } from "lucide-react";
import "@xyflow/react/dist/style.css";
import type { WorkflowFieldType, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { WORKFLOW_FIELD_TYPES } from "@/lib/types";
import { buildCallReasonCatalogFromWorkflow } from "@/lib/call-typification";
import { validateWorkflow } from "@/lib/workflow-validation";
import { TypificationPreview } from "@/components/typification-preview";
import { Badge } from "@/components/ui";
import {
  createWorkflowStepNode,
  deleteBranch,
  deleteWorkflowStepNode,
  restoreBranch,
  restoreWorkflowStepNode,
  setStartStep,
  updateWorkflowStepNode,
  updateWorkflowStepPosition,
  upsertBranch,
  type DeletedStepSnapshot,
} from "@/app/actions/workflows";

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 56;
const DEFAULT_OPTION_ID = "__default__";
const NODE_WIDTH = 256;
const HANDLE_SIZE = 12;

// Filas de "respuesta" que dibuja cada tarjeta de paso, segun su tipo de
// campo. Es la unica fuente de verdad para las filas: tanto StepNode (para
// pintarlas) como buildHandles/stepToNode (para calcular alto y la posicion
// exacta de cada Handle) parten de esta misma lista, para que nunca queden
// desincronizadas.
function stepRows(step: WorkflowStep): { id: string; label: string }[] {
  const isChoice = step.field_type === "single_choice" || step.field_type === "combobox";
  if (isChoice) {
    return [
      ...step.options.map((o) => ({ id: `opt::${o}`, label: o })),
      { id: DEFAULT_OPTION_ID, label: "Cualquier otra respuesta" },
    ];
  }
  if (step.field_type === "multi_select") {
    return [{ id: DEFAULT_OPTION_ID, label: "Continuar (selección múltiple)" }];
  }
  return [{ id: DEFAULT_OPTION_ID, label: "Continuar" }];
}

interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  selected: boolean;
}

// Las acciones de la tarjeta llegan por contexto y no dentro de `data`: así los
// nodos solo cargan datos y las acciones pueden usar el historial del lienzo.
const StepActionsContext = createContext<{
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}>({ onSelect: () => {}, onDelete: () => {} });

type StepFlowNode = Node<StepNodeData, "stepNode">;

function fieldTypeLabel(t: WorkflowFieldType) {
  return WORKFLOW_FIELD_TYPES.find((f) => f.value === t)?.label ?? t;
}

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const { step } = data;
  const actions = useContext(StepActionsContext);
  const rows = stepRows(step);

  return (
    <div
      onClick={() => actions.onSelect(step.id)}
      className={`group relative w-64 cursor-pointer rounded-xl border bg-surface-solid shadow-sm transition-shadow hover:shadow-md ${
        data.selected ? "border-primary ring-2 ring-ring" : "border-border"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!h-3 !w-3 !border-2 !border-primary !bg-surface-solid"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!h-3 !w-3 !border-2 !border-primary !bg-surface-solid"
      />

      <button
        type="button"
        aria-label={`Eliminar ${step.name}`}
        title="Eliminar paso"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          actions.onDelete(step.id);
        }}
        className={`nodrag nopan absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-md border border-danger/30 bg-surface-solid text-danger shadow-sm transition hover:bg-danger-bg focus:outline-none focus:ring-2 focus:ring-danger/40 ${
          data.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>

      <div className="border-b border-border px-3 py-2.5" style={{ height: HEADER_HEIGHT }}>
        <div className="flex items-center gap-1.5">
          {step.is_start && (
            <Badge tone="success">Inicio</Badge>
          )}
          <Badge tone={step.is_mandatory ? "warning" : "neutral"}>
            {step.is_mandatory ? "Obligatorio" : "Opcional"}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">{step.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{fieldTypeLabel(step.field_type)}</p>
      </div>

      <div className="py-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className="relative flex items-center px-3 text-xs text-foreground"
            style={{ height: ROW_HEIGHT }}
          >
            <span className={`truncate ${row.id === DEFAULT_OPTION_ID ? "italic text-muted-foreground" : ""}`}>
              {row.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { stepNode: StepNode };

// Tanto el tamano de cada tarjeta como la posicion exacta de cada Handle
// los calcula normalmente React Flow despues del primer render, usando un
// ResizeObserver por nodo y por handle. En este entorno (Next 16 +
// Turbopack + React 19) ese ResizeObserver nunca llega a disparar su
// callback, asi que tanto los nodos (antes) como las conexiones/edges
// (ahora) quedaban invisibles para siempre aunque el DOM tuviera el
// tamano y la posicion correctos. Como conocemos de antemano la geometria
// exacta de cada tarjeta (ancho fijo + alto = header + filas, y cada
// Handle en una posicion fija dentro de esa tarjeta), la declaramos
// explicitamente en el nodo (`width`/`height` y ahora tambien `handles`)
// para que React Flow nunca dependa de esa medicion en tiempo de
// ejecucion, ni para pintar el nodo ni para trazar los edges.
function buildHandles(step: WorkflowStep): NodeHandle[] {
  const rows = stepRows(step);
  const totalHeight = HEADER_HEIGHT + rows.length * ROW_HEIGHT;
  return [
    {
      id: "in",
      type: "target",
      position: Position.Left,
      x: 0,
      y: totalHeight / 2 - HANDLE_SIZE / 2,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    },
    {
      id: "out",
      type: "source",
      position: Position.Right,
      x: NODE_WIDTH,
      y: totalHeight / 2 - HANDLE_SIZE / 2,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    },
  ];
}

function stepToNode(
  step: WorkflowStep,
  selectedId: string | null
): StepFlowNode {
  const height = HEADER_HEIGHT + stepRows(step).length * ROW_HEIGHT;
  return {
    id: step.id,
    type: "stepNode",
    position: { x: step.pos_x, y: step.pos_y },
    data: { step, selected: step.id === selectedId },
    draggable: true,
    width: NODE_WIDTH,
    height,
    initialWidth: NODE_WIDTH,
    initialHeight: height,
    handles: buildHandles(step),
  };
}

function branchToEdge(b: WorkflowStepBranch): Edge | null {
  if (!b.to_step_id) return null;
  return {
    id: b.id,
    source: b.from_step_id,
    sourceHandle: "out",
    target: b.to_step_id,
    targetHandle: "in",
    label: b.from_option ?? "Por defecto",
    type: "smoothstep",
    style: { strokeWidth: 2 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    data: { branchId: b.id, fromOption: b.from_option, createdAt: b.created_at },
  };
}

export function WorkflowCanvas(props: {
  workflowId: string;
  initialSteps: WorkflowStep[];
  initialBranches: WorkflowStepBranch[];
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Cada cambio del lienzo se guarda al instante, así que deshacer no puede ser
// solo visual: cada entrada del historial sabe revertir su cambio en la base y
// devuelve la entrada que lo vuelve a aplicar (la que va a "Rehacer").
interface HistoryEntry {
  label: string;
  run: () => Promise<HistoryEntry>;
}

const HISTORY_LIMIT = 100;
const NOTICE_MS = 8000;

type StepFields = Pick<WorkflowStep, "name" | "description" | "field_type" | "options" | "is_mandatory">;
type Position2D = { id: string; x: number; y: number };

function fromOptionOf(edge: Edge): string | null {
  return (edge.data as { fromOption?: string | null } | undefined)?.fromOption ?? null;
}

function edgeToBranch(edge: Edge, workflowId: string): WorkflowStepBranch {
  return {
    id: edge.id,
    workflow_id: workflowId,
    from_step_id: edge.source,
    from_option: fromOptionOf(edge),
    to_step_id: edge.target,
    created_at: (edge.data as { createdAt?: string } | undefined)?.createdAt ?? new Date().toISOString(),
  };
}

// Reemplaza la conexión por id y cualquier otra que salga del mismo paso con la
// misma respuesta: cada salida lleva a un solo paso.
function withBranch(edges: Edge[], branch: WorkflowStepBranch): Edge[] {
  const kept = edges.filter(
    (e) => e.id !== branch.id && !(e.source === branch.from_step_id && fromOptionOf(e) === branch.from_option)
  );
  const edge = branchToEdge(branch);
  return edge ? [...kept, edge] : kept;
}

const noSubscription = () => () => {};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function WorkflowCanvasInner({
  workflowId,
  initialSteps,
  initialBranches,
}: {
  workflowId: string;
  initialSteps: WorkflowStep[];
  initialBranches: WorkflowStepBranch[];
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edges, setEdges] = useState<Edge[]>(
    initialBranches.map(branchToEdge).filter((e): e is Edge => e !== null)
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setCenter, fitView } = useReactFlow();

  // Las operaciones del historial se ejecutan fuera del render (atajos,
  // botones, respuestas del servidor) y necesitan el estado del momento.
  const stepsRef = useRef(steps);
  const edgesRef = useRef(edges);
  useEffect(() => {
    stepsRef.current = steps;
    edgesRef.current = edges;
  }, [steps, edges]);

  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  // ---- Operaciones reversibles ----
  // Cada una aplica el cambio (base + lienzo) y devuelve la entrada que lo revierte.
  const ops = useMemo(() => {
    const removeStep = async (stepId: string, label: string): Promise<HistoryEntry> => {
      const snapshot = await deleteWorkflowStepNode({ stepId, workflowId });
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      setEdges((prev) => prev.filter((e) => e.source !== stepId && e.target !== stepId));
      setSelectedId((selected) => (selected === stepId ? null : selected));
      return { label, run: () => restoreStep(snapshot, label) };
    };

    const restoreStep = async (snapshot: DeletedStepSnapshot, label: string): Promise<HistoryEntry> => {
      const { step, branches } = await restoreWorkflowStepNode({ workflowId, snapshot });
      setSteps((prev) => [
        ...(step.is_start ? prev.map((s) => ({ ...s, is_start: false })) : prev).filter((s) => s.id !== step.id),
        step,
      ]);
      setEdges((prev) => branches.reduce(withBranch, prev));
      setSelectedId(step.id);
      return { label, run: () => removeStep(step.id, label) };
    };

    const moveSteps = async (positions: Position2D[], label: string): Promise<HistoryEntry> => {
      const previous = positions
        .map((p) => stepsRef.current.find((s) => s.id === p.id))
        .filter((s): s is WorkflowStep => Boolean(s))
        .map((s) => ({ id: s.id, x: s.pos_x, y: s.pos_y }));
      setSteps((prev) =>
        prev.map((s) => {
          const p = positions.find((item) => item.id === s.id);
          return p ? { ...s, pos_x: p.x, pos_y: p.y } : s;
        })
      );
      await Promise.all(
        positions.map((p) => updateWorkflowStepPosition({ stepId: p.id, posX: p.x, posY: p.y }))
      );
      return { label, run: () => moveSteps(previous, label) };
    };

    const updateStep = async (stepId: string, fields: StepFields, label: string): Promise<HistoryEntry> => {
      const current = stepsRef.current.find((s) => s.id === stepId);
      if (!current) throw new Error("El paso ya no está en el lienzo.");
      const previous: StepFields = {
        name: current.name,
        description: current.description,
        field_type: current.field_type,
        options: current.options,
        is_mandatory: current.is_mandatory,
      };
      await updateWorkflowStepNode({
        stepId,
        workflowId,
        name: fields.name,
        description: fields.description,
        fieldType: fields.field_type,
        options: fields.options,
        isMandatory: fields.is_mandatory,
      });
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...fields } : s)));
      return { label, run: () => updateStep(stepId, previous, label) };
    };

    const setStart = async (stepId: string | null, label: string): Promise<HistoryEntry> => {
      const previous = stepsRef.current.find((s) => s.is_start)?.id ?? null;
      await setStartStep({ workflowId, stepId });
      setSteps((prev) => prev.map((s) => ({ ...s, is_start: s.id === stepId })));
      return { label, run: () => setStart(previous, label) };
    };

    const removeBranch = async (branchId: string, label: string): Promise<HistoryEntry> => {
      const edge = edgesRef.current.find((e) => e.id === branchId);
      if (!edge) throw new Error("La conexión ya no está en el lienzo.");
      const branch = edgeToBranch(edge, workflowId);
      await deleteBranch({ branchId, workflowId });
      setEdges((prev) => prev.filter((e) => e.id !== branchId));
      return { label, run: () => putBranch(branch, label) };
    };

    const putBranch = async (branch: WorkflowStepBranch, label: string): Promise<HistoryEntry> => {
      const restored = await restoreBranch({ workflowId, branch });
      setEdges((prev) => withBranch(prev, restored));
      return { label, run: () => removeBranch(restored.id, label) };
    };

    const connect = async (
      source: string,
      target: string,
      fromOption: string | null,
      label: string
    ): Promise<HistoryEntry> => {
      const replaced = edgesRef.current.find((e) => e.source === source && fromOptionOf(e) === fromOption);
      const previous = replaced ? edgeToBranch(replaced, workflowId) : null;
      const branch = await upsertBranch({ workflowId, fromStepId: source, fromOption, toStepId: target });
      setEdges((prev) => withBranch(prev, branch));
      return {
        label,
        run: async () => {
          if (previous) await putBranch(previous, label);
          else await removeBranch(branch.id, label);
          return { label, run: () => connect(source, target, fromOption, label) };
        },
      };
    };

    return { removeStep, moveSteps, updateStep, setStart, removeBranch, connect };
  }, [workflowId]);

  // ---- Historial ----
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const busyRef = useRef(false);
  const [history, setHistory] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  });
  const [notice, setNotice] = useState<{ text: string; action: "undo" | "redo" } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMac = useSyncExternalStore(
    noSubscription,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false
  );
  const mod = isMac ? "⌘" : "Ctrl+";

  const syncHistory = useCallback(() => {
    setHistory({
      undo: undoStackRef.current.at(-1)?.label ?? null,
      redo: redoStackRef.current.at(-1)?.label ?? null,
    });
  }, []);

  const showNotice = useCallback((text: string, action: "undo" | "redo") => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ text, action });
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const record = useCallback(
    (entry: HistoryEntry) => {
      undoStackRef.current = [...undoStackRef.current, entry].slice(-HISTORY_LIMIT);
      redoStackRef.current = [];
      syncHistory();
    },
    [syncHistory]
  );

  const travel = useCallback(
    async (direction: "undo" | "redo") => {
      const from = direction === "undo" ? undoStackRef : redoStackRef;
      const to = direction === "undo" ? redoStackRef : undoStackRef;
      const entry = from.current.at(-1);
      if (!entry || busyRef.current) return;
      busyRef.current = true;
      from.current = from.current.slice(0, -1);
      syncHistory();
      try {
        const inverse = await entry.run();
        to.current = [...to.current, inverse].slice(-HISTORY_LIMIT);
        setErrorMsg(null);
        showNotice(
          direction === "undo" ? `Se deshizo: ${entry.label}.` : `Se rehízo: ${entry.label}.`,
          direction === "undo" ? "redo" : "undo"
        );
      } catch (err) {
        // Queda en su pila para poder reintentarlo.
        from.current = [...from.current, entry];
        setErrorMsg(
          `No se pudo ${direction === "undo" ? "deshacer" : "rehacer"}: ${
            err instanceof Error ? err.message : "error desconocido"
          }`
        );
      } finally {
        busyRef.current = false;
        syncHistory();
      }
    },
    [showNotice, syncHistory]
  );

  const undo = useCallback(() => void travel("undo"), [travel]);
  const redo = useCallback(() => void travel("redo"), [travel]);

  // ---- Acciones del usuario (cada una deja su entrada en el historial) ----
  const deleteStep = useCallback(
    async (stepId: string, name: string) => {
      try {
        record(await ops.removeStep(stepId, `eliminar el paso “${name}”`));
        showNotice(`Eliminaste el paso “${name}”.`, "undo");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "No se pudo eliminar el paso.");
      }
    },
    [ops, record, showNotice]
  );

  const requestDeleteStep = useCallback(
    (stepId: string) => {
      const name = steps.find((item) => item.id === stepId)?.name ?? "sin nombre";
      if (window.confirm(`¿Eliminar el paso “${name}” y sus conexiones?\nPodrás deshacerlo con ${mod}Z.`)) {
        void deleteStep(stepId, name);
      }
    },
    [deleteStep, mod, steps]
  );

  const nodes = useMemo(
    () => steps.map((s) => stepToNode(s, selectedId)),
    [steps, selectedId]
  );

  // El prop declarativo `fitView` solo corre una vez al montar y puede
  // ejecutarse antes de que los nodos terminen de medirse (quedando la
  // vista vacía o con un zoom inválido). Forzamos el ajuste de forma
  // imperativa cada vez que cambia la cantidad de pasos.
  useEffect(() => {
    if (steps.length === 0) return;
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 300 });
    });
    return () => cancelAnimationFrame(id);
  }, [steps.length, fitView]);

  // Los borrados pasan por onBeforeDelete (con historial); aquí solo llegan
  // arrastres y selección.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const kept = changes.filter((c) => c.type !== "remove");
    setSteps((prev) => {
      const asNodes = prev.map((s) => stepToNode(s, selectedId));
      const updated = applyNodeChanges(kept, asNodes);
      return updated
        .map((n) => {
          const original = prev.find((s) => s.id === n.id);
          if (!original) return null;
          return { ...original, pos_x: n.position.x, pos_y: n.position.y };
        })
        .filter((s): s is WorkflowStep => s !== null);
    });
  }, [selectedId]);

  const dragStartRef = useRef<Position2D[]>([]);

  const onNodeDragStart = useCallback((_: unknown, _node: Node, dragged: Node[]) => {
    dragStartRef.current = dragged
      .map((n) => stepsRef.current.find((s) => s.id === n.id))
      .filter((s): s is WorkflowStep => Boolean(s))
      .map((s) => ({ id: s.id, x: s.pos_x, y: s.pos_y }));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: Node, dragged: Node[]) => {
      const before = dragStartRef.current;
      dragStartRef.current = [];
      const after = dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
      after.forEach((p) => updateWorkflowStepPosition({ stepId: p.id, posX: p.x, posY: p.y }));
      const moved = after.some((p) => {
        const b = before.find((item) => item.id === p.id);
        return b && (b.x !== p.x || b.y !== p.y);
      });
      if (!moved || before.length === 0) return;
      const label = after.length === 1 ? "mover el paso" : "mover los pasos";
      record({ label, run: () => ops.moveSteps(before, label) });
    },
    [ops, record]
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => applyEdgeChanges(changes.filter((c) => c.type !== "remove"), prev));
  }, []);

  // Suprimir/Retroceso sobre algo seleccionado: se borra por las mismas
  // operaciones del historial y se cancela el borrado propio de React Flow.
  const onBeforeDelete = useCallback(
    async ({ nodes: toDelete, edges: edgesToDelete }: { nodes: Node[]; edges: Edge[] }) => {
      if (toDelete.length > 0) {
        toDelete.forEach((n) => requestDeleteStep(n.id));
        return false;
      }
      for (const edge of edgesToDelete) {
        const label = `quitar la conexión “${edge.label ?? "Por defecto"}”`;
        try {
          record(await ops.removeBranch(edge.id, label));
          showNotice(`Quitaste la conexión “${edge.label ?? "Por defecto"}”.`, "undo");
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : "No se pudo quitar la conexión.");
        }
      }
      return false;
    },
    [ops, record, requestDeleteStep, showNotice]
  );

  const [pendingConnection, setPendingConnection] = useState<{
    source: string;
    target: string;
    rows: { id: string; label: string }[];
  } | null>(null);

  const commitConnection = useCallback(
    async (source: string, target: string, fromOption: string | null) => {
      const name = (id: string) => stepsRef.current.find((s) => s.id === id)?.name ?? "paso";
      const label = `conectar “${name(source)}” con “${name(target)}”`;
      try {
        record(await ops.connect(source, target, fromOption, label));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "No se pudo guardar la conexión.");
      }
    },
    [ops, record]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const sourceStep = steps.find((s) => s.id === connection.source);
      if (!sourceStep) return;
      const rows = stepRows(sourceStep);

      if (rows.length <= 1) {
        const onlyRow = rows[0];
        const fromOption = !onlyRow || onlyRow.id === DEFAULT_OPTION_ID ? null : onlyRow.id.replace(/^opt::/, "");
        void commitConnection(connection.source, connection.target, fromOption);
        return;
      }

      // Paso con varias opciones: pedimos al usuario cual de ellas representa
      // esta conexion antes de guardar nada.
      setPendingConnection({ source: connection.source, target: connection.target, rows });
    },
    [steps, commitConnection]
  );

  const addStep = useCallback(async () => {
    const count = steps.length;
    const posX = 60 + (count % 3) * 300;
    const posY = 40 + Math.floor(count / 3) * 220;
    try {
      const newStep = await createWorkflowStepNode({
        workflowId,
        posX,
        posY,
        makeStart: count === 0,
      });
      setSteps((prev) => [...prev, newStep]);
      setSelectedId(newStep.id);
      setErrorMsg(null);
      record({ label: "agregar un paso", run: () => ops.removeStep(newStep.id, "agregar un paso") });
      requestAnimationFrame(() => {
        setCenter(newStep.pos_x + 130, newStep.pos_y + 60, { zoom: 1, duration: 400 });
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo crear el paso.");
    }
  }, [workflowId, steps.length, setCenter, ops, record]);

  // Ctrl+Z / ⌘Z deshace; Ctrl+Shift+Z, ⌘⇧Z o Ctrl+Y rehace. Dentro de un campo
  // de texto se deja el deshacer propio del navegador.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isTypingTarget(event.target) || pendingConnection) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || (key === "y" && !event.metaKey)) {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, pendingConnection]);

  const selectedStep = steps.find((s) => s.id === selectedId) ?? null;

  // La vista previa y la revisión se calculan sobre el estado vivo del lienzo
  // con el mismo código que usa la ficha: los cambios se guardan al instante y
  // llegan de inmediato a la operación, así que aquí se ve lo que se tipifica.
  const liveBranches = useMemo<WorkflowStepBranch[]>(
    () => edges.map((edge) => ({ ...edgeToBranch(edge, workflowId), created_at: "" })),
    [edges, workflowId]
  );
  const liveCatalog = useMemo(
    () => buildCallReasonCatalogFromWorkflow(steps, liveBranches),
    [steps, liveBranches]
  );
  const liveIssues = useMemo(() => validateWorkflow(steps, liveBranches), [steps, liveBranches]);

  const historyButton =
    "grid size-9 place-items-center rounded-lg border border-border bg-surface-solid text-foreground shadow transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-solid";

  const stepActions = useMemo(() => ({ onSelect, onDelete: requestDeleteStep }), [onSelect, requestDeleteStep]);

  return (
    <StepActionsContext.Provider value={stepActions}>
    <div className="space-y-4">
    <div className="relative h-[70vh] overflow-hidden rounded-xl border border-border bg-background">
      <ReactFlow
        style={{ width: "100%", height: "100%" }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onBeforeDelete={onBeforeDelete}
        deleteKeyCode={["Backspace", "Delete"]}
        onConnect={onConnect}
        onPaneClick={() => setSelectedId(null)}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} className="!bg-background" />
        <Controls showInteractive={false} className="[&_button]:!border-border [&_button]:!bg-surface-solid [&_button]:!text-foreground" />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !border-border !bg-surface-solid"
          maskColor="rgba(0,0,0,0.15)"
        />
      </ReactFlow>

      <div className="absolute left-3 top-3 flex items-center gap-2">
        <button
          onClick={addStep}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary-hover"
        >
          + Agregar paso
        </button>
        <div className="flex items-center gap-1" role="group" aria-label="Historial de cambios">
          <button
            type="button"
            onClick={undo}
            disabled={!history.undo}
            aria-label={history.undo ? `Deshacer: ${history.undo}` : "Nada que deshacer"}
            title={history.undo ? `Deshacer: ${history.undo} (${mod}Z)` : `Nada que deshacer (${mod}Z)`}
            className={historyButton}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.redo}
            aria-label={history.redo ? `Rehacer: ${history.redo}` : "Nada que rehacer"}
            title={
              history.redo
                ? `Rehacer: ${history.redo} (${isMac ? "⌘⇧Z" : "Ctrl+Y"})`
                : `Nada que rehacer (${isMac ? "⌘⇧Z" : "Ctrl+Y"})`
            }
            className={historyButton}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>
        </div>
        <span className="rounded-lg border border-border bg-surface-solid/90 px-3 py-2 text-xs text-muted-foreground shadow backdrop-blur">
          Arrastra desde el punto junto a cada respuesta hasta el siguiente paso para armar el camino.
        </span>
      </div>

      {pendingConnection && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="w-72 rounded-xl border border-border bg-surface-solid p-4 shadow-xl">
            <p className="mb-3 text-sm font-semibold text-foreground">
              ¿Qué respuesta lleva a este paso?
            </p>
            <div className="space-y-1.5">
              {pendingConnection.rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => {
                    const fromOption = row.id === DEFAULT_OPTION_ID ? null : row.id.replace(/^opt::/, "");
                    void commitConnection(pendingConnection.source, pendingConnection.target, fromOption);
                    setPendingConnection(null);
                  }}
                  className={`w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                    row.id === DEFAULT_OPTION_ID ? "italic text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPendingConnection(null)}
              className="mt-3 w-full rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="absolute left-3 top-16 z-10 max-w-md rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs font-medium text-danger shadow">
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-2 underline">
            cerrar
          </button>
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4"
      >
        {notice && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-surface-solid px-3 py-2 text-xs text-foreground shadow-lg">
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={notice.action === "undo" ? undo : redo}
              disabled={notice.action === "undo" ? !history.undo : !history.redo}
              className="rounded-md px-2 py-1 font-semibold text-primary hover:bg-surface-muted disabled:opacity-40"
            >
              {notice.action === "undo" ? `Deshacer (${mod}Z)` : "Rehacer"}
            </button>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Cerrar aviso"
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {selectedStep && (
        <StepEditorPanel
          // Se remonta si los datos guardados cambian (p. ej. al deshacer una
          // edición), para que el panel no muestre valores viejos.
          key={`${selectedStep.id}:${selectedStep.name}:${selectedStep.description ?? ""}:${selectedStep.field_type}:${selectedStep.options.join("|")}:${selectedStep.is_mandatory}`}
          step={selectedStep}
          workflowId={workflowId}
          saving={saving}
          onClose={() => setSelectedId(null)}
          onSetStart={async () => {
            try {
              record(await ops.setStart(selectedStep.id, `marcar “${selectedStep.name}” como inicio`));
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : "No se pudo marcar el inicio.");
            }
          }}
          onDelete={async () => {
            await deleteStep(selectedStep.id, selectedStep.name);
          }}
          onSave={async (patch) => {
            setSaving(true);
            try {
              record(await ops.updateStep(selectedStep.id, patch, `editar el paso “${patch.name}”`));
              setErrorMsg(null);
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : "No se pudo guardar el paso.");
            }
            setSaving(false);
          }}
        />
      )}
    </div>
    <TypificationPreview catalog={liveCatalog} issues={liveIssues} />
    </div>
    </StepActionsContext.Provider>
  );
}

function StepEditorPanel({
  step,
  saving,
  onClose,
  onSave,
  onDelete,
  onSetStart,
}: {
  step: WorkflowStep;
  workflowId: string;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: {
    name: string;
    description: string | null;
    field_type: WorkflowFieldType;
    options: string[];
    is_mandatory: boolean;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onSetStart: () => Promise<void>;
}) {
  const [name, setName] = useState(step.name);
  const [description, setDescription] = useState(step.description ?? "");
  const [fieldType, setFieldType] = useState<WorkflowFieldType>(step.field_type);
  const [options, setOptions] = useState<string[]>(step.options.length ? step.options : [""]);
  const [isMandatory, setIsMandatory] = useState(step.is_mandatory);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const needsOptions = fieldType !== "text";

  return (
    <div className="absolute right-0 top-0 flex h-full w-80 flex-col border-l border-border bg-surface-solid shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListChecks size={16} className="text-muted-foreground" aria-hidden="true" />
          Editar paso
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre del paso</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Pregunta / instrucción para el ejecutivo
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Ej: Pregunta si el cliente confirma sus datos personales"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo de respuesta</label>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as WorkflowFieldType)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {WORKFLOW_FIELD_TYPES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {needsOptions && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Opciones de respuesta
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={opt}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))
                    }
                    placeholder={`Opción ${i + 1}`}
                    className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                    className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              + Agregar opción
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isMandatory}
            onChange={(e) => setIsMandatory(e.target.checked)}
            className="rounded border-border accent-primary"
          />
          Paso obligatorio
        </label>

        {!step.is_start && (
          <button
            onClick={onSetStart}
            className="w-full rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-muted"
          >
            Marcar como primer paso del flujo
          </button>
        )}
      </div>

      <div className="space-y-2 border-t border-border px-4 py-3">
        <button
          onClick={() =>
            onSave({
              name,
              description: description || null,
              field_type: fieldType,
              options: needsOptions ? options.map((o) => o.trim()).filter(Boolean) : [],
              is_mandatory: isMandatory,
            })
          }
          disabled={saving || !name.trim()}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-lg border border-border px-3 py-2 text-xs font-medium text-danger hover:bg-danger-bg"
          >
            Eliminar paso
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="flex-1 rounded-lg bg-danger px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Confirmar
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-muted"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
