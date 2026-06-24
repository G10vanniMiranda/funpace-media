import 'dotenv/config';
import pg from 'pg';
import {
  DescribeCollectionCommand,
  ListFacesCommand,
  RekognitionClient,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';

const eventId = process.argv[2] || '';
if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
  console.error('Usage: node scripts/audit-face-search-readonly.mjs <event-id>');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = [eventId]) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function getAwsStats() {
  const region = process.env.AWS_REGION;
  const collectionId = process.env.AWS_REKOGNITION_COLLECTION;
  if (!region || !collectionId) return { configured: false };

  const client = new RekognitionClient({ region });
  const described = await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
  let nextToken;
  let scannedFaces = 0;
  let eventExternalImageMatches = 0;
  const sampleExternalImageIds = [];

  do {
    const page = await client.send(new ListFacesCommand({
      CollectionId: collectionId,
      MaxResults: 1000,
      NextToken: nextToken,
    }));
    for (const face of page.Faces || []) {
      scannedFaces += 1;
      if (face.ExternalImageId && sampleExternalImageIds.length < 20) {
        sampleExternalImageIds.push(face.ExternalImageId);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  const dbPhotoIds = await query('select id from public.products where "eventId" = $1 and type = $2', [eventId, 'IMG']);
  const dbPhotoIdSet = new Set(dbPhotoIds.map((row) => row.id));

  do {
    const page = await client.send(new ListFacesCommand({
      CollectionId: collectionId,
      MaxResults: 1000,
      NextToken: nextToken,
    }));
    for (const face of page.Faces || []) {
      if (dbPhotoIdSet.has(face.ExternalImageId)) eventExternalImageMatches += 1;
    }
    nextToken = page.NextToken;
  } while (nextToken);

  return {
    configured: true,
    collectionId,
    region,
    faceCount: described.FaceCount,
    faceModelVersion: described.FaceModelVersion,
    scannedFaces,
    eventExternalImageMatches,
    sampleExternalImageIds,
  };
}

async function getThresholdProbe() {
  const region = process.env.AWS_REGION;
  const collectionId = process.env.AWS_REKOGNITION_COLLECTION;
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!region || !collectionId || !bucket) return { configured: false };

  const top = await query(`
    select photo_id, count(*)::int as faces
    from public.photo_faces
    where event_id = $1
    group by photo_id
    order by count(*) desc
    limit 1
  `);
  if (!top[0]?.photo_id) return { configured: true, skipped: 'No indexed event photo available.' };

  const faceRows = await query('select face_id, photo_id from public.photo_faces where event_id = $1');
  const photoByFaceId = new Map(faceRows.map((row) => [row.face_id, row.photo_id]));
  const client = new RekognitionClient({ region });
  const thresholds = [];

  for (const threshold of [90, 85, 80, 75]) {
    const result = await client.send(new SearchFacesByImageCommand({
      CollectionId: collectionId,
      Image: {
        S3Object: {
          Bucket: bucket,
          Name: `face-index/events/${eventId}/photos/${top[0].photo_id}`,
        },
      },
      FaceMatchThreshold: threshold,
      MaxFaces: 1000,
    }));
    const rawMatches = (result.FaceMatches || []).map((match) => ({
      faceId: match.Face?.FaceId || '',
      similarity: match.Similarity || 0,
    }));
    const eventMatches = rawMatches.filter((match) => photoByFaceId.has(match.faceId));
    const eventPhotos = new Set(eventMatches.map((match) => photoByFaceId.get(match.faceId)));
    thresholds.push({
      threshold,
      rawMatches: rawMatches.length,
      eventFaceMatches: eventMatches.length,
      eventPhotoMatches: eventPhotos.size,
      topEventScores: eventMatches.slice(0, 20).map((match) => Number(match.similarity.toFixed(2))),
    });
  }

  return {
    configured: true,
    queryPhotoId: top[0].photo_id,
    queryPhotoFaceCount: top[0].faces,
    thresholds,
  };
}

try {
  const output = {
    auditedAt: new Date().toISOString(),
    eventId,
    env: {
      faceSimilarityThreshold: Number(process.env.FACE_SIMILARITY_THRESHOLD || 90),
      maxCandidates: Number(process.env.FACE_SEARCH_MAX_CANDIDATES || 1000),
      maxUploadBytes: Number(process.env.FACE_SEARCH_MAX_UPLOAD_BYTES || 8 * 1024 * 1024),
      awsRegion: process.env.AWS_REGION || null,
      awsBucketConfigured: Boolean(process.env.AWS_BUCKET_NAME),
      rekognitionCollectionConfigured: Boolean(process.env.AWS_REKOGNITION_COLLECTION),
    },
    event: await query('select id, name, date, "photographerId", "isPublished", slug from public.events where id = $1'),
    totals: await query(`
      select
        count(*)::int as total_products,
        count(*) filter (where type = 'IMG')::int as total_imgs,
        count(*) filter (where type = 'IMG' and status = 'published')::int as published_imgs,
        count(*) filter (where type = 'IMG' and status = 'published' and "faceIndexStatus" = 'indexed')::int as indexed_published_imgs,
        count(*) filter (where type = 'IMG' and status = 'published' and "faceIndexStatus" = 'no_face')::int as no_face_published_imgs,
        count(*) filter (where type = 'IMG' and status = 'published' and "faceIndexStatus" = 'failed')::int as failed_published_imgs,
        count(*) filter (where type = 'IMG' and status = 'published' and "faceIndexStatus" = 'pending')::int as pending_published_imgs,
        count(*) filter (where type = 'IMG' and status = 'published' and "faceIndexStatus" = 'processing')::int as processing_published_imgs
      from public.products
      where "eventId" = $1
    `),
    productStatus: await query(`
      select status, type, "faceIndexStatus", count(*)::int as count
      from public.products
      where "eventId" = $1
      group by 1, 2, 3
      order by 1, 2, 3
    `),
    faceRows: await query(`
      select
        count(*)::int as face_rows,
        count(distinct photo_id)::int as photos_with_faces,
        count(distinct face_id)::int as distinct_faces,
        count(*) filter (where confidence is null)::int as null_confidence
      from public.photo_faces
      where event_id = $1
    `),
    missingFaceRowsForIndexedPhotos: await query(`
      select p.id, p.name, p."faceIndexStatus", p."faceIndexedAt"
      from public.products p
      where p."eventId" = $1
        and p.type = 'IMG'
        and p.status = 'published'
        and p."faceIndexStatus" = 'indexed'
        and not exists (select 1 from public.photo_faces f where f.photo_id = p.id)
      order by p."createdAt" desc
      limit 100
    `),
    pendingOrFailedSamples: await query(`
      select id, name, status, type, "faceIndexStatus", "faceIndexError", "storagePath", url, "createdAt"
      from public.products
      where "eventId" = $1
        and type = 'IMG'
        and status = 'published'
        and "faceIndexStatus" <> 'indexed'
      order by "createdAt" desc
      limit 100
    `),
    integrity: {
      faceRowsPointingToWrongEvent: await query(`
        select count(*)::int as count
        from public.photo_faces f
        join public.products p on p.id = f.photo_id
        where f.event_id = $1 and p."eventId" is distinct from f.event_id
      `),
      productsWithWrongPhotographer: await query(`
        select count(*)::int as count
        from public.products p
        join public.events e on e.id = p."eventId"
        where p."eventId" = $1 and p."vendedorId" is distinct from e."photographerId"
      `),
      publishedImagesWithoutPath: await query(`
        select count(*)::int as count
        from public.products
        where "eventId" = $1
          and type = 'IMG'
          and status = 'published'
          and coalesce("storagePath", url, '') = ''
      `),
      duplicateImageIds: await query(`
        select image_id, count(*)::int as count
        from public.photo_faces
        where event_id = $1 and image_id is not null
        group by image_id
        having count(*) > 1
        order by count desc
        limit 50
      `),
      duplicatePhotoFaceRows: await query(`
        select photo_id, face_id, count(*)::int as count
        from public.photo_faces
        where event_id = $1
        group by photo_id, face_id
        having count(*) > 1
        limit 50
      `),
    },
    aws: await getAwsStats(),
    thresholdProbe: await getThresholdProbe(),
  };

  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
