// mepbridge.cpp — ObjectARX plugin "AcadBridge" cho AutoCAD 2027 for Mac (R26.0)
//
// Cau 2 CHIEU giua app AutoCAD Toolkit va AutoCAD:
//   1. App ghi ~/Acad-Bridge/docs.req      -> plugin ghi docs.json (danh sach ban ve dang mo,
//      ban ve active). Day cung la HEARTBEAT: app biet plugin song.
//   2. App ghi ~/Acad-Bridge/job_target.txt (ten ban ve dich, UTF-8, tuy chon)
//      roi ghi ~/Acad-Bridge/job.lsp   -> plugin tu (load) job vao DUNG ban ve do
//      (khong co target -> ban ve dang active). Truoc khi load, tu them ~/Acad-Bridge
//      vao TRUSTEDPATHS de khong bi SECURELOAD chan im lang.
//   3. Lenh tay: MEPARX (chay job ngay), MEPDOCS (ghi docs.json), MEPWATCH/MEPUNWATCH.
//
// An toan thread: FSEventStreamSetDispatchQueue(main queue) -> callback chay tren MAIN
// thread; chi dung acDocManager->sendStringToExecute (enqueue, khong chay truc tiep).

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <string>

// Win-compat types (HWND/RECT) cho Mac truoc cac header ARX (aced.h can khi _ADESK_MAC_).
#include "windef.h"
#include <aced.h>
#include <rxregsvc.h>
#include <acutads.h>
#include <acedads.h>
#include <adscodes.h>
#include <acdocman.h>
#include <rxevent.h>
#include <dbmain.h>
#include <dbents.h>
#include <dbmline.h>
#include <dbhatch.h>
#include <dbdim.h>
#include <dbelipse.h>
#include <dbcurve.h>
#include <dbpl.h>
#include <dbsymtb.h>
#include <dbdict.h>
#include <dbxrecrd.h>
#include <dbdynblk.h>
#include <dbAnnotativeObjectPE.h>
#include <dbObjectContextInterface.h>
#include <dbObjectContextManager.h>
#include <dbObjectContextCollection.h>
#include <dblayout.h>
#include <summinfo.h>
#include <dbtable.h>
#include <DbDataLink.h>
#include <dbunderlaydef.h>
#include <dbunderlayref.h>
#include <AcCmColor.h>
#include <algorithm>
#include <map>
#include <set>
#include <vector>

// ============================ trang thai ============================
static FSEventStreamRef gStream       = nullptr;
static struct timespec  gJobMtime     = {0, 0};
static struct timespec  gReqMtime     = {0, 0};
std::string             gBridgeDir;               // /Users/<x>/Acad-Bridge (shared with mepraw.cpp)
static std::string      gJobPath, gReqPath, gDocsPath, gTargetPath;
static std::string      gBomReqPath, gBomPath, gTblReqPath, gNativePath, gNativeDonePath, gSelReqPath;
static std::string      gDrawingInfoReqPath, gDrawingInfoPath;
static std::string      gGeomReqPath, gGeomPath;
static struct timespec  gNativeMtime = {0, 0};
static struct timespec  gSelReqMtime = {0, 0};
static struct timespec  gDrawingInfoReqMtime = {0, 0};
static struct timespec  gGeomReqMtime = {0, 0};
static std::string      gHiLayer;   // layer dang duoc highlight (de unhighlight khi doi)

static const ACHAR* kGroup = L"ACAD_BRIDGE";
static const char*  kPluginVersion = "1.6.0";
static const char*  kReadOnlyJobMarker = ";;; ACAD_BRIDGE_READ_ONLY";
static const uint64_t gDocumentNonce =
    (static_cast<uint64_t>(arc4random()) << 32) | arc4random();
static uint64_t gNextDocumentInstance = 1;
static std::map<const AcApDocument*, std::string> gDocumentInstances;
static std::map<const AcDbDatabase*, uint64_t> gDatabaseRevisions;
// Ban ve co thay doi chua duoc bao cho app. DB reactor bat co nay; `commandEnded`
// hoac nhip watcher xa no. Khai o day (khong phai canh cac reactor) vi nhip
// watcher nam TRUOC khoi reactor trong file nay.
static bool gDirty = false;
// Revision tai lan luu gan nhat. So sanh voi gDatabaseRevisions cho ra
// "da sua ke tu lan luu" — thu ma AcApDocument khong co accessor nao.
static std::map<const AcDbDatabase*, uint64_t> gSavedRevisions;
// Moc dac biet: biet chac ban ve DANG BAN, du bo dem revision o gia tri nao.
// Dung khi plugin nap SAU luc nguoi dung da sua — luc do khong co lich su nao
// de so, nhung DBMOD that van doc duoc.
static const uint64_t kDirtyBaseline = ~static_cast<uint64_t>(0);

std::string acadDocumentInstanceToken(const AcApDocument* document) {
    if (!document) return "";
    const auto found = gDocumentInstances.find(document);
    if (found != gDocumentInstances.end()) return found->second;
    char token[64] = {};
    snprintf(
        token, sizeof token, "%016llX-%016llX",
        static_cast<unsigned long long>(gDocumentNonce),
        static_cast<unsigned long long>(gNextDocumentInstance++));
    const std::string value(token);
    gDocumentInstances.emplace(document, value);
    return value;
}

uint64_t acadDatabaseRevision(const AcDbDatabase* database) {
    if (!database) return 0;
    return gDatabaseRevisions[database];
}

// Ban ve co thay doi chua luu?
//
// AutoCAD co bien he thong DBMOD, nhung acedGetVar chi doc duoc TAI LIEU HIEN
// HANH (code drawing-info da phai canh bao dbmod_unavailable_for_non_current_document).
// AcApDocument khong co accessor nao cho viec nay — da tra header ObjectARX 2027:
// chi co isQuiescent / isReadOnly / isCommandInputInactive / isNamedDrawing.
//
// Nen suy tu dem revision: DB reactor tang bo dem moi lan sua, AcRxEventReactor
// dat lai moc khi luu xong. Cach nay dung cho MOI ban ve dang mo, khong chi ban
// ve hien hanh.
//
// Gioi han da biet: DB reactor chi gan vao database cua tai lieu dang hoat dong,
// nen thay doi do CODE khac gay ra tren mot ban ve nen (plugin khac, job headless)
// se khong duoc dem. Sua cua NGUOI DUNG luon xay ra khi tai lieu dang hoat dong
// nen van duoc dem dung.
// Ban ve co thay doi chua luu? Tra ve false neu KHONG BIET.
//
// Hai nguon, theo thu tu tin cay:
//
//  1. DBMOD that — chi doc duoc cho TAI LIEU HIEN HANH (acedGetVar khong doc
//     duoc tai lieu nen). Day la nguon chinh xac: no ve 0 khi nguoi dung undo
//     het ve moc da luu, dieu ma mot bo dem chi-tang khong the bieu dien.
//  2. Bo dem revision so voi moc luu gan nhat — dung cho ban ve NEN.
//
// Moi lan doc duoc (1) thi moc cua (2) cung duoc dong bo lai, nen khi tai lieu
// tro thanh nen no van mang trang thai dung.
//
// Khong biet phai bao la khong biet: plugin nap sau khi nguoi dung da sua thi
// khong co lich su nao de so, va bao "da luu" luc do la duong dan toi mat du lieu.
static bool acadDocumentModifiedKnown(AcApDocument* doc, bool& modified) {
    if (!doc) return false;
    AcDbDatabase* db = doc->database();
    if (!db) return false;

    if (acDocManager && doc == acDocManager->curDocument()) {
        resbuf rb = {};
        if (acedGetVar(ACRX_T("DBMOD"), &rb) == RTNORM && rb.restype == RTSHORT) {
            modified = (rb.resval.rint != 0);
            gSavedRevisions[db] = modified ? kDirtyBaseline : acadDatabaseRevision(db);
            return true;
        }
    }

    auto saved = gSavedRevisions.find(db);
    if (saved == gSavedRevisions.end()) return false;
    modified = (saved->second == kDirtyBaseline)
        || (acadDatabaseRevision(db) != saved->second);
    return true;
}

static void forgetDocumentState(const AcApDocument* document) {
    if (!document) return;
    gDocumentInstances.erase(document);
    if (document->database()) {
        gDatabaseRevisions.erase(document->database());
        gSavedRevisions.erase(document->database());
    }
}

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
    o.reserve(s.size() + 8);
    static const char hex[] = "0123456789abcdef";
    for (unsigned char c : s) {
        switch (c) {
        case '"':  o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\b': o += "\\b";  break;
        case '\f': o += "\\f";  break;
        case '\n': o += "\\n";  break;
        case '\r': o += "\\r";  break;
        case '\t': o += "\\t";  break;
        default:
            if (c < 0x20) {
                o += "\\u00";
                o += hex[(c >> 4) & 0x0f];
                o += hex[c & 0x0f];
            } else {
                o += static_cast<char>(c);
            }
            break;
        }
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
    std::string primary = std::string(home ? home : "/tmp") + "/Acad-Bridge";
    std::string legacy  = std::string(home ? home : "/tmp") + "/MEP-Bridge";
    const char* configured = std::getenv("ACAD_BRIDGE_DIR");
    if (!configured || !*configured) configured = std::getenv("MEP_BRIDGE_DIR");
    if (configured && *configured) {
        gBridgeDir = configured;
    } else {
        // Prefer primary; fall back to legacy dir if only that exists.
        struct stat stHome;
        if (stat(primary.c_str(), &stHome) != 0 && stat(legacy.c_str(), &stHome) == 0)
            gBridgeDir = legacy;
        else
            gBridgeDir = primary;
    }
    mkdir(gBridgeDir.c_str(), 0755);
    // Primary live job filename (domain-agnostic). Legacy mep_job.lsp also watched below.
    gJobPath    = gBridgeDir + "/job.lsp";
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
    gDrawingInfoReqPath = gBridgeDir + "/drawing-info.req";
    gGeomReqPath        = gBridgeDir + "/geometry.req";
    gGeomPath           = gBridgeDir + "/geometry.json";
    gDrawingInfoPath    = gBridgeDir + "/drawing-info.json";
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
            bool dbmodValue = false;
            const bool dbmodKnown = acadDocumentModifiedKnown(d, dbmodValue);
            json += "{\"title\":\"" + jsonEsc(toUtf8(d->docTitle())) +
                    "\",\"file\":\"" + jsonEsc(toUtf8(d->fileName())) +
                    "\",\"active\":" + (d == pActive ? "true" : "false") +
                    ",\"instance\":\"" +
                        jsonEsc(acadDocumentInstanceToken(d)) + "\"" +
                    ",\"revision\":" +
                        std::to_string(acadDatabaseRevision(d->database())) +
                    // Bo han truong dbmod khi KHONG BIET — UI phan biet
                    // "khong doc duoc" voi "da luu".
                    (dbmodKnown
                        ? std::string(",\"dbmod\":") + (dbmodValue ? "1" : "0")
                        : std::string()) +
                    "}";
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

// ============================ tim ban ve theo title/fileName chinh xac ============================
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
            if (title == want || file == want) {
                if (hit) {
                    hit = nullptr;
                    break;
                }
                hit = d;
            }
        }
        delete it;
    }
    return hit;
}
static AcApDocument* findDocExact(const std::string& target);
static AcApDocument* resolveTarget() {
    const std::string target = readAll(gTargetPath);
    if (target.empty()) {
        AcApDocument* active = acDocManager ? acDocManager->mdiActiveDocument() : nullptr;
        return active ? active : (acDocManager ? acDocManager->curDocument() : nullptr);
    }
    // A non-empty target is a safety boundary. Never fall back to whatever
    // drawing became active after the daemon resolved the user's selection.
    return findDocExact(target);
}

// ============================ drawing-info: snapshot read-only ============================
// Protocol:
//   drawing-info.req  line 1 = requestId, remaining text = exact title/full path.
//                     Empty target resolves mdiActiveDocument() at processing time.
//   drawing-info.json atomic response, always echoes requestId.
//
// The collector deliberately opens database objects kForRead only. Output is bounded so
// a very large DWG cannot monopolize AutoCAD's main thread indefinitely.
static const size_t kInfoMaxTableItems       = 500;
static const size_t kInfoMaxMapKeys          = 500;
static const size_t kInfoMaxDictionaryItems  = 200;
static const size_t kInfoMaxSelectionObjects = 200;
static const size_t kInfoMaxXrefs             = 200;
static const size_t kInfoMaxEntitiesScanned   = 200000;
static const size_t kInfoMaxSelectionScopeEntities = 50000;
static const size_t kInfoMaxCustomSummary     = 50;
static const size_t kInfoMaxPdfUnderlays      = 200;
static const size_t kInfoMaxDataLinks         = 200;
static const size_t kInfoMaxDataLinkSources   = 500;
static const size_t kInfoMaxDataLinkTargets   = 500;

static std::string jsonString(const std::string& s) {
    return "\"" + jsonEsc(s) + "\"";
}

static std::string jsonNumber(double v) {
    if (!std::isfinite(v)) return "null";
    char buf[64];
    snprintf(buf, sizeof buf, "%.12g", v);
    return buf;
}

static std::string jsonBool(bool v) {
    return v ? "true" : "false";
}

static void addWarning(std::vector<std::string>& warnings, const std::string& warning) {
    for (const auto& current : warnings)
        if (current == warning) return;
    warnings.push_back(warning);
}

static std::string stringArrayJson(const std::vector<std::string>& values) {
    std::string out = "[";
    for (size_t i = 0; i < values.size(); ++i) {
        if (i) out += ",";
        out += jsonString(values[i]);
    }
    return out + "]";
}

static std::string jsonRows(const std::vector<std::string>& rows) {
    std::string out = "[";
    for (size_t i = 0; i < rows.size(); ++i) {
        if (i) out += ",";
        out += rows[i];
    }
    return out + "]";
}

static bool writeAtomicJson(const std::string& path, const std::string& json) {
    const std::string tmp = path + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return false;
    const bool ok = fwrite(json.data(), 1, json.size(), f) == json.size();
    fclose(f);
    if (!ok) {
        unlink(tmp.c_str());
        return false;
    }
    if (rename(tmp.c_str(), path.c_str()) != 0) {
        unlink(tmp.c_str());
        return false;
    }
    return true;
}

static AcApDocument* findDocExact(const std::string& target) {
    if (!acDocManager) return nullptr;
    if (target.empty()) return acDocManager->mdiActiveDocument();
    AcApDocumentIterator* it = acDocManager->newAcApDocumentIterator();
    AcApDocument* found = nullptr;
    if (it) {
        for (; !it->done(); it->step()) {
            AcApDocument* doc = it->document();
            if (!doc) continue;
            if (toUtf8(doc->docTitle()) == target || toUtf8(doc->fileName()) == target) {
                if (found) {
                    found = nullptr;
                    break;
                }
                found = doc;
            }
        }
        delete it;
    }
    return found;
}

static std::string objectHandle(AcDbObject* obj) {
    if (!obj) return "";
    AcDbHandle handle;
    obj->getAcDbHandle(handle);
    ACHAR buf[32];
    handle.getIntoAsciiBuffer(buf);
    return toUtf8(buf);
}

static std::string objectIdHandle(AcDbObjectId id) {
    if (id.isNull()) return "";
    const AcDbHandle handle = id.handle();
    ACHAR buf[32] = {};
    handle.getIntoAsciiBuffer(buf);
    return toUtf8(buf);
}

static const ACHAR* kAcadlibXrecordKey = L"ACADLIB";

static bool readBlockAcadlibMetadata(AcDbBlockTableRecord* block, std::string& metadata) {
    metadata.clear();
    if (!block) return false;
    const AcDbObjectId dictionaryId = block->extensionDictionary();
    if (dictionaryId.isNull()) return true;

    AcDbDictionary* dictionary = nullptr;
    if (acdbOpenObject(dictionary, dictionaryId, AcDb::kForRead) != Acad::eOk || !dictionary)
        return false;
    if (!dictionary->has(kAcadlibXrecordKey)) {
        dictionary->close();
        return true;
    }

    AcDbXrecord* xrecord = nullptr;
    const Acad::ErrorStatus openStatus =
        dictionary->getAt(kAcadlibXrecordKey, xrecord, AcDb::kForRead);
    dictionary->close();
    if (openStatus != Acad::eOk || !xrecord) return false;

    resbuf* chain = nullptr;
    const Acad::ErrorStatus readStatus = xrecord->rbChain(&chain);
    xrecord->close();
    if (readStatus != Acad::eOk) {
        if (chain) acutRelRb(chain);
        return false;
    }
    for (resbuf* item = chain; item; item = item->rbnext) {
        if (item->restype == 1 && item->resval.rstring)
            metadata += toUtf8(item->resval.rstring);
    }
    if (chain) acutRelRb(chain);
    return true;
}

static std::string objectType(AcDbObject* obj) {
    if (!obj || !obj->isA()) return "UNKNOWN";
    const ACHAR* dxf = obj->isA()->dxfName();
    if (dxf && *dxf) return toUtf8(dxf);
    const ACHAR* cls = obj->isA()->name();
    return cls ? toUtf8(cls) : "UNKNOWN";
}

static std::string entityLayer(AcDbEntity* ent) {
    if (!ent) return "";
    ACHAR* layer = ent->layer();
    std::string out = toUtf8(layer);
    if (layer) acutDelString(layer);
    return out;
}

static std::string symbolName(AcDbObjectId id) {
    if (id.isNull()) return "";
    AcDbSymbolTableRecord* record = nullptr;
    if (acdbOpenObject(record, id, AcDb::kForRead) != Acad::eOk || !record) return "";
    AcString name;
    record->getName(name);
    std::string out = toUtf8(name.kwszPtr());
    record->close();
    return out;
}

static std::string layoutNameFor(AcDbBlockTableRecord* btr) {
    if (!btr) return "";
    AcDbObjectId layoutId = btr->getLayoutId();
    if (!layoutId.isNull()) {
        AcDbLayout* layout = nullptr;
        if (acdbOpenObject(layout, layoutId, AcDb::kForRead) == Acad::eOk && layout) {
            AcString name;
            layout->getName(name);
            std::string out = toUtf8(name.kwszPtr());
            layout->close();
            if (!out.empty()) return out;
        }
    }
    AcString name;
    btr->getName(name);
    return toUtf8(name.kwszPtr());
}

static void bumpBounded(std::map<std::string, long long>& values,
                        const std::string& key, long long& overflow) {
    auto found = values.find(key);
    if (found != values.end()) {
        found->second++;
    } else if (values.size() < kInfoMaxMapKeys) {
        values[key] = 1;
    } else {
        overflow++;
    }
}

static std::string countMapJson(const std::map<std::string, long long>& values,
                                long long overflow) {
    std::string out = "{";
    bool first = true;
    for (const auto& item : values) {
        if (!first) out += ",";
        first = false;
        out += jsonString(item.first) + ":" + std::to_string(item.second);
    }
    if (overflow > 0) {
        if (!first) out += ",";
        out += "\"__other__\":" + std::to_string(overflow);
    }
    return out + "}";
}

static std::string countRowsJson(const std::map<std::string, long long>& values,
                                 const char* keyName, long long overflow) {
    std::string out = "[";
    bool first = true;
    for (const auto& item : values) {
        if (!first) out += ",";
        first = false;
        out += "{" + jsonString(keyName) + ":" + jsonString(item.first) +
               ",\"count\":" + std::to_string(item.second) + "}";
    }
    if (overflow > 0) {
        if (!first) out += ",";
        out += "{" + jsonString(keyName) + ":\"__other__\",\"count\":" +
               std::to_string(overflow) + "}";
    }
    return out + "]";
}

static bool sysVarJson(const ACHAR* name, std::string& value) {
    resbuf rb = {};
    if (acedGetVar(name, &rb) != RTNORM) {
        value = "null";
        return false;
    }
    switch (rb.restype) {
    case RTSTR:
        value = jsonString(toUtf8(rb.resval.rstring));
        if (rb.resval.rstring) acutDelString(rb.resval.rstring);
        return true;
    case RTSHORT:
        value = std::to_string((int)rb.resval.rint);
        return true;
    case RTLONG:
        value = std::to_string((long)rb.resval.rlong);
        return true;
    case RTREAL:
        value = jsonNumber(rb.resval.rreal);
        return true;
    default:
        value = "null";
        return false;
    }
}

static std::string summaryInfoJson(AcDbDatabase* db, std::vector<std::string>& warnings) {
    AcDbDatabaseSummaryInfo* info = nullptr;
    if (!db || acdbGetSummaryInfo(db, info) != Acad::eOk || !info) {
        addWarning(warnings, "summary_info_unavailable");
        return "{}";
    }
    AcString title, subject, author, keywords, comments, lastSavedBy, revision, hyperlinkBase;
    info->getTitle(title);
    info->getSubject(subject);
    info->getAuthor(author);
    info->getKeywords(keywords);
    info->getComments(comments);
    info->getLastSavedBy(lastSavedBy);
    info->getRevisionNumber(revision);
    info->getHyperlinkBase(hyperlinkBase);
    std::string out =
        "{\"title\":" + jsonString(toUtf8(title.kwszPtr())) +
        ",\"subject\":" + jsonString(toUtf8(subject.kwszPtr())) +
        ",\"author\":" + jsonString(toUtf8(author.kwszPtr())) +
        ",\"keywords\":" + jsonString(toUtf8(keywords.kwszPtr())) +
        ",\"comments\":" + jsonString(toUtf8(comments.kwszPtr())) +
        ",\"lastSavedBy\":" + jsonString(toUtf8(lastSavedBy.kwszPtr())) +
        ",\"revision\":" + jsonString(toUtf8(revision.kwszPtr())) +
        ",\"hyperlinkBase\":" + jsonString(toUtf8(hyperlinkBase.kwszPtr())) +
        ",\"custom\":[";
    const int customCount = info->numCustomInfo();
    const int keep = customCount < (int)kInfoMaxCustomSummary
        ? customCount : (int)kInfoMaxCustomSummary;
    bool first = true;
    for (int i = 0; i < keep; ++i) {
        AcString key, value;
        if (info->getCustomSummaryInfo(i, key, value) != Acad::eOk) continue;
        if (!first) out += ",";
        first = false;
        out += "{\"key\":" + jsonString(toUtf8(key.kwszPtr())) +
               ",\"value\":" + jsonString(toUtf8(value.kwszPtr())) + "}";
    }
    out += "],\"customCount\":" + std::to_string(customCount) + "}";
    if (customCount > keep) addWarning(warnings, "summary_custom_truncated");
    delete info;
    return out;
}

static std::string symbolTableNamesJson(AcDbSymbolTable* table,
                                        const char* warningCode,
                                        std::vector<std::string>& warnings) {
    if (!table) {
        addWarning(warnings, warningCode);
        return "[]";
    }
    std::string out = "[";
    size_t count = 0;
    bool first = true;
    AcDbSymbolTableIterator* it = nullptr;
    if (table->newIterator(it) == Acad::eOk && it) {
        for (; !it->done(); it->step()) {
            AcDbSymbolTableRecord* record = nullptr;
            if (it->getRecord(record, AcDb::kForRead) != Acad::eOk || !record) continue;
            AcString name;
            record->getName(name);
            if (count < kInfoMaxTableItems) {
                if (!first) out += ",";
                first = false;
                out += jsonString(toUtf8(name.kwszPtr()));
            }
            count++;
            record->close();
        }
        delete it;
    } else {
        addWarning(warnings, warningCode);
    }
    table->close();
    if (count > kInfoMaxTableItems) addWarning(warnings, std::string(warningCode) + "_truncated");
    return out + "]";
}

struct SelectionScopeStats {
    std::string space;
    size_t scanned = 0;
    bool complete = false;
    // Table handles remain stable when a layer or block definition is renamed.
    std::map<std::string, long long> layerHandles;
    std::map<std::string, long long> blockHandles;
    std::vector<std::string> objects;
};

static AcDbObjectId effectiveBlockDefinition(AcDbBlockReference* reference) {
    if (!reference) return AcDbObjectId::kNull;
    AcDbDynBlockReference dynamicReference(reference->objectId());
    if (dynamicReference.isDynamicBlock()) {
        const AcDbObjectId dynamicId =
            dynamicReference.dynamicBlockTableRecord();
        if (!dynamicId.isNull()) return dynamicId;
    }
    return reference->blockTableRecord();
}

static long long selectableCount(
    const std::map<std::string, long long>& counts,
    const std::string& name) {
    const auto found = counts.find(name);
    return found == counts.end() ? 0 : found->second;
}

static void collectSelectionScope(AcDbDatabase* db, SelectionScopeStats& stats,
                                  std::vector<std::string>& warnings) {
    if (!db || db->currentSpaceId().isNull()) {
        addWarning(warnings, "selection_scope_unavailable");
        return;
    }
    AcDbBlockTableRecord* space = nullptr;
    if (acdbOpenObject(space, db->currentSpaceId(), AcDb::kForRead) != Acad::eOk ||
        !space) {
        addWarning(warnings, "selection_scope_unavailable");
        return;
    }
    stats.space = layoutNameFor(space);

    AcDbBlockTableRecordIterator* iterator = nullptr;
    if (space->newIterator(iterator) != Acad::eOk || !iterator) {
        space->close();
        addWarning(warnings, "selection_scope_iterator_unavailable");
        return;
    }

    bool truncated = false;
    bool unreadable = false;
    for (; !iterator->done(); iterator->step()) {
        if (stats.scanned >= kInfoMaxSelectionScopeEntities) {
            truncated = true;
            break;
        }
        stats.scanned++;
        AcDbEntity* entity = nullptr;
        if (iterator->getEntity(entity, AcDb::kForRead) != Acad::eOk || !entity) {
            unreadable = true;
            continue;
        }

        const std::string handle = objectHandle(entity);
        const std::string type = objectType(entity);
        const std::string layer = entityLayer(entity);
        const std::string layerHandle = objectIdHandle(entity->layerId());
        if (handle.empty() || type.empty() || layer.empty() || layerHandle.empty()) {
            unreadable = true;
        } else {
            stats.layerHandles[layerHandle]++;
        }

        std::string object =
            "{\"handle\":" + jsonString(handle) +
            ",\"type\":" + jsonString(type) +
            ",\"layer\":" + jsonString(layer) +
            ",\"layerHandle\":" + jsonString(layerHandle);

        if (AcDbBlockReference* reference = AcDbBlockReference::cast(entity)) {
            const AcDbObjectId blockId = effectiveBlockDefinition(reference);
            const std::string block = symbolName(blockId);
            const std::string blockHandle = objectIdHandle(blockId);
            if (block.empty() || blockHandle.empty()) {
                unreadable = true;
            } else {
                stats.blockHandles[blockHandle]++;
            }
            object += ",\"blockName\":" + jsonString(block) +
                      ",\"blockHandle\":" + jsonString(blockHandle);
        }
        stats.objects.push_back(object + "}");
        entity->close();
    }
    delete iterator;
    space->close();

    stats.complete = !truncated && !unreadable;
    if (truncated) addWarning(warnings, "selection_scope_scan_truncated");
    if (unreadable) addWarning(warnings, "selection_scope_scan_incomplete");
}

static std::string layerTableJson(AcDbDatabase* db,
                                  const SelectionScopeStats& selectionScope,
                                  long long& total,
                                  std::vector<std::string>& warnings) {
    total = 0;
    AcDbLayerTable* table = nullptr;
    if (!db || db->getLayerTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        addWarning(warnings, "layers_unavailable");
        return "[]";
    }
    std::string out = "[";
    size_t count = 0;
    bool first = true;
    AcDbLayerTableIterator* it = nullptr;
    if (table->newIterator(it) == Acad::eOk && it) {
        for (; !it->done(); it->step()) {
            AcDbLayerTableRecord* layer = nullptr;
            if (it->getRecord(layer, AcDb::kForRead) != Acad::eOk || !layer) continue;
            if (count < kInfoMaxTableItems) {
                AcString name, description;
                layer->getName(name);
                layer->description(description);
                AcCmColor color = layer->color();
                AcCmTransparency transparency = layer->transparency();
                if (!first) out += ",";
                first = false;
                const std::string layerName = toUtf8(name.kwszPtr());
                out += "{\"name\":" + jsonString(layerName) +
                       ",\"handle\":" + jsonString(objectHandle(layer)) +
                       ",\"selectableCount\":" +
                           std::to_string(selectableCount(
                               selectionScope.layerHandles, objectHandle(layer))) +
                       ",\"aci\":" + std::to_string((unsigned)color.colorIndex()) +
                       ",\"color\":" + std::to_string((unsigned)color.colorIndex()) +
                       ",\"rgb\":[" + std::to_string((unsigned)color.red()) + "," +
                                         std::to_string((unsigned)color.green()) + "," +
                                         std::to_string((unsigned)color.blue()) + "]" +
                       ",\"linetype\":" + jsonString(symbolName(layer->linetypeObjectId())) +
                       ",\"lineweight\":" + std::to_string((int)layer->lineWeight()) +
                       ",\"transparency\":" + std::to_string((unsigned)transparency.alpha()) +
                       ",\"off\":" + jsonBool(layer->isOff()) +
                       ",\"frozen\":" + jsonBool(layer->isFrozen()) +
                       ",\"locked\":" + jsonBool(layer->isLocked()) +
                       ",\"hidden\":" + jsonBool(layer->isHidden()) +
                       ",\"plottable\":" + jsonBool(layer->isPlottable()) +
                       ",\"inUse\":" + jsonBool(layer->isInUse()) +
                       ",\"description\":" + jsonString(toUtf8(description.kwszPtr())) + "}";
            }
            count++;
            total++;
            layer->close();
        }
        delete it;
    } else {
        addWarning(warnings, "layers_iterator_unavailable");
    }
    table->close();
    if (count > kInfoMaxTableItems) addWarning(warnings, "layers_truncated");
    return out + "]";
}

static std::string blockAnnotationScalesJson(AcDbDatabase* db,
                                             AcDbBlockTableRecord* block) {
    if (!db || !block) return "[]";
    AcDbObjectContextManager* manager = db->objectContextManager();
    AcDbObjectContextCollection* collection = manager
        ? manager->contextCollection(ACDB_ANNOTATIONSCALES_COLLECTION)
        : nullptr;
    AcDbObjectContextInterface* contextInterface =
        ACRX_PE_PTR(block, AcDbObjectContextInterface);
    if (!collection || !contextInterface ||
        !contextInterface->supportsCollection(block, ACDB_ANNOTATIONSCALES_COLLECTION))
        return "[]";

    AcDbObjectContextCollectionIterator* iterator = collection->newIterator();
    if (!iterator || iterator->start() != Acad::eOk) {
        delete iterator;
        return "[]";
    }
    std::string out = "[";
    bool first = true;
    for (; !iterator->done(); iterator->next()) {
        AcDbObjectContext* context = nullptr;
        if (iterator->getContext(context) != Acad::eOk || !context) continue;
        if (contextInterface->hasContext(block, *context)) {
            AcString name;
            if (context->getName(name) == Acad::eOk) {
                if (!first) out += ",";
                first = false;
                out += jsonString(toUtf8(name.kwszPtr()));
            }
        }
        delete context;
    }
    delete iterator;
    return out + "]";
}

static long long blockReferenceCount(AcDbBlockTableRecord* block) {
    if (!block) return 0;
    AcDbObjectIdArray referenceIds;
    if (block->getBlockReferenceIds(referenceIds) != Acad::eOk)
        referenceIds.removeAll();
    long long total = (long long)referenceIds.length();
    if (!AcDbDynBlockTableRecord::isDynamicBlock(block)) return total;

    AcDbDynBlockTableRecord dynamicRecord(block->objectId());
    AcDbObjectIdArray anonymousIds;
    if (dynamicRecord.getAnonymousBlockIds(anonymousIds) != Acad::eOk) return total;
    for (int index = 0; index < anonymousIds.length(); ++index) {
        AcDbBlockTableRecord* anonymous = nullptr;
        if (acdbOpenObject(anonymous, anonymousIds[index], AcDb::kForRead) != Acad::eOk ||
            !anonymous)
            continue;
        AcDbObjectIdArray anonymousReferences;
        if (anonymous->getBlockReferenceIds(anonymousReferences) == Acad::eOk)
            total += (long long)anonymousReferences.length();
        anonymous->close();
    }
    return total;
}

static std::string blockTableJson(AcDbDatabase* db,
                                  const SelectionScopeStats& selectionScope,
                                  std::string& xrefs,
                                  long long& total, long long& totalXrefs,
                                  std::vector<std::string>& warnings) {
    total = 0;
    totalXrefs = 0;
    AcDbBlockTable* table = nullptr;
    if (!db || db->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        addWarning(warnings, "blocks_unavailable");
        xrefs = "[]";
        return "[]";
    }
    std::string blocks = "[";
    xrefs = "[";
    size_t blockCount = 0, xrefCount = 0;
    bool firstBlock = true, firstXref = true;
    AcDbBlockTableIterator* it = nullptr;
    if (table->newIterator(it) == Acad::eOk && it) {
        for (; !it->done(); it->step()) {
            AcDbBlockTableRecord* block = nullptr;
            if (it->getRecord(block, AcDb::kForRead) != Acad::eOk || !block) continue;
            AcString name;
            block->getName(name);
            const std::string blockName = toUtf8(name.kwszPtr());
            const bool isXref = block->isFromExternalReference();
            if (blockCount < kInfoMaxTableItems) {
                AcString comments;
                block->comments(comments);
                const std::string description = toUtf8(comments.kwszPtr());
                const AcGePoint3d origin = block->origin();
                const long long referenceCount = blockReferenceCount(block);
                AcDbAnnotativeObjectPE* annotativePe =
                    ACRX_PE_PTR(block, AcDbAnnotativeObjectPE);
                const bool annotative = annotativePe && annotativePe->annotative(block);
                const std::string annotationScales =
                    blockAnnotationScalesJson(db, block);
                std::string acadlibMetadata;
                if (!readBlockAcadlibMetadata(block, acadlibMetadata))
                    addWarning(warnings, "block_acadlib_metadata_unavailable");

                std::string attributeDefinitions = "[";
                bool firstAttribute = true;
                AcDbBlockTableRecordIterator* entityIterator = nullptr;
                if (block->newIterator(entityIterator) == Acad::eOk && entityIterator) {
                    for (; !entityIterator->done(); entityIterator->step()) {
                        AcDbEntity* entity = nullptr;
                        if (entityIterator->getEntity(entity, AcDb::kForRead) != Acad::eOk || !entity)
                            continue;
                        AcDbAttributeDefinition* attribute = AcDbAttributeDefinition::cast(entity);
                        if (attribute) {
                            AcString tag, prompt, defaultText;
                            attribute->tag(tag);
                            attribute->prompt(prompt);
                            attribute->textString(defaultText);
                            if (!firstAttribute) attributeDefinitions += ",";
                            firstAttribute = false;
                            attributeDefinitions +=
                                "{\"tag\":" + jsonString(toUtf8(tag.kwszPtr())) +
                                ",\"prompt\":" + jsonString(toUtf8(prompt.kwszPtr())) +
                                ",\"defaultValue\":" + jsonString(toUtf8(defaultText.kwszPtr())) +
                                ",\"invisible\":" + jsonBool(attribute->isInvisible()) +
                                ",\"constant\":" + jsonBool(attribute->isConstant()) +
                                ",\"preset\":" + jsonBool(attribute->isPreset()) +
                                ",\"verify\":" + jsonBool(attribute->isVerifiable()) +
                                ",\"lockPosition\":" + jsonBool(attribute->lockPositionInBlock()) + "}";
                        }
                        entity->close();
                    }
                    delete entityIterator;
                }
                attributeDefinitions += "]";

                if (!firstBlock) blocks += ",";
                firstBlock = false;
                blocks += "{\"name\":" + jsonString(blockName) +
                          ",\"handle\":" + jsonString(objectHandle(block)) +
                          ",\"selectableCount\":" +
                              std::to_string(selectableCount(
                                  selectionScope.blockHandles, objectHandle(block))) +
                          ",\"comments\":" + jsonString(description) +
                          ",\"description\":" + jsonString(description) +
                          ",\"acadlibMetadata\":" + jsonString(acadlibMetadata) +
                          ",\"origin\":[" + jsonNumber(origin.x) + "," +
                                                jsonNumber(origin.y) + "," +
                                                jsonNumber(origin.z) + "]" +
                          ",\"referenceCount\":" +
                              std::to_string(referenceCount) +
                          ",\"dynamic\":" +
                              jsonBool(AcDbDynBlockTableRecord::isDynamicBlock(block)) +
                          ",\"insertUnits\":" +
                              std::to_string((int)block->blockInsertUnits()) +
                          ",\"explodable\":" + jsonBool(block->explodable()) +
                          ",\"blockScaling\":" +
                              std::to_string((int)block->blockScaling()) +
                          ",\"hasPreviewIcon\":" + jsonBool(block->hasPreviewIcon()) +
                          ",\"annotative\":" + jsonBool(annotative) +
                          ",\"annotationScales\":" + annotationScales +
                          ",\"attributeDefinitions\":" + attributeDefinitions +
                          ",\"anonymous\":" + jsonBool(block->isAnonymous()) +
                          ",\"isLayout\":" + jsonBool(block->isLayout()) +
                          ",\"layout\":" + jsonBool(block->isLayout()) +
                          ",\"hasAttributeDefinitions\":" + jsonBool(block->hasAttributeDefinitions()) +
                          ",\"isXref\":" + jsonBool(isXref) +
                          ",\"xref\":" + jsonBool(isXref) +
                          ",\"overlay\":" + jsonBool(block->isFromOverlayReference()) + "}";
            }
            blockCount++;
            total++;
            if (isXref) {
                if (xrefCount < kInfoMaxXrefs) {
                    AcString path;
                    block->pathName(path);
                    if (!firstXref) xrefs += ",";
                    firstXref = false;
                    xrefs += "{\"name\":" + jsonString(blockName) +
                             ",\"path\":" + jsonString(toUtf8(path.kwszPtr())) +
                             ",\"overlay\":" + jsonBool(block->isFromOverlayReference()) +
                             ",\"unloaded\":" + jsonBool(block->isUnloaded()) +
                             ",\"status\":" + std::to_string((int)block->xrefStatus()) + "}";
                }
                xrefCount++;
                totalXrefs++;
            }
            block->close();
        }
        delete it;
    } else {
        addWarning(warnings, "blocks_iterator_unavailable");
    }
    table->close();
    if (blockCount > kInfoMaxTableItems) addWarning(warnings, "blocks_truncated");
    if (xrefCount > kInfoMaxXrefs) addWarning(warnings, "xrefs_truncated");
    blocks += "]";
    xrefs += "]";
    return blocks;
}

static std::string layoutTableJson(AcDbDatabase* db, long long& total,
                                   std::vector<std::string>& warnings) {
    total = 0;
    AcDbDictionary* layouts = nullptr;
    if (!db || db->getLayoutDictionary(layouts, AcDb::kForRead) != Acad::eOk || !layouts) {
        addWarning(warnings, "layouts_unavailable");
        return "[]";
    }
    std::string out = "[";
    size_t count = 0;
    bool first = true;
    AcDbDictionaryIterator* it = layouts->newIterator();
    if (it) {
        for (; !it->done(); it->next()) {
            AcDbLayout* layout = nullptr;
            if (it->getObject(layout, AcDb::kForRead) != Acad::eOk || !layout) continue;
            if (count < kInfoMaxTableItems) {
                AcString name;
                layout->getName(name);
                const AcDbObjectId btrId = layout->getBlockTableRecordId();
                AcDbBlockTableRecord* btr = nullptr;
                bool model = false;
                if (acdbOpenObject(btr, btrId, AcDb::kForRead) == Acad::eOk && btr) {
                    AcString btrName;
                    btr->getName(btrName);
                    model = toUtf8(btrName.kwszPtr()) == toUtf8(ACDB_MODEL_SPACE);
                    btr->close();
                }
                if (!first) out += ",";
                first = false;
                out += "{\"name\":" + jsonString(toUtf8(name.kwszPtr())) +
                       ",\"tabOrder\":" + std::to_string(layout->getTabOrder()) +
                       ",\"selected\":" + jsonBool(layout->getTabSelected()) +
                       ",\"model\":" + jsonBool(model) +
                       ",\"viewportCount\":" +
                            std::to_string((long long)layout->getViewportArray().length()) + "}";
            }
            count++;
            total++;
            layout->close();
        }
        delete it;
    } else {
        addWarning(warnings, "layouts_iterator_unavailable");
    }
    layouts->close();
    if (count > kInfoMaxTableItems) addWarning(warnings, "layouts_truncated");
    return out + "]";
}

static std::string dictionariesJson(AcDbDatabase* db, std::vector<std::string>& warnings) {
    AcDbDictionary* nod = nullptr;
    if (!db || db->getNamedObjectsDictionary(nod, AcDb::kForRead) != Acad::eOk || !nod) {
        addWarning(warnings, "dictionaries_unavailable");
        return "[]";
    }
    std::vector<std::string> names;
    size_t total = 0;
    AcDbDictionaryIterator* it = nod->newIterator();
    if (it) {
        for (; !it->done(); it->next()) {
            if (total < kInfoMaxDictionaryItems)
                names.push_back(toUtf8(it->name()));
            total++;
        }
        delete it;
    } else {
        addWarning(warnings, "dictionaries_iterator_unavailable");
    }
    nod->close();
    if (total > kInfoMaxDictionaryItems) addWarning(warnings, "dictionaries_truncated");
    return stringArrayJson(names);
}

struct DrawingEntityStats {
    long long entities = 0;
    long long modelEntities = 0;
    long long paperEntities = 0;
    long long blockReferences = 0;
    long long selected = 0;
    long long typeOverflow = 0;
    long long layerOverflow = 0;
    long long spaceOverflow = 0;
    long long pdfUnderlayCount = 0;
    bool truncated = false;
    bool haveExtents = false;
    AcDbExtents extents;
    std::map<std::string, long long> byType;
    std::map<std::string, long long> byLayer;
    std::map<std::string, long long> bySpace;
    std::vector<std::string> pdfUnderlays;
};

static std::string pdfUnderlayJson(AcDbPdfReference* pdf, const std::string& spaceName,
                                   std::vector<std::string>& warnings) {
    std::string definitionHandle, sourceFile, activeFile, itemName;
    bool definitionAvailable = false;
    bool loaded = false;
    AcDbPdfDefinition* definition = nullptr;
    if (pdf && acdbOpenObject(
            definition, pdf->definitionId(), AcDb::kForRead) == Acad::eOk &&
        definition) {
        definitionAvailable = true;
        definitionHandle = objectHandle(definition);
        sourceFile = toUtf8(definition->getSourceFileName());
        itemName = toUtf8(definition->getItemName());
        AcString active;
        if (definition->getActiveFileName(active) == Acad::eOk)
            activeFile = toUtf8(active.kwszPtr());
        loaded = definition->isLoaded();
        definition->close();
    } else {
        addWarning(warnings, "pdf_underlay_definition_unavailable");
    }

    const AcGePoint3d position = pdf->position();
    const AcGeScale3d scale = pdf->scaleFactors();
    return "{\"handle\":" + jsonString(objectHandle(pdf)) +
           ",\"definitionHandle\":" + jsonString(definitionHandle) +
           ",\"definitionAvailable\":" + jsonBool(definitionAvailable) +
           ",\"sourceFile\":" + jsonString(sourceFile) +
           ",\"activeFile\":" + jsonString(activeFile) +
           ",\"item\":" + jsonString(itemName) +
           ",\"space\":" + jsonString(spaceName) +
           ",\"layer\":" + jsonString(entityLayer(pdf)) +
           ",\"position\":[" + jsonNumber(position.x) + "," +
                                jsonNumber(position.y) + "," +
                                jsonNumber(position.z) + "]" +
           ",\"scale\":[" + jsonNumber(scale.sx) + "," +
                             jsonNumber(scale.sy) + "," +
                             jsonNumber(scale.sz) + "]" +
           ",\"rotation\":" + jsonNumber(pdf->rotation()) +
           ",\"loaded\":" + jsonBool(loaded) +
           ",\"visible\":" + jsonBool(pdf->isOn()) +
           ",\"clipped\":" + jsonBool(pdf->isClipped()) +
           ",\"monochrome\":" + jsonBool(pdf->isMonochrome()) + "}";
}

static void collectEntityStats(AcDbDatabase* db, DrawingEntityStats& stats,
                               std::vector<std::string>& warnings) {
    AcDbBlockTable* table = nullptr;
    if (!db || db->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        addWarning(warnings, "entity_scan_unavailable");
        return;
    }
    AcDbBlockTableIterator* btIt = nullptr;
    if (table->newIterator(btIt) == Acad::eOk && btIt) {
        for (; !btIt->done() && !stats.truncated; btIt->step()) {
            AcDbBlockTableRecord* space = nullptr;
            if (btIt->getRecord(space, AcDb::kForRead) != Acad::eOk || !space) continue;
            if (!space->isLayout()) {
                space->close();
                continue;
            }
            AcString btrName;
            space->getName(btrName);
            const bool model = toUtf8(btrName.kwszPtr()) == toUtf8(ACDB_MODEL_SPACE);
            const std::string spaceName = layoutNameFor(space);
            AcDbBlockTableRecordIterator* entIt = nullptr;
            if (space->newIterator(entIt) == Acad::eOk && entIt) {
                for (; !entIt->done(); entIt->step()) {
                    if ((size_t)stats.entities >= kInfoMaxEntitiesScanned) {
                        stats.truncated = true;
                        break;
                    }
                    AcDbEntity* ent = nullptr;
                    if (entIt->getEntity(ent, AcDb::kForRead) != Acad::eOk || !ent) continue;
                    const std::string type = objectType(ent);
                    const std::string layer = entityLayer(ent);
                    stats.entities++;
                    if (model) stats.modelEntities++; else stats.paperEntities++;
                    if (AcDbBlockReference::cast(ent)) stats.blockReferences++;
                    if (AcDbPdfReference* pdf = AcDbPdfReference::cast(ent)) {
                        if (stats.pdfUnderlays.size() < kInfoMaxPdfUnderlays)
                            stats.pdfUnderlays.push_back(
                                pdfUnderlayJson(pdf, spaceName, warnings));
                        stats.pdfUnderlayCount++;
                    }
                    bumpBounded(stats.byType, type, stats.typeOverflow);
                    bumpBounded(stats.byLayer, layer, stats.layerOverflow);
                    bumpBounded(stats.bySpace, spaceName, stats.spaceOverflow);
                    AcDbExtents ext;
                    if (ent->getGeomExtents(ext) == Acad::eOk && ext.isValid()) {
                        if (stats.haveExtents) stats.extents.addExt(ext);
                        else {
                            stats.extents = ext;
                            stats.haveExtents = true;
                        }
                    }
                    ent->close();
                }
                delete entIt;
            }
            space->close();
        }
        delete btIt;
    } else {
        addWarning(warnings, "entity_iterator_unavailable");
    }
    table->close();
    if (stats.truncated) addWarning(warnings, "entity_scan_truncated");
    if (stats.typeOverflow || stats.layerOverflow || stats.spaceOverflow)
        addWarning(warnings, "entity_count_maps_truncated");
    if ((size_t)stats.pdfUnderlayCount > kInfoMaxPdfUnderlays)
        addWarning(warnings, "pdf_underlays_truncated");
}

static std::string dataLinksJson(AcDbDatabase* db, long long& total,
                                 std::vector<std::string>& warnings) {
    total = 0;
    if (!db) {
        addWarning(warnings, "data_links_unavailable");
        return "[]";
    }
    AcDbDataLinkManager* manager = db->getDataLinkManager();
    if (!manager) {
        addWarning(warnings, "data_links_unavailable");
        return "[]";
    }
    AcDbObjectIdArray linkIds;
    manager->getDataLink(linkIds);
    total = manager->dataLinkCount();

    std::vector<std::string> rows;
    size_t emittedSources = 0;
    size_t emittedTargets = 0;
    const size_t keep = std::min(
        (size_t)linkIds.length(), kInfoMaxDataLinks);
    for (size_t i = 0; i < keep; ++i) {
        AcDbDataLink* link = nullptr;
        if (acdbOpenObject(
                link, linkIds[(int)i], AcDb::kForRead) != Acad::eOk || !link) {
            addWarning(warnings, "data_link_open_failed");
            continue;
        }

        std::vector<std::string> sourceRows;
        AcStringArray sourceFiles;
        if (link->getSourceFiles(
                AcDb::kDataLinkGetSourceContextOther, sourceFiles) == Acad::eOk) {
            for (int sourceIndex = 0;
                 sourceIndex < sourceFiles.length() &&
                 emittedSources < kInfoMaxDataLinkSources;
                 ++sourceIndex, ++emittedSources) {
                sourceRows.push_back(
                    jsonString(toUtf8(sourceFiles[sourceIndex].kwszPtr())));
            }
            if (sourceFiles.length() > (int)sourceRows.size())
                addWarning(warnings, "data_link_sources_truncated");
        } else {
            addWarning(warnings, "data_link_sources_unavailable");
        }

        std::vector<std::string> targetRows;
        AcDbObjectIdArray targetIds;
        link->getTargets(targetIds);
        int attemptedTargets = 0;
        for (int targetIndex = 0;
             targetIndex < targetIds.length() &&
             emittedTargets < kInfoMaxDataLinkTargets;
             ++targetIndex, ++emittedTargets) {
            attemptedTargets++;
            AcDbObject* target = nullptr;
            if (acdbOpenObject(
                    target, targetIds[targetIndex], AcDb::kForRead) != Acad::eOk ||
                !target) {
                addWarning(warnings, "data_link_target_open_failed");
                continue;
            }
            std::string targetRow =
                "{\"handle\":" + jsonString(objectHandle(target)) +
                ",\"type\":" + jsonString(objectType(target));
            if (AcDbTable* table = AcDbTable::cast(target)) {
                targetRow +=
                    ",\"rows\":" + std::to_string((long long)table->numRows()) +
                    ",\"columns\":" +
                        std::to_string((long long)table->numColumns());
            }
            targetRows.push_back(targetRow + "}");
            target->close();
        }
        if (targetIds.length() > attemptedTargets)
            addWarning(warnings, "data_link_targets_truncated");

        const AcString name = link->name();
        const int updateOption = link->updateOption();
        rows.push_back(
            "{\"handle\":" + jsonString(objectHandle(link)) +
            ",\"name\":" + jsonString(toUtf8(name.kwszPtr())) +
            ",\"description\":" + jsonString(toUtf8(link->description())) +
            ",\"adapterId\":" + jsonString(toUtf8(link->dataAdapterId())) +
            ",\"valid\":" + jsonBool(link->isValid()) +
            ",\"option\":" + std::to_string((int)link->option()) +
            ",\"updateOption\":" + std::to_string(updateOption) +
            ",\"sourceUpdateAllowed\":" +
                jsonBool((updateOption & AcDb::kUpdateOptionAllowSourceUpdate) != 0) +
            ",\"sourceFiles\":" + jsonRows(sourceRows) +
            ",\"targets\":" + jsonRows(targetRows) + "}");
        link->close();
    }
    if ((size_t)linkIds.length() > kInfoMaxDataLinks)
        addWarning(warnings, "data_links_truncated");
    return jsonRows(rows);
}

static std::string selectionJson(AcApDocument* doc, AcDbDatabase* db,
                                 DrawingEntityStats& stats,
                                 std::vector<std::string>& warnings) {
    if (!acDocManager || doc != acDocManager->mdiActiveDocument() ||
        doc != acDocManager->curDocument()) {
        addWarning(warnings, "selection_unavailable_for_non_current_document");
        return "{\"count\":0,\"byType\":{},\"objects\":[]}";
    }
    ads_name selection;
    if (acedSSGet(L"_I", nullptr, nullptr, nullptr, selection) != RTNORM)
        return "{\"count\":0,\"byType\":{},\"objects\":[]}";
    Adesk::Int32 length = 0;
    if (acedSSLength(selection, &length) != RTNORM || length < 0) {
        acedSSFree(selection);
        addWarning(warnings, "selection_length_unavailable");
        return "{\"count\":0,\"byType\":{},\"objects\":[]}";
    }
    stats.selected = length;
    std::map<std::string, long long> byType;
    long long typeOverflow = 0;
    std::string objects = "[";
    bool first = true;
    const Adesk::Int32 keep = length < (Adesk::Int32)kInfoMaxSelectionObjects
        ? length : (Adesk::Int32)kInfoMaxSelectionObjects;
    for (Adesk::Int32 i = 0; i < length; ++i) {
        ads_name adsEnt;
        if (acedSSName(selection, i, adsEnt) != RTNORM) continue;
        AcDbObjectId id;
        if (acdbGetObjectId(id, adsEnt) != Acad::eOk || id.isNull()) continue;
        AcDbEntity* ent = nullptr;
        if (acdbOpenObject(ent, id, AcDb::kForRead) != Acad::eOk || !ent) continue;
        const std::string type = objectType(ent);
        bumpBounded(byType, type, typeOverflow);
        if (i < keep) {
            if (!first) objects += ",";
            first = false;
            objects += "{\"handle\":" + jsonString(objectHandle(ent)) +
                       ",\"type\":" + jsonString(type) +
                       ",\"layer\":" + jsonString(entityLayer(ent)) + "}";
        }
        ent->close();
    }
    acedSSFree(selection);
    if (length > keep) addWarning(warnings, "selection_objects_truncated");
    if (typeOverflow) addWarning(warnings, "selection_type_map_truncated");
    objects += "]";
    return "{\"count\":" + std::to_string((long long)length) +
           ",\"byType\":" + countMapJson(byType, typeOverflow) +
           ",\"objects\":" + objects + "}";
}

static std::string drawingInfoErrorJson(const std::string& requestId,
                                        const std::string& code,
                                        const std::string& message) {
    return "{\"ok\":false,\"requestId\":" + jsonString(requestId) +
           ",\"collectedAt\":" + std::to_string((long long)time(nullptr)) +
           ",\"source\":{\"channel\":\"objectarx\",\"protocol\":1,\"pluginVersion\":\"" +
           std::string(kPluginVersion) + "\"},\"status\":" + jsonString(code) +
           ",\"code\":" + jsonString(code) +
           ",\"error\":" + jsonString(message) + "}";
}

static void writeDrawingInfo() {
    const std::string raw = readAll(gDrawingInfoReqPath);
    const size_t nl = raw.find('\n');
    std::string requestId = nl == std::string::npos ? raw : raw.substr(0, nl);
    std::string target = nl == std::string::npos ? "" : raw.substr(nl + 1);
    if (!requestId.empty() && requestId.back() == '\r') requestId.pop_back();
    while (!target.empty() && (target.back() == '\r' || target.back() == '\n'))
        target.pop_back();
    if (requestId.empty()) {
        writeAtomicJson(gDrawingInfoPath,
                        drawingInfoErrorJson(requestId, "invalid_request", "requestId is required"));
        return;
    }
    if (!acDocManager) {
        writeAtomicJson(gDrawingInfoPath,
                        drawingInfoErrorJson(requestId, "bridge_unavailable", "document manager unavailable"));
        return;
    }
    AcApDocument* doc = findDocExact(target);
    if (!doc) {
        writeAtomicJson(gDrawingInfoPath,
                        drawingInfoErrorJson(requestId, "not_found",
                                             target.empty() ? "no active document" : "exact target not open"));
        return;
    }
    AcDbDatabase* db = doc->database();
    if (!db) {
        writeAtomicJson(gDrawingInfoPath,
                        drawingInfoErrorJson(requestId, "database_unavailable", "document has no database"));
        return;
    }

    const bool active = doc == acDocManager->mdiActiveDocument();
    const bool quiescent = doc->isQuiescent();
    const std::string title = toUtf8(doc->docTitle());
    const std::string file = toUtf8(doc->fileName());
    const bool readOnly = doc->isReadOnly();
    const Acad::ErrorStatus lockStatus = acDocManager->lockDocument(doc, AcAp::kRead);
    if (lockStatus != Acad::eOk) {
        writeAtomicJson(gDrawingInfoPath,
                        drawingInfoErrorJson(requestId, "busy",
                                             "read lock failed: " + std::to_string((int)lockStatus)));
        return;
    }

    std::vector<std::string> warnings;
    if (!quiescent) addWarning(warnings, "document_not_quiescent");

    std::string appAcadver, appProduct, appPlatform, appLocale;
    bool appVarsOk = true;
    appVarsOk = sysVarJson(L"ACADVER", appAcadver) && appVarsOk;
    appVarsOk = sysVarJson(L"PRODUCT", appProduct) && appVarsOk;
    appVarsOk = sysVarJson(L"PLATFORM", appPlatform) && appVarsOk;
    appVarsOk = sysVarJson(L"LOCALE", appLocale) && appVarsOk;
    if (!appVarsOk) addWarning(warnings, "application_system_variables_incomplete");

    std::string dbmod = "null";
    if (doc == acDocManager->curDocument()) {
        if (!sysVarJson(L"DBMOD", dbmod)) addWarning(warnings, "dbmod_unavailable");
    } else {
        addWarning(warnings, "dbmod_unavailable_for_non_current_document");
    }

    SelectionScopeStats selectionScope;
    collectSelectionScope(db, selectionScope, warnings);
    DrawingEntityStats stats;
    collectEntityStats(db, stats, warnings);
    const std::string selection = selectionJson(doc, db, stats, warnings);

    long long layerCount = 0, blockCount = 0, layoutCount = 0, xrefCount = 0;
    long long dataLinkCount = 0;
    const std::string layers =
        layerTableJson(db, selectionScope, layerCount, warnings);
    AcDbSymbolTable* linetypeTable = nullptr;
    if (db->getLinetypeTable(linetypeTable, AcDb::kForRead) != Acad::eOk) linetypeTable = nullptr;
    const std::string linetypes =
        symbolTableNamesJson(linetypeTable, "linetypes_unavailable", warnings);
    AcDbSymbolTable* textStyleTable = nullptr;
    if (db->getTextStyleTable(textStyleTable, AcDb::kForRead) != Acad::eOk) textStyleTable = nullptr;
    const std::string textStyles =
        symbolTableNamesJson(textStyleTable, "text_styles_unavailable", warnings);
    AcDbSymbolTable* dimStyleTable = nullptr;
    if (db->getDimStyleTable(dimStyleTable, AcDb::kForRead) != Acad::eOk) dimStyleTable = nullptr;
    const std::string dimStyles =
        symbolTableNamesJson(dimStyleTable, "dim_styles_unavailable", warnings);
    AcDbSymbolTable* regAppTable = nullptr;
    if (db->getRegAppTable(regAppTable, AcDb::kForRead) != Acad::eOk) regAppTable = nullptr;
    const std::string registeredApps =
        symbolTableNamesJson(regAppTable, "registered_apps_unavailable", warnings);
    std::string xrefs;
    const std::string blocks =
        blockTableJson(db, selectionScope, xrefs, blockCount, xrefCount, warnings);
    const std::string layouts = layoutTableJson(db, layoutCount, warnings);
    const std::string dataLinks = dataLinksJson(db, dataLinkCount, warnings);
    const std::string pdfUnderlays = jsonRows(stats.pdfUnderlays);
    const std::string dictionaries = dictionariesJson(db, warnings);
    const std::string metadataSummary = summaryInfoJson(db, warnings);

    const std::string ctab = selectionScope.space;
    const std::string selectionScopeJson =
        "{\"space\":" + jsonString(selectionScope.space) +
        ",\"scanned\":" + std::to_string(selectionScope.scanned) +
        ",\"complete\":" + jsonBool(selectionScope.complete) + "}";
    const std::string selectionCatalogJson =
        "{\"space\":" + jsonString(selectionScope.space) +
        ",\"scanned\":" + std::to_string(selectionScope.scanned) +
        ",\"complete\":" + jsonBool(selectionScope.complete) +
        ",\"objects\":" + jsonRows(selectionScope.objects) + "}";

    std::string extents;
    if (stats.haveExtents && stats.extents.isValid()) {
        const AcGePoint3d min = stats.extents.minPoint();
        const AcGePoint3d max = stats.extents.maxPoint();
        extents = "{\"min\":[" + jsonNumber(min.x) + "," + jsonNumber(min.y) + "," +
                  jsonNumber(min.z) + "],\"max\":[" + jsonNumber(max.x) + "," +
                  jsonNumber(max.y) + "," + jsonNumber(max.z) + "],\"width\":" +
                  jsonNumber(max.x - min.x) + ",\"height\":" + jsonNumber(max.y - min.y) +
                  ",\"depth\":" + jsonNumber(max.z - min.z) + "}";
    } else {
        extents = "{\"min\":null,\"max\":null,\"width\":0,\"height\":0,\"depth\":0}";
        addWarning(warnings, "drawing_extents_unavailable");
    }

    const std::string settings =
        "{\"ACADVER\":" + appAcadver +
        ",\"PRODUCT\":" + appProduct +
        ",\"PLATFORM\":" + appPlatform +
        ",\"LOCALE\":" + appLocale +
        ",\"INSUNITS\":" + std::to_string((int)db->insunits()) +
        ",\"LUNITS\":" + std::to_string((int)db->lunits()) +
        ",\"LUPREC\":" + std::to_string((int)db->luprec()) +
        ",\"AUNITS\":" + std::to_string((int)db->aunits()) +
        ",\"AUPREC\":" + std::to_string((int)db->auprec()) +
        ",\"MEASUREMENT\":" + std::to_string((int)db->measurement()) +
        ",\"TILEMODE\":" + std::to_string(db->tilemode() ? 1 : 0) +
        ",\"CTAB\":" + jsonString(ctab) +
        ",\"CLAYER\":" + jsonString(symbolName(db->clayer())) +
        ",\"TEXTSTYLE\":" + jsonString(symbolName(db->textstyle())) +
        ",\"DIMSTYLE\":" + jsonString(symbolName(db->dimstyle())) +
        ",\"LTSCALE\":" + jsonNumber(db->ltscale()) +
        ",\"CELTSCALE\":" + jsonNumber(db->celtscale()) +
        ",\"PSLTSCALE\":" + std::to_string(db->psltscale() ? 1 : 0) +
        ",\"MSLTSCALE\":" + std::to_string(db->msltscale() ? 1 : 0) +
        ",\"TEXTSIZE\":" + jsonNumber(db->textsize()) + "}";

    const std::string counts =
        "{\"approxObjects\":" + std::to_string((long long)db->approxNumObjects()) +
        ",\"entities\":" + std::to_string(stats.entities) +
        ",\"modelEntities\":" + std::to_string(stats.modelEntities) +
        ",\"paperEntities\":" + std::to_string(stats.paperEntities) +
        ",\"blockReferences\":" + std::to_string(stats.blockReferences) +
        ",\"pdfUnderlays\":" + std::to_string(stats.pdfUnderlayCount) +
        ",\"dataLinks\":" + std::to_string(dataLinkCount) +
        ",\"selected\":" + std::to_string(stats.selected) +
        ",\"byType\":" + countMapJson(stats.byType, stats.typeOverflow) +
        ",\"byLayer\":" + countMapJson(stats.byLayer, stats.layerOverflow) +
        ",\"bySpace\":" + countMapJson(stats.bySpace, stats.spaceOverflow) + "}";

    std::string summary =
        "{\"totalEntities\":" + std::to_string(stats.entities) +
        ",\"entityCount\":" + std::to_string(stats.entities) +
        ",\"layerCount\":" + std::to_string(layerCount) +
        ",\"blockCount\":" + std::to_string(blockCount) +
        ",\"blockReferences\":" + std::to_string(stats.blockReferences) +
        ",\"layoutCount\":" + std::to_string(layoutCount) +
        ",\"xrefCount\":" + std::to_string(xrefCount) +
        ",\"pdfUnderlayCount\":" + std::to_string(stats.pdfUnderlayCount) +
        ",\"dataLinkCount\":" + std::to_string(dataLinkCount) +
        ",\"selectionCount\":" + std::to_string(stats.selected);
    if (metadataSummary.size() >= 2 && metadataSummary.front() == '{' &&
        metadataSummary.back() == '}') {
        const std::string fields = metadataSummary.substr(1, metadataSummary.size() - 2);
        if (!fields.empty()) summary += "," + fields;
    }
    summary += "}";

    const std::string limits =
        "{\"maxEntitiesScanned\":" + std::to_string(kInfoMaxEntitiesScanned) +
        ",\"maxSelectionScopeEntities\":" +
            std::to_string(kInfoMaxSelectionScopeEntities) +
        ",\"maxTableItems\":" + std::to_string(kInfoMaxTableItems) +
        ",\"maxMapKeys\":" + std::to_string(kInfoMaxMapKeys) +
        ",\"maxDictionaryItems\":" + std::to_string(kInfoMaxDictionaryItems) +
        ",\"maxSelectionObjects\":" + std::to_string(kInfoMaxSelectionObjects) +
        ",\"maxXrefs\":" + std::to_string(kInfoMaxXrefs) +
        ",\"maxPdfUnderlays\":" + std::to_string(kInfoMaxPdfUnderlays) +
        ",\"pdfUnderlayScope\":\"direct_layout_space_references\"" +
        ",\"maxDataLinks\":" + std::to_string(kInfoMaxDataLinks) +
        ",\"maxDataLinkSources\":" + std::to_string(kInfoMaxDataLinkSources) +
        ",\"maxDataLinkTargets\":" + std::to_string(kInfoMaxDataLinkTargets) +
        ",\"maxCustomSummary\":" + std::to_string(kInfoMaxCustomSummary) + "}";

    const std::string document =
        "{\"title\":" + jsonString(title) +
        ",\"file\":" + jsonString(file) +
        ",\"active\":" + jsonBool(active) +
        ",\"named\":" + jsonBool(!file.empty()) +
        ",\"readOnly\":" + jsonBool(readOnly) +
        ",\"quiescent\":" + jsonBool(quiescent) +
        ",\"dbmod\":" + dbmod +
        ",\"instance\":" + jsonString(acadDocumentInstanceToken(doc)) +
        ",\"revision\":" +
            std::to_string(acadDatabaseRevision(db)) +
        "}";

    const std::string tables =
        "{\"layers\":" + layers +
        ",\"linetypes\":" + linetypes +
        ",\"textStyles\":" + textStyles +
        ",\"dimStyles\":" + dimStyles +
        ",\"blocks\":" + blocks +
        ",\"layouts\":" + layouts +
        ",\"dataLinks\":" + dataLinks +
        ",\"registeredApps\":" + registeredApps + "}";

    const std::string variables =
        "[{\"name\":\"ACADVER\",\"value\":" + appAcadver +
        "},{\"name\":\"PRODUCT\",\"value\":" + appProduct +
        "},{\"name\":\"PLATFORM\",\"value\":" + appPlatform +
        "},{\"name\":\"LOCALE\",\"value\":" + appLocale +
        "},{\"name\":\"INSUNITS\",\"value\":" + std::to_string((int)db->insunits()) +
        "},{\"name\":\"LUNITS\",\"value\":" + std::to_string((int)db->lunits()) +
        "},{\"name\":\"LUPREC\",\"value\":" + std::to_string((int)db->luprec()) +
        "},{\"name\":\"AUNITS\",\"value\":" + std::to_string((int)db->aunits()) +
        "},{\"name\":\"AUPREC\",\"value\":" + std::to_string((int)db->auprec()) +
        "},{\"name\":\"MEASUREMENT\",\"value\":" + std::to_string((int)db->measurement()) +
        "},{\"name\":\"TILEMODE\",\"value\":" + std::to_string(db->tilemode() ? 1 : 0) +
        "},{\"name\":\"CTAB\",\"value\":" + jsonString(ctab) +
        "},{\"name\":\"CLAYER\",\"value\":" + jsonString(symbolName(db->clayer())) +
        "},{\"name\":\"TEXTSTYLE\",\"value\":" + jsonString(symbolName(db->textstyle())) +
        "},{\"name\":\"DIMSTYLE\",\"value\":" + jsonString(symbolName(db->dimstyle())) +
        "},{\"name\":\"LTSCALE\",\"value\":" + jsonNumber(db->ltscale()) +
        "},{\"name\":\"CELTSCALE\",\"value\":" + jsonNumber(db->celtscale()) +
        "},{\"name\":\"PSLTSCALE\",\"value\":" + std::to_string(db->psltscale() ? 1 : 0) +
        "},{\"name\":\"MSLTSCALE\",\"value\":" + std::to_string(db->msltscale() ? 1 : 0) +
        "},{\"name\":\"TEXTSIZE\",\"value\":" + jsonNumber(db->textsize()) + "}]";

    const std::string drawing =
        "{\"variables\":" + variables +
        ",\"settings\":" + settings +
        ",\"extents\":" + extents +
        ",\"counts\":" + counts +
        ",\"entitiesByType\":" +
            countRowsJson(stats.byType, "type", stats.typeOverflow) +
        ",\"entitiesByLayer\":" +
            countRowsJson(stats.byLayer, "layer", stats.layerOverflow) +
        ",\"entitiesBySpace\":" +
            countRowsJson(stats.bySpace, "space", stats.spaceOverflow) +
        ",\"layers\":" + layers +
        ",\"blocks\":" + blocks +
        ",\"layouts\":" + layouts +
        ",\"styles\":{\"text\":" + textStyles +
            ",\"dimension\":" + dimStyles +
            ",\"linetypes\":" + linetypes + "}" +
        ",\"registeredApps\":" + registeredApps +
        ",\"xrefs\":" + xrefs +
        ",\"pdfUnderlays\":" + pdfUnderlays +
        ",\"dataLinks\":" + dataLinks +
        ",\"dictionaries\":" + dictionaries +
        ",\"selection\":" + selection +
        ",\"selectionScope\":" + selectionScopeJson +
        ",\"selectionCatalog\":" + selectionCatalogJson + "}";

    const std::string json =
        "{\"ok\":true,\"requestId\":" + jsonString(requestId) +
        ",\"collectedAt\":" + std::to_string((long long)time(nullptr)) +
        ",\"source\":{\"channel\":\"objectarx\",\"protocol\":1,\"pluginVersion\":\"" +
            std::string(kPluginVersion) + "\"}" +
        ",\"document\":" + document +
        ",\"summary\":" + summary +
        ",\"settings\":" + settings +
        ",\"extents\":" + extents +
        ",\"counts\":" + counts +
        ",\"tables\":" + tables +
        ",\"xrefs\":" + xrefs +
        ",\"pdfUnderlays\":" + pdfUnderlays +
        ",\"dataLinks\":" + dataLinks +
        ",\"dictionaries\":" + dictionaries +
        ",\"selection\":" + selection +
        ",\"selectionScope\":" + selectionScopeJson +
        ",\"drawing\":" + drawing +
        ",\"limits\":" + limits +
        ",\"warnings\":" + stringArrayJson(warnings) + "}";

    acDocManager->unlockDocument(doc);
    writeAtomicJson(gDrawingInfoPath, json);
}

// ============================ geometry: hinh hoc 2D de ve len canvas ============================
// Protocol:
//   geometry.req   dong 1 = requestId
//                  dong 2 = target (title/duong dan day du; rong = ban ve dang active)
//                  cac dong sau = tuy chon "key=value": space, layer, maxEntities
//   geometry.json  phan hoi atomic, luon echo requestId.
//
// Vi sao TACH khoi drawing-info thay vi them truong vao do: drawing-info tren mot
// ban ve that da 350 KB ma chua co toa do nao. Nhet hinh hoc vao se lam moi lan
// doc trang thai deu keo theo ca ban ve — trong khi phan lon man hinh chi can so
// dem va bang layer.
//
// PHEP CHIEU: chi xuat X/Y. Ban ve MEP mat bang la 2D; giu Z se nhan doi payload
// ma khong ai dung. Truong "z" cua tung doi tuong KHONG duoc suy ra tu day.
//
// TRUNG THUC VE DO CHINH XAC: moi doi tuong deu mang co "a" (approx). `a:1` nghia
// la thu ve duoc chi la HINH BAO, khong phai hinh that — kieu doi tuong do chua
// duoc xuat toa do. Khong co co nay thi canvas ve mot dong hop chu nhat va nguoi
// dung tin do la ban ve.
static const size_t kGeomMaxEntitiesDefault = 20000;
static const size_t kGeomMaxEntitiesCap     = 100000;
static const size_t kGeomMaxVertices        = 4000;   // moi polyline
static const size_t kGeomMaxTextChars       = 120;
// Tran TONG, ngoai tran so doi tuong va tran dinh moi polyline. 100.000 doi tuong
// x 4.000 dinh la 400 trieu toa do noi chuoi tren MAIN THREAD cua AutoCAD — du de
// ngon vai GB va lam dong cung hoac giet AutoCAD. Tran so doi tuong mot minh
// khong chan duoc ban ve it doi tuong nhung moi doi tuong cuc day.
static const size_t kGeomMaxTotalBytes      = 24 * 1024 * 1024;
// Tran QUET, tach khoi tran XUAT. `maxEntities` chi dem thu da xuat, nen mot bo
// loc layer khong khop gi (go sai ten chang han) se khong bao gio cham no — va
// ta duyet ca ban ve tren MAIN THREAD du nguoi goi xin dung 1 doi tuong.
static const size_t kGeomMaxScanned         = 200000;
// Noi dung dinh nghia block co ngan sach RIENG. Gop chung voi tran xuat cua
// cap tren cung se cho ra hanh vi kho hieu: mot ban ve 200 doi tuong ma 195
// dinh nghia block se "cham tran" trong khi nguoi dung chi thay 200 dong.
static const size_t kGeomMaxBlockEntities   = 60000;
// Block long nhau. Chan de quy vo han khi ban ve hong (block A chen block B
// chen lai A) va chan ca nhung cay long qua sau de con vẽ noi.
static const size_t kGeomMaxBlockDepth      = 8;
// Mot HATCH pattern min co the co hang chuc nghin doan gach. Ve het thi trinh
// duyet chet ma nguoi dung cung khong doc them duoc gi — vung gach day dac o
// muc thu nho nao cung chi la mot mang mau.
static const size_t kGeomMaxHatchSegments   = 1200;
// Duong cong khong co dang gon (SPLINE, HELIX...) phai lay mau. 48 diem du min
// o moi muc thu phong hop ly, ma van khong lam phinh payload: mot ban ve vai
// chuc spline la vai nghin so, khong phai vai tram nghin.
static const int    kCurveSamples           = 48;

static std::string geomErrorJson(const std::string& requestId,
                                 const std::string& code,
                                 const std::string& message) {
    return "{\"ok\":false,\"requestId\":" + jsonString(requestId) +
           ",\"collectedAt\":" + std::to_string((long long)time(nullptr)) +
           ",\"source\":{\"channel\":\"objectarx\",\"protocol\":1,\"pluginVersion\":\"" +
           std::string(kPluginVersion) + "\"},\"status\":" + jsonString(code) +
           ",\"code\":" + jsonString(code) +
           ",\"error\":" + jsonString(message) + "}";
}

// Khoa JSON cua hinh hoc KHONG duoc trung khoa cap tren ("h" handle, "t" type,
// "l" layer, "sp" space, "a" approx). Trung thi JSON.parse lay cai sau va doi
// tuong mat danh tinh — TEXT tung ghi de "h" cua handle bang chieu cao chu, va
// hit-test hong dung o cho no phai chay.
// Cat chuoi UTF-8 ma khong xe doi mot ky tu. Ban ve Viet Nam day nhan tieng
// Viet; cat dung 120 byte co the roi vao giua mot ky tu nhieu byte va sinh ra
// UTF-8 hong — trinh doc se tu choi hoac thay bang o vuong.
static void truncateUtf8(std::string& text, size_t maxBytes) {
    if (text.size() <= maxBytes) return;
    size_t cut = maxBytes;
    while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) cut--;
    text.resize(cut);
}

static std::string xy(const AcGePoint3d& p) {
    return jsonNumber(p.x) + "," + jsonNumber(p.y);
}

/** Hinh hoc cua mot doi tuong, hoac chuoi rong neu khong lay duoc gi. */
// Mot doi tuong "phang theo XY" khi phap tuyen cua no la +Z. Chi khi do thi cac
// dai luong do TRONG MAT PHANG cua doi tuong — bulge, goc cung, goc xoay chu —
// moi con dung sau khi bo Z. Phap tuyen nghieng bien cung tron thanh elip; phap
// tuyen -Z van song song nhung dao chieu goc.
static bool planarXY(const AcGeVector3d& n) {
    return fabs(n.x) < 1e-9 && fabs(n.y) < 1e-9 && n.z > 0.0;
}

/* --- HATCH -----------------------------------------------------------------
 *
 * Hinh bao cua mot vung gach la mot hop chu nhat: vo dung ca de nhin lan de do.
 * Nhung mot HATCH khong phai MOT hinh — no la nhieu vong bien cong voi (co the)
 * hang chuc nghin doan gach. Nen no ra kieu `multi`: mot doi tuong chon duoc,
 * ben trong la nhieu hinh con.
 *
 * Toa do cua HATCH nam trong mat phang RIENG cua no (OCS). Phang theo XY thi
 * x,y trung voi WCS; nghieng thi khong, va luc do phai danh dau gan dung —
 * giong het cach xu ly cung tron va INSERT nghieng.
 */
static void appendHatchPoint(std::string& pts, int& count, const AcGePoint2d& p) {
    if (count) pts += ",";
    pts += jsonNumber(p.x) + "," + jsonNumber(p.y);
    count++;
}

static std::string hatchGeometryJson(AcDbHatch* ha, bool& approx) {
    const bool flat = planarXY(ha->normal());
    if (!flat) approx = true;

    std::string parts;
    size_t segments = 0;
    bool cut = false;
    bool edgeLoopSkipped = false;
    auto addPart = [&](const std::string& body) {
        if (!parts.empty()) parts += ",";
        parts += "{" + body + "}";
    };

    // --- Vong bien ---
    const int loops = ha->numLoops();
    for (int i = 0; i < loops && !cut; ++i) {
        Adesk::Int32 loopType = 0;
        // Hoi KIEU vong truoc roi moi chon overload. Goi thang overload polyline
        // len mot vong dang canh la doc mot dang du lieu khac han voi thuc te.
        if (ha->loopTypeAt(i) & AcDbHatch::kPolyline) {
            AcGePoint2dArray verts;
            AcGeDoubleArray bulges;
            if (ha->getLoopAt(i, loopType, verts, bulges) == Acad::eOk && verts.length() >= 2) {
                std::string pts, bulgeJson;
                int count = 0;
                bool anyBulge = false, loopCut = false;
                for (int v = 0; v < verts.length(); ++v) {
                    if (segments >= kGeomMaxHatchSegments) { cut = loopCut = true; break; }
                    if (count) bulgeJson += ",";
                    const double b = v < bulges.length() ? bulges[v] : 0.0;
                    if (b != 0.0) anyBulge = true;
                    bulgeJson += jsonNumber(b);
                    appendHatchPoint(pts, count, verts[v]);
                    segments++;
                }
                if (count >= 2) {
                    // Bulge chi ta dung do cong khi mat phang song song XY —
                    // giong het LWPOLYLINE.
                    //
                    // `closed` phai theo loopCut: mot vong bi cat bot dinh ma van
                    // bao khep kin thi renderer ke mot canh GIA tu dinh cuoi ve
                    // dinh dau, co the cat ngang ca vung gach.
                    std::string body = "\"k\":\"poly\",\"p\":[" + pts + "]" +
                                       ",\"closed\":" + jsonBool(!loopCut);
                    if (anyBulge && flat) body += ",\"bulge\":[" + bulgeJson + "]";
                    addPart(body);
                }
                continue;
            }
        }
        // Vong bien dang CANH ROI (line / cung / elip / spline) khong lay o day.
        //
        // Overload `getLoopAt` tra ve mang con tro `AcGeCurve2d*` va giao viec
        // giai phong cho nguoi goi. Ban dau tu tin lam dung: lay mau tung canh
        // roi `delete`. Ket qua tren ban ve that la AutoCAD chay xong dung mot
        // luot doc roi CHET — dau hieu kinh dien cua hong heap, vi loi khong no
        // ngay tai cho `delete`.
        //
        // Doi lay gi: vung gach co bien dang canh roi mat duong vien. Nhung neu
        // no khong to dac thi cac duong gach ben duoi van ve ra ca vung — nguoi
        // dung van thay dung cho, chi thieu net vien. Doi lay mot cai vien ma
        // co nguy co lam sap AutoCAD cua nguoi ta la doi sai chieu.
        //
        // Muon lam dung phai qua `worldDraw` — mot AcGiWorldDraw tu viet bat lai
        // nguyen thuy do hoa, khong dung API nao giao quyen so huu. Xem ROADMAP.
        edgeLoopSkipped = true;
    }

    // --- Duong gach ---
    // To dac thi khong co duong gach nao; luc do chi con bien, va bien khep kin
    // da du de nhin ra vung.
    if (!ha->isSolidFill() && ha->numHatchLines() > 0) {
        AcGePoint2dArray starts, ends;
        if (ha->getHatchLinesData(starts, ends) == Acad::eOk) {
            const int n = starts.length() < ends.length() ? starts.length() : ends.length();
            for (int i = 0; i < n; ++i) {
                if (segments >= kGeomMaxHatchSegments) { cut = true; break; }
                addPart("\"k\":\"line\",\"p\":[" +
                        jsonNumber(starts[i].x) + "," + jsonNumber(starts[i].y) + "," +
                        jsonNumber(ends[i].x) + "," + jsonNumber(ends[i].y) + "]");
                segments++;
            }
        }
    }

    if (parts.empty()) return "";
    std::string out = "\"k\":\"multi\",\"g\":[" + parts + "]";
    // Hai ly do gan dung rat khac nhau, ma `aw` chi mang duoc mot. Cat bot la
    // thu nguoi dung can biet hon: no nghia la hinh KHONG day du.
    if (cut) {
        approx = true;
        out += ",\"aw\":\"hatch-truncated\"";
    } else if (!flat) {
        out += ",\"aw\":\"projected-hatch\"";
    } else if (edgeLoopSkipped) {
        // Thieu duong vien, con duong gach thi van co. Van la `a:1`: hinh ve ra
        // khong phai hinh day du cua doi tuong.
        approx = true;
        out += ",\"aw\":\"hatch-boundary-partial\"";
    }
    return out;
}

static std::string entityGeometryJson(AcDbEntity* ent, bool& approx, long long& vertexOverflow,
                                      std::set<std::string>* blockRefs = nullptr) {
    approx = false;

    if (AcDbLine* line = AcDbLine::cast(ent)) {
        return "\"k\":\"line\",\"p\":[" + xy(line->startPoint()) + "," +
               xy(line->endPoint()) + "]";
    }
    if (AcDbPolyline* pl = AcDbPolyline::cast(ent)) {
        const unsigned int n = pl->numVerts();
        std::string pts, bulges;
        bool anyBulge = false;
        bool truncated = false;
        unsigned int emitted = 0;
        for (unsigned int i = 0; i < n; ++i) {
            if (emitted >= kGeomMaxVertices) {
                vertexOverflow++;
                approx = true;
                truncated = true;
                break;
            }
            // Overload AcGePoint2d tra ve toa do OCS cua polyline. Polyline co
            // phap tuyen khac mac dinh se ra sai vi tri, ma van khong co co `a:1`
            // vi moi thu khac trong phan hoi deu la toa do the gioi. Overload 3D
            // tra ve WCS.
            AcGePoint3d v;
            if (pl->getPointAt(i, v) != Acad::eOk) continue;
            if (emitted) { pts += ","; bulges += ","; }
            pts += jsonNumber(v.x) + "," + jsonNumber(v.y);
            double b = 0.0;
            pl->getBulgeAt(i, b);
            if (b != 0.0) anyBulge = true;
            bulges += jsonNumber(b);
            emitted++;
        }
        // `bulge` giu lai cung tron cua polyline. Bo no di thi ong cong thanh ong
        // thang — sai hinh ma trong van "hop ly", kieu sai te nhat.
        //
        // Nhung bulge chi con dung khi polyline phang theo XY: phap tuyen nghieng
        // bien moi cung thanh elip ma khong bulge nao ta duoc, va -Z dao chieu
        // cung. Dinh la WCS nen vi tri van dung; rieng do cong thi khong ta duoc.
        //
        // Cat bot dinh thi KHONG con la duong khep kin: renderer se ke mot doan
        // gia tu dinh cuoi ve dinh dau, co the cat ngang ca ban ve.
        //
        // Chi RIENG viec cat dinh moi pha tinh khep kin. Bulge bi chieu phang
        // cung bat `approx`, nhung moi dinh van con du — bo `closed` o truong hop
        // do la tu tay xoa mat mot canh co that (canh cuoi ve dinh dau), doi lay
        // khong duoc gi. Nen dieu kien la `truncated`, khong phai `approx`.
        const bool flatPoly = planarXY(pl->normal());
        if (anyBulge && !flatPoly) approx = true;
        std::string out = "\"k\":\"poly\",\"p\":[" + pts + "]" +
                          ",\"closed\":" + jsonBool(pl->isClosed() && !truncated);
        if (anyBulge && flatPoly) out += ",\"bulge\":[" + bulges + "]";
        else if (anyBulge) out += ",\"aw\":\"projected-bulge\"";
        return out;
    }
    // Vong tron/cung chi giu duoc hinh khi mat phang cua no song song mat phang
    // XY. Pháp tuyen nghieng thi hinh chieu xuong XY la mot ELIP, va goc dau/cuoi
    // do trong mat phang rieng cua doi tuong — xuat center+radius se la mot hinh
    // SAI ma lai khong co co `a:1`. Truong hop do roi xuong hinh bao.
    static const double kNormalEps = 1e-9;
    if (AcDbCircle* c = AcDbCircle::cast(ent)) {
        const AcGeVector3d n = c->normal();
        // Vong tron doi xung nen phap tuyen -Z van cho ra dung hinh.
        if (fabs(n.x) < kNormalEps && fabs(n.y) < kNormalEps) {
            return "\"k\":\"circle\",\"c\":[" + xy(c->center()) + "]" +
                   ",\"r\":" + jsonNumber(c->radius());
        }
    }
    if (AcDbArc* a = AcDbArc::cast(ent)) {
        // Voi CUNG con phai dung chieu: phap tuyen nguoc (-Z) van song song
        // nhung goc do nguoc chieu, nen cung se ve sai phia.
        if (planarXY(a->normal())) {
            return "\"k\":\"arc\",\"c\":[" + xy(a->center()) + "]" +
                   ",\"r\":" + jsonNumber(a->radius()) +
                   ",\"a0\":" + jsonNumber(a->startAngle()) +
                   ",\"a1\":" + jsonNumber(a->endAngle());
        }
    }
    if (AcDbPoint* pt = AcDbPoint::cast(ent)) {
        return "\"k\":\"point\",\"p\":[" + xy(pt->position()) + "]";
    }
    if (AcDbBlockReference* br = AcDbBlockReference::cast(ent)) {
        std::string name;
        AcDbBlockTableRecord* btr = nullptr;
        if (acdbOpenObject(btr, br->blockTableRecord(), AcDb::kForRead) == Acad::eOk && btr) {
            AcString n;
            btr->getName(n);
            name = toUtf8(n.kwszPtr());
            btr->close();
        }
        const AcGeScale3d sc = br->scaleFactors();
        // `rotation()` va `scaleFactors()` mo ta phep bien doi TRONG mat phang
        // chen cua block. Phap tuyen khac +Z thi vi tri XY van dung nhung huong
        // va ti le chieu xuong XY khong con dung — block se ve sai huong hoac
        // sai kich thuoc.
        if (!planarXY(br->normal())) approx = true;
        if (blockRefs) blockRefs->insert(name);
        // Hinh cua block nam trong DINH NGHIA cua no, khong nhan ban o day —
        // mot ban ve co 50 lan chen cung mot block thi nhan ban la 50 lan hinh
        // hoc trong payload. Thay vao do: dinh nghia gui MOT lan trong `blocks`,
        // con moi lan chen mang mot ma tran.
        //
        // `m` la affine 2D [a,b,c,d,e,f] rut ra tu `blockTransform()`:
        //     x' = a*x + c*y + e ;  y' = b*x + d*y + f
        // Dung chinh ma tran cua AutoCAD thay vi tu dung lai tu rot/sc: no da
        // gom san diem chen, diem goc cua block, ti le am (block bi lat), va
        // truong hop truc khong vuong goc.
        const AcGeMatrix3d xf = br->blockTransform();
        return "\"k\":\"insert\",\"p\":[" + xy(br->position()) + "]" +
               ",\"rot\":" + jsonNumber(br->rotation()) +
               ",\"sc\":[" + jsonNumber(sc.sx) + "," + jsonNumber(sc.sy) + "]" +
               ",\"m\":[" + jsonNumber(xf(0, 0)) + "," + jsonNumber(xf(1, 0)) + "," +
                             jsonNumber(xf(0, 1)) + "," + jsonNumber(xf(1, 1)) + "," +
                             jsonNumber(xf(0, 3)) + "," + jsonNumber(xf(1, 3)) + "]" +
               ",\"name\":" + jsonString(name) +
               (approx ? ",\"aw\":\"projected-transform\"" : "");
    }
    if (AcDbText* t = AcDbText::cast(ent)) {
        std::string body = toUtf8(t->textStringConst());
        truncateUtf8(body, kGeomMaxTextChars);
        // Goc xoay do TRONG mat phang cua chu. Phap tuyen nghieng thi goc do
        // khong dung sau khi bo Z — vi tri van dung nen van xuat, nhung phai
        // danh dau gan dung.
        if (!planarXY(t->normal())) approx = true;
        return "\"k\":\"text\",\"p\":[" + xy(t->position()) + "]" +
               ",\"th\":" + jsonNumber(t->height()) +
               ",\"rot\":" + jsonNumber(t->rotation()) +
               (approx ? ",\"aw\":\"projected-rotation\"" : "") +
               ",\"txt\":" + jsonString(body);
    }
    if (AcDbMText* m = AcDbMText::cast(ent)) {
        std::string body = toUtf8(m->contents());
        truncateUtf8(body, kGeomMaxTextChars);
        if (!planarXY(m->normal())) approx = true;
        return "\"k\":\"text\",\"p\":[" + xy(m->location()) + "]" +
               ",\"th\":" + jsonNumber(m->textHeight()) +
               ",\"rot\":" + jsonNumber(m->rotation()) +
               (approx ? ",\"aw\":\"projected-rotation\"" : "") +
               ",\"txt\":" + jsonString(body);
    }

    if (AcDbMline* ml = AcDbMline::cast(ent)) {
        // MLINE la cach ban ve MEP ve ONG (hai duong song song). Tra ve hinh bao
        // se cho ra mot day hop chu nhat dung cho cho ong chay — vo dung de nhin
        // va vo dung de bat diem. Xuat TIM ONG: mot duong, dung vi tri, dung
        // huong. Van la `a:1` vi day khong phai hinh that duoc ve tren ban ve.
        const int n = (int)ml->numVertices();
        std::string pts;
        int emittedVerts = 0;
        bool overflowed = false;
        for (int i = 0; i < n; ++i) {
            if ((size_t)emittedVerts >= kGeomMaxVertices) {
                vertexOverflow++;
                overflowed = true;
                break;
            }
            const AcGePoint3d v = ml->vertexAt(i);
            if (emittedVerts) pts += ",";
            pts += jsonNumber(v.x) + "," + jsonNumber(v.y);
            emittedVerts++;
        }
        if (emittedVerts >= 2) {
            approx = true;
            // Cat bot dinh thi khong con khep kin — giong LWPOLYLINE. Bao
            // `closed` se ke mot doan gia tu dinh cuoi ve dinh dau.
            return "\"k\":\"poly\",\"p\":[" + pts + "]" +
                   ",\"closed\":" + jsonBool(ml->closedMline() && !overflowed) +
                   ",\"aw\":\"mline-centerline\"";
        }
    }

    // ELLIPSE xuat GON, khong lay mau: tam + hai ban truc + goc nghieng + hai
    // tham so dau/cuoi la 7 so, con lay mau 32 diem la 64 so. Tren ban ve
    // as-built co 1847 ellipse (chu yeu la ky hieu nho trong block) — chenh
    // lech giua 13 KB va 830 KB payload cho cung mot hinh.
    //
    // `startAngle`/`endAngle` cua AcDbEllipse la THAM SO, khong phai goc that:
    // P(t) = C + a·cos(t)·u + b·sin(t)·v. Cung tham so nay anh xa 1-1 sang cung
    // elip cua SVG, nen xuat thang tham so la dung, khong phai xap xi.
    if (AcDbEllipse* el = AcDbEllipse::cast(ent)) {
        const AcGeVector3d major = el->majorAxis();
        const double rx = major.length();
        const double ry = rx * el->radiusRatio();
        if (rx > 0.0 && ry > 0.0) {
            if (!planarXY(el->normal())) approx = true;
            return "\"k\":\"ellipse\",\"c\":[" + xy(el->center()) + "]" +
                   ",\"rx\":" + jsonNumber(rx) +
                   ",\"ry\":" + jsonNumber(ry) +
                   ",\"rot\":" + jsonNumber(atan2(major.y, major.x)) +
                   ",\"a0\":" + jsonNumber(el->startAngle()) +
                   ",\"a1\":" + jsonNumber(el->endAngle()) +
                   (approx ? ",\"aw\":\"projected-ellipse\"" : "");
        }
    }

    if (AcDbHatch* ha = AcDbHatch::cast(ent)) {
        const std::string geom = hatchGeometryJson(ha, approx);
        if (!geom.empty()) return geom;
    }

    // DIMENSION giu do hoa cua no trong mot BLOCK an danh (`*D12`). Khong phai
    // tu dung lai duong kich thuoc, mui ten, duong giong va chu — lay chinh
    // block ma AutoCAD da dung de ve, roi di qua duong xuat block san co.
    //
    // Ket qua la hinh THAT, khong phai gan dung: day dung la thu AutoCAD ve ra.
    if (AcDbDimension* dim = AcDbDimension::cast(ent)) {
        const AcDbObjectId blockId = dim->dimBlockId();
        if (!blockId.isNull()) {
            std::string name;
            AcDbBlockTableRecord* btr = nullptr;
            if (acdbOpenObject(btr, blockId, AcDb::kForRead) == Acad::eOk && btr) {
                AcString n;
                btr->getName(n);
                name = toUtf8(n.kwszPtr());
                btr->close();
            }
            if (!name.empty()) {
                if (blockRefs) blockRefs->insert(name);
                const AcGePoint3d pos = dim->dimBlockPosition();
                return "\"k\":\"insert\",\"p\":[" + xy(pos) + "]" +
                       ",\"m\":[1,0,0,1," + jsonNumber(pos.x) + "," + jsonNumber(pos.y) + "]" +
                       ",\"name\":" + jsonString(name);
            }
        }
    }

    // Duong cong con lai (SPLINE, HELIX...): lay mau qua `AcDbCurve`.
    //
    // Dung API nay chu KHONG dung `AcGeCurve2d` cua hatch: `getPointAtParam`
    // ghi vao mot diem cua nguoi goi, khong cap phat gi, khong giao quyen so
    // huu cho ai. Lan truoc di duong AcGe co delete va lam AutoCAD chet sau khi
    // doc xong — mot API khong cap phat thi khong co cach nao hong kieu do.
    if (AcDbCurve* cu = AcDbCurve::cast(ent)) {
        double t0 = 0.0, t1 = 0.0;
        if (cu->getStartParam(t0) == Acad::eOk && cu->getEndParam(t1) == Acad::eOk &&
            std::isfinite(t0) && std::isfinite(t1) && t1 > t0) {
            std::string pts;
            int count = 0;
            for (int i = 0; i < kCurveSamples; ++i) {
                AcGePoint3d pt;
                const double t = t0 + (t1 - t0) * (double)i / (double)(kCurveSamples - 1);
                if (cu->getPointAtParam(t, pt) != Acad::eOk) continue;
                if (count) pts += ",";
                pts += jsonNumber(pt.x) + "," + jsonNumber(pt.y);
                count++;
            }
            if (count >= 2) {
                // Lay mau LA xap xi: duong cong that di qua vo han diem, day chi
                // co 48. Danh dau de man hinh khong noi day la hinh chinh xac.
                approx = true;
                return "\"k\":\"poly\",\"p\":[" + pts + "]" +
                       ",\"closed\":" + jsonBool(cu->isClosed()) +
                       ",\"aw\":\"curve-sampled\"";
            }
        }
    }

    // Con lai: chi co hinh bao. Danh dau `a:1` de canvas ve khac di va man hinh
    // noi ro day khong phai hinh that.
    AcDbExtents ext;
    if (ent->getGeomExtents(ext) == Acad::eOk && ext.isValid()) {
        approx = true;
        return "\"k\":\"box\",\"b\":[" + jsonNumber(ext.minPoint().x) + "," +
               jsonNumber(ext.minPoint().y) + "," +
               jsonNumber(ext.maxPoint().x) + "," +
               jsonNumber(ext.maxPoint().y) + "],\"aw\":\"bounding-box\"";
    }
    return "";
}

static void writeGeometry() {
    const std::string raw = readAll(gGeomReqPath);
    std::vector<std::string> lines;
    {
        std::string cur;
        for (char ch : raw) {
            if (ch == '\n') { lines.push_back(cur); cur.clear(); }
            else if (ch != '\r') cur += ch;
        }
        lines.push_back(cur);
    }
    const std::string requestId = lines.empty() ? "" : lines[0];
    const std::string target = lines.size() > 1 ? lines[1] : "";

    std::string wantSpace, wantLayer;
    size_t maxEntities = kGeomMaxEntitiesDefault;
    for (size_t i = 2; i < lines.size(); ++i) {
        const size_t eq = lines[i].find('=');
        if (eq == std::string::npos) continue;
        const std::string key = lines[i].substr(0, eq);
        const std::string value = lines[i].substr(eq + 1);
        if (key == "space") wantSpace = value;
        else if (key == "layer") wantLayer = value;
        else if (key == "maxEntities") {
            const long long parsed = atoll(value.c_str());
            if (parsed > 0)
                maxEntities = (size_t)parsed < kGeomMaxEntitiesCap
                    ? (size_t)parsed : kGeomMaxEntitiesCap;
        }
    }

    if (requestId.empty()) {
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "invalid_request", "requestId is required"));
        return;
    }
    if (!acDocManager) {
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "bridge_unavailable", "document manager unavailable"));
        return;
    }
    AcApDocument* doc = findDocExact(target);
    if (!doc) {
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "not_found",
                                      target.empty() ? "no active document" : "exact target not open"));
        return;
    }
    AcDbDatabase* db = doc->database();
    if (!db) {
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "database_unavailable", "document has no database"));
        return;
    }

    // ObjectARX doi khoa doc truoc khi doc database cua mot tai lieu khong phai
    // tai lieu hien hanh. `writeDrawingInfo()` da lam dung; thieu no thi mot lenh
    // dang chay song song co the lam lan quet hong — hoac lam AutoCAD mat on dinh.
    const Acad::ErrorStatus geomLock = acDocManager->lockDocument(doc, AcAp::kRead);
    if (geomLock != Acad::eOk) {
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "busy",
                                      "read lock failed: " + std::to_string((int)geomLock)));
        return;
    }

    std::vector<std::string> warnings;
    std::string rows;
    long long emitted = 0, scanned = 0, approxCount = 0, skipped = 0, vertexOverflow = 0;
    bool truncated = false;
    bool scanCapped = false;
    // Bounds phai theo TUNG SPACE. Gop Model voi cac layout giay vao mot con so
    // cho ra mot khung vo nghia: toa do giay tinh bang mm tren to giay, con model
    // co the o toa do trac dia cach goc hang trieu don vi. Canvas cung chi ve mot
    // space mot luc.
    std::map<std::string, AcDbExtents> spaceExtents;
    std::map<std::string, long long> spaceCounts;
    // Ten MOI layout, ke ca layout chua kip quet. Cham tran `maxEntities` o
    // Model space ma dung han vong lap thi cac layout sau bien mat khoi phan
    // hoi — giao dien khong dung bo chon space duoc, va nguoi dung khong biet
    // ban ve co nhung layout do. Doc ten layout thi re; quet doi tuong moi dat.
    std::vector<std::string> allLayouts;
    // Ten block CAN gui dinh nghia. Gom trong luc quet cap tren cung, roi gui
    // sau — gui ngay tai cho se nhan ban dinh nghia cho moi lan chen.
    std::set<std::string> wantBlocks;

    AcDbBlockTable* table = nullptr;
    if (db->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        acDocManager->unlockDocument(doc);
        writeAtomicJson(gGeomPath,
                        geomErrorJson(requestId, "database_unavailable", "block table unavailable"));
        return;
    }
    AcDbBlockTableIterator* btIt = nullptr;
    if (table->newIterator(btIt) == Acad::eOk && btIt) {
        for (; !btIt->done(); btIt->step()) {
            AcDbBlockTableRecord* space = nullptr;
            if (btIt->getRecord(space, AcDb::kForRead) != Acad::eOk || !space) continue;
            if (!space->isLayout()) { space->close(); continue; }
            const std::string spaceName = layoutNameFor(space);
            allLayouts.push_back(spaceName);
            if (truncated) { space->close(); continue; }
            if (!wantSpace.empty() && spaceName != wantSpace) { space->close(); continue; }

            AcDbBlockTableRecordIterator* entIt = nullptr;
            if (space->newIterator(entIt) == Acad::eOk && entIt) {
                for (; !entIt->done(); entIt->step()) {
                    if ((size_t)scanned >= kGeomMaxScanned) {
                        truncated = true;
                        scanCapped = true;
                        break;
                    }
                    AcDbEntity* ent = nullptr;
                    if (entIt->getEntity(ent, AcDb::kForRead) != Acad::eOk || !ent) continue;
                    scanned++;
                    const std::string layer = entityLayer(ent);
                    if (!wantLayer.empty() && layer != wantLayer) { ent->close(); continue; }

                    bool approx = false;
                    const std::string geom =
                        entityGeometryJson(ent, approx, vertexOverflow, &wantBlocks);
                    if (geom.empty()) { skipped++; ent->close(); continue; }

                    // Chi bao `truncated` khi that su BO SOT mot doi tuong dang le
                    // duoc xuat. Kiem tran truoc khi loc layer se bao thieu du moi
                    // doi tuong con lai deu thuoc layer khac — giao dien duoc yeu
                    // cau hien co nay len, nen bao nham la noi doi voi nguoi dung.
                    if ((size_t)emitted >= maxEntities || rows.size() >= kGeomMaxTotalBytes) {
                        truncated = true;
                        ent->close();
                        break;
                    }
                    if (approx) approxCount++;

                    AcDbExtents ext;
                    if (ent->getGeomExtents(ext) == Acad::eOk && ext.isValid()) {
                        auto found = spaceExtents.find(spaceName);
                        if (found == spaceExtents.end()) spaceExtents[spaceName] = ext;
                        else found->second.addExt(ext);
                    }
                    spaceCounts[spaceName]++;

                    if (emitted) rows += ",";
                    rows += "{\"h\":" + jsonString(objectHandle(ent)) +
                            ",\"t\":" + jsonString(objectType(ent)) +
                            ",\"l\":" + jsonString(layer) +
                            ",\"sp\":" + jsonString(spaceName) +
                            (approx ? ",\"a\":1" : "") +
                            "," + geom + "}";
                    emitted++;
                    ent->close();
                }
                delete entIt;
            }
            space->close();
        }
        delete btIt;
    } else {
        addWarning(warnings, "entity_iterator_unavailable");
    }

    // ---- Noi dung dinh nghia block ----------------------------------------
    //
    // Vi sao BAT BUOC phai co: tren ban ve as-built cua du an, ca ban ve chi co
    // 259 doi tuong o cap tren cung, trong do 127 la lan chen block — toan bo
    // mat bang kien truc (tuong, cua, truc, hatch, khung ten) nam BEN TRONG 95
    // dinh nghia block. Chi xuat diem chen thi khung xem ra vai cham, va nguoi
    // dung nhin thay mot ban ve trong ron thay vi ban ve cua ho.
    //
    // Gui dinh nghia MOT lan moi block, kem ma tran `m` o tung lan chen. Noi
    // ban ra tung the hien se nhan ban hinh hoc: 50 lan chen `_ArchTick` thanh
    // 50 ban sao cua cung mot hinh.
    std::string blocksJson = "{";
    bool firstBlock = true;
    long long blockEntities = 0, blockSkipped = 0, blockDefs = 0;
    bool blockTruncated = false, blockDepthHit = false;
    {
        // Duyet theo lop de biet do sau: block long nhau co the tao vong lap
        // (ban ve hong), va cung co the sau toi muc khong con y nghia de ve.
        std::set<std::string> done;
        std::set<std::string> frontier = wantBlocks;
        for (size_t depth = 0; depth < kGeomMaxBlockDepth && !frontier.empty(); ++depth) {
            std::set<std::string> next;
            for (const std::string& name : frontier) {
                if (name.empty() || done.count(name)) continue;
                done.insert(name);
                if ((size_t)blockEntities >= kGeomMaxBlockEntities ||
                    rows.size() + blocksJson.size() >= kGeomMaxTotalBytes) {
                    blockTruncated = true;
                    break;
                }
                AcDbBlockTableRecord* btr = nullptr;
                if (table->getAt(toWide(name).c_str(), btr, AcDb::kForRead) != Acad::eOk || !btr) {
                    continue;
                }
                // Layout khong phai block noi dung; chung da duoc quet o vong
                // tren cung roi. Gui lai la nhan doi ca ban ve.
                if (btr->isLayout()) { btr->close(); continue; }

                std::string defRows;
                long long defCount = 0;
                AcDbBlockTableRecordIterator* it = nullptr;
                if (btr->newIterator(it) == Acad::eOk && it) {
                    for (; !it->done(); it->step()) {
                        if ((size_t)blockEntities >= kGeomMaxBlockEntities ||
                            rows.size() + blocksJson.size() + defRows.size() >= kGeomMaxTotalBytes) {
                            blockTruncated = true;
                            break;
                        }
                        AcDbEntity* ent = nullptr;
                        if (it->getEntity(ent, AcDb::kForRead) != Acad::eOk || !ent) continue;
                        bool approx = false;
                        // `next` chu khong phai `wantBlocks`: block long trong
                        // block phai roi xuong lop sau de dem dung do sau.
                        const std::string geom =
                            entityGeometryJson(ent, approx, vertexOverflow, &next);
                        if (geom.empty()) { blockSkipped++; ent->close(); continue; }
                        if (defCount) defRows += ",";
                        // Khong co `sp`: hinh trong dinh nghia block khong thuoc
                        // khong gian nao ca — no thuoc khong gian cua lan chen.
                        defRows += "{\"h\":" + jsonString(objectHandle(ent)) +
                                   ",\"t\":" + jsonString(objectType(ent)) +
                                   ",\"l\":" + jsonString(entityLayer(ent)) +
                                   (approx ? ",\"a\":1" : "") +
                                   "," + geom + "}";
                        defCount++;
                        blockEntities++;
                        ent->close();
                    }
                    delete it;
                }
                btr->close();
                if (!defCount) continue;
                if (!firstBlock) blocksJson += ",";
                firstBlock = false;
                blocksJson += jsonString(name) + ":[" + defRows + "]";
                blockDefs++;
            }
            if (blockTruncated) break;
            if (depth + 1 >= kGeomMaxBlockDepth && !next.empty()) blockDepthHit = true;
            frontier = next;
        }
    }
    blocksJson += "}";

    table->close();

    if (blockTruncated) addWarning(warnings, "block_geometry_truncated");
    if (blockDepthHit) addWarning(warnings, "block_nesting_too_deep");
    if (blockSkipped) addWarning(warnings, "block_entities_without_geometry_skipped");
    if (truncated) addWarning(warnings, "geometry_truncated");
    // Hai nguyen nhan cat bot rat khac nhau: cham tran XUAT nghia la con doi
    // tuong khop chua gui; cham tran QUET nghia la con phan ban ve chua nhin toi.
    if (scanCapped) addWarning(warnings, "geometry_scan_cap_reached");
    if (vertexOverflow) addWarning(warnings, "polyline_vertices_truncated");
    if (skipped) addWarning(warnings, "entities_without_geometry_skipped");

    std::string warningsJson = "[";
    for (size_t i = 0; i < warnings.size(); ++i) {
        if (i) warningsJson += ",";
        warningsJson += jsonString(warnings[i]);
    }
    warningsJson += "]";

    std::string bounds = "{";
    bool firstBound = true;
    for (const auto& entry : spaceExtents) {
        if (!firstBound) bounds += ",";
        firstBound = false;
        bounds += jsonString(entry.first) + ":[" +
                  jsonNumber(entry.second.minPoint().x) + "," +
                  jsonNumber(entry.second.minPoint().y) + "," +
                  jsonNumber(entry.second.maxPoint().x) + "," +
                  jsonNumber(entry.second.maxPoint().y) + "]";
    }
    bounds += "}";

    std::string spacesJson = "{";
    bool firstSpace = true;
    for (const auto& entry : spaceCounts) {
        if (!firstSpace) spacesJson += ",";
        firstSpace = false;
        spacesJson += jsonString(entry.first) + ":" + std::to_string(entry.second);
    }
    spacesJson += "}";

    std::string layoutsJson = "[";
    for (size_t i = 0; i < allLayouts.size(); ++i) {
        if (i) layoutsJson += ",";
        layoutsJson += jsonString(allLayouts[i]);
    }
    layoutsJson += "]";

    const std::string json =
        "{\"ok\":true,\"requestId\":" + jsonString(requestId) +
        ",\"collectedAt\":" + std::to_string((long long)time(nullptr)) +
        ",\"source\":{\"channel\":\"objectarx\",\"protocol\":1,\"pluginVersion\":\"" +
        std::string(kPluginVersion) + "\"}" +
        ",\"document\":{\"title\":" + jsonString(toUtf8(doc->docTitle())) +
        ",\"file\":" + jsonString(toUtf8(doc->fileName())) +
        ",\"revision\":" + std::to_string((long long)acadDatabaseRevision(db)) + "}" +
        ",\"projection\":\"xy\"" +
        ",\"filter\":{\"space\":" + jsonString(wantSpace) +
        ",\"layer\":" + jsonString(wantLayer) +
        ",\"maxEntities\":" + std::to_string((long long)maxEntities) + "}" +
        ",\"counts\":{\"scanned\":" + std::to_string(scanned) +
        ",\"emitted\":" + std::to_string(emitted) +
        ",\"approx\":" + std::to_string(approxCount) +
        ",\"skipped\":" + std::to_string(skipped) +
        ",\"blockDefs\":" + std::to_string(blockDefs) +
        ",\"blockEntities\":" + std::to_string(blockEntities) + "}" +
        ",\"truncated\":" + jsonBool(truncated) +
        ",\"bounds\":" + bounds +
        ",\"spaces\":" + spacesJson +
        ",\"layouts\":" + layoutsJson +
        ",\"warnings\":" + warningsJson +
        ",\"blocks\":" + blocksJson +
        ",\"entities\":[" + rows + "]}";
    acDocManager->unlockDocument(doc);
    writeAtomicJson(gGeomPath, json);
}

// ============================ chay job ============================
// AutoCAD executes sendStringToExecute asynchronously. Snapshot the watched
// transport first so a later daemon write can never change the bytes of a job
// that has already been queued for a document.
static std::string snapshotJobFile(const std::string& source,
                                   const std::string& bytes) {
    const std::string snapshots = gBridgeDir + "/job-snapshots";
    mkdir(snapshots.c_str(), 0700);
    const time_t now = time(nullptr);

    // Best-effort bounded cleanup; successful jobs also delete their own file.
    DIR* dir = opendir(snapshots.c_str());
    if (dir) {
        struct dirent* entry;
        while ((entry = readdir(dir)) != nullptr) {
            if (entry->d_name[0] == '.') continue;
            const std::string path = snapshots + "/" + entry->d_name;
            struct stat st;
            if (stat(path.c_str(), &st) == 0 && now - st.st_mtime > 24 * 60 * 60)
                unlink(path.c_str());
        }
        closedir(dir);
    }

    static unsigned long sequence = 0;
    char name[96];
    snprintf(name, sizeof name, "job-%ld-%d-%lu.lsp",
             (long)now, (int)getpid(), ++sequence);
    const std::string destination = snapshots + "/" + name;
    if (bytes.empty()) return source;
    FILE* out = fopen(destination.c_str(), "wb");
    if (!out) return source;
    const bool complete = fwrite(bytes.data(), 1, bytes.size(), out) == bytes.size();
    fclose(out);
    if (!complete) {
        unlink(destination.c_str());
        return source;
    }
    return destination;
}

static void runJob() {
    if (acDocManager == nullptr) return;
    AcApDocument* pDoc = resolveTarget();
    if (pDoc == nullptr) { acutPrintf(L"\n[AcadBridge] Chua co ban ve mo -- bo qua job."); return; }
    const std::string jobBytes = readAll(gJobPath);
    const bool readOnly =
        jobBytes.rfind(kReadOnlyJobMarker, 0) == 0;
    // Trust the snapshot only for the duration of load, then restore the exact
    // prior value so even a read-only review leaves no persistent setting change.
    std::wstring dirW = toWide(gBridgeDir);
    const std::string snapshotPath = snapshotJobFile(gJobPath, jobBytes);
    std::wstring jobW = toWide(snapshotPath);
    std::wstring cmd =
        L"((lambda (mep:tp mep:tp-changed mep:load-result) "
        L"(if (null mep:tp) (setq mep:tp \"\")) "
        L"(if (and (null (vl-string-search \"Acad-Bridge\" mep:tp)) (null (vl-string-search \"MEP-Bridge\" mep:tp))) "
        L"(progn (setvar \"TRUSTEDPATHS\" (strcat mep:tp \";" + dirW + L"/...\")) "
        L"(setq mep:tp-changed T))) "
        L"(setq mep:load-result (vl-catch-all-apply 'load (list \"" + jobW + L"\"))) "
        L"(if mep:tp-changed (setvar \"TRUSTEDPATHS\" mep:tp)) "
        L"(vl-file-delete \"" + jobW + L"\") "
        L"(if (vl-catch-all-error-p mep:load-result) "
        L"(princ (strcat \"\\n[AcadBridge] Job load failed: \" "
        L"(vl-catch-all-error-message mep:load-result)))) (princ)) "
        L"(getvar \"TRUSTEDPATHS\") nil nil) ";
    // Read-only review executes in the target context without activating its tab.
    acDocManager->sendStringToExecute(
        pDoc, cmd.c_str(), !readOnly, readOnly, false);
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
    if (stat(gDrawingInfoReqPath.c_str(), &st) == 0 &&
        tsChanged(st.st_mtimespec, gDrawingInfoReqMtime)) {
        gDrawingInfoReqMtime = st.st_mtimespec;
        writeDrawingInfo();
    }
    if (stat(gGeomReqPath.c_str(), &st) == 0 &&
        tsChanged(st.st_mtimespec, gGeomReqMtime)) {
        gGeomReqMtime = st.st_mtimespec;
        writeGeometry();
    }
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

    // Xa co dirty khi khong con lenh nao chay.
    //
    // Binh thuong `commandEnded` lam viec nay. Nhung mot job LISP sua ban ve
    // bang `entmake` thuan (khong goi `command`) thi KHONG co lenh nao ket thuc,
    // nen co dirty nam mai va app khong bao gio biet ban ve da doi — cham "chua
    // luu" tren doctab treo o trang thai cu. Chinh cac job cua app di duong nay.
    //
    // `isQuiescent()` la dieu kien bat buoc: xa giua chung mot lenh dang chay se
    // bao "da sua" truoc khi lenh do that su xong.
    if (gDirty && acDocManager) {
        AcApDocument* cur = acDocManager->curDocument();
        if (cur && cur->isQuiescent()) {
            gDirty = false;
            writeDocs();
            emitEvent("drawingModified", "");
        }
    }
    // Primary job.lsp
    if (stat(gJobPath.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gJobMtime)) {
        gJobMtime = st.st_mtimespec;
        runJob();
    }
    // Legacy alias mep_job.lsp (one release) — load if mtime newer than primary last run
    {
        static struct timespec gLegJobMtime = {0, 0};
        std::string legJob = gBridgeDir + "/mep_job.lsp";
        if (stat(legJob.c_str(), &st) == 0 && tsChanged(st.st_mtimespec, gLegJobMtime)) {
            gLegJobMtime = st.st_mtimespec;
            // Temporarily point load path at legacy file for this run
            std::string saved = gJobPath;
            gJobPath = legJob;
            runJob();
            gJobPath = saved;
        }
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
    if (stat(gDrawingInfoReqPath.c_str(), &st) == 0)
        gDrawingInfoReqMtime = st.st_mtimespec;   // khong xu ly lai request cu
    if (stat(gGeomReqPath.c_str(), &st) == 0)
        gGeomReqMtime = st.st_mtimespec;
    mepRawOnStartWatch();

    CFStringRef dir = CFStringCreateWithCString(nullptr, gBridgeDir.c_str(), kCFStringEncodingUTF8);
    CFArrayRef paths = CFArrayCreate(nullptr, (const void**)&dir, 1, &kCFTypeArrayCallBacks);
    FSEventStreamContext ctx = {0, nullptr, nullptr, nullptr, nullptr};
    gStream = FSEventStreamCreate(nullptr, &fsCallback, &ctx, paths,
        kFSEventStreamEventIdSinceNow, 0.25,
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer);
    CFRelease(paths); CFRelease(dir);
    if (!gStream) { acutPrintf(L"\n[AcadBridge] Loi: khong tao duoc FSEventStream."); return; }
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
    tbl->setTextString(0, 0, L"BANG KHOI LUONG (AutoCAD Toolkit)");
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
    acutPrintf(L"\n[AcadBridge] Da chen bang BOQ.");
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
// Không LISP, không SECURELOAD: app ghi ~/Acad-Bridge/native.job (bảng, phân tách TAB),
// plugin dựng entity trực tiếp qua AcDb trong document lock -> nhanh + chính xác.
// Định dạng mỗi dòng:
//   MODE   \t COMMIT|PREVIEW|APPLY|REJECT              (mặc định COMMIT = vẽ thẳng)
//   OPID   \t <id>                                       (bắt buộc với PREVIEW/APPLY/REJECT)
//   TARGET \t <tên bản vẽ>                              (tuỳ chọn)
//   LAYER  \t <tên> \t <ACI màu>
//   PIPE   \t <layer> \t <dn> \t <hệ> \t x1,y1 x2,y2 …  (polyline + XDATA)
//   TEXT   \t <layer> \t <x> \t <y> \t <cao> \t <chuỗi>
//   CIRCLE \t <layer> \t <x> \t <y> \t <bán kính>
//   BLOCKMETA \t <blockName> \t <commentsHexUtf8> \t <metaHexUtf8>
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
static bool decodeHexUtf8(const std::string& hex, std::string& decoded) {
    decoded.clear();
    if ((hex.size() & 1) != 0) return false;
    decoded.reserve(hex.size() / 2);
    auto nibble = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < hex.size(); i += 2) {
        const int hi = nibble(hex[i]);
        const int lo = nibble(hex[i + 1]);
        if (hi < 0 || lo < 0) {
            decoded.clear();
            return false;
        }
        decoded += static_cast<char>((hi << 4) | lo);
    }
    return true;
}
static bool writeBlockAcadlibMetadata(AcDbBlockTableRecord* block,
                                      const std::string& metadata,
                                      std::string& error) {
    error.clear();
    if (!block) {
        error = "null block record";
        return false;
    }

    std::wstring wideMetadata = toWide(metadata);
    resbuf* chain = acutBuildList(1, wideMetadata.c_str(), 0);
    if (!chain) {
        error = "cannot allocate XRecord data";
        return false;
    }

    AcDbObjectId dictionaryId = block->extensionDictionary();
    if (dictionaryId.isNull()) {
        const Acad::ErrorStatus createStatus = block->createExtensionDictionary();
        if (createStatus != Acad::eOk) {
            acutRelRb(chain);
            error = "cannot create extension dictionary (" +
                    std::to_string((int)createStatus) + ")";
            return false;
        }
        dictionaryId = block->extensionDictionary();
    }

    AcDbDictionary* dictionary = nullptr;
    const Acad::ErrorStatus dictionaryStatus =
        acdbOpenObject(dictionary, dictionaryId, AcDb::kForWrite);
    if (dictionaryStatus != Acad::eOk || !dictionary) {
        acutRelRb(chain);
        error = "cannot open extension dictionary (" +
                std::to_string((int)dictionaryStatus) + ")";
        return false;
    }

    Acad::ErrorStatus writeStatus = Acad::eOk;
    if (dictionary->has(kAcadlibXrecordKey)) {
        AcDbXrecord* xrecord = nullptr;
        writeStatus = dictionary->getAt(kAcadlibXrecordKey, xrecord, AcDb::kForWrite);
        if (writeStatus == Acad::eOk && xrecord) {
            writeStatus = xrecord->setFromRbChain(*chain);
            xrecord->close();
        }
    } else {
        AcDbXrecord* xrecord = new AcDbXrecord();
        writeStatus = xrecord->setFromRbChain(*chain);
        if (writeStatus == Acad::eOk) {
            AcDbObjectId xrecordId;
            writeStatus = dictionary->setAt(kAcadlibXrecordKey, xrecord, xrecordId);
        }
        if (writeStatus == Acad::eOk) xrecord->close();
        else delete xrecord;
    }
    dictionary->close();
    acutRelRb(chain);

    if (writeStatus != Acad::eOk) {
        error = "cannot write ACADLIB XRecord (" +
                std::to_string((int)writeStatus) + ")";
        return false;
    }
    return true;
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

    AcApDocument* pDoc = findDocExact(target);
    if (!pDoc) { acutPrintf(L"\n[AcadBridge] native.job: khong co ban ve dich.");
        failDone("no document"); return 0; }
    if (acDocManager->lockDocument(pDoc, AcAp::kWrite) != Acad::eOk) {
        failDone("lock failed"); return 0; }
    AcDbDatabase* db = pDoc->database();
    ensureRegApp(db);

    AcDbBlockTable* bt = nullptr; AcDbBlockTableRecord* ms = nullptr;
    if (db->getBlockTable(bt, AcDb::kForRead) != Acad::eOk) {
        acDocManager->unlockDocument(pDoc);
        failDone("cannot open block table");
        return 0;
    }
    if (bt->getAt(ACDB_MODEL_SPACE, ms, AcDb::kForWrite) != Acad::eOk) {
        bt->close(); acDocManager->unlockDocument(pDoc);
        failDone("cannot open model space");
        return 0;
    }

    int count = 0;
    std::vector<std::string> handles;
    std::string operationError;
    bool hasViewMutation = mode == "PREVIEW" || mode == "APPLY";
    if (mode == "COMMIT") {
        for (const auto& line : lines) {
            const std::string op = splitCh(line, '\t')[0];
            if (op == "PIPE" || op == "TEXT" || op == "RECT" ||
                op == "SYMBOL" || op == "CIRCLE") {
                hasViewMutation = true;
                break;
            }
        }
    }

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
            if (op == "BLOCKMETA") {
                if (isPreview) {
                    operationError = "BLOCKMETA is only supported in COMMIT mode";
                    break;
                }
                if (t.size() != 4 || t[1].empty()) {
                    operationError = "BLOCKMETA needs blockName, commentsHexUtf8 and metaHexUtf8";
                    break;
                }
                std::string comments, metadata;
                if (!decodeHexUtf8(t[2], comments)) {
                    operationError = "BLOCKMETA commentsHexUtf8 is invalid";
                    break;
                }
                if (!decodeHexUtf8(t[3], metadata)) {
                    operationError = "BLOCKMETA metaHexUtf8 is invalid";
                    break;
                }

                const std::wstring blockName = toWide(t[1]);
                AcDbObjectId blockId;
                const Acad::ErrorStatus lookupStatus = bt->getAt(blockName.c_str(), blockId);
                if (lookupStatus != Acad::eOk || blockId.isNull()) {
                    operationError = "BLOCKMETA block not found: " + t[1];
                    break;
                }

                AcDbBlockTableRecord* targetBlock = nullptr;
                const bool targetIsModelSpace = (blockId == ms->objectId());
                Acad::ErrorStatus openStatus = Acad::eOk;
                if (targetIsModelSpace) targetBlock = ms;
                else openStatus = acdbOpenObject(targetBlock, blockId, AcDb::kForWrite);
                if (openStatus != Acad::eOk || !targetBlock) {
                    operationError = "BLOCKMETA cannot open block for write: " + t[1];
                    break;
                }

                AcString previousComments;
                const Acad::ErrorStatus commentsReadStatus =
                    targetBlock->comments(previousComments);
                const Acad::ErrorStatus commentsWriteStatus =
                    commentsReadStatus == Acad::eOk
                        ? targetBlock->setComments(toWide(comments).c_str())
                        : commentsReadStatus;
                if (commentsWriteStatus != Acad::eOk) {
                    operationError = "BLOCKMETA cannot update comments: " + t[1];
                } else {
                    std::string xrecordError;
                    if (!writeBlockAcadlibMetadata(targetBlock, metadata, xrecordError)) {
                        targetBlock->setComments(previousComments.kwszPtr());
                        operationError = "BLOCKMETA ACADLIB XRecord failed for " + t[1] +
                                         ": " + xrecordError;
                    } else {
                        count++;
                    }
                }
                if (!targetIsModelSpace) targetBlock->close();
                if (!operationError.empty()) break;
            } else if (op == "LAYER" && t.size() >= 3) {
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
            } else if (op == "TEXT" && t.size() >= 6) {
                // TEXT layer x y height string — works in PREVIEW (draw layer) and COMMIT
                std::string drawLayer = isPreview ? toUtf8(kPreviewLayer) : t[1];
                if (!isPreview) ensureLayer(db, toWide(t[1]), 0);
                AcDbText* tx = new AcDbText(AcGePoint3d(atof(t[2].c_str()), atof(t[3].c_str()), 0),
                                           toWide(t[5]).c_str(), db->textstyle(), atof(t[4].c_str()), 0);
                tx->setLayer(toWide(drawLayer).c_str());
                if (isPreview) {
                    AcCmColor col; col.setColorIndex((Adesk::UInt16)kPreviewAci);
                    tx->setColor(col);
                }
                if (ms->appendAcDbEntity(newId, tx) == Acad::eOk) {
                    if (isPreview) setPreviewXData(tx, opId, "0", "plan", t[1]);
                    handles.push_back(handleOfEnt(tx));
                    tx->close(); count++;
                } else delete tx;
            } else if (op == "RECT" && t.size() >= 6) {
                // RECT layer x1 y1 x2 y2 — closed polyline footprint for plan blocks
                std::string destLayer = t[1];
                std::string drawLayer = isPreview ? toUtf8(kPreviewLayer) : destLayer;
                if (!isPreview) ensureLayer(db, toWide(destLayer), 0);
                double x1 = atof(t[2].c_str()), y1 = atof(t[3].c_str());
                double x2 = atof(t[4].c_str()), y2 = atof(t[5].c_str());
                AcDbPolyline* pl = new AcDbPolyline(4);
                pl->addVertexAt(0, AcGePoint2d(x1, y1));
                pl->addVertexAt(1, AcGePoint2d(x2, y1));
                pl->addVertexAt(2, AcGePoint2d(x2, y2));
                pl->addVertexAt(3, AcGePoint2d(x1, y2));
                pl->setClosed(Adesk::kTrue);
                pl->setLayer(toWide(drawLayer).c_str());
                pl->setConstantWidth(80.0);
                if (isPreview) {
                    AcCmColor col; col.setColorIndex((Adesk::UInt16)kPreviewAci);
                    pl->setColor(col);
                }
                if (ms->appendAcDbEntity(newId, pl) == Acad::eOk) {
                    if (isPreview) setPreviewXData(pl, opId, "0", "plan", destLayer);
                    handles.push_back(handleOfEnt(pl));
                    pl->close(); count++;
                } else delete pl;
            } else if (op == "SYMBOL" && t.size() >= 6) {
                // SYMBOL layer x y size label — circle + text (stair/elevator stand-in)
                std::string destLayer = t[1];
                std::string drawLayer = isPreview ? toUtf8(kPreviewLayer) : destLayer;
                if (!isPreview) ensureLayer(db, toWide(destLayer), 0);
                double cx = atof(t[2].c_str()), cy = atof(t[3].c_str());
                double r = atof(t[4].c_str());
                if (r < 50) r = 50;
                AcDbCircle* c = new AcDbCircle(AcGePoint3d(cx, cy, 0), AcGeVector3d(0, 0, 1), r);
                c->setLayer(toWide(drawLayer).c_str());
                if (isPreview) {
                    AcCmColor col; col.setColorIndex((Adesk::UInt16)kPreviewAci);
                    c->setColor(col);
                }
                if (ms->appendAcDbEntity(newId, c) == Acad::eOk) {
                    if (isPreview) setPreviewXData(c, opId, "0", "symbol", destLayer);
                    handles.push_back(handleOfEnt(c));
                    c->close(); count++;
                } else delete c;
                AcDbText* tx = new AcDbText(AcGePoint3d(cx + r * 1.2, cy, 0),
                    toWide(t[5]).c_str(), db->textstyle(), r * 0.8, 0);
                tx->setLayer(toWide(drawLayer).c_str());
                if (isPreview) {
                    AcCmColor col; col.setColorIndex((Adesk::UInt16)kPreviewAci);
                    tx->setColor(col);
                }
                if (ms->appendAcDbEntity(newId, tx) == Acad::eOk) {
                    if (isPreview) setPreviewXData(tx, opId, "0", "symbol", destLayer);
                    handles.push_back(handleOfEnt(tx));
                    tx->close(); count++;
                } else delete tx;
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

    if (!operationError.empty()) {
        failDone(operationError.c_str());
        return 0;
    }

    // After PREVIEW/COMMIT: zoom so the user actually sees new geometry (tests used tiny coords
    // at origin; without ZOOM the viewport can leave everything off-screen).
    if (count > 0 && hasViewMutation &&
        (mode == "PREVIEW" || mode == "COMMIT" || mode == "APPLY")) {
        acDocManager->sendStringToExecute(pDoc, L"(command \"_.ZOOM\" \"_E\") ", true, false, false);
        if (mode == "PREVIEW") {
            // Thaw/on preview layer if frozen; print clear cue on command line.
            acutPrintf(L"\n[AcadBridge] PREVIEW: %d doi tuong tren layer MEP-PREVIEW (mau cam). Zoom Extents.", count);
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
    acutPrintf(L"\n[AcadBridge] native.job %s: %d doi tuong.", toWide(mode).c_str(), count);
    return count;
}

// ============================ QA highlight + zoom theo layer (rank 7) ============================
// App ghi ~/Acad-Bridge/select.req = "<target>|<layer>"  -> plugin sáng mọi đối tượng trên layer
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
    acutPrintf(L"\n[AcadBridge] Highlight '%s': %d doi tuong.", toWide(layer).c_str(), n);
}

// ============================ reactors: su kien realtime -> app ============================
static void attachDbReactor();   // forward
static void detachDbReactor();

class MepDocReactor : public AcApDocManagerReactor {
public:
    void documentCreated(AcApDocument* d) override {
        emitEvent("docOpened", d ? toUtf8(d->docTitle()) : "");
        writeDocs();
    }
    // CRITICAL: detach DB reactor WHILE the document/database is still valid.
    // Crash stack (CER): removeReactor on a destroyed AcDbDatabase after tab switch/close
    // (MepDocReactor::documentActivated → attachDbReactor → removeReactor).
    void documentToBeDestroyed(AcApDocument* d) override {
        if (d) detachDbReactorIfDoc(d);
        emitEvent("docClosed", d ? toUtf8(d->docTitle()) : "");
        writeDocs();
        forgetDocumentState(d);
    }
    void documentActivated(AcApDocument* d) override {
        // Re-attach only after activation; never removeReactor on a dead db pointer.
        attachDbReactor();
        // Tai lieu vua thanh hien hanh -> bay gio moi doc duoc DBMOD that cua no.
        // Nho vay ban ve da mo TU TRUOC khi nap plugin cung co moc dung, ngay
        // khi nguoi dung bam sang no.
        writeDocs();   // tu dat lai moc dbmod cho tai lieu vua thanh hien hanh
        emitEvent("docActivated", d ? toUtf8(d->docTitle()) : "");
        writeDocs();
    }
    void documentToBeDeactivated(AcApDocument* d) override {
        // Optional early detach when leaving a doc (safe while db still alive).
        if (d) detachDbReactorIfDoc(d);
    }
private:
    void detachDbReactorIfDoc(AcApDocument* d);
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
    void objectAppended(const AcDbDatabase* db, const AcDbObject*) override {
        gDirty = true;
        if (db) ++gDatabaseRevisions[db];
    }
    void objectModified(const AcDbDatabase* db, const AcDbObject*) override {
        gDirty = true;
        if (db) ++gDatabaseRevisions[db];
    }
    void objectErased(const AcDbDatabase* db, const AcDbObject*, bool) override {
        gDirty = true;
        if (db) ++gDatabaseRevisions[db];
    }
    void headerSysVarChanged(const AcDbDatabase* db, const ACHAR* name, bool success) override {
        // TRUSTEDPATHS is an application preference used only while loading a
        // queued job; it must not make a read-only drawing review look stale.
        if (success && (!name || toUtf8(name) != "TRUSTEDPATHS")) {
            gDirty = true;
            if (db) ++gDatabaseRevisions[db];
        }
    }
};
// AcRxEventReactor la NOI DUY NHAT trong ObjectARX bao "da luu xong":
// AcDbDatabaseReactor va AcApDocManagerReactor deu khong co callback nay
// (da tra header 2027). Khong co no thi khong the biet ban ve sach hay ban.
class MepRxEventReactor : public AcRxEventReactor {
public:
    void saveComplete(AcDbDatabase* db, const ACHAR*) override {
        if (!db) return;
        gSavedRevisions[db] = acadDatabaseRevision(db);
        writeDocs();
        // Phai phat su kien: UI nap lai danh sach ban ve theo su kien, va
        // writeDocs() mot minh khong danh thuc ai ca — cham "chua luu" se treo
        // o trang thai cu cho toi lan mo/dong ban ve tiep theo.
        emitEvent("drawingSaved", "");
    }
    // Ban ve vua mo la sach, du bo dem revision dang o gia tri nao.
    void dwgFileOpened(AcDbDatabase* db, const ACHAR*) override {
        if (db) gSavedRevisions[db] = acadDatabaseRevision(db);
    }
    void databaseToBeDestroyed(AcDbDatabase* db) override {
        if (db) gSavedRevisions.erase(db);
    }
};

static MepDocReactor gDocReactor;
static MepEdReactor  gEdReactor;
static MepDbReactor  gDbReactor;
static MepRxEventReactor gRxEventReactor;
// Track BOTH document and database so we never removeReactor on a freed AcDbDatabase*
// after the owning document is destroyed (common when opening many demo DWGs).
static AcApDocument* gDocWatched = nullptr;
static AcDbDatabase* gDbWatched = nullptr;
static bool gReactorsOn = false;

static void detachDbReactor() {
    if (gDbWatched) {
        // Database must still be alive here (called only while doc is valid).
        gDbWatched->removeReactor(&gDbReactor);
        gDbWatched = nullptr;
    }
    gDocWatched = nullptr;
}

// Detach only if the watched pair matches this document.
static void detachDbReactorIfDoc(AcApDocument* d) {
    if (!d) return;
    if (gDocWatched == d || (gDbWatched && d->database() == gDbWatched)) {
        detachDbReactor();
    }
}

void MepDocReactor::detachDbReactorIfDoc(AcApDocument* d) {
    ::detachDbReactorIfDoc(d);
}

// Gan database reactor vao db cua ban ve active (goi khi nap + khi doi document).
static void attachDbReactor() {
    AcApDocument* doc = (acDocManager) ? acDocManager->mdiActiveDocument() : nullptr;
    AcDbDatabase* db = doc ? doc->database() : nullptr;
    if (doc == gDocWatched && db == gDbWatched) return;

    // If we still track a previous live doc (tab switch, not destroy), remove cleanly.
    // If documentToBeDestroyed already ran, gDbWatched is null — no remove on freed heap.
    if (gDbWatched && gDocWatched) {
        gDbWatched->removeReactor(&gDbReactor);
        gDbWatched = nullptr;
        gDocWatched = nullptr;
    } else {
        // Dangling or already cleared — never call removeReactor on a free pointer.
        gDbWatched = nullptr;
        gDocWatched = nullptr;
    }

    gDocWatched = doc;
    gDbWatched = db;
    if (gDbWatched) gDbWatched->addReactor(&gDbReactor);
}

static void startReactors() {
    if (gReactorsOn) return;
    if (acDocManager) acDocManager->addReactor(&gDocReactor);
    if (acedEditor)   acedEditor->addReactor(&gEdReactor);
    if (acrxEvent)    acrxEvent->addReactor(&gRxEventReactor);
    attachDbReactor();
    gReactorsOn = true;
}
static void stopReactors() {
    if (!gReactorsOn) return;
    if (acDocManager) acDocManager->removeReactor(&gDocReactor);
    if (acedEditor)   acedEditor->removeReactor(&gEdReactor);
    if (acrxEvent)    acrxEvent->removeReactor(&gRxEventReactor);
    detachDbReactor();
    gDocumentInstances.clear();
    gDatabaseRevisions.clear();
    gSavedRevisions.clear();
    gReactorsOn = false;
}

// ============================ lenh AutoCAD ============================
static void cmdMepArx()     { acutPrintf(L"\n[AcadBridge] ACADARX: chay job.lsp."); runJob(); }
static void cmdMepNative()  { execNativeJob(readAll(gNativePath)); }
static void cmdMepBomTable() { insertBomTable(acDocManager ? acDocManager->mdiActiveDocument() : nullptr, 0, 0); }
static void cmdMepBom()     { writeBom(acDocManager ? acDocManager->mdiActiveDocument() : nullptr); acutPrintf(L"\n[AcadBridge] Da ghi bom.json."); }
static void cmdMepDocs()    { writeDocs(); acutPrintf(L"\n[AcadBridge] Da ghi docs.json."); }
static void cmdMepWatch()   { startWatch();  acutPrintf(L"\n[AcadBridge] Watcher: ON."); }
static void cmdMepUnwatch() { stopWatch();   acutPrintf(L"\n[AcadBridge] Watcher: OFF."); }

// MEPPIPE: vẽ ống tương tác trong AutoCAD — hỏi DN + hệ, nhặt điểm (rubber-band),
// dựng polyline auto layer/màu + XDATA (dn/hệ). Enter/ESC để kết thúc.
static void cmdMepPipe() {
    if (!acDocManager) return;
    AcApDocument* pDoc = acDocManager->mdiActiveDocument();
    if (!pDoc) { acutPrintf(L"\n[AcadBridge] Chua co ban ve mo."); return; }

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
    if (acedGetPoint(nullptr, L"\nDiem dau ong: ", p) != RTNORM) { acutPrintf(L"\n[AcadBridge] Da huy."); return; }
    pts.push_back(AcGePoint2d(p[0], p[1]));
    while (true) {
        base[0] = pts.back().x; base[1] = pts.back().y; base[2] = 0;
        if (acedGetPoint(base, L"\nDiem tiep (Enter=ket thuc): ", p) != RTNORM) break;
        pts.push_back(AcGePoint2d(p[0], p[1]));
    }
    if (pts.size() < 2) { acutPrintf(L"\n[AcadBridge] Can it nhat 2 diem."); return; }

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
    acutPrintf(L"\n[AcadBridge] Da ve ong %d diem, DN%d, layer %s.", (int)pts.size(), dn, toWide(layer).c_str());
}

// ============================ entry point ============================
extern "C" __attribute__((visibility("default"))) AcRx::AppRetCode
acrxEntryPoint(AcRx::AppMsgCode msg, void* pkt) {
    switch (msg) {
    case AcRx::kInitAppMsg:
        acrxDynamicLinker->unlockApplication(pkt);
        acrxRegisterAppMDIAware(pkt);
        initPaths();
        // Primary domain-agnostic commands
        acedRegCmds->addCommand(kGroup, L"ACADARX",    L"ACADARX",    ACRX_CMD_MODAL, &cmdMepArx);
        acedRegCmds->addCommand(kGroup, L"ACADDOCS",   L"ACADDOCS",   ACRX_CMD_MODAL, &cmdMepDocs);
        acedRegCmds->addCommand(kGroup, L"ACADWATCH",  L"ACADWATCH",  ACRX_CMD_MODAL, &cmdMepWatch);
        acedRegCmds->addCommand(kGroup, L"ACADUNWATCH",L"ACADUNWATCH",ACRX_CMD_MODAL, &cmdMepUnwatch);
        acedRegCmds->addCommand(kGroup, L"ACADNATIVE", L"ACADNATIVE", ACRX_CMD_MODAL, &cmdMepNative);
        // Legacy aliases (one release)
        acedRegCmds->addCommand(kGroup, L"MEPARX",     L"MEPARX",     ACRX_CMD_MODAL, &cmdMepArx);
        acedRegCmds->addCommand(kGroup, L"MEPBOM",     L"MEPBOM",     ACRX_CMD_MODAL, &cmdMepBom);
        acedRegCmds->addCommand(kGroup, L"MEPBOMTABLE",L"MEPBOMTABLE",ACRX_CMD_MODAL, &cmdMepBomTable);
        acedRegCmds->addCommand(kGroup, L"MEPNATIVE",  L"MEPNATIVE",  ACRX_CMD_MODAL, &cmdMepNative);
        acedRegCmds->addCommand(kGroup, L"MEPPIPE",    L"MEPPIPE",    ACRX_CMD_MODAL, &cmdMepPipe);
        acedRegCmds->addCommand(kGroup, L"MEPDOCS",    L"MEPDOCS",    ACRX_CMD_MODAL, &cmdMepDocs);
        acedRegCmds->addCommand(kGroup, L"MEPWATCH",   L"MEPWATCH",   ACRX_CMD_MODAL, &cmdMepWatch);
        acedRegCmds->addCommand(kGroup, L"MEPUNWATCH", L"MEPUNWATCH", ACRX_CMD_MODAL, &cmdMepUnwatch);
        mepRawRegisterCommands();   // ACADRAW / MEPRAW — interactive raw ObjectARX ops
        startWatch();
        startReactors();
        writeDocs();   // heartbeat dau tien
        emitEvent("pluginLoaded", std::string("AcadBridge ") + kPluginVersion);
        acutPrintf(L"\n[AcadBridge 1.6.0] Da nap. Drawing-info + PDF/DataLink inventory + selection control + Raw ObjectARX."
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
