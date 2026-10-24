const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 500 * 1024;
const MAX_PIXELS = 24_000_000;

export async function compressConcernPhoto(
  file: File
): Promise<File> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  ) {
    throw new Error(
      'Please select a JPG, PNG, or WebP image.'
    );
  }

  if (
    !file.size ||
    file.size > MAX_INPUT_BYTES
  ) {
    throw new Error(
      'The original image must be no larger than 5 MB.'
    );
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image'
    });
  } catch {
    throw new Error(
      'This image cannot be opened. Please choose another photo.'
    );
  }

  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > MAX_PIXELS
    ) {
      throw new Error(
        'Please choose an image with no more than 24 megapixels.'
      );
    }

    const scale = Math.min(
      1,
      1600 / Math.max(bitmap.width, bitmap.height)
    );

    let width = Math.max(
      1,
      Math.round(bitmap.width * scale)
    );

    let height = Math.max(
      1,
      Math.round(bitmap.height * scale)
    );

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error(
        'Your browser cannot process this photo.'
      );
    }

    let quality = 0.82;
    let blob: Blob | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = width;
      canvas.height = height;

      // JPEG has no transparency, so use a white background.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      context.drawImage(
        bitmap,
        0,
        0,
        width,
        height
      );

      blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(
          resolve,
          'image/jpeg',
          quality
        );
      });

      if (!blob) {
        throw new Error(
          'Unable to compress the photo. Please choose another image.'
        );
      }

      if (blob.size <= TARGET_BYTES) {
        break;
      }

      if (quality > 0.62) {
        quality = Math.max(
          0.62,
          quality - 0.1
        );
      } else {
        width = Math.max(
          1,
          Math.round(width * 0.8)
        );

        height = Math.max(
          1,
          Math.round(height * 0.8)
        );
      }
    }

    if (!blob || blob.size > TARGET_BYTES) {
      throw new Error(
        'Please choose a smaller photo. This image could not be compressed enough.'
      );
    }

    const name =
      file.name.replace(/\.[^.]+$/, '') || 'concern';

    return new File(
      [blob],
      `${name}.jpg`,
      {
        type: 'image/jpeg',
        lastModified: Date.now()
      }
    );
  } finally {
    bitmap.close();
  }
}