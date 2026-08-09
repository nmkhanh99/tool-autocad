"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import styles from "./CadWebViewerPanel.module.css";
import type {
  CadWebRenderLayer,
  CadWebViewerDocument,
  CadWebWorkerRequest,
  CadWebWorkerResponse,
} from "./cadweb.worker";

export type CadWebViewerPanelProps = {
  open: boolean;
  onClose: () => void;
  className?: string;
};

const numberFormat = new Intl.NumberFormat("vi-VN");
const VERTEX_STRIDE = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCoordinate(value: number): string {
  return numberFormat.format(Math.round(value * 1000) / 1000);
}

function argbToCss(argb: number): string {
  const value = argb >>> 0;
  return `#${((value >>> 16) & 0xff).toString(16).padStart(2, "0")}${((
    value >>> 8
  ) & 0xff)
    .toString(16)
    .padStart(2, "0")}${(value & 0xff).toString(16).padStart(2, "0")}`;
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("WebGL2 không thể tạo shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader không biên dịch được.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = createShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
      layout(location = 0) in vec2 a_position;
      layout(location = 1) in vec4 a_color;
      uniform vec2 u_center;
      uniform vec2 u_scale;
      uniform float u_point_size;
      out lowp vec4 v_color;
      void main() {
        vec2 projected = (a_position - u_center) * u_scale;
        gl_Position = vec4(projected, 0.0, 1.0);
        gl_PointSize = u_point_size;
        v_color = a_color;
      }
    `,
  );
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
      precision mediump float;
      in lowp vec4 v_color;
      uniform bool u_round_point;
      out vec4 out_color;
      void main() {
        if (u_round_point && distance(gl_PointCoord, vec2(0.5)) > 0.5) {
          discard;
        }
        out_color = v_color;
      }
    `,
  );
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("WebGL2 không thể tạo chương trình render.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Shader không link được.";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function visibleBounds(
  layers: readonly CadWebRenderLayer[],
  hiddenLayerIds: ReadonlySet<string>,
): readonly [number, number, number, number] | null {
  let bounds: [number, number, number, number] | null = null;
  for (const layer of layers) {
    if (hiddenLayerIds.has(layer.id) || layer.bounds === null) {
      continue;
    }
    if (bounds === null) {
      bounds = [...layer.bounds];
      continue;
    }
    bounds[0] = Math.min(bounds[0], layer.bounds[0]);
    bounds[1] = Math.min(bounds[1], layer.bounds[1]);
    bounds[2] = Math.max(bounds[2], layer.bounds[2]);
    bounds[3] = Math.max(bounds[3], layer.bounds[3]);
  }
  return bounds;
}

function uploadAndDraw(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  vertices: Float32Array,
  mode: number,
  roundPointUniform: WebGLUniformLocation | null,
): void {
  if (vertices.length === 0) {
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VERTEX_STRIDE * 4, 0);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, VERTEX_STRIDE * 4, 2 * 4);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.uniform1i(roundPointUniform, mode === gl.POINTS ? 1 : 0);
  gl.drawArrays(mode, 0, vertices.length / VERTEX_STRIDE);
}

function renderCadWeb(
  canvas: HTMLCanvasElement,
  document: CadWebViewerDocument,
  hiddenLayerIds: ReadonlySet<string>,
): string | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  if (gl === null) {
    return "Trình duyệt này không cung cấp WebGL2. Hãy dùng Chrome, Edge hoặc Safari mới hơn.";
  }

  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.clearColor(0.025, 0.043, 0.055, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const bounds = visibleBounds(document.layers, hiddenLayerIds);
  if (bounds === null) {
    return null;
  }

  try {
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    if (buffer === null) {
      gl.deleteProgram(program);
      return "WebGL2 không thể cấp phát vertex buffer.";
    }

    const centerX = (bounds[0] + bounds[2]) / 2;
    const centerY = (bounds[1] + bounds[3]) / 2;
    const spanX = Math.max(bounds[2] - bounds[0], 1e-6);
    const spanY = Math.max(bounds[3] - bounds[1], 1e-6);
    const pixelsPerUnit = Math.min((width * 0.88) / spanX, (height * 0.88) / spanY);

    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_center"), centerX, centerY);
    gl.uniform2f(
      gl.getUniformLocation(program, "u_scale"),
      (2 * pixelsPerUnit) / width,
      (2 * pixelsPerUnit) / height,
    );
    gl.uniform1f(gl.getUniformLocation(program, "u_point_size"), 7 * pixelRatio);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const roundPointUniform = gl.getUniformLocation(program, "u_round_point");
    for (const layer of document.layers) {
      if (hiddenLayerIds.has(layer.id)) {
        continue;
      }
      uploadAndDraw(gl, buffer, layer.lineVertices, gl.LINES, roundPointUniform);
      uploadAndDraw(gl, buffer, layer.markerVertices, gl.POINTS, roundPointUniform);
    }

    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

export default function CadWebViewerPanel({
  open,
  onClose,
  className,
}: CadWebViewerPanelProps) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const layerIdsRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [document, setDocument] = useState<CadWebViewerDocument | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./cadweb.worker.ts", import.meta.url), {
        type: "module",
        name: "cadweb-reader",
      });
    } catch (cause) {
      setLoadError(
        `Không thể khởi tạo worker đọc CADWeb: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return;
    }

    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<CadWebWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestIdRef.current) {
        return;
      }
      setLoadingName(null);
      if (response.type === "error") {
        setDocument(null);
        setLoadError(`${response.code ? `${response.code}: ` : ""}${response.message}`);
        return;
      }
      if (response.type === "reset-needed") {
        setLoadError(
          `Cần tải lại snapshot${response.currentRevision === undefined
            ? ""
            : ` từ revision ${response.currentRevision}`}: ${response.code}: ${response.message}`,
        );
        return;
      }
      if (response.type === "reset") {
        setDocument(null);
        setHiddenLayerIds(new Set());
        layerIdsRef.current = new Set();
        setLoadError(null);
        return;
      }

      setDocument(response.document);
      const nextLayerIds = new Set(response.document.layers.map((layer) => layer.id));
      if (response.mode === "delta" || response.mode === "recovery") {
        setHiddenLayerIds((current) => {
          const next = new Set([...current].filter((id) => nextLayerIds.has(id)));
          for (const layer of response.document.layers) {
            if (!layerIdsRef.current.has(layer.id) && !layer.defaultVisible) {
              next.add(layer.id);
            }
          }
          return next;
        });
      } else {
        setHiddenLayerIds(
          new Set(
            response.document.layers
              .filter((layer) => !layer.defaultVisible)
              .map((layer) => layer.id),
          ),
        );
      }
      layerIdsRef.current = nextLayerIds;
      setLoadError(null);
    };
    worker.onerror = (event) => {
      setLoadingName(null);
      setLoadError(`Worker CADWeb gặp lỗi: ${event.message}`);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      setLoadingName(null);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousFocus = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || document === null) {
      setRenderError(null);
      return;
    }

    const draw = () => {
      setRenderError(renderCadWeb(canvas, document, hiddenLayerIds));
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [document, hiddenLayerIds]);

  const visiblePrimitiveCount = useMemo(() => {
    if (document === null) {
      return 0;
    }
    return document.layers.reduce((total, layer) => {
      if (hiddenLayerIds.has(layer.id)) {
        return total;
      }
      return (
        total +
        layer.lineVertices.length / (VERTEX_STRIDE * 2) +
        layer.markerVertices.length / VERTEX_STRIDE
      );
    }, 0);
  }, [document, hiddenLayerIds]);

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) {
      return;
    }
    if (workerRef.current === null) {
      setLoadError("Worker đọc CADWeb chưa sẵn sàng.");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setDocument(null);
    setHiddenLayerIds(new Set());
    setLoadError(null);
    setRenderError(null);
    setLoadingName(file.name);
    const request: CadWebWorkerRequest = { type: "load", requestId, file };
    workerRef.current.postMessage(request);
  };

  const toggleLayer = (layerId: string) => {
    setHiddenLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const resetLayerVisibility = () => {
    if (document === null) {
      return;
    }
    setHiddenLayerIds(
      new Set(
        document.layers.filter((layer) => !layer.defaultVisible).map((layer) => layer.id),
      ),
    );
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
    <section
      ref={panelRef}
      className={`${styles.panel}${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cadweb-viewer-title"
      tabIndex={-1}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CADWEB VIEWER · WEBGL2</span>
          <h2 id="cadweb-viewer-title">{document?.sourceFileName ?? "Mở bản vẽ .cadweb"}</h2>
          <p>
            {document
              ? `${document.archiveName} · ${formatBytes(document.archiveSize)}`
              : "Đọc ZIP, kiểm tra SHA-256 và giải mã FlatBuffers trong Web Worker."}
          </p>
        </div>
        <label className={styles.fileButton}>
          <input
            type="file"
            accept=".cadweb,application/zip"
            onChange={onFileSelected}
          />
          {document ? "Mở file khác" : "Chọn file .cadweb"}
        </label>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Đóng CADWeb Viewer"
        >
          ×
        </button>
      </header>

      {(loadError || renderError) && (
        <div className={styles.error} role="alert">
          <strong>Không thể hiển thị bản vẽ</strong>
          <span>{loadError ?? renderError}</span>
        </div>
      )}

      <div className={styles.workspace} aria-busy={loadingName !== null}>
        <aside className={styles.layersPanel} aria-label="Danh sách layer">
          <div className={styles.panelTitle}>
            <div>
              <strong>Layers</strong>
              <span>{document ? document.layers.length : 0}</span>
            </div>
            {document && (
              <button type="button" onClick={resetLayerVisibility}>
                Theo file
              </button>
            )}
          </div>
          {document === null ? (
            <p className={styles.asideEmpty}>Layer sẽ xuất hiện sau khi file hợp lệ được đọc.</p>
          ) : (
            <div className={styles.layerList}>
              {document.layers.map((layer) => (
                <label className={styles.layerRow} key={layer.id}>
                  <input
                    type="checkbox"
                    checked={!hiddenLayerIds.has(layer.id)}
                    onChange={() => toggleLayer(layer.id)}
                  />
                  <i style={{ backgroundColor: argbToCss(layer.colorArgb) }} />
                  <span title={layer.name}>{layer.name || layer.id}</span>
                  <small>{layer.entityCount}</small>
                  {layer.locked && <b title="Layer bị khóa">⌑</b>}
                </label>
              ))}
            </div>
          )}
        </aside>

        <div className={styles.canvasArea}>
          <canvas ref={canvasRef} aria-label="Bản vẽ CADWeb trên WebGL2" />
          {loadingName && (
            <div className={styles.canvasMessage} role="status" aria-live="polite">
              <span className={styles.spinner} />
              <strong>Đang kiểm tra {loadingName}</strong>
              <small>Giải nén, checksum và FlatBuffers đang chạy trong worker…</small>
            </div>
          )}
          {!loadingName && document === null && !loadError && (
            <div className={styles.canvasMessage}>
              <span className={styles.emptyIcon}>⌗</span>
              <strong>Chưa có bản vẽ</strong>
              <small>Viewer chỉ nhận contract .cadweb v1, không đọc JSON geometry thay thế.</small>
            </div>
          )}
          {!loadingName && document && visiblePrimitiveCount === 0 && !renderError && (
            <div className={styles.canvasMessage}>
              <span className={styles.emptyIcon}>◎</span>
              <strong>Không có primitive đang hiển thị</strong>
              <small>Bật lại layer hoặc xem cảnh báo export ở bảng thông tin.</small>
            </div>
          )}
          {document && (
            <div className={styles.legend}>
              <span><i className={styles.lineLegend} /> Line / Polyline / Arc / Circle</span>
              <span><i className={styles.pointLegend} /> Text marker</span>
              <b>XY · Fit extents</b>
            </div>
          )}
        </div>

        <aside className={styles.infoPanel} aria-label="Thông tin CADWeb">
          <div className={styles.panelTitle}>
            <div>
              <strong>Thông tin</strong>
              {document && (
                <span className={styles[document.exportStatus]}>{document.exportStatus}</span>
              )}
            </div>
          </div>
          {document === null ? (
            <div className={styles.help}>
              <strong>Pipeline đọc an toàn</strong>
              <ol>
                <li>Kiểm tra ZIP và đường dẫn entry</li>
                <li>Đối chiếu size + SHA-256</li>
                <li>Validate manifest/layers/report</li>
                <li>Verify và parse FlatBuffers</li>
              </ol>
            </div>
          ) : (
            <>
              <dl className={styles.metadata}>
                <div><dt>Format</dt><dd>CADWeb {document.formatVersion}</dd></div>
                <div><dt>Producer</dt><dd>{document.producer}</dd></div>
                <div><dt>Platform</dt><dd>{document.platform}</dd></div>
                <div><dt>Đơn vị</dt><dd>{document.units}</dd></div>
                <div><dt>Entities</dt><dd>{numberFormat.format(document.entityCount)}</dd></div>
                <div><dt>Đã render</dt><dd>{numberFormat.format(document.renderedEntityCount)}</dd></div>
                <div><dt>Block defs</dt><dd>{numberFormat.format(document.blockDefinitionCount)}</dd></div>
                <div>
                  <dt>Extents X</dt>
                  <dd>{formatCoordinate(document.extents.min[0])} → {formatCoordinate(document.extents.max[0])}</dd>
                </div>
                <div>
                  <dt>Extents Y</dt>
                  <dd>{formatCoordinate(document.extents.min[1])} → {formatCoordinate(document.extents.max[1])}</dd>
                </div>
              </dl>
              <details className={styles.warnings} open={document.warnings.length > 0}>
                <summary>
                  Cảnh báo <span>{document.warnings.length}</span>
                </summary>
                {document.warnings.length === 0 ? (
                  <p>Không có cảnh báo từ exporter hoặc viewer.</p>
                ) : (
                  <ul>
                    {document.warnings.map((warning, index) => (
                      <li key={`${index}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                )}
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
    </div>
  );
}
