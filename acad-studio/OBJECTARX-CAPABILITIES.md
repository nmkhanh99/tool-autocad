# ObjectARX for Mac (AutoCAD 2027) — Catalog năng lực đầy đủ

Quét từ SDK 2027 trên máy (737 headers + samples) + **kiểm chứng symbol trên dylib** của chính AutoCAD 2027.app. 
`verified-symbol` = hàm có thật trong libacdb/libaccore/libgelib; `header-present` = có header, chưa chứng minh runtime; `win-only` = không có trên Mac.

**Tổng: 86 năng lực, 6 nhóm.**


## Database (AcDb*)

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ✅ | **Entity đường cong cơ bản: line, circle, arc, ellipse, spline, point** | `AcDbLine, AcDbCircle, AcDbArc, AcDbEllipse, AcDbSpline, AcDbPoint (dbents.h) + AcDbBlockTableRecord::appendAcD` | Ctor C1 tất cả class export trong libacdb.dylib; appendAcDbEntity verified (__ZN20AcDbBlockTableRecord16appendAcDbEntityE...). |
| ✅ | **Polyline: lightweight (bulge/width), 2D/3D polyline** | `AcDbPolyline (addVertexAt, setBulgeAt), AcDb2dPolyline, AcDb3dPolyline (dbents.h)` | Ctor cả 3 class export trong libacdb (34/36/26 symbol). Đọc lại vertex+bulge để tính chiều dài chính xác. |
| ✅ | **Multiline (đường song song nhiều nét)** | `AcDbMline + AcDbMlineStyle (dbmline.h)` | AcDbMline ctor export trong libacdb (18 symbol). |
| ✅ | **Text đơn dòng và MText** | `AcDbText, AcDbMText (dbents.h): setTextString, setPosition, setHeight` | Ctor export trong libacdb (AcDbText 31, AcDbMText 63 symbol). |
| ✅ | **Block definition + Block reference (insert)** | `AcDbBlockTable::add + AcDbBlockTableRecord; AcDbBlockReference: setBlockTableRecord/setPosition/setScaleFactor` | AcDbBlockReference ctor + AcDbSymbolTable::add đều export trong libacdb. |
| ✅ | **Attribute: định nghĩa và điền thuộc tính block** | `AcDbAttributeDefinition, AcDbAttribute::setAttributeFromBlock, AcDbBlockReference::appendAttribute (dbents.h)` | Verified: setAttributeFromBlock + appendAttribute export trong libacdb. |
| ✅ | **Dimension đầy đủ 7 loại: rotated, aligned, radial, diametric, angular, ordinate, arc** | `AcDbRotatedDimension, AcDbAlignedDimension, AcDbRadialDimension, AcDbDiametricDimension, AcDb2LineAngularDimen` | Ctor tất cả 7 loại export trong libacdb. |
| ✅ | **Hatch: tô vùng theo pattern, boundary loop từ điểm hoặc entity** | `AcDbHatch (dbhatch.h): appendLoop (3 overload), setPattern` | Verified cả 3 overload appendLoop; AcDbHatch ~566 symbol trong libacdb — dùng thay MPolygon trên Mac. |
| ✅ | **Leader và MLeader (chú thích mũi tên)** | `AcDbLeader (dblead.h), AcDbMLeader (dbmleader.h)` | Ctor export trong libacdb (AcDbLeader 44, AcDbMLeader 78 symbol). |
| ✅ | **Table entity + TableStyle + DataLink (bảng thông minh trong bản vẽ)** | `AcDbTable (dbtable.h): setNumRows/Columns, setTextString, setColumnWidth; AcDbTableStyle; AcDbDataLink` | AcDbTable export rất đầy đủ (hàng trăm symbol trong libacdb), AcDbDataLink 88 symbol — API bảng hoàn chỉnh trên Mac. |
| 🟡 | **3D solid / Region (khối đặc ACIS)** | `AcDb3dSolid (dbsol3d.h), AcDbRegion (dbregion.h)` | Header đủ; libacdb chỉ export acrxGetClassDesc (class registered) nhưng KHÔNG có ctor trong libacdb/libaccore — implementation nằm |
| ✅ | **Symbol tables đủ 9 loại: block, layer, linetype, textstyle, dimstyle, regapp, UCS, view, viewport** | `AcDbDatabase::getSymbolTable/getBlockTable/getLayerTable (dbmain.h), AcDbSymbolTable::add + newIterator, AcDb*` | getSymbolTable export cho cả 9 loại; add + newIterator + BlockTableRecordIterator verified. |
| ✅ | **Layer control: màu, linetype, freeze/lock, tạo layer mới** | `AcDbLayerTableRecord (dbsymtb.h): setColor, setLinetypeObjectId, setIsFrozen, setIsLocked` | Ctor + 162 symbol export trong libacdb. |
| ✅ | **Thuộc tính chung entity: layer, màu, linetype, transform** | `AcDbEntity::setLayer/setColor/setLinetype/transformBy (dbmain.h)` | Verified: setLayer (cả overload tên và ObjectId), setColor, setLinetype, transformBy(AcGeMatrix3d). |
| ✅ | **Vòng đời object: mở/đóng/xóa/nâng quyền** | `acdbOpenObject (dbmain.h/dbobjptr), AcDbObject::close/erase/upgradeOpen/downgradeOpen` | Verified đầy đủ, kể cả acdbOpenObjectOnLockedLayerForWrite. Nền tảng mọi thao tác đọc/sửa/xóa entity. |
| ✅ | **Xdata + RegApp: gắn dữ liệu mở rộng dạng resbuf vào entity** | `AcDbObject::xData/setXData (dbmain.h), resbuf + acutBuildList/acutNewRb/acutRelRb, acdbRegApp, AcDbRegAppTable` | Verified: xData/setXData, acutBuildList/NewRb/RelRb trong libacdb, acdbRegApp trong libaccore. Sample: database/xdata_dg. Cách nhẹ |
| ✅ | **Extension dictionary + Xrecord: dữ liệu có cấu trúc lớn hơn xdata** | `AcDbObject::createExtensionDictionary/extensionDictionary (dbmain.h), AcDbXrecord::setFromRbChain/rbChain (dbx` | Verified; AcDbXrecord 73 symbol trong libacdb. Samples: database/xrecord_dg, xtsndict_dg. |
| ✅ | **Named Object Dictionary và dictionary tùy biến** | `AcDbDatabase::getNamedObjectsDictionary (dbmain.h), AcDbDictionary::setAt/getAt (dbdict.h)` | Verified — nơi neo dictionary 'MEP_STUDIO' chứa registry app-level trong DWG. |
| ✅ | **Handle / ObjectId: định danh ổn định của object** | `AcDbObject::getAcDbHandle, AcDbDatabase::getAcDbObjectId(handle), acdbGetObjectId/acdbGetAdsName/acdbHandEnt (` | Verified đầy đủ — cơ chế đồng bộ 2 chiều cốt lõi: app lưu handle hex, plugin resolve về ObjectId. |
| ✅ | **Transaction: gom nhiều thao tác thành một đơn vị undo** | `acdbTransactionManager (dbtrans.h): startTransaction/endTransaction/abortTransaction/getObject` | AcDbImpTransactionManager::start/endTransaction export trong libacdb — chạy được. |
| ✅ | **Side-database: mở/tạo/lưu DWG ngoài document** | `AcDbDatabase(buildDefaultDrawing, noDocument), readDwgFile, saveAs (dbmain.h)` | Verified: ctor Ebb, readDwgFile (2 overload, có OpenMode+password), saveAs (DwgVersion+SecurityParams). Dùng cho thư viện block ng |
| ✅ | **Wblock (xuất) và Insert (nhập) database** | `AcDbDatabase::wblock (3 dạng), AcDbDatabase::insert (matrix hoặc tên block) (dbmain.h)` | Verified: 4 overload wblock + 3 overload insert trong libacdb. |
| ✅ | **Deep clone / wblock clone giữa database + id mapping** | `AcDbDatabase::deepCloneObjects, wblockCloneObjects (dbmain.h), AcDbIdMapping + AcDbIdPair (dbidmap.h)` | Verified (có DuplicateRecordCloning); AcDbIdMapping::assign/compute. Samples: database/deepclone_dg, clonenod_dg (clone dict trong |
| ✅ | **Purge và đếm tham chiếu** | `AcDbDatabase::purge(ObjectIdArray/ObjectIdGraph), countHardReferences (dbmain.h)` | Verified cả 2 overload purge + countHardReferences. |
| ✅ | **Audit / kiểm tra tính toàn vẹn** | `AcDbObject::audit(AcDbAuditInfo*), AcDbDatabase::auditXData, auditCheck* helpers (dbaudita.h)` | Verified. Không có AcDbDatabase::audit() public — audit toàn DB qua lệnh AUDIT hoặc audit từng object. |
| ✅ | **Đơn vị và header variables của database** | `AcDbDatabase::insunits/setInsunits, measurement, lunits, clayer/setClayer, cecolor, textstyle, dimstyle (dbmai` | Verified — guard đơn vị (mm vs inch) trước khi bóc khối lượng. |
| ✅ | **Extents: bounding box của entity và bản vẽ** | `AcDbEntity::getGeomExtents(AcDbExtents&), AcDbExtents::set/addPoint/addExt/addBlockExt/transformBy, AcDbDataba` | Verified đầy đủ. |
| ✅ | **Chuyển đổi tọa độ WCS/UCS và viewport hiện hành** | `acdbWcs2Ucs, acdbUcs2Wcs, acdbGetCurVportId (dbxutil.h)` | Verified trong libacdb. |
| ✅ | **Xref: attach, detach, bind, reload, resolve + phân tích đồ hình** | `acdbAttachXref, acdbDetachXref, acdbBindXrefs, acdbXBindXrefs, acdbReloadXrefs, acdbResolveCurrentXRefs (acdbx` | Verified cả 6 hàm + acdbAttachXrefWithConcatenatedName; AcDbXrefGraph 50 symbol; có cả xref compare reactor. |
| ✅ | **Truy cập entity kiểu ads/DXF-list (entget/entmake AutoLISP-style)** | `acdbEntGet/acdbEntGetX, acdbEntMod, acdbEntMake/acdbEntMakeX, acdbEntNext/acdbEntLast, acdbTblSearch` | Verified trong libaccore.dylib — cần AutoCAD chạy, không dùng cho side-database thuần. Cầu serialize resbuf DXF-group → JSON. |
| ✅ | **Group: nhóm entity có tên** | `AcDbGroup (dbgroup.h): append(ObjectId), iterator, trong Group Dictionary` | AcDbGroup 99 symbol trong libacdb. Sample: database/groups_dg. Mỗi pipe run = 1 group. |
| ✅ | **Layout, paper space viewport, layout manager** | `AcDbLayout (dblayout.h), AcDbViewport (dbents.h): setCenterPoint/setViewCenter/setCustomScale; AcDbLayoutManag` | AcDbLayout ctor (152 symbol), AcDbViewport ctor (118 symbol), AcDbLayoutManager 70 symbol. |
| 🟡 | **Wipeout (che nền)** | `AcDbWipeout (dbwipeout/imgent)` | Không thấy symbol trong libacdb/libaccore — nằm trong module AcWipeoutObj nạp runtime; cần test khi AutoCAD chạy. |
| ❓ | **MPolygon** | `AcDbMPolygon (acmpolygonobj)` | 0 symbol trong cả 4 dylib chính; trên Windows là .dbx riêng — có thể không ship trên Mac. Dùng AcDbHatch thay thế. |

## Editor / Input / Selection (AcEd*)

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ✅ | **Nhập điểm tương tác trên canvas** | `acedGetPoint, acedGetCorner (acedads.h)` | libaccore: __Z12acedGetPointPKdPKwPd (C++ mangled, không extern-C). |
| ✅ | **Nhập string/keyword tại command line** | `acedGetString, acedGetKword (acedads.h)` | libaccore: bản AcString + overload bool. |
| ✅ | **Nhập số (real/int/dist/angle)** | `acedGetReal, acedGetInt, acedGetDist, acedGetAngle (acedads.h)` | Verified đủ 4 hàm trong libaccore. |
| ✅ | **Selection set query (ssget) có filter** | `acedSSGet, acedSSLength, acedSSName, acedSSNameX, acedSSFree, acedSSAdd (acedads.h)` | Verified đầy đủ trong libaccore; hỗ trợ filter resbuf (layer, entity type). |
| ✅ | **Pickfirst selection get/set** | `acedSSGetFirst, acedSSSetFirst (aced.h)` | Verified — đọc thứ user đang chọn và set selection từ code. |
| ✅ | **Điều khiển selection hai chiều có xác nhận và stale guard** | `acedSSGet/acedSSSetFirst + AcDbHandle/ObjectId + AcDbEntity::setLayer trong document exact-target` | Control-plane tokenized chạy trong command context: activate/capture/select/move; move kiểm tra handle, type, layer và owner trước khi ghi. |
| ✅ | **Pick 1 entity (kể cả nested trong block)** | `acedEntSel, acedNEntSel (acedads.h)` | Verified; acedNEntSel pick được nested entity trong block. |
| ✅ | **Highlight subentity + selection filter** | `acedSSGet/acedSSNameX + AcDbFullSubentPath + AcDbEntity::highlight; AcEdSSGetFilter` | acedSSGet=6, AcEdSSGetFilter=14 symbol libaccore. Sample: entity/hilight_dg (GS marker). |
| ✅ | **Chạy lệnh programmatic (synchronous, non-fiber)** | `acedCommandS, acedCmdS (acedCmdNF.h); acedCommand cũ` | _acedCommandS/_acedCmdS extern-C thật trong libaccore. Phải gọi trong command context. |
| ✅ | **Đăng ký native custom commands** | `acedRegCmds->addCommand (accmd.h, AcEdCommandStack)` | AcEdImpCommandStack::addCommand verified; macro acedRegCmds trong accmd.h. Nền cho bộ lệnh MEPPIPE/MEPBOM/MEPQA. |
| ✅ | **In ra command line** | `acutPrintf (acutads.h)` | Symbol nằm trong libacdb.dylib (không phải libaccore). |
| ✅ | **Refresh command prompt sau output bất đồng bộ** | `acedPostCommandPrompt (aced.h)` | Verified trong libaccore. |
| ✅ | **Đọc/ghi system variable** | `acedGetVar, acedSetVar (acedads.h)` | Verified — đọc DWGNAME/DWGPREFIX/CLAYER kèm event; set OSMODE/CLAYER trước khi vẽ tự động. |
| 🟡 | **RAII smart pointer mở/đóng DB object** | `AcDbObjectPointer<T> (dbobjptr.h)` | Template header-only; hàm nền acdbOpenObject đã verified — dùng an toàn trên Mac. |
| ✅ | **Temporary graphics (vẽ đồ họa tạm trên canvas)** | `acedGrDraw, acedGrVecs, acedGrText, acedGrRead (acedads.h)` | Đủ bộ symbol trong libaccore — preview tuyến ống, chớp-highlight đối tượng lỗi QA. |
| ✅ | **Input point monitor/filter — tooltip và can thiệp điểm nhập** | `AcEdInputPointMonitor, AcEdInputPointFilter, AcEdInputContextReactor, AcEdInputPointManager (qua AcApDocument)` | Monitor=50, Filter=34, Manager=6 symbol libaccore. Sample: reactors/inputpoint — Monitor appendToTooltipText, Filter được SỬA điểm |
| ✅ | **Custom OSNAP mode riêng** | `AcDbCustomOsnapMode + acdbCustomOsnapManager()->addCustomOsnapMode` | 8 symbol libacdb + 29 tham chiếu libaccore (glyph/tooltip pipeline). Không có sample riêng. |

## Documents / Events / Reactors

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ✅ | **Document manager: mở/đóng/kích hoạt/tạo document** | `acDocManager (acdocman.h): appContextOpenDocument, closeDocument, activateDocument, newDocument` | acDocManagerPtr + AcApDocImpManager::open/close/activate/newDocument đều có symbol. |
| ✅ | **Gửi chuỗi lệnh vào document** | `AcApDocManager::sendStringToExecute (acdocman.h)` | Chính là API MepBridge đang dùng — xác nhận hoạt động thực tế. Giữ làm escape hatch tổng quát. |
| ✅ | **Document locking để ghi DB an toàn** | `acDocManager->lockDocument / unlockDocument, lockCurDocument (acdocman.h)` | Verified. Bắt buộc khi daemon/FSEvents trigger ghi database ngoài command context — tránh crash. |
| ✅ | **Thực thi callback trong command/application context** | `AcApDocManager::beginExecuteInCommandContext / beginExecuteInApplicationContext (acdocman.h)` | Export trực tiếp trên class public — cách chuẩn để job từ file-watch chạy code native, nền tảng nâng cấp lớn nhất cho MepBridge. |
| ✅ | **Realtime document events (open/close/switch/lock)** | `AcApDocManagerReactor (acdocman.h): documentCreated, documentToBeDestroyed, documentActivated, documentBecameC` | __ZTV21AcApDocManagerReactor + addReactor verified (24 symbol); virtuals xác nhận trong header. |
| ✅ | **Liệt kê documents đang mở** | `AcApDocManager::newAcApDocumentIterator, documentCount (acdocman.h)` | Verified — nâng cấp tính năng đếm documents hiện có của MepBridge. |
| ✅ | **Quản lý document window (tab bản vẽ) + reactor** | `AcApDocWindow / AcApDwgDocWindow / AcApDocWindowReactor (AcApDocWindow.h)` | addReactor/close/setDocument có symbol trong libaccore; không guard Windows. |
| ✅ | **Realtime command lifecycle events** | `AcEditorReactor via acedEditor->addReactor (aced.h): commandWillStart, commandEnded, commandCancelled, command` | __ZTV15AcEditorReactor (52 symbol libaccore) + AcEditorReactorEx; acedEditor qua acrxSysRegistry (libacfirst.dylib). |
| ✅ | **Drawing/database lifecycle events (open, save)** | `AcRxEventReactor via acrxEvent->addReactor (rxevent.h): dwgFileOpened, databaseConstructed, databaseToBeDestro` | __ZTV16AcRxEventReactor + desc/rxInit trong libacdb; virtuals xác nhận rxevent.h. |
| ✅ | **Per-database entity change events** | `AcDbDatabaseReactor (dbmain.h): objectAppended, objectModified, objectErased, headerSysVarChanged` | AcDbImpDatabase::addReactor/remove verified (22 symbol). Callback chạy rất thường xuyên — chỉ ghi nhận ObjectId, xử lý sau ở comma |
| ✅ | **Per-object change events** | `AcDbObjectReactor (dbmain.h): modified, erased, goodbye, openedForModify` | desc/rxInit/C1/D1 + AcDbImpObject::addReactor verified (31 symbol). |
| ✅ | **Persistent reactor — ràng buộc giữa các đối tượng, lưu bền trong DWG** | `AcDbObject::addPersistentReactor + custom AcDbObject reactor class` | addPersistentReactor 4 symbol libacdb. Sample: reactors/persreac_dg — ràng buộc sống qua save/open. |
| ✅ | **Protocol reactor — custom block insertion/alignment points** | `AcRxProtocolReactor + AcDbBlockInsertionPoints` | 7 symbol libacdb. Sample: reactors/ProtocolReactors_dg — block nhiều insertion point + tự xoay theo geometry khi insert. |

## Patterns nâng cao (Jig / Overrule / Custom Entity / Fields)

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ✅ | **Đóng gói & nạp plugin trên Mac (bundle + entrypoint)** | `acrxEntryPoint, acedRegCmds->addCommand, acrxRegisterAppMDIAware; ARX=.bundle, DBX=.framework, 64-bit, Xcode +` | guide.txt SDK mô tả đầy đủ; MepBridge đang chạy nên đã kiểm chứng thực tế. |
| ✅ | **Jig / dynamic preview khi vẽ (kéo chuột entity cập nhật realtime)** | `AcEdJig (dbjig.h): sampler()/update()/entity()/drag(); acedDragGen` | 271 symbol AcEdJig trong libaccore; acedDragGen có. Sample: database/elipsjig_dg (đã đọc source) — acquirePoint + keyword trong sa |
| ✅ | **Overrule framework — 'độ' entity chuẩn thành đối tượng MEP không cần custom entity** | `AcDbObjectOverrule, AcGiDrawableOverrule, AcDbGripOverrule, AcDbOsnapOverrule, AcDbTransformOverrule, AcDbProp` | Toàn bộ họ overrule trong libacdb (588 dòng chứa 'Overrule'). Pattern adndevblog/keanw khuyên dùng — file mở máy khác vẫn là LINE  |
| ✅ | **Custom entity / custom object (class riêng lưu trong DWG)** | `AcDbEntity/AcDbObject subclass + ACRX_DXF_DEFINE_MEMBERS + dwgIn/OutFields + dxfIn/OutFields + worldDraw` | Sample: editor/custobj_dg. AcGiWorldDraw 237 symbol libacdb. LƯU Ý: máy khác cần object enabler nếu không entity thành proxy — ưu  |
| ✅ | **Protocol extension — gắn hành vi mới cho class có sẵn lúc runtime** | `AcRxObject::queryX/x + ACRX_DECLARE_MEMBERS, AcRxClass::addX` | AcRxClass 357 symbol libacdb (addX/queryX inline nhưng RTTI runtime đầy đủ). Samples: entity/tempapp_dg (protocol ENERGY), misc/fa |
| ✅ | **Fields + custom field evaluator — nhãn/khung tên tự tính** | `AcDbField, AcFdFieldEngine, AcFdFieldEvaluator, acdbEvaluateFields` | AcDbField=262, AcFdFieldEvaluator=62, AcFdFieldEngine=22, acdbEvaluateFields=4 symbol libacdb — cả cơ chế đăng ký evaluator custom |
| ✅ | **Long transaction (cơ chế REFEDIT) — sửa block in-place** | `AcDbLongTransaction + acApLongTransactionManager (checkOut/checkIn)` | AcDbLongTransaction=32 symbol libacdb, manager=7 symbol libaccore. Sample: database/longtrans_dg. |
| ✅ | **Parametric constraints + dynamic block** | `AcDbAssoc2dConstraintGroup, AcDbAssocNetwork; AcDbDynBlockReference` | 115/44/90 symbol libacdb. API phức tạp — xếp giai đoạn sau. |
| ✅ | **AcGi graphics primitives — mesh/shell/polygon/text trong worldDraw** | `AcGiWorldDraw/AcGiViewportDraw + geometry().mesh()/shell()/polygon(), subEntityTraits` | AcGiWorldDraw 237 symbol libacdb + 122 libaccore. Samples graphics/: mesh_dg, shell_dg, traits_dg, viewgeom_dg, teselate_dg, coord |

## UI / View / Plot / Platform Mac

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ✅ | **Điều khiển view/zoom từ C++** | `acgsGetCurrentAcGsView(int), acgsSetViewParameters(int, AcGsView*, bool,bool,bool), acedSetCurrentView (acgs.h` | Cả 3 symbol trong libaccore. Lấy AcGsView* rồi gọi virtual zoom/setView qua vtable. |
| ✅ | **Zoom nội bộ (không có trong header public)** | `acedZoomAuto(short) / acedZoomAuto(short,double,double,double,double)` | Symbol có trong libaccore nhưng KHÔNG khai báo trong header SDK — API nội bộ, không nên dựa vào; dùng acgsSetViewParameters hoặc l |
| ✅ | **Plot/Publish API — in PDF programmatically** | `AcPlPlotFactory::createPublishEngine/createPreviewEngine, AcPlPlotEngine::beginPlot/beginDocument/beginPage, A` | Không có libAcPl.dylib riêng — toàn bộ AcPl* trong libaccore (39 symbol AcPlPlotEngine) + libpltcfgmgr/libplotgrad hỗ trợ; header  |
| ✅ | **Status bar & tray item của AutoCAD** | `acedGetApplicationStatusBar() → AcApStatusBar*, AcPane, AcTrayItem (AcStatusBar.h)` | Symbol verified libaccore; interface ảo gọi qua vtable. Implementation Mac là Objective-C (AcStatusBar.framework). |
| ✅ | **Plugin mở cửa sổ Cocoa riêng trong AutoCAD (Objective-C++)** | `Template ArxWithCocoa.xctemplate + EnableCocoaThreading() (libCocoaAPI.dylib)` | Template chính chủ Autodesk tại /Library/Developer/Autodesk/ObjectARX 2027/utils/templates/; plugin in-process tạo được NSWindow/N |
| ✅ | **ViewCube / SteeringWheel control** | `acedCreateSteeringWheel(), acedDestroyViewCube(AcEdViewCube*) (AcEdViewCube.h, AcEdSteeringWheel.h)` | Symbol trong libaccore; header không guard Windows. |
| ✅ | **In-place text editor (sửa text/mtext tại chỗ)** | `AcEdInplaceTextEditor (AcEdInplaceTextEditor.h)` | Symbol insertFile... trong libaccore; header không guard Windows. |
| ✅ | **Main window handle (HWND giả lập trên Mac)** | `adsw_acadMainWnd() → HWND (acedads.h:59)` | Symbol có nhưng HWND là kiểu giả lập từ WinStubs.h/libWinAPI.dylib — KHÔNG phải NSWindow thật; muốn parent cửa sổ Cocoa dùng [NSAp |
| ❓ | **UI stack nội bộ AutoCAD Mac (chỉ tham khảo kiến trúc)** | `Qt 6 (QtWidgets/QtGui), AcOCUi.framework, AcOCUiControls.framework, AcToolbar/AcStatusBar/CoreDialogs (Objecti` | Frameworks tồn tại trong app bundle nhưng SDK KHÔNG có header public — UI nội bộ, không phải API plugin được hỗ trợ. Không xây tín |

## Win-only / Không có trên Mac

| | Năng lực | API | Ghi chú |
|---|---|---|---|
| ❌ | **MFC dialog framework AcUi/AdUi (CAcUiDialog, CAdUiDialog, CWnd)** | `acui.h / acuiDialog.h / adui.h + ~50 header AcUi*/AdUi*` | Mac SDK ship afxwin.h là STUB (#error nếu không _ADESK_MAC_) — không có MFC runtime, không symbol CAcUiDialog/InitAcUiDLL trong dy |
| ❌ | **Tool Palette / PaletteSet** | `aduiPaletteSet.h / aduiPalette.h (CAdUiPaletteSet)` | Class bọc trong #ifndef _ADESK_MAC_ (dòng 59) — loại trừ tường minh trên Mac. Thay bằng NSPanel Cocoa. |
| ❌ | **OPM Property Palette (properties tùy biến trên palette Properties)** | `dynprops.h (IPropertyManager, IDynamicProperty), opmdialog.h, category.h` | dynprops.h/category.h bọc #ifdef _ADESK_WINDOWS_; opmdialog.h thuần COM. Hiển thị property MEP trong panel riêng của app thay thế. |
| ❌ | **COM/OLE automation & ActiveX wrapper** | `oleaprot.h (AcAxOleLinkManager), axobjref.h, dcdispid.h` | oleaprot.h bọc trọn #ifdef _ADESK_WINDOWS_. Không có COM trên Mac — điều khiển từ ngoài process phải qua file bridge + sendStringT |
| ❌ | **.NET managed API (AcMgd/C++-CLI interop)** | `mgdhost.h / mgdinterop.h / mgdhost-core2d.h; acdbmgd/acmgd` | mgdinterop.h include vcclr.h/gcroot.h (C++/CLI) — chỉ MSVC/Windows. Forum Autodesk xác nhận C# plugin không chạy AutoCAD Mac; plug |

## Backlog tích hợp vào Acad Studio (cập nhật)

| # | Tính năng | Effort | Trạng thái | Mô tả |
|---|---|---|---|---|
| 1 | **Realtime Events Bridge (push thay polling)** ✅ ĐÃ TÍCH HỢP | med | buildable-now | AutoCAD tự báo cho Acad Studio mọi sự kiện: mở/đóng/đổi bản vẽ active, lệnh vừa kết thúc (MOVE/COPY/E |
| 2 | **Command-context Job Runner (nâng cấp lõi MepBridge)** ✅ ĐÃ TÍCH HỢP  | med | buildable-now | Thay ghép chuỗi sendStringToExecute dễ vỡ bằng thực thi callback C++ native trong đúng command conte |
| 3 | **MEP Metadata Tagging (round-trip 2 chiều)** ✅ ĐÃ TÍCH HỢP | low | buildable-now | Gắn metadata MEP (hệ, DN, vật liệu, cách nhiệt, ID trong app) vào từng entity + registry dự án trong |
| 4 | **MEPBOM — bóc khối lượng native từ bản vẽ đang mở** ✅ ĐÃ TÍCH HỢP | med | buildable-now | Lệnh MEPBOM quét bản vẽ (theo filter layer/hệ), tính chiều dài polyline (kể cả bulge), đếm block thi |
| 5 | **Live BOQ — dirty-tracking incremental** ✅ ĐÃ TÍCH HỢP | med | buildable-now | Bảng khối lượng trong Acad Studio tự cập nhật live khi user vẽ/sửa/xóa, không cần bấm nút quét lại. |
| 6 | **Vẽ chính xác từ app (pipe/duct/block theo tọa độ)** ✅ ĐÃ TÍCH HỢP  | med | buildable-now | App tính routing → plugin vẽ trực tiếp centerline ống, chèn block fitting/thiết bị đúng tọa độ/scale |
| 7 | **Selection sync 2 chiều + QA highlight/zoom** ✅ ĐÃ TÍCH HỢP  | med | buildable-now | User chọn đối tượng trong AutoCAD → panel app hiện thông tin/khối lượng; ngược lại click 1 dòng lỗi  |
| 8 | **Doc Control — panel dự án điều khiển documents**  | low | buildable-now | Acad Studio liệt kê mọi DWG đang mở (đường dẫn, trạng thái active), mở file dự án, chuyển tab, đóng f |
| 9 | **Khung tên tự điền + tag thiết bị (attributes)**  | low | buildable-now | Điền khung tên (tên dự án, tầng, ngày, rev, người vẽ) và tag thiết bị (mã, công suất) từ database ME |
| 10 | **Thư viện thiết bị MEP (block library insert)**  | med | buildable-now | User chọn thiết bị (van, đèn, quạt, AHU, tủ điện) trong app → plugin lấy block từ file thư viện chuẩ |
| 11 | **BOQ Table ngay trong bản vẽ (AcDbTable)** ✅ ĐÃ TÍCH HỢP | med | buildable-now | Chèn bảng bóc khối lượng thành AcDbTable thật trong layout theo style chuẩn công ty; model đổi → chạ |
| 12 | **Copy tầng điển hình + Extract hệ (deep clone)** ✅ ĐÃ TÍCH HỢP | med | buildable-now | Nhân bản toàn bộ hệ ống tầng 3 sang tầng 4-10 (kèm xdata/ext dict được remap đúng); wblock riêng một |
| 13 | **Cocoa MEP Toolbar panel ngay trong AutoCAD**  | high | buildable-now | NSPanel nổi 'MEP Toolbar' trong AutoCAD: nút Vẽ ống / Bóc khối lượng / Chèn khung tên / trạng thái B |
| 14 | **Xref nền kiến trúc — setup và QA**  | med | buildable-now | Lệnh setup 1-phát: attach nền kiến trúc làm xref đúng chuẩn dự án (layer/khóa/mờ), reload khi file n |
| 15 | **Save-snapshot: lịch sử BOQ/QA theo lần save**  | low | buildable-now | Mỗi lần user Cmd+S, tự xuất snapshot khối lượng + kết quả QA vào bridge — app lưu lịch sử phiên bản, |
| 16 | **MEPPIPE — jig vẽ ống tương tác kiểu Revit** ✅ ĐÃ TÍCH HỢP  | high | buildable-now | Lệnh vẽ ống: kéo chuột thấy ngay preview ống 2 nét + elbow tự chèn tại điểm gãy, gõ keyword đổi size |
| 17 | **Overrule rendering — LINE thành ống 2 nét theo hệ**  | high | needs-restart-test | LINE/PLINE gắn xdata hệ ống được vẽ đè thành ống 2 nét + hatch cách nhiệt + mũi tên chiều dòng chảy, |
| 18 | **Batch xuất PDF hồ sơ**  | med | needs-restart-test | Nút 'Xuất PDF toàn bộ layout' trong Acad Studio: plot hàng loạt layout khung tên ra PDF không cần bấm |
| 19 | **Persistent reactor — nhãn/fitting tự bám ống**  | med | needs-restart-test | Kéo giãn ống thì nhãn size tự dời theo giữa ống, elbow đầu ống tự xoay — ràng buộc lưu trong chính D |
| 20 | **Status bar pane 'MEP Bridge' + smart field khung tên**  | med | needs-restart-test | Pane trên status bar AutoCAD báo trạng thái kết nối daemon (xanh/đỏ) + bubble khi job xong; field 'M |
| 21 | **Custom OSNAP 'MEPFIT' — bắt điểm nối fitting**  | high | research | Chế độ osnap riêng bắt đúng điểm nối của fitting/điểm tap trên ống (kể cả khi ống chỉ là LINE + over |
| 22 | **Clash check 3D bằng solid**  | high | research | Mô hình ống 3D dạng AcDb3dSolid để check va chạm giữa các hệ. |

## KHÔNG có trên Mac (đừng phí công)

- MFC dialogs AcUi/AdUi (CAcUiDialog/CAdUiDialog, ~50 header acui*/adui*) — Mac SDK ship afxwin.h stub, không có MFC runtime, không có symbol trong bất kỳ dylib nào; mọi UI phức tạp để ở app Next.js hoặc Cocoa panel (ArxWithCocoa)
- Tool Palette / PaletteSet (CAdUiPaletteSet, aduiPaletteSet.h) — bị loại trừ tường minh trên Mac bằng #ifndef _ADESK_MAC_; thay bằng NSPanel Cocoa do plugin tự mở
- OPM Property Palette (dynprops.h IPropertyManager/IDynamicProperty, category.h, opmdialog.h) — bọc #ifdef _ADESK_WINDOWS_ + thuần COM; không thêm được property MEP vào palette Properties trên Mac — hiển thị trong panel riêng của Acad Studio
- COM/OLE/ActiveX automation (oleaprot.h AcAxOleLinkManager, axobjref.h, dcdispid.h) — không có COM trên Mac, không automation kiểu VBA/COM từ ngoài process; giữ kiến trúc file bridge + sendStringToExecute
- .NET managed API (AcMgd/acdbmgd, mgdhost.h/mgdinterop.h C++/CLI) — AutoCAD Mac không có .NET API, C# plugin không chạy (forum Autodesk xác nhận); plugin phải là C++/Objective-C++ thuần
- HWND/Win32 windowing thật — adsw_acadMainWnd() trên Mac trả HWND giả lập từ WinStubs.h/libWinAPI.dylib, không phải NSWindow; parent cửa sổ Cocoa phải dùng [NSApp mainWindow]/[NSApp keyWindow]
- AcDbMPolygon (object enabler acmpolygonobj) — 0 symbol trong cả 4 dylib chính (libacdb/libaccore/libgelib/libAcPal), nhiều khả năng không ship trên Mac (chưa xác nhận 100%); dùng AcDbHatch (verified) thay thế cho vùng tô kín
- Framework UI nội bộ AutoCAD Mac (Qt 6 QtWidgets, AcOCUi.framework, AcOCUiControls.framework, AcToolbar/AcStatusBar/CoreDialogs Objective-C) — tồn tại trong app bundle nhưng không có header public, không phải API được hỗ trợ; không xây tính năng trên đó

## Đã tích hợp vào app (trạng thái hiện tại)

- **Realtime events** (rank 1): plugin reactor → `events.jsonl` → daemon SSE `/api/acad/events` → chip 🎯 trên UI + tự làm mới danh sách bản vẽ.
- **Docs/heartbeat**: `GET /api/acad/docs` — bản vẽ đang mở + plugin sống.
- **Chọn bản vẽ đích**: `target` trên `/api/acad/live` + `/api/acad/job` → plugin `sendStringToExecute` vào đúng document.
- **Livequery**: `POST /api/acad/livequery` — selection / layers / count / khung tên của bản vẽ đang mở.
- **MEPBOM native** (rank 4): plugin C++ quét model space (AcDbCurve::getDistAtParam + AcDbMline scale=DN + đếm block) → `GET /api/acad/livebom` → nút "📊 BOM live".
- Kênh nền tảng: headless AcCoreConsole (recipes), job LISP + MEP-RUN/tự-động, preview–accept–rollback.
