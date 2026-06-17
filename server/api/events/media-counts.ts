import { createPool } from '../../shared/utils.js';

type EventMediaCountRow = {
  eventId: string;
  eventName: string;
  photos: string | number;
  videos: string | number;
  items: string | number;
};

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function handler(_req: any, res: any) {
  const pool = await createPool();

  try {
    const result = await pool.query(`
      select
        e.id as "eventId",
        e.name as "eventName",
        count(distinct p.id) filter (where p.type = 'IMG') as photos,
        count(distinct p.id) filter (where p.type in ('VIDEO', 'VIEW')) as videos,
        count(distinct p.id) as items
      from public.events e
      left join public.products p
        on coalesce(p.status, 'published') = 'published'
       and (
          p."eventId" = e.id
          or (
            p."eventId" is null
            and lower(trim(p.event)) = lower(trim(e.name))
          )
       )
      where coalesce(e."isPublished", true) = true
      group by e.id, e.name
      order by e.date desc nulls last, e."createdAt" desc nulls last
    `);

    const rows = result.rows as EventMediaCountRow[];
    return res.status(200).json({
      counts: rows.map((row) => ({
        eventId: row.eventId,
        eventName: row.eventName,
        photos: toNumber(row.photos),
        videos: toNumber(row.videos),
        items: toNumber(row.items),
      })),
    });
  } catch (error) {
    console.error('[events:media-counts] failed', error);
    return res.status(500).json({ error: 'Não foi possível carregar as contagens dos eventos.' });
  } finally {
    await pool.end();
  }
}
