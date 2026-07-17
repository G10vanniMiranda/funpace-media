import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
try {
  const [latest, categories, severities, review, audit, alerts, unfinished] = await Promise.all([
    pool.query(`select id,mode,status,summary,started_at,completed_at,error from public.integrity_runs order by started_at desc limit 5`),
    pool.query(`select category,status,count(*)::int count from public.integrity_findings group by category,status order by count desc,category`),
    pool.query(`select severity,status,count(*)::int count from public.integrity_findings group by severity,status order by severity,status`),
    pool.query(`select status,count(*)::int count from public.integrity_review_queue group by status order by status`),
    pool.query(`select count(*)::int count from public.integrity_audit_logs`),
    pool.query(`select metric_name,severity,status,count(*)::int count from public.integrity_alerts group by metric_name,severity,status order by metric_name`),
    pool.query(`select count(*)::int count from public.integrity_runs where status='running'`),
  ]);
  console.log(JSON.stringify({ latestRuns: latest.rows, findingsByCategory: categories.rows, findingsBySeverity: severities.rows, reviewQueue: review.rows, functionalCorrectionsLogged: audit.rows[0].count, alerts: alerts.rows, unfinishedRuns: unfinished.rows[0].count }, null, 2));
} finally {
  await pool.end();
}
