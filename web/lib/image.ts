// Shrink phone photos before upload: a 12 MP photo becomes ~400 KB at 2000 px, which uploads
// quickly on museum Wi-Fi and is still sharp enough for an engineer. Videos and PDFs pass through.

const MAX_EDGE = 2000;

export async function prepareForUpload(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return { blob: file, name: file.name };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    // Some formats (for example HEIC outside Safari) cannot be decoded here: send the original.
    return { blob: file, name: file.name };
  }
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
