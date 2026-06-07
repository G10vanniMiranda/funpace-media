import { supabaseRequest } from '../_utils.js';

export type FaceRow = {
  face_id: string;
  image_id: string | null;
  event_id: string;
  photo_id: string;
  confidence: number | null;
};

export async function getAuthenticatedUser(req: any) {
  const token = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token) return null;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.ANON_KEY ||
    '';
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getOwnedPhoto(photoId: string, photographerId: string) {
  const rows = await supabaseRequest<any[]>(`/rest/v1/products?select=id,type,status,eventId,vendedorId&id=eq.${encodeURIComponent(photoId)}&vendedorId=eq.${encodeURIComponent(photographerId)}&limit=1`);
  return rows[0] || null;
}

export async function getEvent(eventId: string) {
  const rows = await supabaseRequest<any[]>(`/rest/v1/events?select=id,photographerId,isPublished&id=eq.${encodeURIComponent(eventId)}&limit=1`);
  return rows[0] || null;
}

export async function getPhotoFaces(photoId: string): Promise<FaceRow[]> {
  return supabaseRequest<FaceRow[]>(`/rest/v1/photo_faces?select=face_id,image_id,event_id,photo_id,confidence&photo_id=eq.${encodeURIComponent(photoId)}`);
}

export async function replacePhotoFaces(input: {
  photoId: string;
  eventId: string;
  faces: Array<{ faceId: string; imageId?: string; confidence?: number }>;
}) {
  await supabaseRequest(`/rest/v1/photo_faces?photo_id=eq.${encodeURIComponent(input.photoId)}`, { method: 'DELETE' });
  if (input.faces.length > 0) {
    await supabaseRequest('/rest/v1/photo_faces', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(input.faces.map((face) => ({
        face_id: face.faceId,
        image_id: face.imageId || null,
        event_id: input.eventId,
        photo_id: input.photoId,
        confidence: face.confidence ?? null,
      }))),
    });
  }
}

export async function updatePhotoFaceStatus(photoId: string, status: string, error?: string) {
  await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(photoId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ faceIndexStatus: status, faceIndexError: error?.slice(0, 1000) || null, faceIndexedAt: status === 'indexed' ? new Date().toISOString() : null }),
  });
}

export async function getMatchesByEvent(eventId: string, matches: Array<{ faceId: string; similarity: number }>) {
  if (matches.length === 0) return [];
  const ids = matches.map((match) => `"${match.faceId}"`).join(',');
  const rows = await supabaseRequest<FaceRow[]>(`/rest/v1/photo_faces?select=face_id,image_id,event_id,photo_id,confidence&event_id=eq.${encodeURIComponent(eventId)}&face_id=in.(${encodeURIComponent(ids)})`);
  const similarityByFace = new Map(matches.map((match) => [match.faceId, match.similarity]));
  const bestByPhoto = new Map<string, { photoId: string; similarity: number }>();
  for (const row of rows) {
    const similarity = similarityByFace.get(row.face_id) || 0;
    if (similarity > (bestByPhoto.get(row.photo_id)?.similarity || 0)) {
      bestByPhoto.set(row.photo_id, { photoId: row.photo_id, similarity });
    }
  }
  if (bestByPhoto.size === 0) return [];
  const photoIds = [...bestByPhoto.keys()].map((id) => `"${id}"`).join(',');
  const products = await supabaseRequest<any[]>(`/rest/v1/products?select=*&status=eq.published&id=in.(${encodeURIComponent(photoIds)})`);
  return products
    .map((product) => ({ product, similarity: bestByPhoto.get(product.id)?.similarity || 0 }))
    .sort((a, b) => b.similarity - a.similarity);
}
