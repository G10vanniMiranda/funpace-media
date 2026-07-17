import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

async function expectRejected(name, task, expectedPattern) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await task(client);
    await client.query('rollback');
    return { name, passed: false, reason: 'operation_unexpectedly_allowed' };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    const message = String(error?.message || '');
    return { name, passed: expectedPattern.test(message), code: error?.code || null, reason: expectedPattern.test(message) ? 'rejected_as_expected' : 'unexpected_error' };
  } finally {
    client.release();
  }
}

try {
  const triggers = (await pool.query(`select distinct trigger_name,event_object_table from information_schema.triggers where trigger_schema='public' and trigger_name in ('products_face_integrity_guard','photo_faces_integrity_guard','photo_faces_delete_integrity_guard') order by trigger_name`)).rows;
  const candidate = (await pool.query(`select p.id,p."eventId",p."vendedorId",f.face_id from public.products p join public.photo_faces f on f.photo_id=p.id where p."faceIndexStatus"='indexed' and p."eventId"=f.event_id and p."vendedorId"=f.photographer_id order by p."createdAt" desc limit 1`)).rows[0];
  if (!candidate) throw new Error('Nenhuma foto indexed consistente disponível para validar os guards.');

  const checks = [
    await expectRejected('indexed_face_delete', (client) => client.query('delete from public.photo_faces where face_id=$1', [candidate.face_id]), /cannot_remove_face_from_indexed_photo/),
    await expectRejected('face_event_mismatch', (client) => client.query(`insert into public.photo_faces(face_id,event_id,photo_id,external_image_id,photographer_id) values($1,gen_random_uuid(),$2::uuid,$2::uuid::text,$3::text)`, [`phase5-canary-${Date.now()}`, candidate.id, candidate.vendedorId]), /face_event_mismatch|foreign key/),
    await expectRejected('product_event_invalid', (client) => client.query(`update public.products set "eventId"=gen_random_uuid() where id=$1`, [candidate.id]), /event_invalid|foreign key/),
    await expectRejected('duplicate_face_id', (client) => client.query(`insert into public.photo_faces(face_id,event_id,photo_id,external_image_id,photographer_id) values($1,$2::uuid,$3::uuid,$3::uuid::text,$4::text)`, [candidate.face_id, candidate.eventId, candidate.id, candidate.vendedorId]), /duplicate key|unique constraint/),
  ];

  console.log(JSON.stringify({ triggers, checks, allPassed: triggers.length === 3 && checks.every((check) => check.passed), persistentChanges: 0 }, null, 2));
  if (triggers.length !== 3 || checks.some((check) => !check.passed)) process.exitCode = 1;
} finally {
  await pool.end();
}
