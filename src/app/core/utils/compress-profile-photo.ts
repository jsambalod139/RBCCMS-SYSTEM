export async function compressProfilePhoto(
  file: File
): Promise<File> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(
      file.type
    )
  ) {
    throw new Error('Choose a JPG, PNG, or WEBP image.');
  }

  if (!file.size || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose an image no larger than 5 MB.');
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
  } catch {
    throw new Error(
      'This image could not be opened. Choose another photo.'
    );
  }

  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 24000000
    ) {
      throw new Error(
        'Choose an image smaller than 24 megapixels.'
      );
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error(
        'Your browser could not prepare the photo.'
      );
    }

    const crop = Math.min(bitmap.width, bitmap.height);
    let edge = Math.min(512, crop);

    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = edge;
      canvas.height = edge;

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, edge, edge);

      context.drawImage(
        bitmap,
        (bitmap.width - crop) / 2,
        (bitmap.height - crop) / 2,
        crop,
        crop,
        0,
        0,
        edge,
        edge
      );

      for (const quality of [0.82, 0.7, 0.58]) {
        const blob = await new Promise<Blob | null>(
          resolve => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
          }
        );

        if (
          blob?.size &&
          blob.type === 'image/jpeg' &&
          blob.size <= 200 * 1024
        ) {
          return new File([blob], 'profile.jpg', {
            type: 'image/jpeg',
          });
        }
      }

      edge = Math.max(1, Math.floor(edge * 0.75));
    }

    throw new Error(
      'This photo could not be compressed. Choose another image.'
    );
  } finally {
    bitmap.close();
  }
}