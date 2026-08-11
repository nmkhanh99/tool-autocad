// selection_control.cpp — fail-closed bidirectional selection/edit control.
//
// This capability is invoked only from the ACADSELECT command context. The raw
// watcher resolves the exact document before scheduling the command; this file
// checks the active/current document again before reading or changing anything.

#include <algorithm>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "windef.h"
#include <aced.h>
#include <acedads.h>
#include <adscodes.h>
#include <acdocman.h>
#include <dbmain.h>
#include <dbents.h>
#include <dbsymtb.h>
#include <dbdynblk.h>
#include <dbtrans.h>

extern std::string toUtf8(const wchar_t* w);
extern std::wstring toWide(const std::string& s);
extern std::string jsonEsc(const std::string& s);
extern std::string acadDocumentInstanceToken(const AcApDocument* document);
extern uint64_t acadDatabaseRevision(const AcDbDatabase* database);
extern std::string currentSpaceName(AcDbDatabase* database);

namespace {

constexpr size_t kMaxSubjects = 5000;
constexpr size_t kMaxTextBytes = 4096;

struct Request {
    std::string token;
    std::string action;
    std::string exactTarget;
    std::string documentInstance;
    std::string activeDocumentInstance;
    uint64_t databaseRevision = 0;
    // Khong gian hien hanh LUC CHUAN BI, va co bao daemon CO gui hay khong.
    // Hai thu tach roi vi giao thuc raw tra "" cho ca hai truong hop: khong gui
    // (daemon ban cu) va gui chuoi rong (daemon biet la khong doc duoc).  Gop
    // lai thi mot lan doc hong thanh giay phep di qua.
    std::string currentSpace;
    bool spaceKnown = false;
};

struct Subject {
    std::string handle;
    std::string type;
    std::string layer;
    std::string layerHandle;
    std::string ownerHandle;
    AcDbObjectId id = AcDbObjectId::kNull;
};

struct ExpectedSubject {
    std::string handle;
    std::string type;
    std::string layerHandle;
    std::string ownerHandle;
};

static std::string param(const std::map<std::string, std::string>& params,
                         const char* name) {
    const auto found = params.find(name);
    return found == params.end() ? std::string() : found->second;
}

static bool isHexDigit(char value) {
    return (value >= '0' && value <= '9') ||
           (value >= 'a' && value <= 'f') ||
           (value >= 'A' && value <= 'F');
}

static int hexValue(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static bool decodeTextHex(const std::string& encoded, std::string& decoded,
                          const char* field, bool allowEmpty, std::string& error) {
    decoded.clear();
    if (encoded.empty()) {
        if (allowEmpty) return true;
        error = std::string(field) + " is required";
        return false;
    }
    if ((encoded.size() & 1U) != 0 || encoded.size() > kMaxTextBytes * 2) {
        error = std::string(field) + " is not valid bounded hex";
        return false;
    }
    decoded.reserve(encoded.size() / 2);
    for (size_t index = 0; index < encoded.size(); index += 2) {
        const int high = hexValue(encoded[index]);
        const int low = hexValue(encoded[index + 1]);
        if (high < 0 || low < 0) {
            decoded.clear();
            error = std::string(field) + " contains non-hex data";
            return false;
        }
        const char value = static_cast<char>((high << 4) | low);
        // AutoCAD symbol names and document paths cannot legitimately contain
        // these transport/control bytes.  Reject them so c_str() can never
        // resolve a truncated, different symbol name.
        if (value == '\0' || value == '\r' || value == '\n' || value == '\t') {
            decoded.clear();
            error = std::string(field) + " contains a control byte";
            return false;
        }
        decoded.push_back(value);
    }
    if (!allowEmpty && decoded.empty()) {
        error = std::string(field) + " is required";
        return false;
    }
    return true;
}

static bool normalizeHandle(const std::string& input, std::string& output,
                            const char* field, std::string& error) {
    output.clear();
    if (input.empty() || input.size() > 16) {
        error = std::string(field) + " must be 1..16 hex characters";
        return false;
    }
    output.reserve(input.size());
    for (char value : input) {
        if (!isHexDigit(value)) {
            output.clear();
            error = std::string(field) + " contains a non-hex character";
            return false;
        }
        output.push_back(value >= 'a' && value <= 'f'
            ? static_cast<char>(value - 'a' + 'A') : value);
    }
    const size_t first = output.find_first_not_of('0');
    if (first == std::string::npos) output = "0";
    else if (first > 0) output.erase(0, first);
    return true;
}

static std::vector<std::string> split(const std::string& text, char separator) {
    std::vector<std::string> values;
    std::string value;
    for (char current : text) {
        if (current == separator) {
            values.push_back(value);
            value.clear();
        } else {
            value.push_back(current);
        }
    }
    values.push_back(value);
    return values;
}

static bool boundedToken(const std::string& value, const char* field,
                         std::string& error) {
    if (value.empty() || value.size() > 128 ||
        value.find('\0') != std::string::npos ||
        value.find_first_of("\r\n\t") != std::string::npos) {
        error = std::string(field) + " is required and must be one bounded line";
        return false;
    }
    return true;
}

static bool parseRevision(const std::string& value, uint64_t& revision,
                          std::string& error) {
    if (value.empty() || value.size() > 20) {
        error = "databaseRevision is required";
        return false;
    }
    revision = 0;
    for (char digit : value) {
        if (digit < '0' || digit > '9') {
            error = "databaseRevision must be an unsigned integer";
            return false;
        }
        const uint64_t number = static_cast<uint64_t>(digit - '0');
        if (revision >
            (std::numeric_limits<uint64_t>::max() - number) / 10) {
            error = "databaseRevision is out of range";
            return false;
        }
        revision = revision * 10 + number;
    }
    return true;
}

static std::string objectIdHandle(AcDbObjectId id) {
    if (id.isNull()) return "";
    const AcDbHandle handle = id.handle();
    ACHAR buffer[32] = {};
    handle.getIntoAsciiBuffer(buffer);
    return toUtf8(buffer);
}

static std::string objectHandle(AcDbObject* object) {
    if (!object) return "";
    AcDbHandle handle;
    object->getAcDbHandle(handle);
    ACHAR buffer[32] = {};
    handle.getIntoAsciiBuffer(buffer);
    return toUtf8(buffer);
}

static std::string objectType(AcDbObject* object) {
    if (!object || !object->isA()) return "";
    const ACHAR* dxfName = object->isA()->dxfName();
    if (dxfName && *dxfName) return toUtf8(dxfName);
    const ACHAR* className = object->isA()->name();
    return className ? toUtf8(className) : std::string();
}

static bool resolveHandle(AcDbDatabase* database, const std::string& input,
                          AcDbObjectId& id, std::string& normalized,
                          std::string& error) {
    if (!database) {
        error = "document database is unavailable";
        return false;
    }
    if (!normalizeHandle(input, normalized, "handle", error)) return false;
    const std::wstring wide = toWide(normalized);
    const AcDbHandle handle(wide.c_str());
    const Acad::ErrorStatus status =
        database->getAcDbObjectId(id, false, handle);
    if (status != Acad::eOk || id.isNull() || id.database() != database ||
        id.isErased() || id.isEffectivelyErased()) {
        error = "handle does not resolve to a live object in the exact document: " +
                normalized;
        id = AcDbObjectId::kNull;
        return false;
    }
    return true;
}

static bool subjectFromEntity(AcDbEntity* entity, Subject& subject,
                              std::string& error) {
    if (!entity) {
        error = "selection contains a non-entity";
        return false;
    }
    subject.id = entity->objectId();
    subject.handle = objectHandle(entity);
    subject.type = objectType(entity);
    const AcDbObjectId layerId = entity->layerId();
    const AcDbObjectId ownerId = entity->ownerId();
    subject.layerHandle = objectIdHandle(layerId);
    subject.ownerHandle = objectIdHandle(ownerId);
    AcString layerName;
    if (entity->layer(layerName) != Acad::eOk || subject.handle.empty() ||
        subject.type.empty() || subject.layerHandle.empty() ||
        subject.ownerHandle.empty()) {
        error = "cannot read complete selection subject state";
        return false;
    }
    subject.layer = toUtf8(layerName.kwszPtr());
    return true;
}

static std::string subjectsJson(const std::vector<Subject>& subjects) {
    std::string json = "[";
    bool first = true;
    for (const Subject& subject : subjects) {
        if (!first) json += ",";
        first = false;
        json += "{\"handle\":\"" + jsonEsc(subject.handle) +
                "\",\"type\":\"" + jsonEsc(subject.type) +
                "\",\"layer\":\"" + jsonEsc(subject.layer) +
                "\",\"layerHandle\":\"" + jsonEsc(subject.layerHandle) +
                "\",\"ownerHandle\":\"" + jsonEsc(subject.ownerHandle) + "\"}";
    }
    return json + "]";
}

static std::string resultPayload(const Request& request,
                                 const std::vector<Subject>& subjects,
                                 size_t changed,
                                 const char* status = "ok") {
    return "{\"token\":\"" + jsonEsc(request.token) +
           "\",\"action\":\"" + jsonEsc(request.action) +
           "\",\"target\":\"" + jsonEsc(request.exactTarget) +
           "\",\"status\":\"" + jsonEsc(status ? status : "") +
           "\",\"count\":" + std::to_string(subjects.size()) +
           ",\"changed\":" + std::to_string(changed) +
           ",\"subjects\":" + subjectsJson(subjects) + "}";
}

static bool parseRequest(const std::map<std::string, std::string>& params,
                         Request& request, std::string& error) {
    request.token = param(params, "token");
    request.action = param(params, "action");
    request.documentInstance = param(params, "documentInstance");
    request.activeDocumentInstance = param(params, "activeDocumentInstance");
    request.currentSpace = param(params, "currentSpace");
    request.spaceKnown = param(params, "spaceKnown") == "1";
    if (!boundedToken(request.token, "token", error) ||
        !boundedToken(request.documentInstance, "documentInstance", error) ||
        !boundedToken(
            request.activeDocumentInstance, "activeDocumentInstance", error) ||
        !parseRevision(
            param(params, "databaseRevision"),
            request.databaseRevision,
            error)) return false;
    if (request.action != "activate" && request.action != "capture" &&
        request.action != "resolve" && request.action != "select" &&
        request.action != "move") {
        error = "action must be activate|capture|resolve|select|move";
        return false;
    }
    return decodeTextHex(param(params, "exactTargetHex"), request.exactTarget,
                         "exactTargetHex", false, error);
}

static bool currentExactDocument(const Request& request, AcApDocument*& document,
                                 AcDbDatabase*& database, std::string& error) {
    document = nullptr;
    database = nullptr;
    if (!acDocManager) {
        error = "document manager is unavailable";
        return false;
    }
    AcApDocument* active = acDocManager->mdiActiveDocument();
    AcApDocument* current = acDocManager->curDocument();
    if (!active || active != current) {
        error = "exact target is not both active and current";
        return false;
    }
    const std::string title = toUtf8(active->docTitle());
    const std::string file = toUtf8(active->fileName());
    if (title != request.exactTarget && file != request.exactTarget) {
        error = "active/current document no longer matches exactTarget";
        return false;
    }
    database = active->database();
    if (!database) {
        error = "exact target has no database";
        return false;
    }
    if (acadDocumentInstanceToken(active) != request.documentInstance) {
        error = "document_stale: exact document instance changed";
        return false;
    }
    if (request.action != "activate" &&
        acadDocumentInstanceToken(active) != request.activeDocumentInstance) {
        error = "document_stale: active document changed";
        return false;
    }
    // Doi tab Model/Layout giua luc daemon kiem va luc lenh nay THAT SU chay.
    // Bo dem revision khong bat duoc: doi tab khong sua doi tuong nao, va quay
    // lai mot layout da kich hoat truoc do thi khong con gi de dung lai.  Day la
    // chot cuoi cung truoc khi cham vao ban ve.
    if (request.spaceKnown) {
        // Daemon CO gui, nhung chinh no khong doc duoc khong gian luc chuan bi.
        if (request.currentSpace.empty()) {
            error = "space_changed: prepared space was unreadable";
            return false;
        }
        const std::string space = currentSpaceName(database);
        // Rong o day KHONG phai "daemon ban cu" — daemon CO gui, nghia la no doi
        // duoc kiem.  Rong nghia la khong mo duoc BTR cua khong gian hien hanh,
        // tuc khong biet minh dang o dau.  Fail-OPEN luc do la cho mot lenh ghi
        // chay ma khong ai biet no cham vao khong gian nao.
        if (space.empty()) {
            error = "space_changed: cannot read current space";
            return false;
        }
        if (space != request.currentSpace) {
            error = "space_changed: current space is " + space + ", prepared for "
                  + request.currentSpace;
            return false;
        }
    }
    // Revision xet SAU khong gian: doi tab thuong keo revision nhay theo
    // (AutoCAD dung lai viewport), nen de no chay truoc la bao "noi dung ban ve
    // da thay doi" cho mot cu bam sang tab khac.  Ca hai deu tu choi, nen thu tu
    // khong doi tinh an toan — no doi CAU TRA LOI.
    if (acadDatabaseRevision(database) != request.databaseRevision) {
        error = "drawing_stale: database revision changed";
        return false;
    }
    document = active;
    return true;
}

static bool subjectsFromIds(AcDbDatabase* database,
                            const std::vector<AcDbObjectId>& ids,
                            std::vector<Subject>& subjects,
                            std::string& error) {
    subjects.clear();
    if (ids.size() > kMaxSubjects) {
        error = "selection_too_large";
        return false;
    }
    std::set<std::string> unique;
    subjects.reserve(ids.size());
    for (AcDbObjectId id : ids) {
        if (id.isNull() || id.database() != database || id.isErased() ||
            id.isEffectivelyErased()) {
            error = "selection contains a stale object id";
            subjects.clear();
            return false;
        }
        AcDbEntity* entity = nullptr;
        const Acad::ErrorStatus status =
            acdbOpenObject(entity, id, AcDb::kForRead);
        if (status != Acad::eOk || !entity) {
            error = "cannot open every selected entity";
            subjects.clear();
            return false;
        }
        Subject subject;
        const bool complete = subjectFromEntity(entity, subject, error);
        entity->close();
        if (!complete || !unique.insert(subject.handle).second) {
            if (complete) error = "selection contains duplicate handles";
            subjects.clear();
            return false;
        }
        subjects.push_back(subject);
    }
    return true;
}

static bool capturePickfirst(AcDbDatabase* database,
                             std::vector<Subject>& subjects,
                             std::string& error) {
    subjects.clear();
    ads_name selection;
    if (acedSSGet(L"_I", nullptr, nullptr, nullptr, selection) != RTNORM)
        return true; // No Pickfirst selection is a valid empty capture.

    Adesk::Int32 length = 0;
    if (acedSSLength(selection, &length) != RTNORM || length < 0) {
        acedSSFree(selection);
        error = "cannot read Pickfirst length";
        return false;
    }
    if (length > static_cast<Adesk::Int32>(kMaxSubjects)) {
        acedSSFree(selection);
        error = "selection_too_large";
        return false;
    }

    std::vector<AcDbObjectId> ids;
    ids.reserve(static_cast<size_t>(length));
    for (Adesk::Int32 index = 0; index < length; ++index) {
        ads_name entityName;
        AcDbObjectId id;
        if (acedSSName(selection, static_cast<int>(index), entityName) != RTNORM ||
            acdbGetObjectId(id, entityName) != Acad::eOk || id.isNull()) {
            acedSSFree(selection);
            error = "cannot resolve every Pickfirst member";
            return false;
        }
        ids.push_back(id);
    }
    acedSSFree(selection);
    return subjectsFromIds(database, ids, subjects, error);
}

static bool parseHandleList(const std::string& raw,
                            std::vector<std::string>& handles,
                            bool required, std::string& error) {
    handles.clear();
    if (raw.empty()) {
        if (required) error = "handles is required";
        return !required;
    }
    std::set<std::string> unique;
    for (const std::string& item : split(raw, ',')) {
        std::string handle;
        if (!normalizeHandle(item, handle, "handles", error)) return false;
        if (!unique.insert(handle).second) {
            error = "handles contains a duplicate";
            return false;
        }
        handles.push_back(handle);
        if (handles.size() > kMaxSubjects) {
            error = "selection_too_large";
            return false;
        }
    }
    return true;
}

static bool layerScopeId(AcDbDatabase* database,
                         const std::map<std::string, std::string>& params,
                         AcDbObjectId& layerId, std::string& error,
                         const char* nameField = "scopeNameHex",
                         const char* handleField = "scopeHandle") {
    std::string name;
    if (!decodeTextHex(param(params, nameField), name, nameField,
                       true, error)) return false;
    const std::string handleText = param(params, handleField);
    if (name.empty() && handleText.empty()) {
        error = "layer scope needs scopeNameHex or scopeHandle";
        return false;
    }

    if (!handleText.empty()) {
        std::string normalized;
        if (!resolveHandle(database, handleText, layerId, normalized, error))
            return false;
        AcDbLayerTableRecord* record = nullptr;
        if (acdbOpenObject(record, layerId, AcDb::kForRead) != Acad::eOk || !record) {
            error = "scopeHandle is not a layer";
            return false;
        }
        AcString actualName;
        const Acad::ErrorStatus nameStatus = record->getName(actualName);
        record->close();
        if (nameStatus != Acad::eOk ||
            (!name.empty() && toUtf8(actualName.kwszPtr()) != name)) {
            error = "layer scope name/handle precondition failed";
            return false;
        }
        return true;
    }

    AcDbLayerTable* table = nullptr;
    if (database->getLayerTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        error = "cannot open layer table";
        return false;
    }
    const Acad::ErrorStatus status = table->getAt(toWide(name).c_str(), layerId);
    table->close();
    if (status != Acad::eOk || layerId.isNull()) {
        error = "layer scope does not exist";
        return false;
    }
    return true;
}

static bool blockScopeId(AcDbDatabase* database,
                         const std::map<std::string, std::string>& params,
                         AcDbObjectId& blockId, std::string& error,
                         const char* nameField = "scopeNameHex",
                         const char* handleField = "scopeHandle") {
    std::string name;
    if (!decodeTextHex(param(params, nameField), name, nameField,
                       true, error)) return false;
    const std::string handleText = param(params, handleField);
    if (name.empty() && handleText.empty()) {
        error = "block scope needs scopeNameHex or scopeHandle";
        return false;
    }

    if (!handleText.empty()) {
        std::string normalized;
        if (!resolveHandle(database, handleText, blockId, normalized, error))
            return false;
        AcDbBlockTableRecord* record = nullptr;
        if (acdbOpenObject(record, blockId, AcDb::kForRead) != Acad::eOk || !record) {
            error = "scopeHandle is not a block definition";
            return false;
        }
        AcString actualName;
        const Acad::ErrorStatus nameStatus = record->getName(actualName);
        record->close();
        if (nameStatus != Acad::eOk ||
            (!name.empty() && toUtf8(actualName.kwszPtr()) != name)) {
            error = "block scope name/handle precondition failed";
            return false;
        }
        return true;
    }

    AcDbBlockTable* table = nullptr;
    if (database->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table) {
        error = "cannot open block table";
        return false;
    }
    const Acad::ErrorStatus status = table->getAt(toWide(name).c_str(), blockId);
    table->close();
    if (status != Acad::eOk || blockId.isNull()) {
        error = "block scope does not exist";
        return false;
    }
    return true;
}

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

static bool entityMatchesScope(AcDbEntity* entity, const std::string& scopeKind,
                               AcDbObjectId scopeId) {
    if (!entity || scopeId.isNull()) return false;
    if (scopeKind == "layer") return entity->layerId() == scopeId;
    AcDbBlockReference* reference = AcDbBlockReference::cast(entity);
    return scopeKind == "block" && reference &&
           effectiveBlockDefinition(reference) == scopeId;
}

static bool validateCompleteCatalogScope(
    AcDbObjectId currentSpaceId, const std::string& scopeKind,
    AcDbObjectId scopeId, const std::set<std::string>& requested,
    std::string& error) {
    AcDbBlockTableRecord* space = nullptr;
    if (acdbOpenObject(space, currentSpaceId, AcDb::kForRead) != Acad::eOk ||
        !space) {
        error = "catalog_scope_stale: cannot open current space";
        return false;
    }
    AcDbBlockTableRecordIterator* iterator = nullptr;
    if (space->newIterator(iterator) != Acad::eOk || !iterator) {
        space->close();
        error = "catalog_scope_stale: cannot iterate current space";
        return false;
    }

    std::set<std::string> current;
    for (; !iterator->done(); iterator->step()) {
        AcDbEntity* entity = nullptr;
        if (iterator->getEntity(entity, AcDb::kForRead) != Acad::eOk ||
            !entity) {
            delete iterator;
            space->close();
            error = "catalog_scope_stale: cannot verify every origin member";
            return false;
        }
        if (entityMatchesScope(entity, scopeKind, scopeId)) {
            const std::string handle = objectHandle(entity);
            if (handle.empty() || !current.insert(handle).second) {
                entity->close();
                delete iterator;
                space->close();
                error = "catalog_scope_stale: invalid origin handle set";
                return false;
            }
            if (current.size() > kMaxSubjects) {
                entity->close();
                delete iterator;
                space->close();
                error = "selection_too_large";
                return false;
            }
        }
        entity->close();
    }
    delete iterator;
    space->close();
    if (current != requested) {
        error = "catalog_scope_stale: complete origin handle set changed";
        return false;
    }
    return true;
}

static bool resolveScope(AcDbDatabase* database,
                         const std::map<std::string, std::string>& params,
                         std::vector<AcDbObjectId>& ids,
                         std::vector<Subject>& subjects, std::string& error) {
    const std::string scopeKind = param(params, "scopeKind");
    const AcDbObjectId currentSpaceId = database->currentSpaceId();
    if (currentSpaceId.isNull()) {
        error = "current space is unavailable";
        return false;
    }

    ids.clear();
    if (scopeKind == "handles") {
        std::vector<std::string> handles;
        if (!parseHandleList(param(params, "handles"), handles, true, error))
            return false;
        const std::string catalogScopeKind = param(params, "catalogScopeKind");
        const std::string catalogSelectedAll =
            param(params, "catalogScopeSelectedAll");
        const bool hasCatalogScope = !catalogScopeKind.empty();
        if (!hasCatalogScope &&
            (!param(params, "catalogScopeNameHex").empty() ||
             !param(params, "catalogScopeHandle").empty() ||
             !catalogSelectedAll.empty())) {
            error = "catalog scope is incomplete";
            return false;
        }
        if (hasCatalogScope && catalogScopeKind != "layer" &&
            catalogScopeKind != "block") {
            error = "catalogScopeKind must be layer|block";
            return false;
        }
        if (hasCatalogScope && catalogSelectedAll != "0" &&
            catalogSelectedAll != "1") {
            error = "catalogScopeSelectedAll must be 0|1";
            return false;
        }
        AcDbObjectId catalogScopeId;
        if (catalogScopeKind == "layer") {
            if (!layerScopeId(
                    database, params, catalogScopeId, error,
                    "catalogScopeNameHex", "catalogScopeHandle")) return false;
        } else if (catalogScopeKind == "block" &&
                   !blockScopeId(
                       database, params, catalogScopeId, error,
                       "catalogScopeNameHex", "catalogScopeHandle")) {
            return false;
        }

        std::set<std::string> requested;
        ids.reserve(handles.size());
        for (const std::string& handle : handles) {
            AcDbObjectId id;
            std::string normalized;
            if (!resolveHandle(database, handle, id, normalized, error))
                return false;
            AcDbEntity* entity = nullptr;
            if (acdbOpenObject(entity, id, AcDb::kForRead) != Acad::eOk ||
                !entity) {
                error = "exact handle is not an entity: " + normalized;
                return false;
            }
            const bool inCurrentSpace = entity->ownerId() == currentSpaceId;
            const bool inCatalogScope = !hasCatalogScope ||
                entityMatchesScope(entity, catalogScopeKind, catalogScopeId);
            entity->close();
            if (!inCurrentSpace) {
                error = "exact handle is not a top-level entity in current space: " +
                        normalized;
                return false;
            }
            if (!inCatalogScope) {
                error = "catalog_scope_stale: exact handle left its origin: " +
                        normalized;
                return false;
            }
            ids.push_back(id);
            requested.insert(normalized);
        }
        if (hasCatalogScope && catalogSelectedAll == "1" &&
            !validateCompleteCatalogScope(
                currentSpaceId, catalogScopeKind, catalogScopeId,
                requested, error)) {
            return false;
        }
    } else if (scopeKind == "layer" || scopeKind == "block") {
        AcDbObjectId scopeId;
        if (scopeKind == "layer") {
            if (!layerScopeId(database, params, scopeId, error)) return false;
        } else if (!blockScopeId(database, params, scopeId, error)) {
            return false;
        }

        AcDbBlockTableRecord* space = nullptr;
        if (acdbOpenObject(space, currentSpaceId, AcDb::kForRead) != Acad::eOk ||
            !space) {
            error = "cannot open current space";
            return false;
        }
        AcDbBlockTableRecordIterator* iterator = nullptr;
        if (space->newIterator(iterator) != Acad::eOk || !iterator) {
            space->close();
            error = "cannot iterate current space";
            return false;
        }
        for (; !iterator->done(); iterator->step()) {
            AcDbEntity* entity = nullptr;
            if (iterator->getEntity(entity, AcDb::kForRead) != Acad::eOk ||
                !entity) {
                continue;
            }
            const bool matches = entityMatchesScope(entity, scopeKind, scopeId);
            if (matches) ids.push_back(entity->objectId());
            entity->close();
            if (ids.size() > kMaxSubjects) {
                delete iterator;
                space->close();
                error = "selection_too_large";
                return false;
            }
        }
        delete iterator;
        space->close();
    } else {
        error = "scopeKind must be layer|block|handles";
        return false;
    }

    if (ids.empty()) {
        error = "no_matching_objects";
        return false;
    }
    return subjectsFromIds(database, ids, subjects, error);
}

static bool setPickfirst(const std::vector<AcDbObjectId>& ids,
                         std::string& error) {
    ads_name selection;
    if (acedSSAdd(nullptr, nullptr, selection) != RTNORM) {
        error = "cannot allocate Pickfirst selection";
        return false;
    }
    for (AcDbObjectId id : ids) {
        ads_name entityName;
        if (acdbGetAdsName(entityName, id) != Acad::eOk ||
            acedSSAdd(entityName, selection, selection) != RTNORM) {
            acedSSFree(selection);
            error = "cannot build complete Pickfirst selection";
            return false;
        }
    }
    if (acedSSSetFirst(selection, nullptr) != RTNORM) {
        acedSSFree(selection);
        error = "cannot set Pickfirst selection";
        return false;
    }
    acedSSFree(selection);
    acedUpdateDisplay();
    return true;
}

static bool parseExpected(const std::string& raw, const char* field,
                          bool allowEmpty,
                          std::map<std::string, ExpectedSubject>& expected,
                          std::string& error) {
    expected.clear();
    if (raw.empty()) {
        if (allowEmpty) return true;
        error = std::string(field) + " is required";
        return false;
    }
    if (raw.size() > 2 * 1024 * 1024) {
        error = std::string(field) + " is too large";
        return false;
    }
    for (const std::string& row : split(raw, ';')) {
        const std::vector<std::string> fields = split(row, ',');
        if (fields.size() != 4) {
            error = "expected row must be handle,typeHex,layerHandle,ownerHandle";
            return false;
        }
        ExpectedSubject item;
        if (!normalizeHandle(fields[0], item.handle, "expected.handle", error) ||
            !decodeTextHex(fields[1], item.type, "expected.typeHex", false, error) ||
            !normalizeHandle(fields[2], item.layerHandle,
                             "expected.layerHandle", error) ||
            !normalizeHandle(fields[3], item.ownerHandle,
                             "expected.ownerHandle", error)) {
            return false;
        }
        if (!expected.emplace(item.handle, item).second) {
            error = "expected contains a duplicate handle";
            return false;
        }
        if (expected.size() > kMaxSubjects) {
            error = "selection_too_large";
            return false;
        }
    }
    return true;
}

static bool parseExpectedCount(const std::string& raw, size_t& count,
                               std::string& error) {
    if (raw.empty() || raw.size() > 5) {
        error = "expectedSelectionCount is required";
        return false;
    }
    count = 0;
    for (char digit : raw) {
        if (digit < '0' || digit > '9') {
            error = "expectedSelectionCount must be an unsigned integer";
            return false;
        }
        count = count * 10 + static_cast<size_t>(digit - '0');
        if (count > kMaxSubjects) {
            error = "selection_too_large";
            return false;
        }
    }
    return true;
}

static bool sameHandleSet(const std::vector<Subject>& current,
                          const std::map<std::string, ExpectedSubject>& expected) {
    if (current.size() != expected.size()) return false;
    for (const Subject& subject : current) {
        if (expected.find(subject.handle) == expected.end()) return false;
    }
    return true;
}

static bool validateExpectedSubject(
    const Subject& current,
    const std::map<std::string, ExpectedSubject>& expected,
    std::string& error) {
    const auto found = expected.find(current.handle);
    if (found == expected.end()) {
        error = "selection_stale: Pickfirst handle set changed";
        return false;
    }
    const ExpectedSubject& item = found->second;
    if (current.type != item.type ||
        current.layerHandle != item.layerHandle ||
        current.ownerHandle != item.ownerHandle) {
        error = "selection_stale: subject precondition changed for " +
                current.handle;
        return false;
    }
    return true;
}

static bool validateSubjects(
    const std::vector<Subject>& current,
    const std::map<std::string, ExpectedSubject>& expected,
    const char* setError,
    std::string& error) {
    if (!sameHandleSet(current, expected)) {
        error = setError;
        return false;
    }
    for (const Subject& subject : current) {
        if (!validateExpectedSubject(subject, expected, error)) return false;
    }
    return true;
}

static bool selectScope(AcDbDatabase* database,
                        const std::map<std::string, std::string>& params,
                        std::vector<Subject>& subjects, std::string& error) {
    std::map<std::string, ExpectedSubject> expectedSubjects;
    if (!parseExpected(
            param(params, "expected"), "expected", false,
            expectedSubjects, error)) return false;

    std::map<std::string, ExpectedSubject> expectedSelection;
    if (!parseExpected(
            param(params, "expectedSelection"), "expectedSelection", true,
            expectedSelection, error)) return false;
    size_t expectedSelectionCount = 0;
    if (!parseExpectedCount(
            param(params, "expectedSelectionCount"),
            expectedSelectionCount,
            error)) return false;
    if (expectedSelection.size() != expectedSelectionCount) {
        error = "expectedSelection count differs from payload";
        return false;
    }

    std::vector<Subject> currentSelection;
    if (!capturePickfirst(database, currentSelection, error)) return false;
    if (!validateSubjects(
            currentSelection, expectedSelection,
            "selection_stale: current Pickfirst set differs from proposal",
            error)) return false;

    std::vector<AcDbObjectId> ids;
    if (!resolveScope(database, params, ids, subjects, error)) return false;
    if (!validateSubjects(
            subjects, expectedSubjects,
            "selection_stale: resolved scope differs from proposal",
            error)) return false;
    return setPickfirst(ids, error);
}

static bool destinationLayer(AcDbDatabase* database,
                             const std::map<std::string, std::string>& params,
                             AcDbObjectId& layerId, std::string& layerName,
                             std::string& error) {
    if (!decodeTextHex(param(params, "destLayerHex"), layerName,
                       "destLayerHex", false, error)) {
        return false;
    }
    const std::string handleText = param(params, "destLayerHandle");
    if (!handleText.empty()) {
        std::string normalized;
        if (!resolveHandle(database, handleText, layerId, normalized, error))
            return false;
    } else {
        AcDbLayerTable* table = nullptr;
        if (database->getLayerTable(table, AcDb::kForRead) != Acad::eOk ||
            !table) {
            error = "cannot open destination layer table";
            return false;
        }
        const Acad::ErrorStatus status =
            table->getAt(toWide(layerName).c_str(), layerId);
        table->close();
        if (status != Acad::eOk || layerId.isNull() ||
            layerId.database() != database || layerId.isErased() ||
            layerId.isEffectivelyErased()) {
            error = "destination layer does not exist";
            return false;
        }
    }
    AcDbLayerTableRecord* record = nullptr;
    if (acdbOpenObject(record, layerId, AcDb::kForRead) != Acad::eOk || !record) {
        error = handleText.empty()
            ? "destination layer is unavailable"
            : "destLayerHandle is not a layer";
        return false;
    }
    AcString actualName;
    const Acad::ErrorStatus nameStatus = record->getName(actualName);
    const bool locked = record->isLocked();
    const bool frozen = record->isFrozen();
    const bool off = record->isOff();
    record->close();
    if (nameStatus != Acad::eOk) {
        error = "cannot read destination layer";
        return false;
    }
    const std::string actualLayerName = toUtf8(actualName.kwszPtr());
    if (!handleText.empty() && actualLayerName != layerName) {
        error = "destination layer name/handle precondition failed";
        return false;
    }
    if (locked) {
        error = "destination_layer_locked";
        return false;
    }
    if (frozen) {
        error = "destination_layer_frozen";
        return false;
    }
    if (off) {
        error = "destination_layer_off";
        return false;
    }
    layerName = actualLayerName;
    return true;
}

static bool validateSourceLayers(
    AcDbDatabase* database, const std::vector<Subject>& subjects,
    std::string& error) {
    std::set<std::string> checked;
    for (const Subject& subject : subjects) {
        if (!checked.insert(subject.layerHandle).second) continue;
        AcDbObjectId layerId;
        std::string normalized;
        if (!resolveHandle(
                database, subject.layerHandle, layerId, normalized, error)) {
            return false;
        }
        AcDbLayerTableRecord* layer = nullptr;
        if (acdbOpenObject(layer, layerId, AcDb::kForRead) != Acad::eOk ||
            !layer) {
            error = "source layer is unavailable: " + normalized;
            return false;
        }
        const bool locked = layer->isLocked();
        const bool frozen = layer->isFrozen();
        const bool off = layer->isOff();
        layer->close();
        if (locked) {
            error = "source_layer_locked:" + normalized;
            return false;
        }
        if (frozen) {
            error = "source_layer_frozen:" + normalized;
            return false;
        }
        if (off) {
            error = "source_layer_off:" + normalized;
            return false;
        }
    }
    return true;
}

static bool moveSelection(AcDbDatabase* database,
                          const std::map<std::string, std::string>& params,
                          std::vector<Subject>& subjects, size_t& changed,
                          std::string& error) {
    changed = 0;
    std::map<std::string, ExpectedSubject> expected;
    if (!parseExpected(
            param(params, "expected"), "expected", false,
            expected, error)) return false;

    std::vector<std::string> requestedHandles;
    if (!parseHandleList(param(params, "handles"), requestedHandles, true, error))
        return false;
    if (requestedHandles.size() != expected.size()) {
        error = "handles and expected differ";
        return false;
    }
    for (const std::string& handle : requestedHandles) {
        if (expected.find(handle) == expected.end()) {
            error = "handles and expected differ";
            return false;
        }
    }

    if (!capturePickfirst(database, subjects, error)) return false;
    if (!sameHandleSet(subjects, expected)) {
        error = "selection_stale: current Pickfirst set differs from proposal";
        return false;
    }
    for (const Subject& subject : subjects) {
        if (!validateExpectedSubject(subject, expected, error)) return false;
    }

    AcDbObjectId destinationId;
    std::string destinationName;
    if (!destinationLayer(database, params, destinationId, destinationName, error))
        return false;
    if (!validateSourceLayers(database, subjects, error)) return false;

    const std::string destinationHandle = objectIdHandle(destinationId);
    bool needsChange = false;
    for (const Subject& subject : subjects) {
        if (subject.layerHandle != destinationHandle) {
            needsChange = true;
            break;
        }
    }
    if (!needsChange) return true;

    AcDbTransactionManager* manager = database->transactionManager();
    if (!manager || !manager->startTransaction()) {
        error = "cannot start move transaction";
        return false;
    }
    auto abort = [&]() {
        manager->abortTransaction();
    };

    std::vector<AcDbEntity*> writable;
    writable.reserve(subjects.size());
    for (const Subject& prior : subjects) {
        AcDbObjectId id;
        std::string normalized;
        if (!resolveHandle(database, prior.handle, id, normalized, error)) {
            abort();
            return false;
        }
        AcDbEntity* entity = nullptr;
        const Acad::ErrorStatus openStatus =
            manager->getObject(entity, id, AcDb::kForWrite);
        if (openStatus != Acad::eOk || !entity) {
            abort();
            error = "cannot open every proposed entity for write";
            return false;
        }
        Subject current;
        if (!subjectFromEntity(entity, current, error) ||
            !validateExpectedSubject(current, expected, error)) {
            abort();
            return false;
        }
        writable.push_back(entity);
    }

    for (AcDbEntity* entity : writable) {
        if (entity->layerId() != destinationId) changed++;
        const Acad::ErrorStatus status =
            entity->setLayer(destinationId, Adesk::kFalse, false);
        if (status != Acad::eOk) {
            abort();
            changed = 0;
            error = "setLayer failed; transaction aborted (" +
                    std::to_string(static_cast<int>(status)) + ")";
            return false;
        }
    }
    manager->queueForGraphicsFlush();
    const Acad::ErrorStatus endStatus = manager->endTransaction();
    if (endStatus != Acad::eOk) {
        manager->abortTransaction();
        changed = 0;
        error = "cannot commit move transaction";
        return false;
    }

    for (Subject& subject : subjects) {
        subject.layer = destinationName;
        subject.layerHandle = destinationHandle;
    }
    acedUpdateDisplay();
    return true;
}

} // namespace

bool acadSelectionControlRequestInfo(
    const std::map<std::string, std::string>& params,
    std::string& token, std::string& action, std::string& exactTarget,
    std::string& error) {
    Request request;
    const bool ok = parseRequest(params, request, error);
    token = request.token;
    action = request.action;
    exactTarget = request.exactTarget;
    return ok;
}

bool acadSelectionControlRun(
    const std::map<std::string, std::string>& params,
    std::string& payload, std::string& error) {
    Request request;
    if (!parseRequest(params, request, error)) {
        payload = "{\"token\":\"" + jsonEsc(request.token) +
                  "\",\"action\":\"" + jsonEsc(request.action) +
                  "\",\"status\":\"error\"}";
        return false;
    }
    payload = resultPayload(request, {}, 0, "error");

    AcApDocument* document = nullptr;
    AcDbDatabase* database = nullptr;
    if (!currentExactDocument(request, document, database, error)) return false;

    std::vector<Subject> subjects;
    size_t changed = 0;
    bool ok = false;
    if (request.action == "activate") {
        ok = true; // Scheduling activated it; exact active/current was rechecked above.
    } else if (request.action == "capture") {
        ok = capturePickfirst(database, subjects, error);
    } else if (request.action == "resolve") {
        std::vector<AcDbObjectId> ids;
        ok = resolveScope(database, params, ids, subjects, error);
    } else if (request.action == "select") {
        ok = selectScope(database, params, subjects, error);
    } else if (document->isReadOnly()) {
        error = "exact target is read-only";
    } else {
        ok = moveSelection(database, params, subjects, changed, error);
    }
    payload = resultPayload(
        request, subjects, changed,
        ok && request.action == "move" && changed == 0
            ? "no_change" : (ok ? "ok" : "error"));
    return ok;
}
