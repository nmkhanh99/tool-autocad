// mepbridge.cpp — ObjectARX plugin "MepBridge" cho AutoCAD 2027 for Mac (R26.0)
//
// Cau 2 CHIEU giua app MEP Studio va AutoCAD:
//   1. App ghi ~/MEP-Bridge/docs.req      -> plugin ghi docs.json (danh sach ban ve dang mo,
//      ban ve active). Day cung la HEARTBEAT: app biet plugin song.
//   2. App ghi ~/MEP-Bridge/job_target.txt (ten ban ve dich, UTF-8, tuy chon)
//      roi ghi ~/MEP-Bridge/mep_job.lsp   -> plugin tu (load) job vao DUNG ban ve do
//      (khong co target -> ban ve dang active). Truoc khi load, tu them ~/MEP-Bridge
//      vao TRUSTEDPATHS de khong bi SECURELOAD chan im lang.
//   3. Lenh tay: MEPARX (chay job ngay), MEPDOCS (ghi docs.json), MEPWATCH/MEPUNWATCH.
//
// An toan thread: FSEventStreamSetDispatchQueue(main queue) -> callback chay tren MAIN
// thread; chi dung acDocManager->sendStringToExecute (enqueue, khong chay truc tiep).

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#include <sys/stat.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

// Win-compat types (HWND/RECT) cho Mac truoc cac header ARX (aced.h can khi _ADESK_MAC_).
#include "windef.h"
#include <aced.h>
#include <rxregsvc.h>
#include <acutads.h>
#include <acedads.h>
#include <adscodes.h>
#include <acdocman.h>
#include <dbmain.h>
#include <dbents.h>
#include <dbmline.h>
#include <dbsymtb.h>
#include <dbtable.h>
#include <AcCmColor.h>
#include <map>
#include <vector>

// ============================ trang thai ============================
static FSEventStreamRef gStream       = nullptr;
static struct timespec  gJobMtime     = {0, 0};
static struct timespec  gReqMtime     = {0, 0};
std::string             gBridgeDir;               // /Users/<x>/MEP-Bridge (shared with mepraw.cpp)
static std::string      gJobPath, gReqPath, gDocsPath, gTargetPath;
static std::string      gBomReqPath, gBomPath, gTblReqPath, gNativePath, gNativeDonePath, gSelReqPath;
static struct timespec  gNativeMtime = {0, 0};
static struct timespec  gSelReqMtime = {0, 0};
static std::string      gHiLayer;   // layer dang duoc highlight (de unhighlight khi doi)

static const ACHAR* kGroup = L"MEP_BRIDGE";

// ============================ UTF-8 <-> wchar_t (UTF-32 tren Mac) ============================
std::string toUtf8(const wchar_t* w) {
    std::string out;
    if (!w) return out;
    for (const wchar_t* p = w; *p; ++p) {
        unsigned c = (unsigned)*p;
        if (c < 0x80) out += (char)c;
        else if (c < 0x800) { out += (char)(0xC0 | (c >> 6)); out += (char)(0x80 | (c & 0x3F)); }
        else if (c < 0x10000) { out += (char)(0xE0 | (c >> 12)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
        else { out += (char)(0xF0 | (c >> 18)); out += (char)(0x80 | ((c >> 12) & 0x3F)); out += (char)(0x80 | ((c >> 6) & 0x3F)); out += (char)(0x80 | (c & 0x3F)); }
    }
    return out;
}
std::wstring toWide(const std::string& s) {
    std::wstring out;
    size_t i = 0, n = s.size();
    while (i < n) {
        unsigned char c = s[i];
        unsigned cp = 0; int len = 1;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c >> 5) == 0x6 && i + 1 < n) { cp = ((c & 0x1F) << 6) | (s[i+1] & 0x3F); len = 2; }
        else if ((c >> 4) == 0xE && i + 2 < n) { cp = ((c & 0x0F) << 12) | ((s[i+1] & 0x3F) << 6) | (s[i+2] & 0x3F); len = 3; }
        else if ((c >> 3) == 0x1E && i + 3 < n) { cp = ((c & 0x07) << 18) | ((s[i+1] & 0x3F) << 12) | ((s[i+2] & 0x3F) << 6) | (s[i+3] & 0x3F); len = 4; }
        else { cp = '?'; len = 1; }
        out += (wchar_t)cp; i += len;
    }
    return out;
}
std::string jsonEsc(const std::string& s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (c == '\n' || c == '\r') { o += ' '; }
        else o += c;
    }
    return o;
}
bool tsChanged(const struct timespec& a, const struct timespec& b) {
    return a.tv_sec != b.tv_sec || a.tv_nsec != b.tv_nsec;
}
std::string readAll(const std::string& p) {
    FILE* f = fopen(p.c_str(), "rb");
    if (!f) return "";
    std::string s; char buf[4096]; size_t k;
    while ((k = fread(buf, 1, sizeof buf, f)) > 0) s.append(buf, k);
    fclose(f);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ')) s.pop_back();
    return s;
}

static std::string gEventsPath;

static void initPaths() {
    const char* home = std::getenv("HOME");
    gBridgeDir = std::string(home ? home : "/tmp") + "/MEP-Bridge";
    mkdir(gBridgeDir.c_str(), 0755);
    gJobPath    = gBridgeDir + "/mep_job.lsp";
    gReqPath    = gBridgeDir + "/docs.req";
    gDocsPath   = gBridgeDir + "/docs.json";
    gTargetPath = gBridgeDir + "/job_target.txt";
    gEventsPath = gBridgeDir + "/events.jsonl";
    gBomReqPath = gBridgeDir + "/bom.req";
    gBomPath    = gBridgeDir + "/bom.json";
    gTblReqPath = gBridgeDir + "/bomtable.req";
    gNativePath     = gBridgeDir + "/native.job";    // job C++ thuan (bang tab), khong LISP
    gNativeDonePath = gBridgeDir + "/native.done";   // plugin ghi so entity da tao
    gSelReqPath     = gBridgeDir + "/select.req";     // "<target>|<layer>" -> highlight + zoom
}

// ============================ event stream cho app (events.jsonl, append) ============================
void emitEvent(const char* type, const std::string& detail) {
    struct stat st;
    if (stat(gEventsPath.c_str(), &st) == 0 && st.st_size > 512 * 1024)
        unlink(gEventsPath.c_str());   // chong phinh file
    FILE* f = fopen(gEventsPath.c_str(), "ab");
    if (!f) return;
    std::string active;
    if (acDocManager) {
        AcApDocument* d = acDocManager->mdiActiveDocument();
        if (d) active = toUtf8(d->docTitle());
    }
    fprintf(f, "{\"t\":%ld,\"type\":\"%s\",\"detail\":\"%s\",\"activeDoc\":\"%s\"}\n",
            (long)time(nullptr), type, jsonEsc(detail).c_str(), jsonEsc(active).c_str());
    fclose(f);
}

// ============================ danh sach ban ve dang mo -> docs.json ============================
static void writeDocs() {
    if (acDocManager == nullptr) return;
    AcApDocument* pActive = acDocManager->mdiActiveDocument();
    std::string json = "{\"docs\":[";
    bool first = true;
    AcApDocumentIterator* it = acDocManager->newAcApDocumentIterator();
    if (it) {
        for (; !it->done(); it->step()) {
            AcApDocument* d = it->document();
            if (!d) continue;
            if (!first) json += ",";
            first = false;
            json += "{\"title\":\"" + jsonEsc(toUtf8(d->docTitle())) +
                    "\",\"file\":\"" + jsonEsc(toUtf8(d->fileName())) +
                    "\",\"active\":" + (d == pActive ? "true" : "false") + "}";
        }
        delete it;
    }
    json += "]}";
    std::string tmp = gDocsPath + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return;
    fwrite(json.data(), 1, json.size(), f);
    fclose(f);
    rename(tmp.c_str(), gDocsPath.c_str());
}

// ============================ tim ban ve theo ten (title/fileName/suffix) ============================
AcApDocument* findDocByName(const std::string& want) {
    if (acDocManager == nullptr) return nullptr;
    AcApDocument* fallback = acDocManager->mdiActiveDocument();
    if (!fallback) fallback = acDocManager->curDocument();
    if (want.empty()) return fallback;
    AcApDocumentIterator* it = acDocManager->newAcApDocumentIterator();
    AcApDocument* hit = nullptr;
    if (it) {
        for (; !it->done(); it->step()) {
            AcApDocument* d = it->document();
            if (!d) continue;
            std::string title = toUtf8(d->docTitle());
            std::string file  = toUtf8(d->fileName());
            if (title == want || file == want ||
                (want.size() <= file.size() && file.compare(file.size() - want.size(), want.size(), want) == 0)) {
                hit = d; break;
            }
        }
        delete it;
    }
    return hit ? hit : fallback;
}
static AcApDocument* resolveTarget() { return findDocByName(readAll(gTargetPath)); }

// ============================ chay job ============================
static void runJob() {
    if (acDocManager == nullptr) return;
    AcApDocument* pDoc = resolveTarget();
    if (pDoc == nullptr) { acutPrintf(L"\n[MepBridge] Chua co ban ve mo -- bo qua job."); return; }
    // Tu trust ~/MEP-Bridge de (load) khong bi SECURELOAD hoi/chan, roi load job.
    std::wstring dirW = toWide(gBridgeDir);
    std::wstring jobW = toWide(gJobPath);
    std::wstring cmd =
        L"(progn (setq mep:tp (getvar \"TRUSTEDPATHS\")) (if (null mep:tp) (setq mep:tp \"\")) "
        L"(if (null (vl-string-search \"MEP-Bridge\" mep:tp)) "
        L"(setvar \"TRUSTEDPATHS\" (strcat mep:tp \";" + dirW + L"/...\"))) "
        L"(load \"" + jobW + L"\")) ";
    // Chu y thu tu tham so DUNG: (doc, str, bActivate, bWrapUpInactiveDoc, bEchoString)
    acDocManager->sendStringToExecute(pDoc, cmd.c_str(), true, false, false);
    writeDocs(); // tien the cap nhat trang thai
}

// ============================ FSEvents watcher ============================
static void writeBom(AcApDocument* pDoc);   // forward (dinh nghia o duoi)
static struct timespec gBomReqMtime = {0, 0};
static struct timespec gTblReqMtime = {0, 0};
static void insertBomTable(AcApDocument*, double, double);
static int  execNativeJob(const std::string&);
static void highlightLayer(AcApDocument*, const std::string&);
// mepraw.cpp — raw ObjectARX catalog dispatch
void mepRawOnWatchTick();
void mepRawOnStartWatch();
void mepRawRegisterCommands();

static void fsCallback(ConstFSEventStreamRef, void*, size_t, void*,
                       const FSEventStreamEventFlags*, const FSEventStreamEventId*) {
    struct stat st;
    if (stat(gReqPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gReqMtime)) {
        gReqMtime = st.st_mtimespec;
        writeDocs();                         // app hoi danh sach ban ve (heartbeat)
    }
    if (stat(gBomReqPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gBomReqMtime)) {
        gBomReqMtime = st.st_mtimespec;
        writeBom(findDocByName(readAll(gBomReqPath)));   // app hoi BOM ban ve dang mo
    }
    if (stat(gTblReqPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gTblReqMtime)) {
        gTblReqMtime = st.st_mtimespec;
        std::string req = readAll(gTblReqPath);           // dinh dang: "<target>|<x>|<y>"
        std::string tgt; double x = 0, y = 0;
        size_t p1 = req.find('|');
        if (p1 != std::string::npos) { tgt = req.substr(0, p1);
            size_t p2 = req.find('|', p1 + 1);
            if (p2 != std::string::npos) { x = atof(req.substr(p1 + 1, p2 - p1 - 1).c_str()); y = atof(req.substr(p2 + 1).c_str()); } }
        else tgt = req;
        insertBomTable(findDocByName(tgt), x, y);
    }
    if (stat(gSelReqPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gSelReqMtime)) {
        gSelReqMtime = st.st_mtimespec;
        std::string req = readAll(gSelReqPath);       // "<target>|<layer>"
        size_t bar = req.find('|');
        std::string tgt = bar == std::string::npos ? "" : req.substr(0, bar);
        std::string lay = bar == std::string::npos ? req : req.substr(bar + 1);
        highlightLayer(findDocByName(tgt), lay);
    }
    if (stat(gNativePath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gNativeMtime)) {
        gNativeMtime = st.st_mtimespec;
        execNativeJob(readAll(gNativePath));   // vẽ C++ thuần, khong LISP/SECURELOAD
    }
    mepRawOnWatchTick();   // ObjectARX raw catalog (raw.job → raw.done)
    if (stat(gJobPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gJobMtime)) {
        gJobMtime = st.st_mtimespec;
        runJob();
    }
}

static void startWatch() {
    if (gStream) return;
    struct stat st;
    if (stat(gJobPath.c_str(), &st) == 0) gJobMtime = st.st_mtimespec;   // khong chay job cu
    if (stat(gReqPath.c_str(), &st) == 0) gReqMtime = st.st_mtimespec;
    if (stat(gBomReqPath.c_str(), &st) == 0) gBomReqMtime = st.st_mtimespec;
    if (stat(gTblReqPath.c_str(), &st) == 0) gTblReqMtime = st.st_mtimespec;
    if (stat(gNativePath.c_str(), &st) == 0) gNativeMtime = st.st_mtimespec;   // khong chay job native cu
    if (stat(gSelReqPath.c_str(), &st) == 0) gSelReqMtime = st.st_mtimespec;
    mepRawOnStartWatch();

    CFStringRef dir = CFStringCreateWithCString(nullptr, gBridgeDir.c_str(), kCFStringEncodingUTF8);
    CFArrayRef paths = CFArrayCreate(nullptr, (const void**)&dir, 1, &kCFTypeArrayCallBacks);
    FSEventStreamContext ctx = {0, nullptr, nullptr, nullptr, nullptr};
    gStream = FSEventStreamCreate(nullptr, &fsCallback, &ctx, paths,
        kFSEventStreamEventIdSinceNow, 0.25,
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer);
    CFRelease(paths); CFRelease(dir);
    if (!gStream) { acutPrintf(L"\n[MepBridge] Loi: khong tao duoc FSEventStream."); return; }
    FSEventStreamSetDispatchQueue(gStream, dispatch_get_main_queue());
    FSEventStreamStart(gStream);
}
static void stopWatch() {
    if (!gStream) return;
    FSEventStreamStop(gStream);
    FSEventStreamInvalidate(gStream);
    FSEventStreamRelease(gStream);
    gStream = nullptr;
}

// ============================ MEPBOM: boc khoi luong NATIVE tu ban ve dang mo ============================
static bool isPipeLayer(const std::string& L) {
    std::string u; for (char c : L) u += (char)toupper((unsigned char)c);
    return u.rfind("P-", 0) == 0 || u.rfind("DCCD", 0) == 0 || u.rfind("N-T", 0) == 0 ||
           u.find("PIPE") != std::string::npos || u.find("DUCT") != std::string::npos;
}

// Đọc DN từ XDATA "MEP_STUDIO" (chuỗi "dn=90") của entity ống native; "?" nếu không có.
static std::string xdataDn(AcDbEntity* ent) {
    std::string dn = "?";
    resbuf* rb = ent->xData(L"MEP_STUDIO");
    for (resbuf* p = rb; p; p = p->rbnext) {
        if (p->restype == 1000 && p->resval.rstring) {
            std::string s = toUtf8(p->resval.rstring);
            if (s.rfind("dn=", 0) == 0) dn = s.substr(3);
        }
    }
    if (rb) acutRelRb(rb);
    return dn;
}

// Quét model space -> gom chiều dài ống theo layer\tdn + đếm block. Dùng chung cho JSON & table.
static void scanBom(AcDbDatabase* db, std::map<std::string, double>& pipes, std::map<std::string, int>& blocks) {
    AcDbBlockTable* bt = nullptr;
    if (!db || db->getBlockTable(bt, AcDb::kForRead) != Acad::eOk) return;
    AcDbBlockTableRecord* ms = nullptr;
    if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForRead) == Acad::eOk) {
        AcDbBlockTableRecordIterator* it = nullptr;
        if (ms->newIterator(it) == Acad::eOk && it) {
            for (; !it->done(); it->step()) {
                AcDbEntity* ent = nullptr;
                if (it->getEntity(ent, AcDb::kForRead) != Acad::eOk || !ent) continue;
                ACHAR* lw = ent->layer();
                std::string L = toUtf8(lw); acutDelString(lw);
                if (AcDbBlockReference* br = AcDbBlockReference::cast(ent)) {
                    AcDbBlockTableRecord* def = nullptr;
                    if (acdbOpenObject(def, br->blockTableRecord(), AcDb::kForRead) == Acad::eOk && def) {
                        AcString nm; def->getName(nm);
                        std::string n = toUtf8(nm.kwszPtr());
                        if (!n.empty() && n[0] != '*') blocks[n]++;
                        def->close();
                    }
                } else if (AcDbMline* ml = AcDbMline::cast(ent)) {
                    if (isPipeLayer(L)) {
                        double len = 0;
                        for (int i = 0; i + 1 < ml->numVertices(); ++i)
                            len += ml->vertexAt(i).distanceTo(ml->vertexAt(i + 1));
                        char dn[16]; snprintf(dn, sizeof dn, "%d", (int)(fabs(ml->scale()) + 0.5));
                        pipes[L + "\t" + dn] += len;
                    }
                } else if (AcDbCurve* cv = AcDbCurve::cast(ent)) {
                    if (isPipeLayer(L)) {
                        double ep = 0, len = 0;
                        if (cv->getEndParam(ep) == Acad::eOk && cv->getDistAtParam(ep, len) == Acad::eOk)
                            pipes[L + "\t" + xdataDn(ent)] += len;   // DN từ XDATA nếu là ống native
                    }
                }
                ent->close();
            }
            delete it;
        }
        ms->close();
    }
    bt->close();
}

// Chèn BẢNG BOQ (AcDbTable thật) vào model space bản vẽ tại (x,y).
static void insertBomTable(AcApDocument* pDoc, double x, double y) {
    if (!pDoc || !acDocManager) return;
    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) return;
    AcDbDatabase* db = pDoc->database();
    std::map<std::string, double> pipes; std::map<std::string, int> blocks;
    scanBom(db, pipes, blocks);

    int nRows = 2 + (int)pipes.size() + (blocks.empty() ? 0 : (int)blocks.size() + 1); // title + header + data
    if (nRows < 3) nRows = 3;
    AcDbTable* tbl = new AcDbTable();
    tbl->setDatabaseDefaults(db);
    tbl->setTableStyle(db->tablestyle());
    tbl->setSize(nRows, 3);
    tbl->setColumnWidth(0, 4000.0); tbl->setColumnWidth(1, 1500.0); tbl->setColumnWidth(2, 2000.0);
    tbl->setRowHeight(600.0);
    tbl->setPosition(AcGePoint3d(x, y, 0));
    tbl->setTextString(0, 0, L"BANG KHOI LUONG (MEP Studio)");
    int r = 1;
    tbl->setTextString(r, 0, L"Layer / He"); tbl->setTextString(r, 1, L"DN"); tbl->setTextString(r, 2, L"Dai (m)"); r++;
    for (auto& kv : pipes) {
        size_t tab = kv.first.find('\t');
        std::wstring lay = toWide(kv.first.substr(0, tab)), dn = toWide(kv.first.substr(tab + 1));
        char buf[64]; snprintf(buf, sizeof buf, "%.2f", kv.second / 1000.0);
        tbl->setTextString(r, 0, lay.c_str()); tbl->setTextString(r, 1, dn.c_str());
        tbl->setTextString(r, 2, toWide(buf).c_str()); r++;
    }
    if (!blocks.empty()) {
        tbl->setTextString(r, 0, L"-- Phu kien / thiet bi --"); r++;
        for (auto& kv : blocks) {
            tbl->setTextString(r, 0, toWide(kv.first).c_str());
            tbl->setTextString(r, 2, toWide(std::to_string(kv.second)).c_str()); r++;
        }
    }
    tbl->generateLayout();

    AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
    if (db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk) {
        if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) == Acad::eOk) {
            AcDbObjectId id;
            ms->appendAcDbEntity(id, tbl);
            ms->close();
        }
        bt->close();
    }
    tbl->close();
    acDocManager->unlockDocument(pDoc);
    emitEvent("bomTableInserted", "");
    acutPrintf(L"\n[MepBridge] Da chen bang BOQ.");
}

static void writeBom(AcApDocument* pDoc) {
    if (!pDoc || !acDocManager) return;
    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) {
        FILE* f = fopen((gBomPath + ".tmp").c_str(), "wb");
        if (f) { fputs("{\"error\":\"busy\"}", f); fclose(f); rename((gBomPath + ".tmp").c_str(), gBomPath.c_str()); }
        return;
    }
    std::map<std::string, double> pipes;
    std::map<std::string, int> blocks;
    scanBom(pDoc->database(), pipes, blocks);
    acDocManager->unlockDocument(pDoc);

    std::string json = "{\"doc\":\"" + jsonEsc(toUtf8(pDoc->docTitle())) + "\",\"pipes\":[";
    bool first = true;
    for (auto& kv : pipes) {
        size_t tab = kv.first.find('\t');
        if (!first) json += ","; first = false;
        char buf[64]; snprintf(buf, sizeof buf, "%.2f", kv.second / 1000.0);
        json += "{\"layer\":\"" + jsonEsc(kv.first.substr(0, tab)) + "\",\"dn\":\"" +
                jsonEsc(kv.first.substr(tab + 1)) + "\",\"len_m\":" + buf + "}";
    }
    json += "],\"blocks\":[";
    first = true;
    for (auto& kv : blocks) {
        if (!first) json += ","; first = false;
        json += "{\"name\":\"" + jsonEsc(kv.first) + "\",\"count\":" + std::to_string(kv.second) + "}";
    }
    json += "]}";
    std::string tmp = gBomPath + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (f) { fwrite(json.data(), 1, json.size(), f); fclose(f); rename(tmp.c_str(), gBomPath.c_str()); }
}

// ============================ NATIVE JOB: vẽ bằng C++ thuần (rank 2+6) ============================
// Không LISP, không SECURELOAD: app ghi ~/MEP-Bridge/native.job (bảng, phân tách TAB),
// plugin dựng entity trực tiếp qua AcDb trong document lock -> nhanh + chính xác.
// Định dạng mỗi dòng:
//   MODE   \t COMMIT|PREVIEW|APPLY|REJECT              (mặc định COMMIT = vẽ thẳng)
//   OPID   \t <id>                                       (bắt buộc với PREVIEW/APPLY/REJECT)
//   TARGET \t <tên bản vẽ>                              (tuỳ chọn)
//   LAYER  \t <tên> \t <ACI màu>
//   PIPE   \t <layer> \t <dn> \t <hệ> \t x1,y1 x2,y2 …  (polyline + XDATA)
//   TEXT   \t <layer> \t <x> \t <y> \t <cao> \t <chuỗi>
//   CIRCLE \t <layer> \t <x> \t <y> \t <bán kính>
// PREVIEW: vẽ lên layer MEP-PREVIEW (nhìn thấy trên CAD), XDATA preview=1 + op=<id> + dest=<layer>
// APPLY:  đổi layer entity preview cùng opId sang dest (commit accepted)
// REJECT: xoá entity preview cùng opId
static const wchar_t* kPreviewLayer = L"MEP-PREVIEW";
static const int kPreviewAci = 30; // orange — dễ phân biệt preview

static std::vector<std::string> splitCh(const std::string& s, char d) {
    std::vector<std::string> out; std::string cur;
    for (char c : s) { if (c == d) { out.push_back(cur); cur.clear(); } else cur += c; }
    out.push_back(cur); return out;
}
AcDbObjectId ensureLayer(AcDbDatabase* db, const std::wstring& name, int aci) {
    AcDbObjectId id = AcDbObjectId::kNull;
    AcDbLayerTable* lt = nullptr;
    if (db->getLayerTable(lt, AcDb::kForRead) != Acad::eOk) return id;
    if (lt->has(name.c_str())) { lt->getAt(name.c_str(), id); lt->close(); return id; }
    lt->upgradeOpen();
    AcDbLayerTableRecord* rec = new AcDbLayerTableRecord();
    rec->setName(name.c_str());
    if (aci > 0) { AcCmColor c; c.setColorIndex((Adesk::UInt16)aci); rec->setColor(c); }
    if (lt->add(id, rec) != Acad::eOk) { delete rec; } else rec->close();
    lt->close();
    return id;
}
void ensureRegApp(AcDbDatabase* db) {
    AcDbRegAppTable* rat = nullptr;
    if (db->getRegAppTable(rat, AcDb::kForRead) != Acad::eOk) return;
    if (!rat->has(L"MEP_STUDIO")) {
        rat->upgradeOpen();
        AcDbRegAppTableRecord* r = new AcDbRegAppTableRecord();
        r->setName(L"MEP_STUDIO");
        AcDbObjectId id;
        if (rat->add(id, r) != Acad::eOk) delete r; else r->close();
    }
    rat->close();
}
static void setPipeXData(AcDbEntity* ent, const std::string& dn, const std::string& sys) {
    std::wstring dnW = toWide("dn=" + dn), sysW = toWide("sys=" + sys);
    resbuf* rb = acutBuildList(1001, L"MEP_STUDIO", 1000, dnW.c_str(), 1000, sysW.c_str(), 0);
    if (rb) { ent->setXData(rb); acutRelRb(rb); }
}
/** XDATA preview stage: preview=1, op=<id>, dest=<permanent layer>, dn=, sys= */
static void setPreviewXData(AcDbEntity* ent, const std::string& opId,
                            const std::string& dn, const std::string& sys,
                            const std::string& destLayer) {
    std::wstring a = toWide("preview=1");
    std::wstring b = toWide("op=" + opId);
    std::wstring c = toWide("dest=" + destLayer);
    std::wstring d = toWide("dn=" + dn);
    std::wstring e = toWide("sys=" + sys);
    resbuf* rb = acutBuildList(1001, L"MEP_STUDIO",
        1000, a.c_str(), 1000, b.c_str(), 1000, c.c_str(), 1000, d.c_str(), 1000, e.c_str(), 0);
    if (rb) { ent->setXData(rb); acutRelRb(rb); }
}
/** Parse MEP_STUDIO string tags into map key->value (keys without '=') */
static void readMepTags(AcDbEntity* ent, std::map<std::string, std::string>& tags) {
    tags.clear();
    resbuf* xd = ent->xData(L"MEP_STUDIO");
    if (!xd) return;
    for (resbuf* p = xd; p; p = p->rbnext) {
        if (p->restype != 1000 || !p->resval.rstring) continue;
        std::string s = toUtf8(p->resval.rstring);
        auto eq = s.find('=');
        if (eq == std::string::npos) continue;
        tags[s.substr(0, eq)] = s.substr(eq + 1);
    }
    acutRelRb(xd);
}
static std::string handleOfEnt(AcDbEntity* e) {
    if (!e) return "";
    AcDbHandle h; e->getAcDbHandle(h);
    ACHAR buf[32]; h.getIntoAsciiBuffer(buf);
    return toUtf8(buf);
}
static void writeNativeDoneJson(const std::string& json) {
    FILE* f = fopen((gNativeDonePath + ".tmp").c_str(), "wb");
    if (f) { fwrite(json.data(), 1, json.size(), f); fclose(f);
        rename((gNativeDonePath + ".tmp").c_str(), gNativeDonePath.c_str()); }
}
/** APPLY: promote preview entities (same opId) to dest layer; clear preview flag. */
static int nativeApply(AcDbDatabase* db, AcDbBlockTableRecord* ms, const std::string& opId,
                       std::vector<std::string>& handles) {
    int count = 0;
    AcDbBlockTableRecordIterator* it = nullptr;
    if (ms->newIterator(it) != Acad::eOk || !it) return 0;
    for (; !it->done(); it->step()) {
        AcDbEntity* ent = nullptr;
        if (it->getEntity(ent, AcDb::kForWrite) != Acad::eOk) continue;
        std::map<std::string, std::string> tags;
        readMepTags(ent, tags);
        if (tags["preview"] != "1" || tags["op"] != opId) { ent->close(); continue; }
        std::string dest = tags["dest"].empty() ? "0" : tags["dest"];
        ensureLayer(db, toWide(dest), 0);
        ent->setLayer(toWide(dest).c_str());
        // Clear color override so entity follows dest layer (not permanent orange preview).
        {
            AcCmColor byLayer;
            byLayer.setByLayer();
            ent->setColor(byLayer);
        }
        // rewrite XDATA without preview=1 (accepted)
        setPipeXData(ent, tags["dn"], tags["sys"]);
        handles.push_back(handleOfEnt(ent));
        ent->close();
        count++;
    }
    delete it;
    return count;
}
/** REJECT: erase preview entities for opId. */
static int nativeReject(AcDbBlockTableRecord* ms, const std::string& opId,
                        std::vector<std::string>& handles) {
    int count = 0;
    std::vector<AcDbObjectId> toErase;
    AcDbBlockTableRecordIterator* it = nullptr;
    if (ms->newIterator(it) != Acad::eOk || !it) return 0;
    for (; !it->done(); it->step()) {
        AcDbEntity* ent = nullptr;
        if (it->getEntity(ent, AcDb::kForRead) != Acad::eOk) continue;
        std::map<std::string, std::string> tags;
        readMepTags(ent, tags);
        if (tags["preview"] == "1" && tags["op"] == opId) {
            handles.push_back(handleOfEnt(ent));
            toErase.push_back(ent->objectId());
        }
        ent->close();
    }
    delete it;
    for (auto& id : toErase) {
        AcDbEntity* ent = nullptr;
        if (acdbOpenObject(ent, id, AcDb::kForWrite) == Acad::eOk) {
            ent->erase();
            ent->close();
            count++;
        }
    }
    return count;
}
static int execNativeJob(const std::string& raw) {
    if (!acDocManager) return 0;
    std::vector<std::string> lines = splitCh(raw, '\n');
    std::string target, mode = "COMMIT", opId, token;
    for (auto& ln : lines) {
        std::string line = ln;
        while (!line.empty() && (line.back()=='\r'||line.back()==' ')) line.pop_back();
        if (line.rfind("TARGET\t", 0) == 0) target = line.substr(7);
        else if (line.rfind("MODE\t", 0) == 0) mode = line.substr(5);
        else if (line.rfind("OPID\t", 0) == 0) opId = line.substr(5);
        else if (line.rfind("TOKEN\t", 0) == 0) token = line.substr(6);
    }
    while (!target.empty() && (target.back()=='\r'||target.back()==' ')) target.pop_back();
    while (!mode.empty() && (mode.back()=='\r'||mode.back()==' ')) mode.pop_back();
    while (!opId.empty() && (opId.back()=='\r'||opId.back()==' ')) opId.pop_back();
    while (!token.empty() && (token.back()=='\r'||token.back()==' ')) token.pop_back();

    auto failDone = [&](const char* err) {
        std::string j = std::string("{\"ok\":false,\"error\":\"") + jsonEsc(err) +
            "\",\"count\":0,\"mode\":\"" + jsonEsc(mode) + "\",\"opId\":\"" + jsonEsc(opId) +
            "\",\"token\":\"" + jsonEsc(token) + "\"}";
        writeNativeDoneJson(j);
    };

    AcApDocument* pDoc = findDocByName(target);
    if (!pDoc) { acutPrintf(L"\n[MepBridge] native.job: khong co ban ve dich.");
        failDone("no document"); return 0; }
    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) {
        failDone("lock failed"); return 0; }
    AcDbDatabase* db = pDoc->database();
    ensureRegApp(db);

    AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
    if (db->getBlockTable(bt, AcDb::kForRead) != Acad::eOk) { acDocManager->unlockDocument(pDoc); return 0; }
    if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) != Acad::eOk) {
        bt->close(); acDocManager->unlockDocument(pDoc); return 0; }

    int count = 0;
    std::vector<std::string> handles;

    if (mode == "APPLY") {
        if (opId.empty()) {
            ms->close(); bt->close(); acDocManager->unlockDocument(pDoc);
            failDone("APPLY needs OPID");
            return 0;
        }
        count = nativeApply(db, ms, opId, handles);
    } else if (mode == "REJECT") {
        if (opId.empty()) {
            ms->close(); bt->close(); acDocManager->unlockDocument(pDoc);
            failDone("REJECT needs OPID");
            return 0;
        }
        count = nativeReject(ms, opId, handles);
    } else {
        // COMMIT or PREVIEW: create entities
        const bool isPreview = (mode == "PREVIEW");
        if (isPreview) {
            if (opId.empty()) {
                ms->close(); bt->close(); acDocManager->unlockDocument(pDoc);
                failDone("PREVIEW needs OPID");
                return 0;
            }
            ensureLayer(db, kPreviewLayer, kPreviewAci);
        }
        for (auto& ln : lines) {
            std::string line = ln;
            while (!line.empty() && (line.back()=='\r'||line.back()==' ')) line.pop_back();
            if (line.empty()) continue;
            std::vector<std::string> t = splitCh(line, '\t');
            const std::string& op = t[0];
            AcDbObjectId newId;
            if (op == "LAYER" && t.size() >= 3) {
                ensureLayer(db, toWide(t[1]), atoi(t[2].c_str()));
            } else if (op == "PIPE" && t.size() >= 5) {
                std::string destLayer = t[1];
                std::string drawLayer = isPreview ? toUtf8(kPreviewLayer) : destLayer;
                if (!isPreview) ensureLayer(db, toWide(destLayer), 0);
                else ensureLayer(db, toWide(destLayer), 0); // dest exists for apply later
                std::vector<std::string> pts = splitCh(t[4], ' ');
                std::vector<AcGePoint2d> vs;
                for (auto& p : pts) { if (p.empty()) continue;
                    std::vector<std::string> xy = splitCh(p, ',');
                    if (xy.size() >= 2) vs.push_back(AcGePoint2d(atof(xy[0].c_str()), atof(xy[1].c_str()))); }
                if (vs.size() >= 2) {
                    AcDbPolyline* pl = new AcDbPolyline((unsigned)vs.size());
                    for (unsigned i = 0; i < vs.size(); ++i) pl->addVertexAt(i, vs[i]);
                    pl->setLayer(toWide(drawLayer).c_str());
                    // Visible width: DN as constant width (mm) so thin single-pixel lines don't "disappear"
                    double w = atof(t[2].c_str());
                    if (w < 20) w = 20;
                    if (w > 500) w = 500;
                    pl->setConstantWidth(w);
                    if (isPreview) {
                        AcCmColor col; col.setColorIndex((Adesk::UInt16)kPreviewAci);
                        pl->setColor(col);
                    }
                    if (ms->appendAcDbEntity(newId, pl) == Acad::eOk) {
                        if (isPreview) setPreviewXData(pl, opId, t[2], t[3], destLayer);
                        else setPipeXData(pl, t[2], t[3]);
                        handles.push_back(handleOfEnt(pl));
                        pl->close(); count++;
                    } else delete pl;
                }
            } else if (op == "TEXT" && t.size() >= 6 && !isPreview) {
                ensureLayer(db, toWide(t[1]), 0);
                AcDbText* tx = new AcDbText(AcGePoint3d(atof(t[2].c_str()), atof(t[3].c_str()), 0),
                                           toWide(t[5]).c_str(), db->textstyle(), atof(t[4].c_str()), 0);
                tx->setLayer(toWide(t[1]).c_str());
                if (ms->appendAcDbEntity(newId, tx) == Acad::eOk) { tx->close(); count++; } else delete tx;
            } else if (op == "CIRCLE" && t.size() >= 5 && !isPreview) {
                ensureLayer(db, toWide(t[1]), 0);
                AcDbCircle* c = new AcDbCircle(AcGePoint3d(atof(t[2].c_str()), atof(t[3].c_str()), 0),
                                              AcGeVector3d(0, 0, 1), atof(t[4].c_str()));
                c->setLayer(toWide(t[1]).c_str());
                if (ms->appendAcDbEntity(newId, c) == Acad::eOk) { c->close(); count++; } else delete c;
            }
        }
    }
    ms->close(); bt->close();
    acDocManager->unlockDocument(pDoc);

    // After PREVIEW/COMMIT: zoom so the user actually sees new geometry (tests used tiny coords
    // at origin; without ZOOM the viewport can leave everything off-screen).
    if (count > 0 && (mode == "PREVIEW" || mode == "COMMIT" || mode == "APPLY")) {
        acDocManager->sendStringToExecute(pDoc, L"(command \"_.ZOOM\" \"_E\") ", true, false, false);
        if (mode == "PREVIEW") {
            // Thaw/on preview layer if frozen; print clear cue on command line.
            acutPrintf(L"\n[MepBridge] PREVIEW: %d doi tuong tren layer MEP-PREVIEW (mau cam). Zoom Extents.", count);
        }
    }

    // native.done: JSON with mode+opId+token so daemon never accepts a stale reply
    std::string hjson = "[";
    for (size_t i = 0; i < handles.size(); ++i) {
        if (i) hjson += ",";
        hjson += "\"" + jsonEsc(handles[i]) + "\"";
    }
    hjson += "]";
    std::string done = std::string("{\"ok\":true,\"mode\":\"") + jsonEsc(mode) +
        "\",\"opId\":\"" + jsonEsc(opId) +
        "\",\"token\":\"" + jsonEsc(token) +
        "\",\"count\":" + std::to_string(count) +
        ",\"handles\":" + hjson +
        (mode == "PREVIEW" ? ",\"layer\":\"MEP-PREVIEW\",\"committed\":false" : "") +
        (mode == "APPLY" ? ",\"committed\":true" : "") +
        (mode == "REJECT" ? ",\"discarded\":true" : "") +
        "}";
    writeNativeDoneJson(done);
    emitEvent(mode == "PREVIEW" ? "nativePreview" :
              mode == "APPLY" ? "nativeApply" :
              mode == "REJECT" ? "nativeReject" : "nativeJobDone",
              std::to_string(count) + (opId.empty() ? "" : (" op=" + opId)));
    acutPrintf(L"\n[MepBridge] native.job %s: %d doi tuong.", toWide(mode).c_str(), count);
    return count;
}

// ============================ QA highlight + zoom theo layer (rank 7) ============================
// App ghi ~/MEP-Bridge/select.req = "<target>|<layer>"  -> plugin sáng mọi đối tượng trên layer
// đó (tắt sáng layer trước) rồi ZOOM tới vùng bao. layer="CLEAR" -> tắt sáng.
static void highlightLayer(AcApDocument* pDoc, const std::string& layer) {
    if (!pDoc || !acDocManager) return;
    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) return;
    AcDbDatabase* db = pDoc->database();
    AcDbExtents total;
    int n = 0;
    bool clear = layer.empty() || layer == "CLEAR";
    AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
    if (db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk) {
        if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForRead) == Acad::eOk) {
            AcDbBlockTableRecordIterator* it = nullptr;
            if (ms->newIterator(it) == Acad::eOk && it) {
                for (; !it->done(); it->step()) {
                    AcDbEntity* ent = nullptr;
                    if (it->getEntity(ent, AcDb::kForRead) != Acad::eOk || !ent) continue;
                    ACHAR* lw = ent->layer(); std::string L = toUtf8(lw); acutDelString(lw);
                    if (!clear && L == layer) {
                        ent->highlight();
                        AcDbExtents e;
                        if (ent->getGeomExtents(e) == Acad::eOk && e.isValid()) total.addExt(e);
                        n++;
                    } else if (!gHiLayer.empty() && L == gHiLayer) {
                        ent->unhighlight();
                    }
                    ent->close();
                }
                delete it;
            }
            ms->close();
        }
        bt->close();
    }
    acDocManager->unlockDocument(pDoc);
    gHiLayer = clear ? std::string() : layer;

    if (n > 0 && total.isValid()) {   // ZOOM tới vùng vừa sáng (nới 10%)
        AcGePoint3d mn = total.minPoint(), mx = total.maxPoint();
        double dx = (mx.x - mn.x) * 0.1 + 1.0, dy = (mx.y - mn.y) * 0.1 + 1.0;
        wchar_t buf[256];
        swprintf(buf, 256, L"(command \"_.ZOOM\" \"_W\" (list %.3f %.3f) (list %.3f %.3f)) ",
                 mn.x - dx, mn.y - dy, mx.x + dx, mx.y + dy);
        acDocManager->sendStringToExecute(pDoc, buf, true, false, false);
    }
    emitEvent("highlighted", layer + " (" + std::to_string(n) + ")");
    acutPrintf(L"\n[MepBridge] Highlight '%s': %d doi tuong.", toWide(layer).c_str(), n);
}

// ============================ reactors: su kien realtime -> app ============================
static bool gDirty = false;
static void attachDbReactor();   // forward

class MepDocReactor : public AcApDocManagerReactor {
public:
    void documentCreated(AcApDocument* d) override {
        emitEvent("docOpened", d ? toUtf8(d->docTitle()) : "");
        writeDocs();
    }
    void documentToBeDestroyed(AcApDocument* d) override {
        emitEvent("docClosed", d ? toUtf8(d->docTitle()) : "");
    }
    void documentActivated(AcApDocument* d) override {
        emitEvent("docActivated", d ? toUtf8(d->docTitle()) : "");
        attachDbReactor();   // theo doi thay doi cua ban ve moi active
        writeDocs();
    }
};
class MepEdReactor : public AcEditorReactor {
public:
    void commandWillStart(const ACHAR* cmd) override { emitEvent("commandStart", toUtf8(cmd)); }
    void commandEnded(const ACHAR* cmd) override {
        emitEvent("commandEnded", toUtf8(cmd));
        // Lenh ket thuc + ban ve co thay doi -> bao app (de tu refresh BOM/BOQ live).
        if (gDirty) { gDirty = false; emitEvent("drawingModified", ""); }
    }
};
// Database reactor: gom moi thay doi entity (them/sua/xoa) -> danh dau dirty (KHONG lam gi nang
// trong callback — chi set co; emit 1 lan khi lenh ket thuc de tranh spam).
class MepDbReactor : public AcDbDatabaseReactor {
public:
    void objectAppended(const AcDbDatabase*, const AcDbObject*) override { gDirty = true; }
    void objectModified(const AcDbDatabase*, const AcDbObject*) override { gDirty = true; }
    void objectErased(const AcDbDatabase*, const AcDbObject*, bool) override { gDirty = true; }
};
static MepDocReactor gDocReactor;
static MepEdReactor  gEdReactor;
static MepDbReactor  gDbReactor;
static AcDbDatabase* gDbWatched = nullptr;
static bool gReactorsOn = false;

// Gan database reactor vao db cua ban ve active (goi khi nap + khi doi document).
static void attachDbReactor() {
    AcDbDatabase* db = nullptr;
    if (acDocManager && acDocManager->mdiActiveDocument())
        db = acDocManager->mdiActiveDocument()->database();
    if (db == gDbWatched) return;
    if (gDbWatched) gDbWatched->removeReactor(&gDbReactor);
    gDbWatched = db;
    if (gDbWatched) gDbWatched->addReactor(&gDbReactor);
}

static void startReactors() {
    if (gReactorsOn) return;
    if (acDocManager) acDocManager->addReactor(&gDocReactor);
    if (acedEditor)   acedEditor->addReactor(&gEdReactor);
    attachDbReactor();
    gReactorsOn = true;
}
static void stopReactors() {
    if (!gReactorsOn) return;
    if (acDocManager) acDocManager->removeReactor(&gDocReactor);
    if (acedEditor)   acedEditor->removeReactor(&gEdReactor);
    if (gDbWatched)   { gDbWatched->removeReactor(&gDbReactor); gDbWatched = nullptr; }
    gReactorsOn = false;
}

// ============================ lenh AutoCAD ============================
static void cmdMepArx()     { acutPrintf(L"\n[MepBridge] MEPARX: chay mep_job.lsp."); runJob(); }
static void cmdMepNative()  { execNativeJob(readAll(gNativePath)); }
static void cmdMepBomTable() { insertBomTable(acDocManager ? acDocManager->mdiActiveDocument() : nullptr, 0, 0); }
static void cmdMepBom()     { writeBom(acDocManager ? acDocManager->mdiActiveDocument() : nullptr); acutPrintf(L"\n[MepBridge] Da ghi bom.json."); }
static void cmdMepDocs()    { writeDocs(); acutPrintf(L"\n[MepBridge] Da ghi docs.json."); }
static void cmdMepWatch()   { startWatch();  acutPrintf(L"\n[MepBridge] Watcher: ON."); }
static void cmdMepUnwatch() { stopWatch();   acutPrintf(L"\n[MepBridge] Watcher: OFF."); }

// MEPPIPE: vẽ ống tương tác trong AutoCAD — hỏi DN + hệ, nhặt điểm (rubber-band),
// dựng polyline auto layer/màu + XDATA (dn/hệ). Enter/ESC để kết thúc.
static void cmdMepPipe() {
    if (!acDocManager) return;
    AcApDocument* pDoc = acDocManager->mdiActiveDocument();
    if (!pDoc) { acutPrintf(L"\n[MepBridge] Chua co ban ve mo."); return; }

    int dn = 90;
    AcString dnStr;
    if (acedGetString(1, L"\nDN ong <90>: ", dnStr) == RTNORM && dnStr.length() > 0) {
        int v = atoi(toUtf8(dnStr.kwszPtr()).c_str());
        if (v > 0) dn = v;
    }
    std::string layer = "P-ThoatXi", sysName = "thoatxi"; int col = 190;
    acedInitGet(0, L"Xi Rua Hoi Cap");
    AcString sysK;
    if (acedGetKword(L"\nHe [Xi/Rua/Hoi/Cap] <Xi>: ", sysK) == RTNORM) {
        std::string k = toUtf8(sysK.kwszPtr());
        if (k == "Rua") { layer = "P-ThoatRua"; sysName = "thoatrua"; col = 50; }
        else if (k == "Hoi") { layer = "P-ThongHoi"; sysName = "thonghoi"; col = 5; }
        else if (k == "Cap") { layer = "DCCD-nuoclanh"; sysName = "capnuoc"; col = 90; }
    }

    std::vector<AcGePoint2d> pts;
    ads_point p, base;
    if (acedGetPoint(nullptr, L"\nDiem dau ong: ", p) != RTNORM) { acutPrintf(L"\n[MepBridge] Da huy."); return; }
    pts.push_back(AcGePoint2d(p[0], p[1]));
    while (true) {
        base[0] = pts.back().x; base[1] = pts.back().y; base[2] = 0;
        if (acedGetPoint(base, L"\nDiem tiep (Enter=ket thuc): ", p) != RTNORM) break;
        pts.push_back(AcGePoint2d(p[0], p[1]));
    }
    if (pts.size() < 2) { acutPrintf(L"\n[MepBridge] Can it nhat 2 diem."); return; }

    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) return;
    AcDbDatabase* db = pDoc->database();
    ensureRegApp(db);
    ensureLayer(db, toWide(layer), col);
    AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
    if (db->getBlockTable(bt, AcDb::kForRead) == Acad::eOk) {
        if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) == Acad::eOk) {
            AcDbPolyline* pl = new AcDbPolyline((unsigned)pts.size());
            for (unsigned i = 0; i < pts.size(); ++i) pl->addVertexAt(i, pts[i]);
            pl->setLayer(toWide(layer).c_str());
            AcDbObjectId id;
            if (ms->appendAcDbEntity(id, pl) == Acad::eOk) {
                char dnc[16]; snprintf(dnc, sizeof dnc, "%d", dn);
                setPipeXData(pl, dnc, sysName);
                pl->close();
            } else delete pl;
            ms->close();
        }
        bt->close();
    }
    acDocManager->unlockDocument(pDoc);
    emitEvent("drawingModified", "");   // app tu refresh BOM/BOQ
    acutPrintf(L"\n[MepBridge] Da ve ong %d diem, DN%d, layer %s.", (int)pts.size(), dn, toWide(layer).c_str());
}

// ============================ entry point ============================
extern "C" __attribute__((visibility("default"))) AcRx::AppRetCode
acrxEntryPoint(AcRx::AppMsgCode msg, void* pkt) {
    switch (msg) {
    case AcRx::kInitAppMsg:
        acrxDynamicLinker->unlockApplication(pkt);
        acrxRegisterAppMDIAware(pkt);
        initPaths();
        acedRegCmds->addCommand(kGroup, L"MEPARX",     L"MEPARX",     ACRX_CMD_MODAL, &cmdMepArx);
        acedRegCmds->addCommand(kGroup, L"MEPBOM",     L"MEPBOM",     ACRX_CMD_MODAL, &cmdMepBom);
        acedRegCmds->addCommand(kGroup, L"MEPBOMTABLE",L"MEPBOMTABLE",ACRX_CMD_MODAL, &cmdMepBomTable);
        acedRegCmds->addCommand(kGroup, L"MEPNATIVE",  L"MEPNATIVE",  ACRX_CMD_MODAL, &cmdMepNative);
        acedRegCmds->addCommand(kGroup, L"MEPPIPE",    L"MEPPIPE",    ACRX_CMD_MODAL, &cmdMepPipe);
        acedRegCmds->addCommand(kGroup, L"MEPDOCS",    L"MEPDOCS",    ACRX_CMD_MODAL, &cmdMepDocs);
        acedRegCmds->addCommand(kGroup, L"MEPWATCH",   L"MEPWATCH",   ACRX_CMD_MODAL, &cmdMepWatch);
        acedRegCmds->addCommand(kGroup, L"MEPUNWATCH", L"MEPUNWATCH", ACRX_CMD_MODAL, &cmdMepUnwatch);
        mepRawRegisterCommands();   // MEPRAW — interactive raw ObjectARX ops
        startWatch();
        startReactors();
        writeDocs();   // heartbeat dau tien
        emitEvent("pluginLoaded", "MepBridge v9-raw");
        acutPrintf(L"\n[MepBridge v9] Da nap. Raw ObjectARX menu + ~/MEP-Bridge/raw.job."
                   L" Lenh: MEPARX / MEPRAW / MEPDOCS / MEPWATCH / MEPUNWATCH.");
        break;
    case AcRx::kUnloadAppMsg:
        stopReactors();
        stopWatch();
        acedRegCmds->removeGroup(kGroup);
        break;
    default:
        break;
    }
    return AcRx::kRetOK;
}
