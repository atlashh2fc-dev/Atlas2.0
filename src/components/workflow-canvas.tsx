"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowFieldType, WorkflowStep, WorkflowStepBranch } from "@/lib/types";
import { WORKFLOW_FIELD_TYPES } from "@/lib/types";
import {
  createWorkflowStepNode,
  deleteBranch,
  deleteWorkflowStepNode,
  setStartStep,
  updateWorkflowStepNode,
  updateWorkflowStepPosition,
  upsertBranch,
} from "@/app/actions/workflows";

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 56;
const DEFAULT_OPTION_ID = "__default__";
const NODE_WIDTH = 256;

// Cantidad de filas de "respuesta" que dibuja cada tarjeta de paso, segun su
// tipo de campo. Se usa tanto para pintar las filas como para calcular el
// alto exacto del nodo (ver comentario en stepToNode mas abajo).
function stepRowCount(step: WorkflowStep) {
  const isChoice = step.field_type === "single_choice" || step.field_type === "combobox";
  if (isChoice) return step.options.length + 1;
  return 1;
}

interface StepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  onSelect: (id: string) => void;
  selected: boolean;
}

type StepFlowNode = Node<StepNodeData, "stepNode">;

function fieldTypeLabel(t: WorkflowFieldType) {
  return WORKFLOW_FIELD_TYPES.find((f) => f.value === t)?.label ?? t;
}

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const { step } = data;
  const isChoice = step.field_type === "single_choice" || step.field_type === "combobox";
  const rows: { id: string; label: string }[] = isChoice
    ? [
        ...step.options.map((o) => ({ id: `opt::${o}`, label: o })),
        { id: DEFAULT_OPTION_ID, label: "Cualquier otra respuesta" },
      ]
    : step.field_type === "multi_select"
      ? [{ id: DEFAULT_OPTION_ID, label: "Continuar (selección múltiple)" }]
      : [{ id: DEFAULT_OPTION_ID, label: "Continuar" }];

  return (
    <div
      onClick={() => data.onSelect(step.id)}
      className={`w-64 cursor-pointer rounded-xl border bg-surface shadow-sm transition-shadow ${
        data.selected ? "border-primary ring-2 ring-ring" : "border-border"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!h-3 !w-3 !border-2 !border-primary !bg-surface"
      />

      <div className="border-b border-border px-3 py-2.5" style={{ height: HEADER_HEIGHT }}>
        <div className="flex items-center gap-1.5">
          {step.is_start && (
            <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold text-success">
              INICIO
            </span>
          )}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              step.is_mandatory ? "bg-warning-bg text-warning" : "bg-surface-muted text-muted-foreground"
            }`}
          >
            {step.is_mandatory ? "Obligatorio" : "Opcional"}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">{step.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{fieldTypeLabel(step.field_type)}</p>
      </div>

      <div className="py-1">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="relative flex items-center px-3 text-xs text-foreground"
            style={{ height: ROW_HEIGHT }}
          >
            <span className={`truncate ${row.id === DEFAULT_OPTION_ID ? "italic text-muted-foreground" : ""}`}>
              {row.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={row.id}
              style={{ top: HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 }}
              className="!h-3 !w-3 !border-2 !border-primary !bg-surface"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { stepNode: StepNode };

function stepToNode(step: WorkflowStep, onSelect: (id: string) => void, selectedId: string | null): StepFlowNode {
  // @xyflow/react solo deja de poner `visibility: hidden` en un nodo cuando
  // sabe sus dimensiones (node.measured / node.width / node.initialWidth).
  // Normalmente las averigua con un ResizeObserver despues del primer
  // render, pero en este entorno (Next 16 + Turbopack + React 19) ese
  // ResizeObserver nunca llega a disparar su callback, asi que los nodos
  // quedaban invisibles para siempre aunque el DOM ya tuviera el tamano
  // correcto. Como conocemos el tamano exacto de cada tarjeta de antemano
  // (ancho fijo w-64 + alto = header + filas), lo declaramos explicitamente
  // para que React Flow nunca dependa de esa medicion en tiempo de
  // ejecucion.
  const height = HEADER_HEIGHT + stepRowCount(step) * ROW_HEIGHT;
  return {
    id: step.id,
    type: "stepNode",
    position: { x: step.pos_x, y: step.pos_y },
    data: { step, onSelect, selected: step.id === selectedId },
    draggable: true,
    width: NODE_WIDTH,
    height,
    initialWidth: NODE_WIDTH,
    initialHeight: height,
  };
}

function branchToEdge(b: WorkflowStepBranch): Edge | null {
  if (!b.to_step_id) return null;
  return {
    id: b.id,
    source: b.from_step_id,
    sourceHandle: b.from_option === null ? DEFAULT_OPTION_ID : `opt::${b.from_option}`,
    target: b.to_step_id,
    targetHandle: "in",
    label: b.from_option ?? "Por defecto",
    type: "smoothstep",
    style: { strokeWidth: 2 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    data: { branchId: b.id },
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

  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  const nodes = useMemo(
    () => steps.map((s) => stepToNode(s, onSelect, selectedId)),
    [steps, selectedId, onSelect]
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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setSteps((prev) => {
      const asNodes = prev.map((s) => stepToNode(s, onSelect, selectedId));
      const updated = applyNodeChanges(changes, asNodes);
      return updated
        .map((n) => {
          const original = prev.find((s) => s.id === n.id);
          if (!original) return null;
          return { ...original, pos_x: n.position.x, pos_y: n.position.y };
        })
        .filter((s): s is WorkflowStep => s !== null);
    });
  }, [onSelect, selectedId]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    updateWorkflowStepPosition({ stepId: node.id, posX: node.position.x, posY: node.position.y });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => {
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      removed.forEach((id) => {
        const edge = prev.find((e) => e.id === id);
        const branchId = (edge?.data as { branchId?: string } | undefined)?.branchId;
        if (branchId) deleteBranch({ branchId, workflowId });
      });
      return applyEdgeChanges(changes, prev);
    });
  }, [workflowId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle) return;
      const fromOption = connection.sourceHandle === DEFAULT_OPTION_ID
        ? null
        : connection.sourceHandle.replace(/^opt::/, "");

      setEdges((prev) =>
        prev.filter((e) => !(e.source === connection.source && e.sourceHandle === connection.sourceHandle))
      );

      upsertBranch({
        workflowId,
        fromStepId: connection.source,
        fromOption,
        toStepId: connection.target,
      }).then((branch) => {
        const edge = branchToEdge(branch);
        if (edge) setEdges((prev) => [...prev.filter((e) => e.id !== edge.id), edge]);
      });
    },
    [workflowId]
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
      requestAnimationFrame(() => {
        setCenter(newStep.pos_x + 130, newStep.pos_y + 60, { zoom: 1, duration: 400 });
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo crear el paso.");
    }
  }, [workflowId, steps.length, setCenter]);

  const selectedStep = steps.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="relative h-[70vh] overflow-hidden rounded-xl border border-border bg-background">
      <ReactFlow
        style={{ width: "100%", height: "100%" }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => setSelectedId(null)}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} className="!bg-background" />
        <Controls showInteractive={false} className="[&_button]:!border-border [&_button]:!bg-surface [&_button]:!text-foreground" />
        <MiniMap
          pannable
          zoomable
          className="!bg-surface"
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
        <span className="rounded-lg bg-surface/90 px-3 py-2 text-xs text-muted-foreground shadow backdrop-blur">
          Arrastra desde el punto junto a cada respuesta hasta el siguiente paso para armar el camino.
        </span>
      </div>

      {errorMsg && (
        <div className="absolute left-3 top-16 z-10 max-w-md rounded-lg bg-danger-bg px-3 py-2 text-xs font-medium text-danger shadow">
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-2 underline">
            cerrar
          </button>
        </div>
      )}

      {selectedStep && (
        <StepEditorPanel
          key={selectedStep.id}
          step={selectedStep}
          workflowId={workflowId}
          saving={saving}
          onClose={() => setSelectedId(null)}
          onSetStart={async () => {
            try {
              await setStartStep({ workflowId, stepId: selectedStep.id });
              setSteps((prev) => prev.map((s) => ({ ...s, is_start: s.id === selectedStep.id })));
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : "No se pudo marcar el inicio.");
            }
          }}
          onDelete={async () => {
            try {
              await deleteWorkflowStepNode({ stepId: selectedStep.id, workflowId });
              setSteps((prev) => prev.filter((s) => s.id !== selectedStep.id));
              setEdges((prev) => prev.filter((e) => e.source !== selectedStep.id && e.target !== selectedStep.id));
              setSelectedId(null);
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : "No se pudo eliminar el paso.");
            }
          }}
          onSave={async (patch) => {
            setSaving(true);
            try {
              await updateWorkflowStepNode({
                stepId: selectedStep.id,
                workflowId,
                name: patch.name,
                description: patch.description,
                fieldType: patch.field_type,
                options: patch.options,
                isMandatory: patch.is_mandatory,
              });
              setSteps((prev) =>
                prev.map((s) => (s.id === selectedStep.id ? { ...s, ...patch } : s))
              );
              setErrorMsg(null);
            } catch (err) {
              setErrorMsg(err instanceof Error ? err.message : "No se pudo guardar el paso.");
            }
            setSaving(false);
          }}
        />
      )}
    </div>
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
    <div className="absolute right-0 top-0 flex h-full w-80 flex-col border-l border-border bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Editar paso</h3>
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
            className="rounded border-border"
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
              className="flex-1 rounded-lg bg-danger px-3 py-2 text-xs font-medium text-white hover:opacity-90"
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
