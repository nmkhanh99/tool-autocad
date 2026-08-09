#pragma once

// Registers the shared per-document Save-only tracker. Registration is safe to
// call once from either platform entrypoint; unregister detaches database
// reactors while each document/database is still alive.
void cadWebRegisterSaveSync();
void cadWebUnregisterSaveSync();

// Read-only diagnostics for the current document.
void cadWebPrintSyncStatus();
