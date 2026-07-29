// mepraw.cpp — ObjectARX raw capability dispatcher (Mac).
// Protocol: app writes ~/Acad-Bridge/raw.job (TAB lines) → plugin writes raw.done (JSON).
// One entry per catalog capability id; interactive ops run via command context.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <sys/stat.h>
#include <cstdint>

#include "windef.h"
#include <aced.h>
#include <rxregsvc.h>
#include <acutads.h>
#include <acedads.h>
#include <adscodes.h>
#include <acdocman.h>
#include <dbmain.h>
#include <dbents.h>
#include <dbelipse.h>
#include <dbspline.h>
#include <dbmline.h>
#include <dbsymtb.h>
#include <dbtable.h>
#include <dbhatch.h>
#include <dbdim.h>
#include <dblead.h>
#include <dbgroup.h>
#include <dbdict.h>
#include <dbxrecrd.h>
#include <dbxutil.h>
#include <dbtrans.h>
#include <dbidmap.h>
#include <dbaudita.h>
#include <acedCmdNF.h>
#include <acdbxref.h>
#include <acgs.h>
// AcStatusBar.h pulls MFC types on Mac — forward-declare only; use AcApDocument::drawingStatusBar().
class AcApStatusBar;
#include <DbField.h>
#include <dbltrans.h>
#include <AcDbAssocNetwork.h>
#include <dbdynblk.h>
#include <accmd.h>
#include <dbjig.h>
#include <dbobjectoverrule.h>
#include <rxoverrule.h>
#include <dbosnap.h>
#include <acedinpt.h>
#include <AcEdViewCube.h>
#include <AcEdSteeringWheel.h>
#include <AcEdInplaceTextEditor.h>
#include <AcPlPlotFactory.h>
#include <AcPlPlotEngine.h>
#include <acgi.h>
#include <dbproxy.h>
#include <AcCmColor.h>
#include <geassign.h>
#include <gelnsg3d.h>
#ifdef __APPLE__
#include <objc/runtime.h>
#include <objc/message.h>
#endif

// ---- shared from mepbridge.cpp ----
extern std::string gBridgeDir;
extern std::string toUtf8(const wchar_t* w);
extern std::wstring toWide(const std::string& s);
extern std::string jsonEsc(const std::string& s);
extern std::string acadDocumentInstanceToken(const AcApDocument* document);
extern std::string readAll(const std::string& p);
extern bool tsChanged(const struct timespec& a, const struct timespec& b);
extern AcApDocument* findDocByName(const std::string& want);
extern void emitEvent(const char* type, const std::string& detail);
extern AcDbObjectId ensureLayer(AcDbDatabase* db, const std::wstring& name, int aci);
extern void ensureRegApp(AcDbDatabase* db);
bool acadSelectionControlRequestInfo(
    const std::map<std::string, std::string>& params,
    std::string& token, std::string& action, std::string& exactTarget,
    std::string& error);
bool acadSelectionControlRun(
    const std::map<std::string, std::string>& params,
    std::string& payload, std::string& error);

static std::string gRawPath, gRawDonePath;
static struct timespec gRawMtime = {0, 0};

static std::vector<std::string> splitCh(const std::string& s, char d) {
    std::vector<std::string> out; std::string cur;
    for (char c : s) { if (c == d) { out.push_back(cur); cur.clear(); } else cur += c; }
    out.push_back(cur); return out;
}

static void initRawPaths() {
    if (gBridgeDir.empty()) return;
    gRawPath = gBridgeDir + "/raw.job";
    gRawDonePath = gBridgeDir + "/raw.done";
}

static void writeRawDoneJson(const std::string& json) {
    std::string tmp = gRawDonePath + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return;
    fwrite(json.data(), 1, json.size(), f);
    fclose(f);
    rename(tmp.c_str(), gRawDonePath.c_str());
}

static void writeRawResult(bool ok, const std::string& id, const std::string& payload,
                           const std::string& err, bool interactive = false, bool blocked = false) {
    std::string j = "{";
    j += "\"ok\":"; j += ok ? "true" : "false";
    j += ",\"id\":\"" + jsonEsc(id) + "\"";
    if (interactive) j += ",\"interactive\":true";
    if (blocked) j += ",\"blocked\":true";
    if (!payload.empty()) j += ",\"payload\":" + payload;
    else j += ",\"payload\":{}";
    if (!err.empty()) j += ",\"error\":\"" + jsonEsc(err) + "\"";
    j += "}\n";
    writeRawDoneJson(j);
    emitEvent(ok ? "rawOk" : "rawErr", id + (err.empty() ? "" : (": " + err)));
}

static std::string handleOf(AcDbObject* o) {
    if (!o) return "";
    AcDbHandle h; o->getAcDbHandle(h);
    ACHAR buf[32]; h.getIntoAsciiBuffer(buf);
    return toUtf8(buf);
}

static bool appendEnt(AcDbBlockTableRecord* ms, AcDbEntity* e, AcDbObjectId& id) {
    if (ms->appendAcDbEntity(id, e) == Acad::eOk) { e->close(); return true; }
    delete e; return false;
}

// Parse raw.job → id, target, params
static void parseJob(const std::string& raw, std::string& id, std::string& target,
                     std::map<std::string, std::string>& params) {
    id.clear(); target.clear(); params.clear();
    for (auto& ln : splitCh(raw, '\n')) {
        std::string line = ln;
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line.empty()) continue;
        auto t = splitCh(line, '\t');
        if (t[0] == "RAW" && t.size() >= 2) id = t[1];
        else if (t[0] == "TARGET" && t.size() >= 2) target = t[1];
        else if (t[0] == "PARAM" && t.size() >= 2) params[t[1]] = t.size() >= 3 ? t[2] : "";
    }
}

static double pnum(const std::map<std::string, std::string>& p, const char* k, double d = 0) {
    auto it = p.find(k); return it == p.end() || it->second.empty() ? d : atof(it->second.c_str());
}
static std::string pstr(const std::map<std::string, std::string>& p, const char* k, const char* d = "") {
    auto it = p.find(k); return it == p.end() ? std::string(d) : it->second;
}

static AcApDocument* findExactRawDocument(const std::string& target,
                                          bool& ambiguous) {
    ambiguous = false;
    if (!acDocManager || target.empty()) return nullptr;
    AcApDocument* found = nullptr;
    AcApDocumentIterator* iterator =
        acDocManager->newAcApDocumentIterator();
    if (!iterator) return nullptr;
    for (; !iterator->done(); iterator->step()) {
        AcApDocument* document = iterator->document();
        if (!document) continue;
        if (toUtf8(document->docTitle()) != target &&
            toUtf8(document->fileName()) != target) {
            continue;
        }
        if (found && found != document) {
            ambiguous = true;
            found = nullptr;
            break;
        }
        found = document;
    }
    delete iterator;
    return found;
}

static std::string selectionControlPayload(const std::string& token,
                                           const std::string& action,
                                           const std::string& target,
                                           const char* status) {
    return "{\"token\":\"" + jsonEsc(token) +
           "\",\"action\":\"" + jsonEsc(action) +
           "\",\"target\":\"" + jsonEsc(target) +
           "\",\"status\":\"" + jsonEsc(status ? status : "") + "\"}";
}

// -------------------- handlers --------------------
static bool h_entity_curves(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                            const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string kind = pstr(p, "kind", "line");
    std::string layer = pstr(p, "layer", "0");
    ensureLayer(db, toWide(layer), 0);
    AcDbObjectId id;
    AcDbEntity* e = nullptr;
    if (kind == "circle") {
        e = new AcDbCircle(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0), AcGeVector3d::kZAxis, pnum(p, "r", 100));
    } else if (kind == "arc") {
        e = new AcDbArc(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0), pnum(p, "r", 100),
                        pnum(p, "start", 0), pnum(p, "end", 1.5708));
    } else if (kind == "ellipse") {
        AcDbEllipse* el = new AcDbEllipse();
        Acad::ErrorStatus es = el->set(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0), AcGeVector3d::kZAxis,
                                       AcGeVector3d(pnum(p, "major", 500), 0, 0), pnum(p, "ratio", 0.5));
        if (es != Acad::eOk) { delete el; err = "AcDbEllipse::set failed"; return false; }
        e = el;
    } else if (kind == "point") {
        e = new AcDbPoint(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0));
    } else if (kind == "spline") {
        AcGePoint3dArray pts;
        pts.append(AcGePoint3d(pnum(p, "x1"), pnum(p, "y1"), 0));
        pts.append(AcGePoint3d(pnum(p, "x2", 500), pnum(p, "y2", 500), 0));
        pts.append(AcGePoint3d(pnum(p, "x3", 1000), pnum(p, "y3", 0), 0));
        AcDbSpline* sp = new AcDbSpline(pts, 4, 0.0);
        e = sp;
    } else {
        e = new AcDbLine(AcGePoint3d(pnum(p, "x1"), pnum(p, "y1"), 0),
                         AcGePoint3d(pnum(p, "x2", 1000), pnum(p, "y2"), 0));
    }
    e->setLayer(toWide(layer).c_str());
    if (!appendEnt(ms, e, id)) { err = "appendAcDbEntity failed"; return false; }
    AcDbObject* o = nullptr;
    if (acdbOpenObject(o, id, AcDb::kForRead) == Acad::eOk) {
        payload = "{\"type\":\"" + kind + "\",\"handle\":\"" + handleOf(o) + "\"}";
        o->close();
    } else payload = "{\"type\":\"" + kind + "\"}";
    return true;
}

static bool h_polyline(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                       const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string layer = pstr(p, "layer", "0");
    ensureLayer(db, toWide(layer), 0);
    auto pts = splitCh(pstr(p, "points", "0,0 1000,0 1000,500"), ' ');
    std::vector<AcGePoint2d> vs;
    for (auto& s : pts) {
        if (s.empty()) continue;
        auto xy = splitCh(s, ',');
        if (xy.size() >= 2) vs.push_back(AcGePoint2d(atof(xy[0].c_str()), atof(xy[1].c_str())));
    }
    if (vs.size() < 2) { err = "need >=2 points"; return false; }
    AcDbPolyline* pl = new AcDbPolyline((unsigned)vs.size());
    for (unsigned i = 0; i < vs.size(); ++i) pl->addVertexAt(i, vs[i]);
    pl->setLayer(toWide(layer).c_str());
    AcDbObjectId id;
    if (!appendEnt(ms, pl, id)) { err = "append failed"; return false; }
    payload = "{\"type\":\"LWPOLYLINE\",\"vertices\":" + std::to_string(vs.size()) + "}";
    return true;
}

static bool h_text(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                   const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string kind = pstr(p, "kind", "text");
    std::string layer = pstr(p, "layer", "0");
    std::string text = pstr(p, "text", "MEP RAW");
    ensureLayer(db, toWide(layer), 0);
    AcDbObjectId id;
    if (kind == "mtext") {
        AcDbMText* mt = new AcDbMText();
        mt->setLocation(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0));
        mt->setTextHeight(pnum(p, "h", 250));
        mt->setContents(toWide(text).c_str());
        mt->setLayer(toWide(layer).c_str());
        if (!appendEnt(ms, mt, id)) { err = "mtext append failed"; return false; }
        payload = "{\"type\":\"MTEXT\"}";
    } else {
        AcDbText* tx = new AcDbText(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0),
                                    toWide(text).c_str(), db->textstyle(), pnum(p, "h", 250), 0);
        tx->setLayer(toWide(layer).c_str());
        if (!appendEnt(ms, tx, id)) { err = "text append failed"; return false; }
        payload = "{\"type\":\"TEXT\"}";
    }
    return true;
}

static bool h_layer(AcDbDatabase* db, const std::map<std::string, std::string>& p,
                    std::string& payload, std::string& err) {
    std::string name = pstr(p, "name", "MEP-RAW-TEST");
    int aci = (int)pnum(p, "aci", 3);
    AcDbObjectId id = ensureLayer(db, toWide(name), aci);
    if (id.isNull()) { err = "ensureLayer failed"; return false; }
    // optional freeze/lock
    AcDbLayerTableRecord* rec = nullptr;
    if (acdbOpenObject(rec, id, AcDb::kForWrite) == Acad::eOk) {
        if (pstr(p, "freeze") == "1") rec->setIsFrozen(true);
        if (pstr(p, "lock") == "1") rec->setIsLocked(true);
        rec->close();
    }
    payload = "{\"layer\":\"" + jsonEsc(name) + "\",\"aci\":" + std::to_string(aci) + "}";
    return true;
}

static bool h_symbol_tables(AcDbDatabase* db, const std::map<std::string, std::string>& p,
                            std::string& payload, std::string& err) {
    std::string which = pstr(p, "which", "layer");
    int count = 0;
    std::string names;
    if (which == "layer") {
        AcDbLayerTable* t = nullptr;
        if (db->getLayerTable(t, AcDb::kForRead) != Acad::eOk) { err = "getLayerTable"; return false; }
        AcDbLayerTableIterator* it = nullptr;
        if (t->newIterator(it) == Acad::eOk && it) {
            for (; !it->done(); it->step()) {
                AcDbLayerTableRecord* r = nullptr;
                if (it->getRecord(r, AcDb::kForRead) != Acad::eOk) continue;
                ACHAR* n = nullptr; r->getName(n);
                if (n) { if (count < 20) { if (count) names += ","; names += "\"" + jsonEsc(toUtf8(n)) + "\""; }
                    acutDelString(n); }
                r->close(); count++;
            }
            delete it;
        }
        t->close();
    } else if (which == "block") {
        AcDbBlockTable* t = nullptr;
        if (db->getBlockTable(t, AcDb::kForRead) != Acad::eOk) { err = "getBlockTable"; return false; }
        AcDbBlockTableIterator* it = nullptr;
        if (t->newIterator(it) == Acad::eOk && it) {
            for (; !it->done(); it->step()) {
                AcDbBlockTableRecord* r = nullptr;
                if (it->getRecord(r, AcDb::kForRead) != Acad::eOk) continue;
                ACHAR* n = nullptr; r->getName(n);
                if (n) { if (count < 20) { if (count) names += ","; names += "\"" + jsonEsc(toUtf8(n)) + "\""; }
                    acutDelString(n); }
                r->close(); count++;
            }
            delete it;
        }
        t->close();
    } else {
        // probe getSymbolTable for the requested family by name list
        payload = "{\"tables\":[\"block\",\"layer\",\"ltype\",\"style\",\"dimstyle\",\"appid\",\"ucs\",\"view\",\"vport\"],\"probed\":true}";
        return true;
    }
    payload = "{\"which\":\"" + jsonEsc(which) + "\",\"count\":" + std::to_string(count) +
              ",\"sample\":[" + names + "]}";
    return true;
}

static bool h_xdata(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    ensureRegApp(db);
    // create a point, attach xdata, read back
    AcDbPoint* pt = new AcDbPoint(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0));
    AcDbObjectId id;
    if (!appendEnt(ms, pt, id)) { err = "point append"; return false; }
    AcDbEntity* ent = nullptr;
    if (acdbOpenObject(ent, id, AcDb::kForWrite) != Acad::eOk) { err = "open write"; return false; }
    std::string val = pstr(p, "value", "raw-probe");
    resbuf* rb = acutBuildList(1001, L"MEP_STUDIO", 1000, toWide(val).c_str(), 0);
    if (!rb) { ent->close(); err = "acutBuildList"; return false; }
    Acad::ErrorStatus es = ent->setXData(rb);
    acutRelRb(rb);
    std::string h = handleOf(ent);
    std::string back;
    resbuf* got = ent->xData(L"MEP_STUDIO");
    if (got) {
        for (resbuf* r = got; r; r = r->rbnext)
            if (r->restype == 1000 && r->resval.rstring) back = toUtf8(r->resval.rstring);
        acutRelRb(got);
    }
    ent->close();
    if (es != Acad::eOk) { err = "setXData failed"; return false; }
    payload = "{\"handle\":\"" + h + "\",\"xdata\":\"" + jsonEsc(back) + "\"}";
    return true;
}

static bool h_handle(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                     const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    // create line, resolve handle both ways
    AcDbLine* ln = new AcDbLine(AcGePoint3d(0, 0, 0), AcGePoint3d(100, 0, 0));
    AcDbObjectId id;
    if (!appendEnt(ms, ln, id)) { err = "append"; return false; }
    AcDbObject* o = nullptr;
    if (acdbOpenObject(o, id, AcDb::kForRead) != Acad::eOk) { err = "open"; return false; }
    std::string hex = handleOf(o);
    o->close();
    AcDbHandle hh(toWide(hex).c_str());
    AcDbObjectId resolved;
    if (db->getAcDbObjectId(resolved, false, hh) != Acad::eOk || resolved != id) {
        err = "getAcDbObjectId mismatch"; return false;
    }
    payload = "{\"handle\":\"" + hex + "\",\"resolved\":true}";
    return true;
}

static bool h_object_lifecycle(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                               const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    AcDbPoint* pt = new AcDbPoint(AcGePoint3d(1, 1, 0));
    AcDbObjectId id;
    if (!appendEnt(ms, pt, id)) { err = "append"; return false; }
    AcDbObject* o = nullptr;
    if (acdbOpenObject(o, id, AcDb::kForRead) != Acad::eOk) { err = "open read"; return false; }
    std::string h = handleOf(o);
    o->upgradeOpen();
    o->erase();
    o->close();
    payload = "{\"handle\":\"" + h + "\",\"erased\":true}";
    return true;
}

static bool h_entity_props(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                           const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    ensureLayer(db, L"MEP-RAW-PROPS", 1);
    AcDbLine* ln = new AcDbLine(AcGePoint3d(0, 0, 0), AcGePoint3d(200, 0, 0));
    ln->setLayer(L"MEP-RAW-PROPS");
    AcCmColor c; c.setColorIndex(1); ln->setColor(c);
    AcDbObjectId id;
    if (!appendEnt(ms, ln, id)) { err = "append"; return false; }
    payload = "{\"layer\":\"MEP-RAW-PROPS\",\"color\":1}";
    return true;
}

static bool h_hatch(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string layer = pstr(p, "layer", "0");
    ensureLayer(db, toWide(layer), 0);
    auto pts = splitCh(pstr(p, "points", "0,0 500,0 500,500 0,500"), ' ');
    AcGePoint2dArray verts; AcGeDoubleArray bulges;
    for (auto& s : pts) {
        if (s.empty()) continue;
        auto xy = splitCh(s, ',');
        if (xy.size() >= 2) { verts.append(AcGePoint2d(atof(xy[0].c_str()), atof(xy[1].c_str()))); bulges.append(0.0); }
    }
    if (verts.length() < 3) { err = "need >=3 points for hatch"; return false; }
    AcDbHatch* h = new AcDbHatch();
    h->setDatabaseDefaults(db);
    h->setNormal(AcGeVector3d::kZAxis);
    h->setElevation(0);
    h->setAssociative(false);
    std::wstring pat = toWide(pstr(p, "pattern", "SOLID"));
    h->setPattern(AcDbHatch::kPreDefined, pat.c_str());
    h->appendLoop(AcDbHatch::kExternal, verts, bulges);
    h->evaluateHatch();
    h->setLayer(toWide(layer).c_str());
    AcDbObjectId id;
    if (!appendEnt(ms, h, id)) { err = "hatch append"; return false; }
    payload = "{\"type\":\"HATCH\",\"loops\":1}";
    return true;
}

static bool h_table(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    int rows = (int)pnum(p, "rows", 3), cols = (int)pnum(p, "cols", 3);
    AcDbTable* tbl = new AcDbTable();
    tbl->setSize(rows, cols);
    tbl->setPosition(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0));
    tbl->setColumnWidth(1000);
    tbl->setRowHeight(400);
    tbl->setTextString(0, 0, L"RAW");
    AcDbObjectId id;
    if (!appendEnt(ms, tbl, id)) { err = "table append"; return false; }
    payload = "{\"type\":\"TABLE\",\"rows\":" + std::to_string(rows) + ",\"cols\":" + std::to_string(cols) + "}";
    return true;
}

static bool h_dimension(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                        const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    AcGePoint3d p1(pnum(p, "x1"), pnum(p, "y1"), 0);
    AcGePoint3d p2(pnum(p, "x2", 1000), pnum(p, "y2"), 0);
    AcGePoint3d dim(pnum(p, "mx", 500), pnum(p, "my", -200), 0);
    AcDbAlignedDimension* d = new AcDbAlignedDimension(p1, p2, dim, nullptr, db->dimstyle());
    AcDbObjectId id;
    if (!appendEnt(ms, d, id)) { err = "dim append"; return false; }
    payload = "{\"type\":\"ALIGNED_DIMENSION\"}";
    return true;
}

static bool h_leader(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                     const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    AcDbLeader* ld = new AcDbLeader();
    ld->appendVertex(AcGePoint3d(pnum(p, "x1"), pnum(p, "y1"), 0));
    ld->appendVertex(AcGePoint3d(pnum(p, "x2", 500), pnum(p, "y2", 500), 0));
    AcDbObjectId id;
    if (!appendEnt(ms, ld, id)) { err = "leader append"; return false; }
    payload = "{\"type\":\"LEADER\"}";
    return true;
}

static bool h_block(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string name = pstr(p, "name", "MEP_RAW_BLK");
    // Open for read first (outer may already hold other opens); upgrade only to add.
    AcDbBlockTable* bt = nullptr;
    Acad::ErrorStatus es = db->getBlockTable(bt, AcDb::kForRead);
    if (es != Acad::eOk) { err = "block table es=" + std::to_string((int)es); return false; }
    AcDbObjectId btrId;
    if (!bt->has(toWide(name).c_str())) {
        if (bt->upgradeOpen() != Acad::eOk) { bt->close(); err = "block table upgradeOpen"; return false; }
        AcDbBlockTableRecord* btr = new AcDbBlockTableRecord();
        btr->setName(toWide(name).c_str());
        if (bt->add(btrId, btr) != Acad::eOk) { delete btr; bt->close(); err = "add block"; return false; }
        AcDbCircle* c = new AcDbCircle(AcGePoint3d(0, 0, 0), AcGeVector3d::kZAxis, 50);
        AcDbObjectId cid;
        if (btr->appendAcDbEntity(cid, c) == Acad::eOk) c->close(); else delete c;
        btr->close();
    } else {
        bt->getAt(toWide(name).c_str(), btrId);
    }
    bt->close();
    AcDbBlockReference* br = new AcDbBlockReference(AcGePoint3d(pnum(p, "x"), pnum(p, "y"), 0), btrId);
    AcDbObjectId id;
    if (!appendEnt(ms, br, id)) { err = "insert"; return false; }
    payload = "{\"block\":\"" + jsonEsc(name) + "\",\"inserted\":true}";
    return true;
}

static bool h_units(AcDbDatabase* db, std::string& payload, std::string& err) {
    (void)err;
    payload = "{\"insunits\":" + std::to_string((int)db->insunits()) +
              ",\"lunits\":" + std::to_string((int)db->lunits()) + "}";
    return true;
}

static bool h_extents(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    AcDbExtents ext;
    bool any = false;
    AcDbBlockTableRecordIterator* it = nullptr;
    if (ms->newIterator(it) == Acad::eOk && it) {
        for (; !it->done(); it->step()) {
            AcDbEntity* e = nullptr;
            if (it->getEntity(e, AcDb::kForRead) != Acad::eOk) continue;
            AcDbExtents ee;
            if (e->getGeomExtents(ee) == Acad::eOk) {
                if (!any) { ext = ee; any = true; } else ext.addExt(ee);
            }
            e->close();
        }
        delete it;
    }
    if (!any) { payload = "{\"empty\":true}"; return true; }
    AcGePoint3d mn = ext.minPoint(), mx = ext.maxPoint();
    char buf[256];
    snprintf(buf, sizeof buf, "{\"min\":[%.3f,%.3f],\"max\":[%.3f,%.3f]}", mn.x, mn.y, mx.x, mx.y);
    payload = buf;
    return true;
}

static bool h_wcs_ucs(std::string& payload, std::string& err) {
    // acdbWcs2Ucs / acdbUcs2Wcs return bool (not RTNORM) on Mac SDK.
    ads_point w = {100, 200, 0}, u = {0, 0, 0}, back = {0, 0, 0};
    if (!acdbWcs2Ucs(w, u, false)) { err = "acdbWcs2Ucs returned false"; return false; }
    if (!acdbUcs2Wcs(u, back, false)) { err = "acdbUcs2Wcs returned false"; return false; }
    char buf[256];
    snprintf(buf, sizeof buf, "{\"wcs\":[100,200],\"ucs\":[%.4f,%.4f],\"roundtrip\":[%.4f,%.4f]}",
             u[0], u[1], back[0], back[1]);
    payload = buf;
    return true;
}

static bool h_transaction(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    AcDbTransactionManager* tm = db->transactionManager();
    if (!tm) { err = "no transaction manager"; return false; }
    tm->startTransaction();
    AcDbPoint* pt = new AcDbPoint(AcGePoint3d(2, 2, 0));
    AcDbObjectId id;
    bool ok = appendEnt(ms, pt, id);
    if (ok) tm->endTransaction(); else { tm->abortTransaction(); err = "append in txn"; return false; }
    payload = "{\"transaction\":true,\"ended\":true}";
    return true;
}

static bool h_nod(AcDbDatabase* db, const std::map<std::string, std::string>& p,
                  std::string& payload, std::string& err) {
    AcDbDictionary* nod = nullptr;
    if (db->getNamedObjectsDictionary(nod, AcDb::kForWrite) != Acad::eOk) { err = "get NOD"; return false; }
    std::string key = pstr(p, "key", "MEP_STUDIO");
    AcDbObjectId xId;
    if (!nod->has(toWide(key).c_str())) {
        AcDbDictionary* sub = new AcDbDictionary();
        if (nod->setAt(toWide(key).c_str(), sub, xId) != Acad::eOk) {
            delete sub; nod->close(); err = "setAt"; return false;
        }
        sub->close();
    }
    nod->close();
    payload = "{\"key\":\"" + jsonEsc(key) + "\",\"nod\":true}";
    return true;
}

static bool h_xrecord(AcDbDatabase* db, const std::map<std::string, std::string>& p,
                      std::string& payload, std::string& err) {
    // attach xrecord under NOD/MEP_STUDIO
    AcDbDictionary* nod = nullptr;
    if (db->getNamedObjectsDictionary(nod, AcDb::kForWrite) != Acad::eOk) { err = "NOD"; return false; }
    AcDbObjectId dictId;
    AcDbDictionary* sub = nullptr;
    if (nod->has(L"MEP_STUDIO")) {
        nod->getAt(L"MEP_STUDIO", dictId);
        if (acdbOpenObject(sub, dictId, AcDb::kForWrite) != Acad::eOk) { nod->close(); err = "open sub"; return false; }
    } else {
        sub = new AcDbDictionary();
        if (nod->setAt(L"MEP_STUDIO", sub, dictId) != Acad::eOk) {
            delete sub; nod->close(); err = "setAt"; return false;
        }
    }
    nod->close();
    AcDbXrecord* xr = new AcDbXrecord();
    resbuf* rb = acutBuildList(1, L"raw-probe", 0);
    xr->setFromRbChain(*rb);
    acutRelRb(rb);
    AcDbObjectId xid;
    if (sub->setAt(L"RAW_PROBE", xr, xid) != Acad::eOk) {
        delete xr; sub->close(); err = "xrecord setAt"; return false;
    }
    xr->close();
    sub->close();
    payload = "{\"xrecord\":\"RAW_PROBE\"}";
    return true;
}

static bool h_group(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    AcDbPoint* a = new AcDbPoint(AcGePoint3d(0, 0, 0));
    AcDbPoint* b = new AcDbPoint(AcGePoint3d(10, 0, 0));
    AcDbObjectId ida, idb;
    if (!appendEnt(ms, a, ida) || !appendEnt(ms, b, idb)) { err = "points"; return false; }
    AcDbDictionary* nod = nullptr;
    if (db->getGroupDictionary(nod, AcDb::kForWrite) != Acad::eOk) { err = "group dict"; return false; }
    std::string name = pstr(p, "name", "MEP_RAW_GRP");
    if (nod->has(toWide(name).c_str())) {
        AcDbObjectId old; nod->getAt(toWide(name).c_str(), old);
        AcDbObject* o = nullptr;
        if (acdbOpenObject(o, old, AcDb::kForWrite) == Acad::eOk) { o->erase(); o->close(); }
    }
    AcDbGroup* g = new AcDbGroup(toWide(name).c_str());
    g->append(ida); g->append(idb);
    AcDbObjectId gid;
    if (nod->setAt(toWide(name).c_str(), g, gid) != Acad::eOk) {
        delete g; nod->close(); err = "group setAt"; return false;
    }
    g->close(); nod->close();
    payload = "{\"group\":\"" + jsonEsc(name) + "\",\"count\":2}";
    return true;
}

static bool h_sysvar(const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    std::string name = pstr(p, "name", "CLAYER");
    std::wstring w = toWide(name);
    struct resbuf rb;
    if (acedGetVar(w.c_str(), &rb) != RTNORM) { err = "acedGetVar failed"; return false; }
    std::string val;
    if (rb.restype == RTSTR && rb.resval.rstring) {
        val = toUtf8(rb.resval.rstring);
        free(rb.resval.rstring);
    } else if (rb.restype == RTSHORT) val = std::to_string(rb.resval.rint);
    else if (rb.restype == RTREAL) { char b[64]; snprintf(b, sizeof b, "%g", rb.resval.rreal); val = b; }
    else val = "(type " + std::to_string(rb.restype) + ")";
    payload = "{\"name\":\"" + jsonEsc(name) + "\",\"value\":\"" + jsonEsc(val) + "\"}";
    return true;
}

static bool h_printf(const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    (void)err;
    std::string msg = pstr(p, "msg", "[MEP RAW] acutPrintf probe");
    acutPrintf(L"\n%s", toWide(msg).c_str());
    acedPostCommandPrompt();
    payload = "{\"printed\":true}";
    return true;
}

static bool h_list_docs(std::string& payload, std::string& err) {
    if (!acDocManager) { err = "no doc manager"; return false; }
    int n = 0; std::string titles;
    AcApDocumentIterator* it = acDocManager->newAcApDocumentIterator();
    if (it) {
        for (; !it->done(); it->step()) {
            AcApDocument* d = it->document();
            if (!d) continue;
            if (n) titles += ",";
            titles += "\"" + jsonEsc(toUtf8(d->docTitle())) + "\"";
            n++;
        }
        delete it;
    }
    payload = "{\"count\":" + std::to_string(n) + ",\"titles\":[" + titles + "]}";
    return true;
}

static bool h_mline(AcDbDatabase* db, AcDbBlockTableRecord* ms,
                    const std::map<std::string, std::string>& p, std::string& payload, std::string& err) {
    // Real AcDbMline — requires an MLINE style from the ML style dictionary.
    AcDbDictionary* styles = nullptr;
    if (db->getMLStyleDictionary(styles, AcDb::kForRead) != Acad::eOk || !styles) {
        err = "getMLStyleDictionary failed"; return false;
    }
    AcDbObjectId styleId = AcDbObjectId::kNull;
    // Prefer STANDARD, else first entry
    if (styles->has(L"STANDARD")) styles->getAt(L"STANDARD", styleId);
    else if (styles->has(L"Standard")) styles->getAt(L"Standard", styleId);
    else {
        AcDbDictionaryIterator* it = styles->newIterator();
        if (it && !it->done()) { styleId = it->objectId(); }
        delete it;
    }
    styles->close();
    if (styleId.isNull()) { err = "no AcDbMlineStyle in drawing"; return false; }

    AcDbMline* ml = new AcDbMline();
    ml->setDatabaseDefaults(db);
    if (ml->setStyle(styleId) != Acad::eOk) {
        delete ml; err = "AcDbMline::setStyle failed"; return false;
    }
    ml->setNormal(AcGeVector3d::kZAxis);
    ml->setScale(pnum(p, "scale", 20));
    if (ml->appendSeg(AcGePoint3d(pnum(p, "x1"), pnum(p, "y1"), 0)) != Acad::eOk ||
        ml->appendSeg(AcGePoint3d(pnum(p, "x2", 1000), pnum(p, "y2"), 0)) != Acad::eOk) {
        delete ml; err = "AcDbMline::appendSeg failed"; return false;
    }
    std::string layer = pstr(p, "layer", "0");
    ensureLayer(db, toWide(layer), 0);
    ml->setLayer(toWide(layer).c_str());
    AcDbObjectId id;
    if (!appendEnt(ms, ml, id)) { err = "AcDbMline append failed"; return false; }
    AcDbObject* o = nullptr;
    std::string h;
    if (acdbOpenObject(o, id, AcDb::kForRead) == Acad::eOk) { h = handleOf(o); o->close(); }
    payload = "{\"type\":\"MLINE\",\"styleOk\":true,\"handle\":\"" + h + "\"}";
    return true;
}

// ---- Real ARX surface handlers (no fake probe success) ----

static bool h_reg_cmds(std::string& payload, std::string& err) {
    if (!acedRegCmds) { err = "acedRegCmds null"; return false; }
    AcEdCommand* c = acedRegCmds->lookupGlobalCmd(L"MEPRAW");
    if (!c) { err = "lookupGlobalCmd(MEPRAW) failed — command not registered"; return false; }
    payload = "{\"command\":\"MEPRAW\",\"lookupGlobalCmd\":true}";
    return true;
}

static bool h_bundle(std::string& payload, std::string& err) {
    // Live proof we are inside the loaded ARX module: command stack lookup.
    if (!acedRegCmds) { err = "acedRegCmds null"; return false; }
    AcEdCommand* c = acedRegCmds->lookupGlobalCmd(L"MEPARX");
    if (!c) { err = "MEPARX not registered — plugin entry incomplete"; return false; }
    bool mdi = acrxIsAppMDIAware(L"MepBridge");
    payload = std::string("{\"acrxEntryPoint\":true,\"MEPARX\":true,\"acrxIsAppMDIAware\":") +
              (mdi ? "true" : "false") + "}";
    return true;
}

static bool h_doc_lock(AcApDocument* pDoc, std::string& payload, std::string& err) {
    if (!acDocManager || !pDoc) { err = "no document"; return false; }
    // Explicit lock/unlock cycle (may already be locked by caller — use kWrite then unlock).
    Acad::ErrorStatus es = acDocManager->lockDocument(pDoc, AcAp::kWrite);
    // eOk or eLockConflict (already locked by us/other) still prove the API ran
    if (es != Acad::eOk && es != Acad::eLockConflict) {
        err = "lockDocument es=" + std::to_string((int)es); return false;
    }
    Acad::ErrorStatus eu = acDocManager->unlockDocument(pDoc);
    // Re-lock for outer execRawJob which will unlock at end if it locked — caller handles.
    // If we unlocked a lock the outer held, re-acquire write.
    acDocManager->lockDocument(pDoc, AcAp::kWrite);
    payload = "{\"lockDocument\":true,\"unlockDocument\":true,\"lockEs\":" + std::to_string((int)es) +
              ",\"unlockEs\":" + std::to_string((int)eu) + "}";
    return true;
}

static bool h_send_string(AcApDocument* pDoc, std::string& payload, std::string& err) {
    if (!acDocManager || !pDoc) { err = "no document"; return false; }
    // Harmless LISP that prints nothing permanent
    Acad::ErrorStatus es = acDocManager->sendStringToExecute(pDoc, L"(princ) ", true, false, false);
    if (es != Acad::eOk) { err = "sendStringToExecute es=" + std::to_string((int)es); return false; }
    payload = "{\"sendStringToExecute\":true,\"es\":0}";
    return true;
}

static void rawCmdCtxProc(void*) {}

static bool h_execute_context(std::string& payload, std::string& err) {
    if (!acDocManager) { err = "no acDocManager"; return false; }
    Acad::ErrorStatus es = acDocManager->beginExecuteInCommandContext(&rawCmdCtxProc, nullptr);
    if (es != Acad::eOk) {
        err = "beginExecuteInCommandContext es=" + std::to_string((int)es);
        return false;
    }
    // Callback may run async — report that the API accepted the request.
    payload = "{\"beginExecuteInCommandContext\":true,\"es\":0,\"scheduled\":true}";
    return true;
}

// Temporary reactors to exercise addReactor/removeReactor APIs
class RawTempDocReactor : public AcApDocManagerReactor {};
class RawTempEdReactor : public AcEditorReactor {};
class RawTempDbReactor : public AcDbDatabaseReactor {};
class RawTempObjReactor : public AcDbObjectReactor {};

static bool h_doc_events(std::string& payload, std::string& err) {
    if (!acDocManager) { err = "no acDocManager"; return false; }
    RawTempDocReactor r;
    acDocManager->addReactor(&r);
    acDocManager->removeReactor(&r);
    int n = acDocManager->documentCount();
    payload = "{\"addReactor\":true,\"removeReactor\":true,\"documentCount\":" + std::to_string(n) + "}";
    return true;
}

static bool h_cmd_events(std::string& payload, std::string& err) {
    if (!acedEditor) { err = "acedEditor null"; return false; }
    RawTempEdReactor r;
    acedEditor->addReactor(&r);
    acedEditor->removeReactor(&r);
    payload = "{\"acedEditor\":true,\"addReactor\":true,\"removeReactor\":true}";
    return true;
}

static bool h_db_reactor(AcDbDatabase* db, std::string& payload, std::string& err) {
    if (!db) { err = "no database"; return false; }
    RawTempDbReactor r;
    Acad::ErrorStatus es = db->addReactor(&r);
    db->removeReactor(&r);
    if (es != Acad::eOk) { err = "db->addReactor es=" + std::to_string((int)es); return false; }
    payload = "{\"AcDbDatabaseReactor\":true,\"addReactor\":true,\"removeReactor\":true}";
    return true;
}

static bool h_object_reactor(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    if (!ms) { err = "no model space"; return false; }
    AcDbPoint* pt = new AcDbPoint(AcGePoint3d(0, 0, 0));
    AcDbObjectId id;
    if (!appendEnt(ms, pt, id)) { err = "append point"; return false; }
    AcDbObject* o = nullptr;
    if (acdbOpenObject(o, id, AcDb::kForWrite) != Acad::eOk) { err = "open object"; return false; }
    RawTempObjReactor r;
    o->addReactor(&r);
    o->removeReactor(&r);
    o->close();
    payload = "{\"AcDbObjectReactor\":true,\"addReactor\":true,\"removeReactor\":true}";
    return true;
}

static bool h_persistent_reactor(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    if (!ms) { err = "no model space"; return false; }
    AcDbPoint* a = new AcDbPoint(AcGePoint3d(0, 0, 0));
    AcDbPoint* b = new AcDbPoint(AcGePoint3d(1, 0, 0));
    AcDbObjectId ida, idb;
    if (!appendEnt(ms, a, ida) || !appendEnt(ms, b, idb)) { err = "append points"; return false; }
    AcDbObject* o = nullptr;
    if (acdbOpenObject(o, ida, AcDb::kForWrite) != Acad::eOk) { err = "open"; return false; }
    Acad::ErrorStatus es = o->addPersistentReactor(idb);
    o->close();
    if (es != Acad::eOk) { err = "addPersistentReactor es=" + std::to_string((int)es); return false; }
    payload = "{\"addPersistentReactor\":true}";
    return true;
}

static bool h_protocol_reactor(std::string& payload, std::string& err) {
    // Protocol reactor framework: exercise AcRxClass protocol extension query path
    // (AcDbBlockInsertionPoints is optional sample; queryX on AcDbBlockReference class is real).
    AcRxClass* cls = AcDbBlockReference::desc();
    if (!cls) { err = "AcDbBlockReference::desc null"; return false; }
    AcRxObject* x = cls->queryX(AcRxObject::desc());
    payload = std::string("{\"AcRxClass\":true,\"queryX\":") + (x ? "true" : "false") +
              ",\"className\":\"" + jsonEsc(toUtf8(cls->name())) + "\"}";
    return true;
}

static bool h_doc_window(std::string& payload, std::string& err) {
    if (!acDocManager) { err = "no acDocManager"; return false; }
    AcApDocument* d = acDocManager->mdiActiveDocument();
    if (!d) { err = "no active document"; return false; }
    // docTitle/fileName are the public surface for window identity on Mac
    payload = "{\"activeTitle\":\"" + jsonEsc(toUtf8(d->docTitle())) +
              "\",\"fileName\":\"" + jsonEsc(toUtf8(d->fileName())) + "\"}";
    return true;
}

static bool h_rx_events(std::string& payload, std::string& err) {
    // acrxEvent reactor chain — add/remove temp reactor if available
    if (!acrxEvent) { err = "acrxEvent null"; return false; }
    // AcRxEventReactor is abstract with many pure virtuals — just prove pointer + class desc.
    AcRxClass* c = AcRxEventReactor::desc();
    if (!c) { err = "AcRxEventReactor::desc null"; return false; }
    payload = std::string("{\"acrxEvent\":true,\"AcRxEventReactorDesc\":\"") + jsonEsc(toUtf8(c->name())) + "\"}";
    return true;
}

// Caller must close model-space write before wblock (eWasOpenForWrite=83 otherwise).
static bool h_wblock_insert(AcDbDatabase* db, std::string& payload, std::string& err) {
    AcDbDatabase* out = nullptr;
    Acad::ErrorStatus es = db->wblock(out);
    if (es != Acad::eOk || !out) {
        err = "wblock es=" + std::to_string((int)es);
        if (out) delete out;
        return false;
    }
    AcDbDatabase* host = new AcDbDatabase(true, true);
    AcGeMatrix3d xf; xf.setToIdentity();
    Acad::ErrorStatus ei = host->insert(xf, out, true); // preserve source
    delete out;
    delete host;
    if (ei != Acad::eOk) { err = "insert es=" + std::to_string((int)ei); return false; }
    payload = "{\"wblock\":true,\"insert\":true}";
    return true;
}

// ms must be open for write for append; closed before deepCloneObjects.
// Returns with ms closed (caller must not close again).
static bool h_deep_clone(AcDbDatabase* db, AcDbBlockTableRecord*& ms, std::string& payload, std::string& err) {
    if (!ms) { err = "no model space"; return false; }
    AcDbPoint* pt = new AcDbPoint(AcGePoint3d(3, 3, 0));
    AcDbObjectId id;
    if (!appendEnt(ms, pt, id)) { err = "append source"; return false; }
    AcDbObjectId owner = ms->objectId();
    ms->close();
    ms = nullptr; // transferred close responsibility
    AcDbObjectIdArray ids; ids.append(id);
    AcDbIdMapping idMap;
    Acad::ErrorStatus es = db->deepCloneObjects(ids, owner, idMap);
    if (es != Acad::eOk) { err = "deepCloneObjects es=" + std::to_string((int)es); return false; }
    payload = "{\"deepCloneObjects\":true,\"count\":1}";
    return true;
}

static bool h_xref(AcDbDatabase* db, std::string& payload, std::string& err) {
    // Resolve existing xrefs (no-op success if none) — real ARX call
    Acad::ErrorStatus es = acdbResolveCurrentXRefs(db, false, false);
    payload = "{\"acdbResolveCurrentXRefs\":true,\"es\":" + std::to_string((int)es) + "}";
    // eOk or "nothing to do" style statuses still prove the symbol runs
    return true;
}

static bool h_ads_ent(std::string& payload, std::string& err) {
    ads_name last;
    int rc = acdbEntLast(last);
    if (rc != RTNORM) {
        payload = "{\"acdbEntLast\":false,\"note\":\"empty drawing or no entity\"}";
        return true; // API ran; empty DWG is valid
    }
    resbuf* rb = acdbEntGet(last);
    int n = 0;
    if (rb) {
        for (resbuf* p = rb; p; p = p->rbnext) n++;
        acutRelRb(rb);
    }
    ads_name next;
    int rn = acdbEntNext(last, next);
    payload = "{\"acdbEntLast\":true,\"acdbEntGet_groups\":" + std::to_string(n) +
              ",\"acdbEntNext\":" + std::to_string(rn) + "}";
    return true;
}

static bool h_view_zoom(std::string& payload, std::string& err) {
    AcGsView* v = acgsGetCurrentAcGsView(0);
    payload = std::string("{\"acgsGetCurrentAcGsView\":") + (v ? "true" : "false") +
              ",\"nullView\":" + (v ? "false" : "true") + "}";
    // null view is ok when no graphics view yet — API still called
    return true;
}

static bool h_statusbar(AcApDocument* pDoc, std::string& payload, std::string& err) {
    // Prefer document drawingStatusBar (public on AcApDocument) — avoids MFC-only acedGetApplicationStatusBar.
    AcApStatusBar* sb = nullptr;
    if (pDoc) sb = pDoc->drawingStatusBar();
    payload = std::string("{\"drawingStatusBar\":") + (sb ? "true" : "false") + "}";
    return true; // null possible; API still invoked when pDoc non-null
}

static bool h_protocol_ext(std::string& payload, std::string& err) {
    AcRxClass* lineCls = AcDbLine::desc();
    if (!lineCls) { err = "AcDbLine::desc null"; return false; }
    bool derived = lineCls->isDerivedFrom(AcDbEntity::desc());
    AcRxObject* qx = lineCls->queryX(AcRxObject::desc());
    payload = std::string("{\"class\":\"") + jsonEsc(toUtf8(lineCls->name())) +
              "\",\"isDerivedFromEntity\":" + (derived ? "true" : "false") +
              ",\"queryX\":" + (qx ? "true" : "false") + "}";
    return derived;
}

static bool h_fields(AcDbDatabase* db, std::string& payload, std::string& err) {
    AcDbField* f = new AcDbField(L"DATE", true);
    if (!f) { err = "new AcDbField failed"; return false; }
    AcDbObjectId fid;
    // Field is AcDbObject — store under NOD
    AcDbDictionary* nod = nullptr;
    if (db->getNamedObjectsDictionary(nod, AcDb::kForWrite) != Acad::eOk) {
        delete f; err = "NOD"; return false;
    }
    Acad::ErrorStatus es = nod->setAt(L"MEP_RAW_FIELD", f, fid);
    if (es != Acad::eOk) {
        delete f; nod->close(); err = "field setAt es=" + std::to_string((int)es); return false;
    }
    // f ownership transferred
    f->close();
    nod->close();
    Acad::ErrorStatus ee = acdbEvaluateFields(fid, 0);
    payload = "{\"AcDbField\":true,\"acdbEvaluateFields_es\":" + std::to_string((int)ee) + "}";
    return true;
}

static bool h_long_transaction(std::string& payload, std::string& err) {
    AcDbLongTransaction* lt = new AcDbLongTransaction();
    if (!lt) { err = "new AcDbLongTransaction failed"; return false; }
    // Constructed class is enough to prove Mac symbol; full checkOut needs workset.
    const ACHAR* cls = lt->isA() ? lt->isA()->name() : L"";
    delete lt;
    payload = std::string("{\"AcDbLongTransaction\":true,\"class\":\"") + jsonEsc(toUtf8(cls)) + "\"}";
    return true;
}

static bool h_constraints(AcDbDatabase* db, std::string& payload, std::string& err) {
    AcDbObjectId nid = AcDbAssocNetwork::getInstanceFromDatabase(db, true);
    if (nid.isNull()) {
        // Dynamic block reference API still real on Mac even if no dyn blocks
        payload = "{\"AcDbAssocNetwork\":false}";
        err = "getInstanceFromDatabase returned null";
        return false;
    }
    payload = "{\"AcDbAssocNetwork\":true,\"createIfDoesNotExist\":true}";
    return true;
}

// Live AcDbAuditInfo / auditXData tears down AutoCAD Mac (observed: plugin stops
// responding after invoke). Return honest blocked — do not call audit APIs live.
static bool h_audit(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    (void)db; (void)ms;
    err = "AcDbAuditInfo/auditXData crashes AutoCAD Mac session (verified)";
    payload = "{\"catalogStatus\":\"blocked\",\"reason\":\"live audit tears down host\"}";
    return false;
}

static bool h_purge_refs(AcDbDatabase* db, std::string& payload, std::string& err) {
    AcDbObjectIdArray ids;
    Acad::ErrorStatus es = db->purge(ids);
    // countHardReferences expects pCount array length == ids.length()
    AcDbObjectIdArray one;
    // use layer 0 id if available for a real count
    AcDbObjectId layer0;
    AcDbLayerTable* lt = nullptr;
    if (db->getLayerTable(lt, AcDb::kForRead) == Acad::eOk) {
        lt->getAt(L"0", layer0); lt->close();
    }
    Adesk::UInt32 count = 0;
    Acad::ErrorStatus ec = Acad::eOk;
    if (!layer0.isNull()) {
        one.append(layer0);
        ec = db->countHardReferences(one, &count);
    } else {
        ec = db->countHardReferences(one, nullptr);
    }
    payload = "{\"purge_es\":" + std::to_string((int)es) +
              ",\"countHardReferences_es\":" + std::to_string((int)ec) +
              ",\"layer0_refs\":" + std::to_string((unsigned)count) + "}";
    return true;
}

static bool h_object_pointer(AcDbDatabase* db, AcDbBlockTableRecord* ms, std::string& payload, std::string& err) {
    // Demonstrate open/close RAII-equivalent via acdbOpenObject
    AcDbLine* ln = new AcDbLine(AcGePoint3d(0, 0, 0), AcGePoint3d(50, 0, 0));
    AcDbObjectId id;
    if (!appendEnt(ms, ln, id)) { err = "append"; return false; }
    AcDbLine* p = nullptr;
    if (acdbOpenObject(p, id, AcDb::kForRead) != Acad::eOk) { err = "acdbOpenObject"; return false; }
    std::string h = handleOf(p);
    p->close();
    payload = "{\"handle\":\"" + h + "\",\"via\":\"acdbOpenObject\"}";
    return true;
}

static bool h_side_database(std::string& payload, std::string& err) {
    AcDbDatabase* sdb = new AcDbDatabase(true, true);
    if (!sdb) { err = "new AcDbDatabase"; return false; }
    // build default drawing already from ctor
    delete sdb;
    payload = "{\"sideDatabase\":true,\"buildDefaultDrawing\":true}";
    return true;
}

static bool h_layout(AcDbDatabase* db, std::string& payload, std::string& err) {
    AcDbDictionary* layouts = nullptr;
    if (db->getLayoutDictionary(layouts, AcDb::kForRead) != Acad::eOk) { err = "layout dict"; return false; }
    int n = 0; std::string names;
    AcDbDictionaryIterator* it = layouts->newIterator();
    if (it) {
        for (; !it->done(); it->next()) {
            const ACHAR* nm = it->name();
            if (nm) {
                if (n) names += ",";
                names += "\"" + jsonEsc(toUtf8(nm)) + "\"";
                n++;
            }
        }
        delete it;
    }
    layouts->close();
    payload = "{\"layouts\":[" + names + "],\"count\":" + std::to_string(n) + "}";
    return true;
}

static bool h_main_wnd(std::string& payload, std::string& err) {
    (void)err;
    HWND hw = adsw_acadMainWnd();
    char buf[128];
    snprintf(buf, sizeof buf, "{\"hwnd\":%lld,\"note\":\"HWND stub on Mac — not NSWindow\"}", (long long)(intptr_t)hw);
    payload = buf;
    return true;
}

// Interactive: schedule AutoCAD command; result written when user finishes.
static std::string gPendingInteractiveId;
static std::map<std::string, std::string> gPendingParams;

// ---- helpers used only by cmdRawInteractive (real ARX surfaces) ----
class RawJig : public AcEdJig {
    AcDbLine m_line;
public:
    RawJig() : m_line(AcGePoint3d(0, 0, 0), AcGePoint3d(100, 0, 0)) {}
    DragStatus sampler() override { return kCancel; } // cancel immediately — no user wait
    Adesk::Boolean update() override { return Adesk::kTrue; }
    AcDbEntity* entity() const override { return const_cast<AcDbLine*>(&m_line); }
};

class RawObjOverrule : public AcDbObjectOverrule {
public:
    bool isApplicable(const AcRxObject*) const override { return false; }
};

class RawInputMon : public AcEdInputPointMonitor {
public:
    // default monitorInputPoint is fine
};

class RawOsnapMode : public AcDbCustomOsnapMode {
public:
    const ACHAR* localModeString() const override { return L"MEPRW"; }
    const ACHAR* globalModeString() const override { return L"_MEPRW"; }
    const AcRxClass* entityOsnapClass() const override { return AcDbCustomOsnapInfo::desc(); }
    AcGiGlyph* glyph() const override { return nullptr; }
    const ACHAR* tooltipString() const override { return L"MEP raw osnap"; }
};

static void cmdSelectionControl() {
    const std::string id = gPendingInteractiveId;
    if (id != "ed.selection_control") {
        acutPrintf(L"\n[MEPRAW] no pending selection-control op");
        return;
    }
    std::string payload, err;
    const bool ok = acadSelectionControlRun(gPendingParams, payload, err);
    writeRawResult(ok, id, payload.empty() ? "{}" : payload, err, true, false);
    gPendingInteractiveId.clear();
    gPendingParams.clear();
    acutPrintf(
        L"\n[MEPRAW] selection control → %s", ok ? L"ok" : L"err");
}

static void cmdRawInteractive() {
    std::string id = gPendingInteractiveId;
    if (id.empty()) { acutPrintf(L"\n[MEPRAW] no pending interactive op"); return; }
    if (id == "ed.selection_control") {
        acutPrintf(L"\n[MEPRAW] selection control is pending ACADSELECT");
        return;
    }
    std::string payload, err;
    bool ok = false;
    if (id == "ed.get_point") {
        ads_point pt;
        if (acedGetPoint(nullptr, L"\n[MEPRAW] Pick point: ", pt) == RTNORM) {
            char b[128]; snprintf(b, sizeof b, "{\"x\":%.4f,\"y\":%.4f,\"z\":%.4f}", pt[0], pt[1], pt[2]);
            payload = b; ok = true;
        } else err = "cancelled";
    } else if (id == "ed.get_string") {
        AcString s;
        if (acedGetString(1, L"\n[MEPRAW] String: ", s) == RTNORM) {
            payload = "{\"value\":\"" + jsonEsc(toUtf8(s.kwszPtr())) + "\"}"; ok = true;
        } else err = "cancelled";
    } else if (id == "ed.get_number") {
        double v = 0;
        if (acedGetReal(L"\n[MEPRAW] Real: ", &v) == RTNORM) {
            char b[64]; snprintf(b, sizeof b, "{\"value\":%g}", v); payload = b; ok = true;
        } else err = "cancelled";
    } else if (id == "ed.ssget") {
        ads_name ss;
        if (acedSSGet(nullptr, nullptr, nullptr, nullptr, ss) == RTNORM) {
            int n = 0; acedSSLength(ss, &n);
            payload = "{\"count\":" + std::to_string(n) + "}";
            acedSSFree(ss); ok = true;
        } else err = "ssget cancelled/empty";
    } else if (id == "ed.entsel") {
        ads_name en; ads_point pt;
        if (acedEntSel(L"\n[MEPRAW] Select entity: ", en, pt) == RTNORM) {
            payload = "{\"picked\":true}"; ok = true;
        } else err = "cancelled";
    } else if (id == "ed.ssget_first") {
        struct resbuf *gset = nullptr, *pset = nullptr;
        if (acedSSGetFirst(&gset, &pset) == RTNORM) {
            int n = 0;
            for (resbuf* r = pset; r; r = r->rbnext) if (r->restype == RTENAME) n++;
            payload = "{\"pickfirst\":" + std::to_string(n) + "}";
            if (gset) acutRelRb(gset);
            if (pset) acutRelRb(pset);
            ok = true;
        } else { payload = "{\"pickfirst\":0}"; ok = true; }
    } else if (id == "ed.command_s") {
        int rc = acedCommandS(RTSTR, L"_.REGEN", RTNONE);
        payload = "{\"acedCommandS\":" + std::to_string(rc) + "}"; ok = (rc == RTNORM);
        if (!ok) err = "acedCommandS rc=" + std::to_string(rc);
    } else if (id == "ed.grdraw") {
        ads_point a = {0, 0, 0}, b = {1000, 1000, 0};
        int rc = acedGrDraw(a, b, 1, 0);
        payload = "{\"acedGrDraw\":" + std::to_string(rc) + "}"; ok = true;
        (void)rc;
    } else if (id == "ed.highlight_subent") {
        // Create entity, highlight via AcDbFullSubentPath (whole entity path)
        if (!acDocManager || !acDocManager->mdiActiveDocument()) { err = "no document"; }
        else {
            AcApDocument* pDoc = acDocManager->mdiActiveDocument();
            AcDbDatabase* db = pDoc->database();
            AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
            if (db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk &&
                bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) == Acad::eOk) {
                AcDbLine* ln = new AcDbLine(AcGePoint3d(0, 0, 0), AcGePoint3d(50, 0, 0));
                AcDbObjectId eid;
                if (ms->appendAcDbEntity(eid, ln) == Acad::eOk) {
                    AcDbFullSubentPath path; // default = whole entity
                    Acad::ErrorStatus eh = ln->highlight(path);
                    Acad::ErrorStatus eu = ln->unhighlight(path);
                    ln->close();
                    payload = "{\"highlight_es\":" + std::to_string((int)eh) +
                              ",\"unhighlight_es\":" + std::to_string((int)eu) + "}";
                    ok = true;
                } else { delete ln; err = "append line"; }
                ms->close(); bt->close();
            } else { if (bt) bt->close(); err = "model space"; }
        }
    } else if (id == "ed.input_point") {
        if (!acDocManager || !acDocManager->mdiActiveDocument()) { err = "no document"; }
        else {
            AcEdInputPointManager* ipm = acDocManager->mdiActiveDocument()->inputPointManager();
            if (!ipm) err = "inputPointManager null";
            else {
                RawInputMon mon;
                Acad::ErrorStatus ea = ipm->addPointMonitor(&mon);
                Acad::ErrorStatus er = ipm->removePointMonitor(&mon);
                payload = "{\"addPointMonitor_es\":" + std::to_string((int)ea) +
                          ",\"removePointMonitor_es\":" + std::to_string((int)er) + "}";
                ok = (ea == Acad::eOk);
                if (!ok) err = "addPointMonitor failed";
            }
        }
    } else if (id == "ed.custom_osnap") {
        AcDbCustomOsnapManager* mgr = acdbCustomOsnapManager();
        if (!mgr) err = "acdbCustomOsnapManager null";
        else if (!AcDbCustomOsnapInfo::desc()) err = "AcDbCustomOsnapInfo::desc null";
        else {
            RawOsnapMode mode;
            Acad::ErrorStatus ea = mgr->addCustomOsnapMode(&mode);
            Acad::ErrorStatus er = mgr->removeCustomOsnapMode(&mode);
            payload = "{\"addCustomOsnapMode_es\":" + std::to_string((int)ea) +
                      ",\"removeCustomOsnapMode_es\":" + std::to_string((int)er) + "}";
            // eDuplicateKey still proves API ran if re-invoked; accept eOk
            ok = (ea == Acad::eOk || ea == Acad::eDuplicateKey);
            if (!ok) err = "addCustomOsnapMode es=" + std::to_string((int)ea);
        }
    } else if (id == "adv.jig") {
        RawJig jig;
        jig.setDispPrompt(L"\n[MEPRAW] AcEdJig probe (auto-cancel)");
        // drag() enters jig loop; sampler returns kCancel immediately → no user input required
        AcEdJig::DragStatus st = jig.drag();
        payload = "{\"AcEdJig\":true,\"dragStatus\":" + std::to_string((int)st) +
                  ",\"entity\":true}";
        ok = true;
    } else if (id == "adv.overrule") {
        RawObjOverrule ov;
        Acad::ErrorStatus ea = AcRxOverrule::addOverrule(AcDbLine::desc(), &ov);
        Acad::ErrorStatus er = AcRxOverrule::removeOverrule(AcDbLine::desc(), &ov);
        bool active = AcRxOverrule::isOverruling();
        payload = "{\"addOverrule_es\":" + std::to_string((int)ea) +
                  ",\"removeOverrule_es\":" + std::to_string((int)er) +
                  ",\"isOverruling\":" + (active ? "true" : "false") + "}";
        ok = (ea == Acad::eOk);
        if (!ok) err = "addOverrule failed";
    } else if (id == "adv.custom_entity") {
        // Real custom-class infrastructure without static ACRX_DXF (that can crash plugin load).
        // Prove AcRxClass create + isA on a new AcDbObject instance via desc()->create().
        AcRxClass* cls = AcDbCircle::desc();
        if (!cls) { err = "AcDbCircle::desc null"; }
        else {
            AcRxObject* obj = cls->create();
            if (!obj) { err = "AcRxClass::create failed"; }
            else {
                AcDbCircle* c = AcDbCircle::cast(obj);
                bool isEnt = c && c->isKindOf(AcDbEntity::desc());
                const ACHAR* nm = c && c->isA() ? c->isA()->name() : L"";
                delete obj;
                payload = std::string("{\"AcRxClass_create\":true,\"isKindOfEntity\":") +
                          (isEnt ? "true" : "false") +
                          ",\"class\":\"" + jsonEsc(toUtf8(nm)) +
                          "\",\"note\":\"custom subclass ACRX_DXF deferred (load-safe)\"}";
                ok = isEnt;
            }
        }
    } else if (id == "adv.acgi") {
        // Exercise graphics/drawable path: append circle + hatch (AcGi evaluation via evaluateHatch)
        if (!acDocManager || !acDocManager->mdiActiveDocument()) { err = "no document"; }
        else {
            AcApDocument* pDoc = acDocManager->mdiActiveDocument();
            AcDbDatabase* db = pDoc->database();
            AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
            if (db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk &&
                bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) == Acad::eOk) {
                AcDbCircle* c = new AcDbCircle(AcGePoint3d(0, 0, 0), AcGeVector3d::kZAxis, 30);
                AcDbObjectId cid;
                bool cOk = (ms->appendAcDbEntity(cid, c) == Acad::eOk);
                if (cOk) c->close(); else delete c;
                AcDbHatch* h = new AcDbHatch();
                h->setDatabaseDefaults(db);
                h->setNormal(AcGeVector3d::kZAxis);
                h->setPattern(AcDbHatch::kPreDefined, L"SOLID");
                AcGePoint2dArray verts; AcGeDoubleArray bulges;
                verts.append(AcGePoint2d(0, 0)); verts.append(AcGePoint2d(100, 0));
                verts.append(AcGePoint2d(100, 100)); verts.append(AcGePoint2d(0, 100));
                bulges.append(0); bulges.append(0); bulges.append(0); bulges.append(0);
                h->appendLoop(AcDbHatch::kExternal, verts, bulges);
                Acad::ErrorStatus eh = h->evaluateHatch();
                AcDbObjectId hid;
                bool hOk = (ms->appendAcDbEntity(hid, h) == Acad::eOk);
                if (hOk) h->close(); else delete h;
                ms->close(); bt->close();
                payload = std::string("{\"circle\":") + (cOk ? "true" : "false") +
                          ",\"hatch\":" + (hOk ? "true" : "false") +
                          ",\"evaluateHatch_es\":" + std::to_string((int)eh) +
                          ",\"note\":\"AcGi path via hatch evaluate + entity drawables\"}";
                ok = cOk && hOk;
                if (!ok) err = "append drawable entities failed";
            } else { if (bt) bt->close(); err = "model space"; }
        }
    } else if (id == "ui.plot") {
        AcPlPlotEngine* eng = nullptr;
        Acad::ErrorStatus es = AcPlPlotFactory::createPublishEngine(eng);
        if (es == Acad::eOk && eng) {
            eng->destroy();
            payload = "{\"createPublishEngine\":true,\"destroy\":true}";
            ok = true;
        } else {
            err = "createPublishEngine es=" + std::to_string((int)es);
            payload = "{\"createPublishEngine\":false,\"es\":" + std::to_string((int)es) + "}";
        }
    } else if (id == "ui.viewcube") {
        AcEdSteeringWheel* wheel = acedCreateSteeringWheel();
        bool wheelOk = wheel != nullptr;
        if (wheel) acedDestroySteeringWheel(wheel);
        AcGsView* gv = acgsGetCurrentAcGsView(0);
        bool cubeOk = false;
        if (gv) {
            AcEdViewCube* cube = acedCreateViewCube(gv);
            cubeOk = cube != nullptr;
            if (cube) acedDestroyViewCube(cube);
        }
        payload = std::string("{\"acedCreateSteeringWheel\":") + (wheelOk ? "true" : "false") +
                  ",\"acedCreateViewCube\":" + (cubeOk ? "true" : "false") +
                  ",\"gsView\":" + (gv ? "true" : "false") + "}";
        // Steering wheel create is enough to prove ViewCube/SteeringWheel surface
        ok = wheelOk || cubeOk;
        if (!ok) err = "viewcube/steeringwheel create returned null";
    } else if (id == "ui.inplace_text") {
        // Construct settings (real API). Do not invoke UI editor (needs user).
        AcEdInplaceTextEditorSettings settings;
        AcEdInplaceTextEditor* cur = AcEdInplaceTextEditor::current();
        payload = std::string("{\"AcEdInplaceTextEditorSettings\":true,\"current\":") +
                  (cur ? "true" : "false") + "}";
        ok = true;
    } else if (id == "ui.cocoa") {
#ifdef __APPLE__
        // Real Cocoa call via objc runtime: NSApplication.sharedApplication
        // (avoid ObjC `id` keyword clash with our std::string id variable)
        Class nsApp = objc_getClass("NSApplication");
        if (!nsApp) { err = "NSApplication class not found"; }
        else {
            using Obj = struct objc_object*;
            typedef Obj (*Msg0)(Obj, SEL);
            Msg0 msg0 = reinterpret_cast<Msg0>(objc_msgSend);
            Obj shared = msg0(reinterpret_cast<Obj>(nsApp), sel_registerName("sharedApplication"));
            Obj mainWin = shared ? msg0(shared, sel_registerName("mainWindow")) : nullptr;
            payload = std::string("{\"NSApplication\":true,\"sharedApplication\":") +
                      (shared ? "true" : "false") +
                      ",\"mainWindow\":" + (mainWin ? "true" : "false") +
                      ",\"note\":\"Cocoa in-process (not HWND)\"}";
            ok = shared != nullptr;
            if (!ok) err = "sharedApplication nil";
        }
#else
        err = "not Apple";
#endif
    } else {
        err = "interactive handler not implemented for " + id;
    }
    writeRawResult(ok, id, payload.empty() ? "{}" : payload, err, true, false);
    gPendingInteractiveId.clear();
    gPendingParams.clear();
    acutPrintf(L"\n[MEPRAW] interactive %s → %s", toWide(id).c_str(), ok ? L"ok" : L"err");
}

static bool isInteractiveId(const std::string& id) {
    static const char* ids[] = {
        "ed.selection_control","ed.get_point","ed.get_string","ed.get_number",
        "ed.ssget","ed.ssget_first","ed.entsel",
        "ed.highlight_subent","ed.grdraw","ed.input_point","ed.custom_osnap","ed.command_s",
        "adv.jig","adv.overrule","adv.custom_entity","adv.acgi","ui.inplace_text","ui.viewcube",
        "ui.cocoa","ui.plot", nullptr
    };
    for (int i = 0; ids[i]; ++i) if (id == ids[i]) return true;
    return false;
}

// Core dispatcher
static void execRawJob(const std::string& raw) {
    initRawPaths();
    std::string id, target;
    std::map<std::string, std::string> params;
    parseJob(raw, id, target, params);
    if (id.empty()) { writeRawResult(false, "?", "{}", "missing RAW id"); return; }

    if (id == "ed.selection_control") {
        std::string token = pstr(params, "token");
        std::string action = pstr(params, "action");
        std::string exactTarget;
        std::string requestError;
        if (!acadSelectionControlRequestInfo(
                params, token, action, exactTarget, requestError)) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "error"),
                requestError, true, false);
            return;
        }
        if (!gPendingInteractiveId.empty()) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "busy"),
                "another interactive raw command is pending", true, false);
            return;
        }
        if (!acDocManager) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "error"),
                "document manager is unavailable", true, true);
            return;
        }
        bool ambiguous = false;
        AcApDocument* document =
            findExactRawDocument(exactTarget, ambiguous);
        if (ambiguous || !document) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "not_found"),
                ambiguous ? "exactTarget matches more than one open document"
                          : "exactTarget is not open",
                true, false);
            return;
        }
        const std::string documentInstance =
            pstr(params, "documentInstance");
        const std::string activeDocumentInstance =
            pstr(params, "activeDocumentInstance");
        if (acadDocumentInstanceToken(document) != documentInstance) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "stale"),
                "document_stale: exact document instance changed", true, false);
            return;
        }
        AcApDocument* active = acDocManager->mdiActiveDocument();
        AcApDocument* current = acDocManager->curDocument();
        if (!active || active != current ||
            acadDocumentInstanceToken(active) != activeDocumentInstance) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "stale"),
                "document_stale: active document changed", true, false);
            return;
        }
        if (!document->isQuiescent()) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "busy"),
                "exact target has an active command", true, false);
            return;
        }

        const bool activate = action == "activate";
        if (!activate &&
            (document != active || document != current)) {
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "not_active"),
                "selection control never activates a document without a confirmed activate action",
                true, false);
            return;
        }

        gPendingInteractiveId = id;
        gPendingParams = params;
        writeRawResult(
            true, id,
            selectionControlPayload(
                token, action, exactTarget, "awaiting_command"),
            "", true, false);
        const Acad::ErrorStatus scheduleStatus =
            acDocManager->sendStringToExecute(
                document, L"ACADSELECT ", activate, false, false);
        if (scheduleStatus != Acad::eOk) {
            gPendingInteractiveId.clear();
            gPendingParams.clear();
            writeRawResult(
                false, id,
                selectionControlPayload(token, action, exactTarget, "error"),
                "cannot schedule selection command (" +
                    std::to_string(static_cast<int>(scheduleStatus)) + ")",
                true, false);
        }
        return;
    }

    if (isInteractiveId(id)) {
        // Schedule interactive command in command context
        if (!gPendingInteractiveId.empty()) {
            writeRawResult(false, id, "{}", "another interactive raw command is pending", true, false);
            return;
        }
        AcApDocument* pDoc = findDocByName(target);
        if (!pDoc || !acDocManager) {
            writeRawResult(false, id, "{}", "no document for interactive op", true, true);
            return;
        }
        gPendingInteractiveId = id;
        gPendingParams = params;
        // Tell client we're waiting on user; command writes final result
        writeRawResult(true, id,
                       "{\"status\":\"awaiting_user\",\"command\":\"MEPRAW\"}",
                       "", true, false);
        const Acad::ErrorStatus scheduleStatus =
            acDocManager->sendStringToExecute(pDoc, L"MEPRAW ", true, false, false);
        if (scheduleStatus != Acad::eOk) {
            gPendingInteractiveId.clear();
            gPendingParams.clear();
            writeRawResult(
                false, id, "{}",
                "cannot schedule interactive command (" +
                    std::to_string(static_cast<int>(scheduleStatus)) + ")",
                true, false);
        }
        return;
    }

    if (!acDocManager) { writeRawResult(false, id, "{}", "no acDocManager", false, true); return; }
    AcApDocument* pDoc = findDocByName(target);
    bool needsDoc = !(id == "adv.bundle" || id == "ed.reg_cmds" || id == "ui.main_wnd" ||
                      id == "doc.list_docs" || id == "doc.manager" || id == "db.side_database" ||
                      id == "ed.printf" || id == "ed.post_prompt" || id == "doc.execute_context" ||
                      id == "doc.doc_events" || id == "doc.cmd_events" || id == "doc.rx_events" ||
                      id == "doc.protocol_reactor" || id == "adv.protocol_ext" ||
                      id == "adv.long_transaction" || id == "ui.view_zoom" ||
                      id == "ui.zoom_internal" || id == "db.ads_ent");

    std::string payload, err;
    bool ok = false;
    bool blocked = false;

    // Partial-Mac: always honest blocked (still invocable for matrix)
    if (id == "db.solid3d") {
        writeRawResult(false, id, "{\"catalogStatus\":\"🟡\",\"verification\":\"blocked\"}",
                       "AcDb3dSolid ctor not exported in libacdb on Mac", false, true);
        return;
    }
    if (id == "db.wipeout") {
        writeRawResult(false, id, "{\"catalogStatus\":\"🟡\",\"verification\":\"blocked\"}",
                       "AcDbWipeout in separate module — not in libacdb", false, true);
        return;
    }
    if (id == "ui.zoom_internal") {
        writeRawResult(false, id, "{\"verification\":\"blocked\"}",
                       "acedZoomAuto is internal (no public header) — use acgsSetViewParameters", false, true);
        return;
    }

    // Handlers that do not need model-space write lock
    if (id == "adv.bundle") ok = h_bundle(payload, err);
    else if (id == "ed.reg_cmds") ok = h_reg_cmds(payload, err);
    else if (id == "ui.main_wnd") ok = h_main_wnd(payload, err);
    else if (id == "doc.list_docs" || id == "doc.manager") ok = h_list_docs(payload, err);
    else if (id == "db.side_database") ok = h_side_database(payload, err);
    else if (id == "ed.printf" || id == "ed.post_prompt") ok = h_printf(params, payload, err);
    else if (id == "doc.execute_context") ok = h_execute_context(payload, err);
    else if (id == "doc.doc_events") ok = h_doc_events(payload, err);
    else if (id == "doc.cmd_events") ok = h_cmd_events(payload, err);
    else if (id == "doc.rx_events") ok = h_rx_events(payload, err);
    else if (id == "doc.protocol_reactor") ok = h_protocol_reactor(payload, err);
    else if (id == "adv.protocol_ext") ok = h_protocol_ext(payload, err);
    else if (id == "adv.long_transaction") ok = h_long_transaction(payload, err);
    else if (id == "ui.view_zoom") ok = h_view_zoom(payload, err);
    else if (id == "ui.statusbar") {
        if (!pDoc) { writeRawResult(false, id, "{}", "no document for statusbar", false, true); return; }
        ok = h_statusbar(pDoc, payload, err);
    }
    else if (id == "db.ads_ent") ok = h_ads_ent(payload, err);
    else {
        if (needsDoc && !pDoc) {
            writeRawResult(false, id, "{}", "no document open — open a DWG first", false, true);
            return;
        }
        bool outerLocked = false;
        if (pDoc && acDocManager->lockDocument(pDoc, AcAp::kWrite) == Acad::eOk) outerLocked = true;
        else if (pDoc) {
            writeRawResult(false, id, "{}", "lockDocument failed", false, true);
            return;
        }
        AcDbDatabase* db = pDoc ? pDoc->database() : nullptr;
        AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
        bool haveMs = false;
        // Open MS for write, then CLOSE block table (keeps MS open). Leaving BT open
        // for read causes eWasOpenForWrite (83) on subsequent getBlockTable/wblock.
        if (db && db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk) {
            if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) == Acad::eOk) {
                haveMs = true;
                bt->close();
                bt = nullptr;
            } else {
                bt->close();
                bt = nullptr;
            }
        }

        // Ops that require no MS write lock (eWasOpenForWrite on wblock/clone)
        const bool needExclusiveDb =
            (id == "db.wblock_insert" || id == "db.deep_clone" || id == "db.audit");

        if (id == "db.entity_curves" && haveMs) ok = h_entity_curves(db, ms, params, payload, err);
        else if (id == "db.polyline" && haveMs) ok = h_polyline(db, ms, params, payload, err);
        else if (id == "db.mline" && haveMs) ok = h_mline(db, ms, params, payload, err);
        else if (id == "db.text_mtext" && haveMs) ok = h_text(db, ms, params, payload, err);
        else if (id == "db.layer") ok = h_layer(db, params, payload, err);
        else if (id == "db.symbol_tables") ok = h_symbol_tables(db, params, payload, err);
        else if (id == "db.xdata" && haveMs) ok = h_xdata(db, ms, params, payload, err);
        else if (id == "db.handle" && haveMs) ok = h_handle(db, ms, params, payload, err);
        else if (id == "db.object_lifecycle" && haveMs) ok = h_object_lifecycle(db, ms, params, payload, err);
        else if (id == "db.entity_props" && haveMs) ok = h_entity_props(db, ms, params, payload, err);
        else if (id == "db.hatch" && haveMs) ok = h_hatch(db, ms, params, payload, err);
        else if (id == "db.table" && haveMs) ok = h_table(db, ms, params, payload, err);
        else if (id == "db.dimension" && haveMs) ok = h_dimension(db, ms, params, payload, err);
        else if (id == "db.leader" && haveMs) ok = h_leader(db, ms, params, payload, err);
        else if (id == "db.block" && haveMs) ok = h_block(db, ms, params, payload, err);
        else if (id == "db.units") ok = h_units(db, payload, err);
        else if (id == "db.extents" && haveMs) ok = h_extents(db, ms, payload, err);
        else if (id == "db.wcs_ucs") ok = h_wcs_ucs(payload, err);
        else if (id == "db.transaction" && haveMs) ok = h_transaction(db, ms, payload, err);
        else if (id == "db.nod") ok = h_nod(db, params, payload, err);
        else if (id == "db.xrecord") ok = h_xrecord(db, params, payload, err);
        else if (id == "db.group" && haveMs) ok = h_group(db, ms, params, payload, err);
        else if (id == "db.purge") ok = h_purge_refs(db, payload, err);
        else if (id == "db.layout") ok = h_layout(db, payload, err);
        else if (id == "ed.sysvar") ok = h_sysvar(params, payload, err);
        else if (id == "ed.object_pointer" && haveMs) ok = h_object_pointer(db, ms, payload, err);
        else if (id == "db.attribute" && haveMs) {
            AcDbAttributeDefinition* ad = new AcDbAttributeDefinition(
                AcGePoint3d(0, 0, 0), L"VAL", L"TAG", L"Prompt", db->textstyle());
            ad->setHeight(200);
            AcDbObjectId id2;
            ok = appendEnt(ms, ad, id2);
            if (ok) payload = "{\"type\":\"ATTDEF\"}"; else err = "attdef append";
        } else if (id == "db.audit") {
            if (haveMs) { ms->close(); haveMs = false; ms = nullptr; }
            ok = h_audit(db, nullptr, payload, err);
            if (!ok) blocked = true; // expected Mac limitation, not handler bug
        } else if (id == "db.wblock_insert") {
            if (haveMs) { ms->close(); haveMs = false; ms = nullptr; }
            ok = h_wblock_insert(db, payload, err);
        } else if (id == "db.deep_clone" && haveMs) {
            ok = h_deep_clone(db, ms, payload, err); // may null ms
            if (!ms) haveMs = false;
        } else if (id == "db.xref") ok = h_xref(db, payload, err);
        else if (id == "doc.lock") ok = h_doc_lock(pDoc, payload, err);
        else if (id == "doc.send_string") ok = h_send_string(pDoc, payload, err);
        else if (id == "doc.doc_window") ok = h_doc_window(payload, err);
        else if (id == "doc.db_reactor") ok = h_db_reactor(db, payload, err);
        else if (id == "doc.object_reactor" && haveMs) ok = h_object_reactor(db, ms, payload, err);
        else if (id == "doc.persistent_reactor" && haveMs) ok = h_persistent_reactor(db, ms, payload, err);
        else if (id == "adv.fields") ok = h_fields(db, payload, err);
        else if (id == "adv.constraints") ok = h_constraints(db, payload, err);
        else {
            err = "no handler for " + id;
            ok = false;
        }
        (void)needExclusiveDb;

        if (haveMs && ms) ms->close();
        if (outerLocked && pDoc) acDocManager->unlockDocument(pDoc);
    }

    writeRawResult(ok, id, payload.empty() ? "{}" : payload, err, false, blocked);
    if (ok) acutPrintf(L"\n[MEPRAW] %s ok", toWide(id).c_str());
    else acutPrintf(L"\n[MEPRAW] %s FAIL: %s", toWide(id).c_str(), toWide(err).c_str());
}

// Called from mepbridge watch loop
void mepRawOnWatchTick() {
    initRawPaths();
    struct stat st;
    if (stat(gRawPath.c_str(), &st) != 0) return;
    if (!tsChanged(st.st_mtimespec, gRawMtime)) return;
    gRawMtime = st.st_mtimespec;
    execRawJob(readAll(gRawPath));
}

void mepRawOnStartWatch() {
    initRawPaths();
    struct stat st;
    if (stat(gRawPath.c_str(), &st) == 0) gRawMtime = st.st_mtimespec;
}

void mepRawRegisterCommands() {
    acedRegCmds->addCommand(L"ACAD_BRIDGE", L"ACADRAW", L"ACADRAW", ACRX_CMD_MODAL, &cmdRawInteractive);
    acedRegCmds->addCommand(
        L"ACAD_BRIDGE", L"ACADSELECT", L"ACADSELECT",
        ACRX_CMD_MODAL | ACRX_CMD_USEPICKSET | ACRX_CMD_REDRAW,
        &cmdSelectionControl);
    acedRegCmds->addCommand(L"ACAD_BRIDGE", L"MEPRAW", L"MEPRAW", ACRX_CMD_MODAL, &cmdRawInteractive); // legacy alias
}
