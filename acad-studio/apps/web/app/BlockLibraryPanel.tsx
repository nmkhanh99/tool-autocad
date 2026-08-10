"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asRecord, daemonRecord, type JsonRecord } from "../lib/daemon/client";
import { TECHNICAL_NAME_PATTERN, validateBlockDraft, blockMatches, catalogRecord, duplicateLabel, emptyBlock, finiteNumber, localDuplicateGroups, normalizeBlock, normalizeDuplicates, normalizeSource, slugifyTechnicalName, splitList, syncLabel, textValue, type BlockDefinition, type BlockSpace, type BlockType, type DuplicateGroup, type LibrarySource, type Notice, type SyncStatus } from "../features/blocks/model";

export type BlockLibraryPanelProps = {
  open: boolean;
  daemon: string;
  initialTarget?: string;
  onClose: () => void;
  onOpenAutoCAD?: () => void;
};
















export default function BlockLibraryPanel({
  open,
  daemon,
  initialTarget = "",
  onClose,
  onOpenAutoCAD,
}: BlockLibraryPanelProps) {
  const baseUrl = daemon.replace(/\/$/, "");
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [serverDuplicates, setServerDuplicates] = useState<DuplicateGroup[]>([]);
  const [revision, setRevision] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<BlockDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [tagsInput, setTagsInput] = useState("");
  const [useCasesInput, setUseCasesInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [sourceDraft, setSourceDraft] = useState({
    kind: "dwg" as LibrarySource["kind"],
    displayName: "",
    path: "",
  });

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    const body = await daemonRecord(await fetch(`${baseUrl}/api/acad/blocks`, {
      cache: "no-store",
      signal,
    }));
    const catalog = catalogRecord(body);
    const nextBlocks = Array.isArray(catalog.blocks)
      ? catalog.blocks.map(normalizeBlock).filter((item): item is BlockDefinition => !!item)
      : [];
    const catalogSources = Array.isArray(catalog.sources)
      ? catalog.sources.map(normalizeSource).filter((item): item is LibrarySource => !!item)
      : [];
    let nextSources = catalogSources;
    setSourceError("");
    try {
      const sourceBody = await daemonRecord(await fetch(
        `${baseUrl}/api/acad/blocks/sources`,
        { cache: "no-store", signal },
      ));
      const sourceRoot = catalogRecord(sourceBody);
      if (Array.isArray(sourceRoot.sources)) {
        nextSources = sourceRoot.sources
          .map(normalizeSource)
          .filter((item): item is LibrarySource => !!item);
      }
    } catch (error) {
      if (signal?.aborted) return;
      setSourceError(error instanceof Error ? error.message : String(error));
    }
    if (dirtyRef.current) return;
    setBlocks(nextBlocks);
    setSources(nextSources);
    setRevision(textValue(catalog.revision || body.revision));
    setServerDuplicates(normalizeDuplicates(
      catalog.duplicateGroups || catalog.duplicates ||
      body.duplicateGroups || body.duplicates,
    ));
    setSelectedId((current) =>
      nextBlocks.some((block) => block.id === current) ? current : nextBlocks[0]?.id || "");
  }, [baseUrl]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setNotice(null);
    setDraftDirty(false);
    void loadCatalog(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setNotice({
            tone: "error",
            text: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, loadCatalog]);

  useEffect(() => {
    if (dirty) return;
    const selected = blocks.find((block) => block.id === selectedId);
    setDraft(selected ? { ...selected, basePoint: { ...selected.basePoint } } : null);
    setTagsInput(selected?.tags.join(", ") || "");
    setUseCasesInput(selected?.useCases.join("\n") || "");
  }, [blocks, selectedId, dirty]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  const duplicateGroups = useMemo(() => {
    const all = [...serverDuplicates, ...localDuplicateGroups(blocks)];
    const seen = new Set<string>();
    return all.filter((group) => {
      const key = `${group.reason}:${group.key.toLocaleLowerCase("en-US")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [blocks, serverDuplicates]);
  const duplicateBlockIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.blockIds)),
    [duplicateGroups],
  );
  const visibleBlocks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return blocks.filter((block) => blockMatches(block, normalized));
  }, [blocks, query]);

  function requestClose() {
    if (dirty && !window.confirm("Metadata block có thay đổi chưa lưu. Đóng và bỏ thay đổi?")) {
      return;
    }
    onClose();
  }

  function setDraftDirty(value: boolean) {
    dirtyRef.current = value;
    setDirty(value);
  }

  function chooseBlock(id: string) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Bỏ thay đổi metadata chưa lưu?")) return;
    setDraftDirty(false);
    setSelectedId(id);
  }

  function updateDraft(patch: Partial<BlockDefinition>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setDraftDirty(true);
  }

  function toggleSpace(space: BlockSpace) {
    if (!draft) return;
    const next = draft.allowedSpaces.includes(space)
      ? draft.allowedSpaces.filter((item) => item !== space)
      : [...draft.allowedSpaces, space];
    updateDraft({ allowedSpaces: next });
  }

  async function refreshAfterMutation(preferredId?: string) {
    setDraftDirty(false);
    await loadCatalog();
    if (preferredId) setSelectedId(preferredId);
  }

  async function saveMetadata() {
    if (!draft?.id) return;
    const error = validateBlockDraft(draft);
    if (error) return setNotice({ tone: "error", text: error });
    setBusy("save");
    setNotice(null);
    try {
      const body = await daemonRecord(await fetch(
        `${baseUrl}/api/acad/blocks/${encodeURIComponent(draft.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ block: draft, expectedRevision: revision }),
        },
      ));
      await refreshAfterMutation(draft.id);
      setNotice({ tone: "ok", text: textValue(body.hint || body.message) || "Đã lưu metadata block." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  async function createFromSelection() {
    if (!draft) return;
    const error = validateBlockDraft(draft);
    if (error) return setNotice({ tone: "error", text: error });
    setBusy("create");
    setNotice(null);
    try {
      const { id: _id, ...block } = draft;
      const body = await daemonRecord(await fetch(`${baseUrl}/api/acad/blocks/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          block,
          target: initialTarget,
          expectedRevision: revision,
        }),
      }));
      const created = asRecord(body.block);
      const createdId = textValue(created?.id || body.blockId);
      await refreshAfterMutation(createdId || undefined);
      setNotice({
        tone: "ok",
        text: textValue(body.hint || body.message) || "Đã tạo block từ selection và đồng bộ catalog.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  async function runBlockAction(action: "insert" | "sync") {
    if (!draft?.id || dirty) return;
    setBusy(action);
    setNotice(null);
    try {
      const body = await daemonRecord(await fetch(`${baseUrl}/api/acad/blocks/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: draft.id,
          target: initialTarget,
          expectedRevision: revision,
        }),
      }));
      await refreshAfterMutation(draft.id);
      setNotice({
        tone: "ok",
        text: textValue(body.hint || body.message) ||
          (action === "insert" ? "Đã bắt đầu chèn block trong AutoCAD." : "Đã đồng bộ block."),
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  async function scanDrawing() {
    if (dirty) return;
    setBusy("scan");
    setNotice(null);
    try {
      const body = await daemonRecord(await fetch(`${baseUrl}/api/acad/blocks/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: initialTarget, expectedRevision: revision }),
      }));
      await refreshAfterMutation(selectedId);
      setNotice({
        tone: duplicateGroups.length ? "warn" : "ok",
        text: textValue(body.hint || body.message) || "Đã quét block trong bản vẽ đang mở.",
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  async function addSource() {
    if (!sourceDraft.displayName.trim() || !sourceDraft.path.trim()) {
      return setNotice({ tone: "error", text: "Nguồn cần có tên hiển thị và đường dẫn." });
    }
    setBusy("source");
    setNotice(null);
    try {
      const body = await daemonRecord(await fetch(`${baseUrl}/api/acad/blocks/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceDraft, expectedRevision: revision }),
      }));
      const catalog = catalogRecord(body);
      if (Array.isArray(catalog.sources)) {
        setSources(catalog.sources
          .map(normalizeSource)
          .filter((item): item is LibrarySource => !!item));
      }
      setRevision(textValue(catalog.revision || body.revision));
      setSourceDraft({ kind: "dwg", displayName: "", path: "" });
      setNotice({ tone: "ok", text: textValue(body.hint || body.message) || "Đã liên kết nguồn thư viện." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  if (!open) return null;

  const formError = draft ? validateBlockDraft(draft) : "";
  const creating = !!draft && !draft.id;

  return (
    <div className="blocklib-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section className="blocklib-panel" role="dialog" aria-modal="true"
        aria-labelledby="blocklib-title">
        <header className="blocklib-head">
          <div className="blocklib-identity">
            <span className="blocklib-mark" aria-hidden="true">B</span>
            <div>
              <span>Catalog · metadata · AutoCAD</span>
              <h2 id="blocklib-title">Thư viện block</h2>
              <p>{initialTarget || "Bản vẽ đang active"}</p>
            </div>
          </div>
          <div className="blocklib-head-actions">
            {onOpenAutoCAD && (
              <button type="button" onClick={onOpenAutoCAD}>Mở AutoCAD</button>
            )}
            <button type="button" onClick={() => {
              if (dirty && !window.confirm("Nạp lại catalog và bỏ thay đổi metadata chưa lưu?")) {
                return;
              }
              setDraftDirty(false);
              setLoading(true);
              void loadCatalog()
                .catch((error) => setNotice({
                  tone: "error",
                  text: error instanceof Error ? error.message : String(error),
                }))
                .finally(() => setLoading(false));
            }} disabled={loading || !!busy} title="Nạp lại catalog">↻</button>
            <button type="button" className="blocklib-close" onClick={requestClose}
              aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="blocklib-toolbar">
          <label className="blocklib-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên, mô tả, tag, layer…" />
          </label>
          <span className="blocklib-count">{visibleBlocks.length}/{blocks.length} block</span>
          <button type="button" onClick={scanDrawing} disabled={!!busy || dirty}
            title={dirty ? "Lưu hoặc bỏ thay đổi trước khi quét" : "Quét block trong bản vẽ"}>
            {busy === "scan" ? "Đang quét…" : "Quét bản vẽ"}
          </button>
          <button type="button" className="primary" onClick={() => {
            if (dirty && !window.confirm("Bỏ thay đổi metadata chưa lưu?")) return;
            setSelectedId("");
            setDraft(emptyBlock());
            setTagsInput("");
            setUseCasesInput("");
            setDraftDirty(true);
          }} disabled={!!busy}>＋ Tạo block</button>
        </div>

        {notice && (
          <div className={`blocklib-notice ${notice.tone}`}>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <div className="blocklib-workspace">
          <aside className="blocklib-sidebar">
            {loading && !blocks.length && <div className="blocklib-list-state">Đang tải catalog…</div>}
            {!loading && !visibleBlocks.length && (
              <div className="blocklib-list-state">Không có block phù hợp.</div>
            )}
            <div className="blocklib-list">
              {visibleBlocks.map((block) => (
                <button type="button" key={block.id}
                  className={"blocklib-item" + (block.id === selectedId ? " selected" : "")}
                  onClick={() => chooseBlock(block.id)}>
                  <span className="blocklib-thumb">
                    {block.previewImage
                      ? <img src={block.previewImage} alt="" />
                      : block.displayName.slice(0, 1).toLocaleUpperCase("vi")}
                  </span>
                  <span className="blocklib-item-main">
                    <strong>{block.displayName}</strong>
                    <code>{block.technicalName}</code>
                    <span className="blocklib-badges">
                      <i className={block.type}>{block.type === "dynamic" ? "Động" : "Tĩnh"}</i>
                      {block.hasAttributes && <i className="attribute">Attribute</i>}
                      <i className={`sync ${block.syncStatus}`}>{syncLabel(block.syncStatus)}</i>
                      {duplicateBlockIds.has(block.id) && <i className="duplicate">Trùng</i>}
                    </span>
                  </span>
                  <em>{block.referenceCount ?? 0}</em>
                </button>
              ))}
            </div>
          </aside>

          <main className="blocklib-content">
            {!draft ? (
              <div className="blocklib-empty">
                <span>B</span>
                <h3>Chọn một block để xem metadata</h3>
                <p>Hoặc tạo block mới từ các đối tượng đang chọn trong AutoCAD.</p>
              </div>
            ) : (
              <>
                <div className="blocklib-detail-head">
                  <div>
                    <span>{creating ? "Block mới từ selection" : draft.cadName || "Tên CAD chưa có"}</span>
                    <h3>{draft.displayName || "Chưa đặt tên"}</h3>
                    {!creating && <code>ACADLIB:v1;id={draft.id}</code>}
                  </div>
                  <div className="blocklib-detail-actions">
                    {!creating && (
                      <>
                        <button type="button" onClick={() => runBlockAction("insert")}
                          disabled={!!busy || dirty}>Chèn block</button>
                        <button type="button" onClick={() => runBlockAction("sync")}
                          disabled={!!busy || dirty}>{busy === "sync" ? "Đang sync…" : "Sync AutoCAD"}</button>
                      </>
                    )}
                    <button type="button" className="primary"
                      onClick={creating ? createFromSelection : saveMetadata}
                      disabled={!!busy || !!formError || (!creating && !dirty)}>
                      {busy === "create" ? "Đang tạo…" : busy === "save" ? "Đang lưu…" :
                        creating ? "Tạo từ selection" : "Lưu metadata"}
                    </button>
                  </div>
                </div>

                <div className="blocklib-form">
                  <section className="blocklib-section">
                    <header><h4>Định danh và cách dùng</h4><p>Tên kỹ thuật dùng để mapping; description vẫn dễ đọc trong AutoCAD.</p></header>
                    <div className="blocklib-grid">
                      <label>
                        <span>Tên kỹ thuật ASCII *</span>
                        <div className="blocklib-inline-input">
                          <input value={draft.technicalName}
                            className={draft.technicalName && !TECHNICAL_NAME_PATTERN.test(draft.technicalName) ? "invalid" : ""}
                            onChange={(event) => updateDraft({ technicalName: event.target.value })} />
                          <button type="button" onClick={() => updateDraft({
                            technicalName: slugifyTechnicalName(draft.displayName),
                          })} title="Tạo tên không dấu từ tên hiển thị">Aa</button>
                        </div>
                      </label>
                      <label><span>Tên hiển thị *</span><input value={draft.displayName}
                        onChange={(event) => updateDraft({ displayName: event.target.value })} /></label>
                      <label><span>Danh mục</span><input value={draft.category}
                        placeholder="furniture/chair"
                        onChange={(event) => updateDraft({ category: event.target.value })} /></label>
                      <label><span>Loại block (đọc từ CAD)</span><select value={draft.type} disabled
                        onChange={(event) => updateDraft({ type: event.target.value as BlockType })}>
                        <option value="static">Block tĩnh</option>
                        <option value="dynamic" disabled={creating}>
                          Block động {creating ? "(import từ DWG/Block Editor)" : ""}
                        </option>
                      </select></label>
                      <label className="wide"><span>Description</span><textarea value={draft.description}
                        rows={3} onChange={(event) => updateDraft({ description: event.target.value })} /></label>
                      <label className="wide"><span>Tags — phân cách bằng dấu phẩy</span><input
                        value={tagsInput}
                        onChange={(event) => {
                          setTagsInput(event.target.value);
                          updateDraft({ tags: splitList(event.target.value) });
                        }} /></label>
                      <label className="wide"><span>Tình huống sử dụng</span><textarea
                        value={useCasesInput} rows={2}
                        placeholder="Mỗi dòng một trường hợp"
                        onChange={(event) => {
                          setUseCasesInput(event.target.value);
                          updateDraft({ useCases: splitList(event.target.value) });
                        }} /></label>
                      <label className="blocklib-check wide"><input type="checkbox"
                        checked={draft.hasAttributes}
                        disabled
                        onChange={(event) => updateDraft({ hasAttributes: event.target.checked })} />
                        <span>Có attribute definitions ({draft.attributeDefinitions.length}) — khi tạo, hãy chọn cả ATTDEF trong AutoCAD</span>
                      </label>
                      {!!draft.attributeDefinitions.length && (
                        <div className="blocklib-attribute-list wide">
                          {draft.attributeDefinitions.map((value, index) => {
                            const attribute = asRecord(value) || {};
                            return <code key={`${textValue(attribute.tag)}-${index}`}>
                              {textValue(attribute.tag) || `ATT_${index + 1}`}
                              {textValue(attribute.prompt) ? ` · ${textValue(attribute.prompt)}` : ""}
                            </code>;
                          })}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="blocklib-section">
                    <header><h4>Chèn và hiển thị</h4><p>Layer/space là policy; base point, unit và annotative được đọc từ definition trong CAD.</p></header>
                    <div className="blocklib-grid thirds">
                      <label><span>Layer mặc định *</span><input value={draft.defaultLayer}
                        onChange={(event) => updateDraft({ defaultLayer: event.target.value })} /></label>
                      <label><span>Đơn vị (đọc từ CAD) *</span><select value={draft.units} disabled
                        onChange={(event) => updateDraft({ units: event.target.value })}>
                        {['unitless', 'mm', 'cm', 'm', 'in', 'ft'].map((unit) =>
                          <option key={unit} value={unit}>{unit}</option>)}
                      </select></label>
                      <label><span>Nguồn DWG thư viện</span><select value={draft.sourceId || ""}
                        onChange={(event) => {
                          const source = sources.find((item) => item.id === event.target.value);
                          updateDraft({
                            sourceId: source?.id,
                            sourcePath: undefined,
                            sourceBlockName: undefined,
                          });
                        }}>
                        <option value="">Chưa liên kết</option>
                        {sources.filter((source) => source.kind === "dwg").map((source) => <option key={source.id} value={source.id}>
                          {source.displayName} · {source.kind.toUpperCase()}
                        </option>)}
                      </select></label>
                      <label><span>Tên definition trong DWG nguồn</span><input
                        value={draft.sourceBlockName || ""}
                        placeholder={draft.cadName || draft.technicalName || "BLOCK_NAME"}
                        onChange={(event) => updateDraft({
                          sourceBlockName: event.target.value || undefined,
                        })} /></label>
                      {(["x", "y", "z"] as const).map((axis) => (
                        <label key={axis}><span>Base point {axis.toUpperCase()} (chọn khi tạo)</span><input type="number" readOnly
                          value={draft.basePoint[axis]}
                          onChange={(event) => updateDraft({
                            basePoint: { ...draft.basePoint, [axis]: finiteNumber(event.target.value) },
                          })} /></label>
                      ))}
                      <div className="blocklib-field wide">
                        <span>Không gian cho phép *</span>
                        <div className="blocklib-choice-row">
                          <label className="blocklib-check"><input type="checkbox"
                            checked={draft.allowedSpaces.includes("model")}
                            onChange={() => toggleSpace("model")} /><span>Model</span></label>
                          <label className="blocklib-check"><input type="checkbox"
                            checked={draft.allowedSpaces.includes("layout")}
                            onChange={() => toggleSpace("layout")} /><span>Layout</span></label>
                        </div>
                      </div>
                      <label className="blocklib-check"><input type="checkbox" disabled
                        checked={draft.annotative}
                        onChange={(event) => updateDraft({ annotative: event.target.checked })} />
                        <span>Annotative</span></label>
                      <label className="wide"><span>Annotation scales (đọc từ CAD)</span><input readOnly
                        value={draft.scales.join(", ")} placeholder="1:50, 1:100"
                        onChange={(event) => updateDraft({ scales: splitList(event.target.value) })} /></label>
                      <label className="wide"><span>Ảnh preview (URL/đường dẫn artifact)</span><input
                        value={draft.previewImage || ""}
                        onChange={(event) => updateDraft({
                          previewImage: event.target.value || undefined,
                        })} /></label>
                      <label className="wide"><span>XTP liên quan (artifact tương thích, không phải nguồn chính)</span><input
                        value={draft.toolPalettePath || ""}
                        onChange={(event) => updateDraft({
                          toolPalettePath: event.target.value || undefined,
                        })} /></label>
                    </div>
                  </section>

                  <section className="blocklib-section blocklib-sources">
                    <header><h4>Nguồn thư viện</h4><p>Liên kết DWG, XTP hoặc ảnh; app quản lý đường dẫn, không nhúng file.</p></header>
                    <div className="blocklib-source-list">
                      {sources.map((source) => (
                        <div key={source.id}><b>{source.kind.toUpperCase()}</b><span>{source.displayName}</span>
                          <code title={source.path}>{source.path}</code></div>
                      ))}
                      {!sources.length && <p>Chưa có nguồn thư viện.</p>}
                    </div>
                    <div className="blocklib-source-add">
                      <select value={sourceDraft.kind} onChange={(event) => setSourceDraft((current) => ({
                        ...current,
                        kind: event.target.value as LibrarySource["kind"],
                      }))}>
                        <option value="dwg">DWG</option><option value="xtp">XTP</option><option value="image">Ảnh</option>
                      </select>
                      <input value={sourceDraft.displayName} placeholder="Tên nguồn"
                        onChange={(event) => setSourceDraft((current) => ({ ...current, displayName: event.target.value }))} />
                      <input value={sourceDraft.path} placeholder="Đường dẫn file/thư mục"
                        onChange={(event) => setSourceDraft((current) => ({ ...current, path: event.target.value }))} />
                      <button type="button" onClick={addSource} disabled={!!busy}>
                        {busy === "source" ? "Đang thêm…" : "Liên kết"}
                      </button>
                    </div>
                    {sourceError && <p className="blocklib-source-error">Không tải được endpoint sources: {sourceError}</p>}
                    <div className="blocklib-compat-note">
                      <b>Lưu ý tương thích:</b> XTP phụ thuộc phiên bản/sản phẩm AutoCAD và chỉ là kênh phân phối.
                      Trên macOS, dùng <b>Blocks palette</b> với DWG thư viện thay cho Tool Palettes.
                    </div>
                  </section>

                  {!!duplicateGroups.length && (
                    <section className="blocklib-section blocklib-duplicates">
                      <header><h4>Cần xử lý duplicate</h4><p>Chỉ cảnh báo — app không tự replace hoặc purge block.</p></header>
                      {duplicateGroups.map((group) => (
                        <div key={`${group.reason}-${group.key}`}>
                          <b>{duplicateLabel(group.reason)}</b><code title={group.key}>{group.key}</code>
                          <span>{group.blockIds.map((id) =>
                            blocks.find((block) => block.id === id)?.displayName || id).join(" · ")}</span>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
                {formError && <div className="blocklib-form-error">{formError}</div>}
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
