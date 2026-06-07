import Busboy from 'busboy';

export const allowedFaceImageTypes = new Set(['image/jpeg', 'image/jpg', 'image/png']);
export const maxFaceImageBytes = Number(process.env.FACE_SEARCH_MAX_UPLOAD_BYTES || 8 * 1024 * 1024);

export function isUuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateImage(buffer: Buffer, contentType: string) {
  if (!allowedFaceImageTypes.has(contentType.toLowerCase())) {
    throw Object.assign(new Error('Formato invalido. Envie uma imagem JPG ou PNG.'), { statusCode: 415 });
  }
  if (buffer.length === 0) {
    throw Object.assign(new Error('Imagem vazia ou nao enviada.'), { statusCode: 400 });
  }
  if (buffer.length > maxFaceImageBytes) {
    throw Object.assign(new Error(`Imagem excede o limite de ${Math.round(maxFaceImageBytes / 1024 / 1024)} MB.`), { statusCode: 413 });
  }
}

export async function readRequestBuffer(req: any) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxFaceImageBytes) {
      throw Object.assign(new Error('Imagem excede o limite permitido.'), { statusCode: 413 });
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function parseSelfieMultipart(req: any): Promise<{ eventId: string; buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let fileContentType = '';
    let size = 0;
    let fileCount = 0;
    const parser = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: maxFaceImageBytes, fields: 5 },
    });

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      fileCount += 1;
      if (name !== 'selfie') {
        stream.resume();
        return;
      }
      fileContentType = info.mimeType;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
      });
      stream.on('limit', () => reject(Object.assign(new Error('Selfie excede o limite permitido.'), { statusCode: 413 })));
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (fileCount === 0) {
        reject(Object.assign(new Error('Campo selfie nao enviado.'), { statusCode: 400 }));
        return;
      }
      resolve({ eventId: fields.eventId || '', buffer: Buffer.concat(chunks, size), contentType: fileContentType });
    });
    req.pipe(parser);
  });
}

export function faceError(error: any, fallback: string) {
  const name = String(error?.name || '');
  if (name === 'InvalidParameterException') {
    return { statusCode: 422, message: 'Nenhum rosto detectado na imagem enviada.' };
  }
  if (name === 'InvalidS3ObjectException' || name === 'InvalidImageFormatException') {
    return { statusCode: 422, message: 'A imagem esta corrompida ou nao pode ser processada.' };
  }
  if (name === 'AbortError' || /abort|timeout/i.test(String(error?.message || ''))) {
    return { statusCode: 504, message: 'A AWS excedeu o tempo limite de processamento.' };
  }
  const statusCode = Number(error?.statusCode || 500);
  return { statusCode: statusCode >= 400 && statusCode < 500 ? statusCode : 500, message: statusCode < 500 ? error.message : fallback };
}
