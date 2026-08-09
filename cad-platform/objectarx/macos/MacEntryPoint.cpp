#include "windef.h"
#include <aced.h>
#include <acutads.h>
#include <rxregsvc.h>

#include "CadWebCommands.h"
#include "CadWebSaveReactor.h"

extern "C" __attribute__((visibility("default"))) AcRx::AppRetCode
acrxEntryPoint(AcRx::AppMsgCode message, void* applicationId) {
  switch (message) {
    case AcRx::kInitAppMsg:
      acrxDynamicLinker->unlockApplication(applicationId);
      acrxRegisterAppMDIAware(applicationId);
      cadWebRegisterSaveSync();
      cadWebRegisterCommands();
      acutPrintf(L"\n[CadWeb 0.1.0] Loaded. Commands: CADWEBEXPORT / "
                 L"CADWEBEXPORTSELECTED / CADWEBSETTINGS / "
                 L"CADWEBSYNCSTATUS.");
      break;
    case AcRx::kUnloadAppMsg:
      cadWebUnregisterCommands();
      cadWebUnregisterSaveSync();
      break;
    default:
      break;
  }
  return AcRx::kRetOK;
}
