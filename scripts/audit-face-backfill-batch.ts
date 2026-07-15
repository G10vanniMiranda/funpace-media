import 'dotenv/config';
import pg from 'pg';
import { ListFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';

const values = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const from = values.get('from');
const to = values.get('to');
const expected = Number(values.get('expected') || 0);
const allIndexed = values.get('all-indexed') === 'true';
if (!allIndexed && (!from || !to || !expected)) throw new Error('Use --from=ISO --to=ISO --expected=N or --all-indexed=true.');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const collectionId = String(process.env.AWS_REKOGNITION_COLLECTION || '');

async function main() {
  const products = await pool.query(allIndexed ? `
    select id, "eventId", "vendedorId", "faceIndexStatus", "faceIndexAttempts", "faceIndexRunId", "faceProcessedAt"
    from public.products order by id
  ` : `
    select id, "eventId", "vendedorId", "faceIndexStatus", "faceIndexAttempts", "faceIndexRunId", "faceProcessedAt"
    from public.products
    where "faceProcessedAt" >= $1::timestamptz and "faceProcessedAt" < $2::timestamptz
    order by id
  `, allIndexed ? [] : [from, to]);
  const ids = products.rows.map((row) => row.id);
  if (!allIndexed && ids.length !== expected) throw new Error(`Expected ${expected} batch rows, found ${ids.length}.`);
  const faces = await pool.query(allIndexed ? `
    select face_id, photo_id, event_id, photographer_id
    from public.photo_faces order by face_id
  ` : `
    select face_id, photo_id, event_id, photographer_id
    from public.photo_faces where photo_id = any($1::uuid[]) order by face_id
  `, allIndexed ? [] : [ids]);
  const duplicateRows = await pool.query(allIndexed ? `
    select photo_id, face_id, count(*)::int as count from public.photo_faces
    group by photo_id, face_id having count(*) > 1
  ` : `
    select photo_id, face_id, count(*)::int as count from public.photo_faces
    where photo_id = any($1::uuid[]) group by photo_id, face_id having count(*) > 1
  `, allIndexed ? [] : [ids]);
  const duplicateFaceIds = await pool.query(allIndexed ? `
    select face_id, count(*)::int as count from public.photo_faces
    group by face_id having count(*) > 1
  ` : `
    select face_id, count(*)::int as count from public.photo_faces
    where face_id in (select face_id from public.photo_faces where photo_id = any($1::uuid[]))
    group by face_id having count(*) > 1
  `, allIndexed ? [] : [ids]);
  const processing = await pool.query(`select id from public.products where "faceIndexStatus" = 'processing'`);
  const stuck = await pool.query(`select id from public.products where "faceIndexStatus" = 'processing' and "faceProcessingStartedAt" < now() - interval '15 minutes'`);
  const faceCountByPhoto = new Map<string, number>();
  for (const face of faces.rows) faceCountByPhoto.set(face.photo_id, (faceCountByPhoto.get(face.photo_id) || 0) + 1);
  const indexedWithoutFaces = products.rows.filter((row) => row.faceIndexStatus === 'indexed' && !faceCountByPhoto.get(row.id));
  const noFaceWithRows = products.rows.filter((row) => row.faceIndexStatus === 'no_face' && faceCountByPhoto.get(row.id));
  const linkMismatches = faces.rows.filter((face) => {
    const product = products.rows.find((row) => row.id === face.photo_id);
    return !product || face.event_id !== product.eventId || face.photographer_id !== product.vendedorId;
  });

  const selected = new Set(ids);
  const awsFaces: Array<{ faceId: string; externalImageId: string }> = [];
  let nextToken: string | undefined;
  do {
    const page = await rekognition.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 4096, NextToken: nextToken }));
    for (const face of page.Faces || []) {
      if (face.FaceId && face.ExternalImageId && (allIndexed || selected.has(face.ExternalImageId))) awsFaces.push({ faceId: face.FaceId, externalImageId: face.ExternalImageId });
    }
    nextToken = page.NextToken;
  } while (nextToken);
  const awsIds = awsFaces.map((face) => face.faceId);
  const dbIds = faces.rows.map((face) => face.face_id);
  const duplicateAwsFaceIds = [...new Set(awsIds.filter((id, index) => awsIds.indexOf(id) !== index))];
  const awsSet = new Set(awsIds);
  const dbSet = new Set(dbIds);
  const awsOnly = awsIds.filter((id) => !dbSet.has(id));
  const databaseOnly = dbIds.filter((id) => !awsSet.has(id));
  const randomSampleIndexed = products.rows
    .filter((row) => row.faceIndexStatus === 'indexed')
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(20, products.rows.length))
    .map((row) => row.id);

  console.log(JSON.stringify({
    event: allIndexed ? 'backfill:global-audit' : 'backfill:batch-audit', auditedAt: new Date().toISOString(), from, to,
    products: products.rows.length,
    statuses: Object.fromEntries(['indexed', 'no_face', 'failed', 'processing'].map((status) => [status, products.rows.filter((row) => row.faceIndexStatus === status).length])),
    attempts: { min: Math.min(...products.rows.map((row) => row.faceIndexAttempts)), max: Math.max(...products.rows.map((row) => row.faceIndexAttempts)), lingeringRunIds: products.rows.filter((row) => row.faceIndexRunId).length },
    database: {
      faces: dbIds.length,
      duplicateRows: duplicateRows.rows.length,
      duplicateFaceIds: duplicateFaceIds.rows.length,
      indexedWithoutFaces: indexedWithoutFaces.length,
      indexedWithoutFacesSample: indexedWithoutFaces.slice(0, 20).map((row) => row.id),
      noFaceWithRows: noFaceWithRows.length,
      linkMismatches: linkMismatches.length,
      linkMismatchesSample: linkMismatches.slice(0, 20),
    },
    aws: {
      faces: awsIds.length,
      duplicateFaceIds: duplicateAwsFaceIds.length,
      awsOnly: awsOnly.length,
      databaseOnly: databaseOnly.length,
      matchesDatabaseExactly: awsOnly.length === 0 && databaseOnly.length === 0,
    },
    processing: { current: processing.rows, olderThan15Minutes: stuck.rows },
    randomSampleIndexed,
  }, null, 2));
}

main().catch((error) => { console.error(JSON.stringify({ event: 'backfill:batch-audit-fatal', message: error?.message })); process.exitCode = 1; }).finally(() => pool.end());
