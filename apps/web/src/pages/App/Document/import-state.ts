let pendingFile: File | null = null;

export function setPendingImportFile(file: File) {
  pendingFile = file;
}

export function consumePendingImportFile(): File | null {
  const f = pendingFile;
  pendingFile = null;
  return f;
}
