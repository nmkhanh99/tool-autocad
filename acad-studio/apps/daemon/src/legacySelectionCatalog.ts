export const LEGACY_SELECTION_CATALOG_MAX = 50_000;

export type SelectionCatalogSubject = {
  handle: string;
  type: string;
  layer: string;
  layerHandle: string;
  blockName?: string;
  blockHandle?: string;
};

export type SelectionCatalog = {
  space: string;
  scanned: number;
  complete: boolean;
  objects: SelectionCatalogSubject[];
};

type SelectionCatalogGroup = {
  handle: string;
  name: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedHandle(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{1,16}$/.test(raw)) return "";
  return raw.replace(/^0+(?=[0-9A-F])/, "");
}

function decodedAcadText(value: string): string {
  return value.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_match, hex) =>
    String.fromCodePoint(Number.parseInt(hex, 16)));
}

function lispString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * AutoLISP compatibility scan for AcadBridge versions before the native
 * selectionCatalog response. It visits the current layout once and writes a
 * bounded TSV file so large drawings are not accumulated in one Lisp string.
 */
export function buildLegacySelectionCatalogLisp(input: {
  outputPath: string;
  exactTarget: string;
  maxSubjects?: number;
}): string {
  const maxSubjects = Number.isInteger(input.maxSubjects) && Number(input.maxSubjects) > 0
    ? Math.min(Number(input.maxSubjects), LEGACY_SELECTION_CATALOG_MAX)
    : LEGACY_SELECTION_CATALOG_MAX;
  const outputPath = lispString(input.outputPath);
  const exactTarget = lispString(input.exactTarget);
  return `(defun acad:cat-present (acad:value)
  (and (= (type acad:value) 'STR) (> (strlen acad:value) 0)))
(defun acad:cat-block-record (acad:name / acad:btr acad:data acad:xdata acad:app acad:key acad:tag acad:resolved)
  (setq acad:btr (tblobjname "BLOCK" acad:name))
  (if acad:btr
    (progn
      (setq acad:data (entget acad:btr '("*")))
      (setq acad:xdata (cdr (assoc -3 acad:data)))
      (foreach acad:app acad:xdata
        (if (= (type acad:app) 'LIST)
          (progn
            (setq acad:key (car acad:app))
            (setq acad:key
              (cond
                ((= (type acad:key) 'STR) acad:key)
                ((= (type acad:key) 'SYM) (vl-symbol-name acad:key))
                (T "")))
            (if (= (strcase acad:key) "ACDBBLOCKREPBTAG")
              (progn
                (setq acad:tag (cdr (assoc 1005 (cdr acad:app))))
                (setq acad:resolved (if acad:tag (handent acad:tag) nil))
                (if acad:resolved (setq acad:btr acad:resolved)))))))))
  acad:btr)
(defun acad:cat-run
  (/ acad:cat-expected acad:cat-output acad:cat-name acad:cat-file
     acad:cat-space acad:cat-ss acad:cat-total acad:cat-scanned
     acad:cat-written acad:cat-index acad:cat-valid acad:cat-stream
     acad:cat-data acad:cat-handle acad:cat-type acad:cat-layer
     acad:cat-layer-record acad:cat-layer-handle acad:cat-block-name
     acad:cat-block-handle acad:cat-btr acad:cat-block-data
     acad:cat-complete)
  (setq acad:cat-expected ${exactTarget})
  (setq acad:cat-output ${outputPath})
  (setq acad:cat-name (getvar "DWGNAME"))
  (setq acad:cat-file (strcat (getvar "DWGPREFIX") acad:cat-name))
  (if (not (or (= acad:cat-expected acad:cat-name) (= acad:cat-expected acad:cat-file)))
    (acad:write-result "error" "selection_catalog_target_mismatch")
    (progn
      (setq acad:cat-space (getvar "CTAB"))
      (setq acad:cat-ss (ssget "_X" (list (cons 410 acad:cat-space))))
      (setq acad:cat-total (if acad:cat-ss (sslength acad:cat-ss) 0))
      (setq acad:cat-scanned (min acad:cat-total ${maxSubjects}))
      (setq acad:cat-written 0 acad:cat-index 0 acad:cat-valid T)
      (setq acad:cat-stream (open acad:cat-output "w"))
      (if (null acad:cat-stream)
        (acad:write-result "error" "selection_catalog_output_unavailable")
        (progn
          (while (< acad:cat-index acad:cat-scanned)
            (setq acad:cat-data
              (entget
                (ssname acad:cat-ss
                  (if (> acad:cat-index 32767)
                    (float acad:cat-index)
                    acad:cat-index))))
            (setq acad:cat-handle (cdr (assoc 5 acad:cat-data)))
            (setq acad:cat-type (cdr (assoc 0 acad:cat-data)))
            (setq acad:cat-layer (cdr (assoc 8 acad:cat-data)))
            (setq acad:cat-layer-record
              (if (acad:cat-present acad:cat-layer)
                (tblobjname "LAYER" acad:cat-layer)
                nil))
            (setq acad:cat-layer-handle
              (if acad:cat-layer-record
                (cdr (assoc 5 (entget acad:cat-layer-record)))
                nil))
            (setq acad:cat-block-name "" acad:cat-block-handle "")
            (if (= acad:cat-type "INSERT")
              (progn
                (setq acad:cat-btr
                  (acad:cat-block-record (cdr (assoc 2 acad:cat-data))))
                (if acad:cat-btr
                  (progn
                    (setq acad:cat-block-data (entget acad:cat-btr))
                    (setq acad:cat-block-name (cdr (assoc 2 acad:cat-block-data)))
                    (setq acad:cat-block-handle (cdr (assoc 5 acad:cat-block-data)))))))
            (if (and
                  (acad:cat-present acad:cat-handle)
                  (acad:cat-present acad:cat-type)
                  (acad:cat-present acad:cat-layer)
                  (acad:cat-present acad:cat-layer-handle)
                  (or (/= acad:cat-type "INSERT")
                      (and (acad:cat-present acad:cat-block-name)
                           (acad:cat-present acad:cat-block-handle))))
              (progn
                (write-line
                  (strcat "O" (chr 9)
                    acad:cat-handle (chr 9)
                    acad:cat-type (chr 9)
                    acad:cat-layer (chr 9)
                    acad:cat-layer-handle (chr 9)
                    acad:cat-block-name (chr 9)
                    acad:cat-block-handle)
                  acad:cat-stream)
                (setq acad:cat-written (1+ acad:cat-written)))
              (setq acad:cat-valid nil))
            (setq acad:cat-index (1+ acad:cat-index)))
          (setq acad:cat-complete
            (and acad:cat-valid
                 (= acad:cat-total acad:cat-scanned)
                 (= acad:cat-written acad:cat-scanned)))
          (write-line
            (strcat "META" (chr 9)
              acad:cat-space (chr 9)
              (itoa acad:cat-scanned) (chr 9)
              (if acad:cat-complete "1" "0"))
            acad:cat-stream)
          (close acad:cat-stream)
          (acad:write-result "ok" (strcat "selection_catalog=" acad:cat-output)))))))
(acad:cat-run)`;
}

export function parseLegacySelectionCatalog(raw: string): SelectionCatalog {
  let space = "";
  let scanned = -1;
  let declaredComplete = false;
  let malformed = false;
  const objects: SelectionCatalogSubject[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields[0] === "META") {
      if (fields.length !== 4 || scanned >= 0) {
        malformed = true;
        continue;
      }
      space = decodedAcadText(fields[1] || "");
      scanned = Number(fields[2]);
      declaredComplete = fields[3] === "1";
      if (!space || !Number.isInteger(scanned) || scanned < 0 ||
          scanned > LEGACY_SELECTION_CATALOG_MAX || !["0", "1"].includes(fields[3] || "")) {
        malformed = true;
      }
      continue;
    }
    if (fields[0] !== "O" || fields.length !== 7) {
      malformed = true;
      continue;
    }
    const handle = normalizedHandle(fields[1]);
    const type = String(fields[2] || "").trim();
    const layer = decodedAcadText(String(fields[3] || ""));
    const layerHandle = normalizedHandle(fields[4]);
    const blockName = decodedAcadText(String(fields[5] || ""));
    const blockHandle = normalizedHandle(fields[6]);
    const blockComplete = type !== "INSERT" || (!!blockName && !!blockHandle);
    if (!handle || !type || !layer || !layerHandle || !blockComplete || seen.has(handle)) {
      malformed = true;
      continue;
    }
    seen.add(handle);
    objects.push({
      handle,
      type,
      layer,
      layerHandle,
      ...(blockName && blockHandle ? { blockName, blockHandle } : {}),
    });
  }

  if (scanned < 0 || !space) {
    throw new Error("selection_catalog_metadata_missing");
  }
  return {
    space,
    scanned,
    complete: declaredComplete && !malformed && objects.length === scanned,
    objects,
  };
}

export function hasSelectionCatalog(snapshot: Record<string, unknown>): boolean {
  const drawing = record(snapshot.drawing);
  const catalog = record(drawing?.selectionCatalog);
  return !!catalog && Array.isArray(catalog.objects);
}

function keyedCounts(
  catalog: SelectionCatalog,
  kind: "layer" | "block",
): { handles: Map<string, number>; names: Map<string, number> } {
  const handles = new Map<string, number>();
  const names = new Map<string, number>();
  for (const subject of catalog.objects) {
    const handle = kind === "layer" ? subject.layerHandle : subject.blockHandle || "";
    const name = kind === "layer" ? subject.layer : subject.blockName || "";
    if (handle) handles.set(handle, (handles.get(handle) || 0) + 1);
    if (name) {
      const key = name.toLocaleUpperCase("en-US");
      names.set(key, (names.get(key) || 0) + 1);
    }
  }
  return { handles, names };
}

function catalogGroups(
  catalog: SelectionCatalog,
  kind: "layer" | "block",
): SelectionCatalogGroup[] {
  const groups: SelectionCatalogGroup[] = [];
  const byHandle = new Map<string, SelectionCatalogGroup>();
  const byName = new Map<string, SelectionCatalogGroup>();
  for (const subject of catalog.objects) {
    const handle = kind === "layer" ? subject.layerHandle : subject.blockHandle || "";
    const name = kind === "layer" ? subject.layer : subject.blockName || "";
    if (!handle || !name) continue;
    const nameKey = name.toLocaleUpperCase("en-US");
    const current = byHandle.get(handle) || byName.get(nameKey);
    if (current) {
      byHandle.set(handle, current);
      byName.set(nameKey, current);
      continue;
    }
    const group = { handle, name };
    groups.push(group);
    byHandle.set(handle, group);
    byName.set(nameKey, group);
  }
  return groups;
}

function withSelectableCounts(
  value: unknown,
  counts: { handles: Map<string, number>; names: Map<string, number> },
  complete: boolean,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    const row = record(item);
    if (!row) return item;
    const handle = normalizedHandle(row.handle);
    const name = String(row.name || "").trim().toLocaleUpperCase("en-US");
    const handleCount = handle ? counts.handles.get(handle) : undefined;
    const count = handleCount ?? counts.names.get(name) ?? 0;
    return {
      ...row,
      selectableCount: count,
      selectableCountExact: complete,
    };
  });
}

function withCatalogGroups(
  value: unknown,
  groups: SelectionCatalogGroup[],
  counts: { handles: Map<string, number>; names: Map<string, number> },
  complete: boolean,
): unknown {
  const source = Array.isArray(value) ? value : [];
  const rows = [...source];
  const seenHandles = new Set<string>();
  const seenNames = new Set<string>();
  for (const item of source) {
    const row = record(item);
    if (!row) continue;
    const handle = normalizedHandle(row.handle);
    const name = String(row.name || "").trim().toLocaleUpperCase("en-US");
    if (handle) seenHandles.add(handle);
    if (name) seenNames.add(name);
  }
  for (const group of groups) {
    const nameKey = group.name.toLocaleUpperCase("en-US");
    if (seenHandles.has(group.handle) || seenNames.has(nameKey)) continue;
    rows.push({ name: group.name, handle: group.handle });
    seenHandles.add(group.handle);
    seenNames.add(nameKey);
  }
  if (!rows.length && !Array.isArray(value)) return value;
  return withSelectableCounts(rows, counts, complete);
}

/** Merge the legacy scan into the same response shape as AcadBridge 1.6. */
export function attachSelectionCatalog(
  snapshot: Record<string, unknown>,
  catalog: SelectionCatalog,
): Record<string, unknown> {
  const drawing = record(snapshot.drawing) || {};
  const tables = record(snapshot.tables) || {};
  const source = record(snapshot.source) || {};
  const limits = record(snapshot.limits) || {};
  const scope = {
    ...(record(drawing.selectionScope) || record(snapshot.selectionScope) || {}),
    space: catalog.space,
    scanned: catalog.scanned,
    complete: catalog.complete,
  };
  const layerCounts = keyedCounts(catalog, "layer");
  const blockCounts = keyedCounts(catalog, "block");
  const layerGroups = catalogGroups(catalog, "layer");
  const blockGroups = catalogGroups(catalog, "block");
  const layers = withCatalogGroups(
    drawing.layers ?? tables.layers,
    layerGroups,
    layerCounts,
    catalog.complete,
  );
  const blocks = withCatalogGroups(
    drawing.blocks ?? tables.blocks,
    blockGroups,
    blockCounts,
    catalog.complete,
  );

  return {
    ...snapshot,
    source: {
      ...source,
      selectionCatalogChannel: "autolisp-compat",
    },
    selectionScope: scope,
    tables: {
      ...tables,
      layers: withCatalogGroups(
        tables.layers ?? drawing.layers,
        layerGroups,
        layerCounts,
        catalog.complete,
      ),
      blocks: withCatalogGroups(
        tables.blocks ?? drawing.blocks,
        blockGroups,
        blockCounts,
        catalog.complete,
      ),
    },
    drawing: {
      ...drawing,
      layers,
      blocks,
      selectionScope: scope,
      selectionCatalog: catalog,
    },
    limits: {
      ...limits,
      maxSelectionScopeEntities: LEGACY_SELECTION_CATALOG_MAX,
    },
  };
}
