// Shared CadWeb export commands for the platform-specific ObjectARX modules.

#include "cadweb/CadWebWriter.h"
#include "CadWebAcDbAdapter.h"
#include "CadWebCommands.h"
#include "CadWebSaveReactor.h"

// AutoCAD's Mac headers expose HWND in acedads.h for source compatibility.
#include "windef.h"
#include <AcString.h>
#include <accmd.h>
#include <acdlflagbits.h>
#include <acdocman.h>
#include <acedads.h>
#include <adscodes.h>
#include <acutads.h>
#include <dbmain.h>

#include <filesystem>
#include <stdexcept>
#include <string>
#include <system_error>
#include <vector>

namespace {

constexpr const ACHAR* kCommandGroup = L"CADWEB_EXPORTER";

bool currentDocument(AcApDocument*& document, AcDbDatabase*& database) {
  document = nullptr;
  database = nullptr;
  if (!acDocManager) {
    acutPrintf(L"\n[CadWeb] Document manager is unavailable.");
    return false;
  }
  AcApDocument* active = acDocManager->mdiActiveDocument();
  AcApDocument* current = acDocManager->curDocument();
  if (!active || active != current || !active->database()) {
    acutPrintf(L"\n[CadWeb] The drawing must be both active and current.");
    return false;
  }
  document = active;
  database = active->database();
  return true;
}

std::filesystem::path defaultOutputPath(AcApDocument* document) {
  std::filesystem::path output;
  if (document && document->fileName() && *document->fileName())
    output = std::filesystem::path(document->fileName());
  if (output.empty()) output = std::filesystem::path(L"drawing.dwg");
  output.replace_extension(L".cadweb");
  std::error_code pathError;
  if (std::filesystem::exists(output, pathError) && !pathError) {
    const std::filesystem::path parent = output.parent_path();
    const std::filesystem::path stem = output.stem();
    for (unsigned suffix = 1; suffix < 10'000; ++suffix) {
      const std::filesystem::path candidate =
          parent / (stem.wstring() + L"-" + std::to_wstring(suffix) +
                    L".cadweb");
      pathError.clear();
      if (!std::filesystem::exists(candidate, pathError) && !pathError)
        return candidate;
    }
  }
  return output;
}

bool chooseOutputPath(AcApDocument* document, std::filesystem::path& output) {
  const std::filesystem::path suggested = defaultOutputPath(document);
  const std::wstring suggestedText = suggested.wstring();
  resbuf* result = acutNewRb(RTSTR);
  if (!result) {
    acutPrintf(L"\n[CadWeb] Cannot allocate the save-file result.");
    return false;
  }
  const int status = acedGetFileD(
      L"Export CadWeb archive", suggestedText.c_str(), L"cadweb",
      kDLFPut | kDLFFrcWarn | kDLFNoURLs, result);
  if (status != RTNORM || !result->resval.rstring || !*result->resval.rstring) {
    acutRelRb(result);
    return false;
  }
  output = std::filesystem::path(result->resval.rstring);
  acutRelRb(result);
  if (output.extension() != L".cadweb") output += L".cadweb";
  std::error_code pathError;
  if (std::filesystem::exists(output, pathError) && !pathError) {
    acutPrintf(L"\n[CadWeb] Existing archives are not overwritten."
               L" Choose a new file name.");
    return false;
  }
  if (pathError) {
    acutPrintf(L"\n[CadWeb] Cannot inspect the selected output path.");
    return false;
  }
  return true;
}

bool selectionIds(AcDbDatabase* database, std::vector<AcDbObjectId>& ids) {
  ids.clear();
  ads_name selection;
  int status = acedSSGet(L"_I", nullptr, nullptr, nullptr, selection);
  if (status != RTNORM) {
    acutPrintf(L"\nSelect entities to export: ");
    status = acedSSGet(nullptr, nullptr, nullptr, nullptr, selection);
  }
  if (status != RTNORM) return false;

  Adesk::Int32 length = 0;
  if (acedSSLength(selection, &length) != RTNORM || length <= 0) {
    acedSSFree(selection);
    acutPrintf(L"\n[CadWeb] No entities were selected.");
    return false;
  }
  ids.reserve(static_cast<std::size_t>(length));
  for (Adesk::Int32 index = 0; index < length; ++index) {
    ads_name name;
    AcDbObjectId id;
    if (acedSSName(selection, static_cast<int>(index), name) != RTNORM ||
        acdbGetObjectId(id, name) != Acad::eOk || id.isNull() ||
        id.database() != database || id.isErased() || id.isEffectivelyErased()) {
      acedSSFree(selection);
      ids.clear();
      acutPrintf(L"\n[CadWeb] The selection contains a stale or foreign entity.");
      return false;
    }
    ids.push_back(id);
  }
  acedSSFree(selection);
  return true;
}

void printFailure(const std::exception& exception) {
  const AcString message(exception.what(), AcString::Utf8);
  acutPrintf(L"\n[CadWeb] Export failed: %ls", message.kwszPtr());
}

void exportDrawing(bool selectedOnly) {
  AcApDocument* document = nullptr;
  AcDbDatabase* database = nullptr;
  if (!currentDocument(document, database)) return;

  cadweb::objectarx::SnapshotOptions options;
  options.selectedOnly = selectedOnly;
  if (selectedOnly && !selectionIds(database, options.selectedIds)) return;

  std::filesystem::path output;
  if (!chooseOutputPath(document, output)) {
    acutPrintf(L"\n[CadWeb] Export cancelled.");
    return;
  }

  try {
    // The command is registered with DOCREADLOCK. snapshotDatabase closes all
    // AcDb objects before the portable writer starts serializing.
    cadweb::CadDocument snapshot =
        cadweb::objectarx::snapshotDatabase(database, options);
    const std::size_t entityCount = snapshot.entities.size();
    const std::size_t blockCount = snapshot.blocks.size();
    const std::size_t issueCount = snapshot.unsupportedEntities.size() +
                                   snapshot.failedEntities.size() +
                                   snapshot.warnings.size() +
                                   snapshot.omittedSpaces.size();
    cadweb::CadWebWriter{}.writeAtomically(snapshot, output);
    const std::wstring outputText = output.wstring();
    acutPrintf(L"\n[CadWeb] Exported %llu entities, %llu blocks, %llu issues."
               L"\n[CadWeb] %ls",
               static_cast<unsigned long long>(entityCount),
               static_cast<unsigned long long>(blockCount),
               static_cast<unsigned long long>(issueCount), outputText.c_str());
  } catch (const std::exception& exception) {
    printFailure(exception);
  }
}

void commandExport() {
  exportDrawing(false);
}

void commandExportSelected() {
  exportDrawing(true);
}

void commandSettings() {
  acutPrintf(
      L"\n[CadWeb] Contract 1.0 settings: WCS/Z-up, model space, doubles,"
      L" Xref=reference-only, blocks=definition+transform."
      L"\n[CadWeb] Settings are fixed for the version-1 compatibility profile.");
}

void commandSyncStatus() {
  cadWebPrintSyncStatus();
}

}  // namespace

void cadWebRegisterCommands() {
  const Adesk::Int32 readOnlyFlags =
      ACRX_CMD_MODAL | ACRX_CMD_DOCREADLOCK | ACRX_CMD_NOMULTIPLE;
  acedRegCmds->addCommand(kCommandGroup, L"CADWEBEXPORT", L"CADWEBEXPORT",
                          readOnlyFlags, &commandExport);
  acedRegCmds->addCommand(
      kCommandGroup, L"CADWEBEXPORTSELECTED", L"CADWEBEXPORTSELECTED",
      readOnlyFlags | ACRX_CMD_USEPICKSET, &commandExportSelected);
  acedRegCmds->addCommand(kCommandGroup, L"CADWEBSETTINGS", L"CADWEBSETTINGS",
                          readOnlyFlags, &commandSettings);
  acedRegCmds->addCommand(kCommandGroup, L"CADWEBSYNCSTATUS",
                          L"CADWEBSYNCSTATUS", readOnlyFlags,
                          &commandSyncStatus);
}

void cadWebUnregisterCommands() {
  acedRegCmds->removeGroup(kCommandGroup);
}
