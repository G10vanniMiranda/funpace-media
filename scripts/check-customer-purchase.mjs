import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const search = process.argv.slice(2).join(" ").trim();

if (!search) {
  console.error("Uso: node scripts/check-customer-purchase.mjs <nome-ou-email>");
  process.exit(1);
}

function maskEmail(value) {
  const email = String(value || "");
  const [local, domain] = email.split("@");
  if (!local || !domain) return email || null;
  return `${local.slice(0, 2)}***@${domain}`;
}

function dbConfigFromEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
      host: process.env.HOST || process.env.DB_HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DATABASE || "postgres",
      user: process.env.DB_USER || process.env.USER || "postgres",
      password: process.env.POSTGRES || process.env.RAILS_MASTER_KEY,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    };
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const pool = new pg.Pool(dbConfigFromEnv());

try {
  const normalized = normalizeSearch(search);
  const like = `%${normalized.replace(/[%_]/g, "\\$&")}%`;

  const authUsers = await pool.query(`
    select
      id,
      email,
      raw_user_meta_data ->> 'name' as name,
      raw_user_meta_data ->> 'full_name' as full_name,
      raw_user_meta_data ->> 'display_name' as display_name,
      created_at,
      last_sign_in_at
    from auth.users
    where
      lower(coalesce(email, '')) like $1
      or lower(coalesce(raw_user_meta_data ->> 'name', '')) like $1
      or lower(coalesce(raw_user_meta_data ->> 'full_name', '')) like $1
      or lower(coalesce(raw_user_meta_data ->> 'display_name', '')) like $1
    order by created_at desc
    limit 20
  `, [like]);

  const customers = await pool.query(`
    select id, email, name, "createdAt", "updatedAt"
    from public.customers
    where
      lower(coalesce(email, '')) like $1
      or lower(coalesce(name, '')) like $1
    order by "createdAt" desc
    limit 20
  `, [like]);

  const ordersByName = await pool.query(`
    select
      id,
      "userId",
      "buyerName",
      "buyerEmail",
      status,
      total,
      "paymentProvider",
      "paymentMethod",
      "paymentExternalId",
      "checkoutUrl",
      "createdAt",
      "updatedAt"
    from public.orders
    where
      lower(coalesce("buyerEmail", '')) like $1
      or lower(coalesce("buyerName", '')) like $1
    order by "createdAt" desc
    limit 50
  `, [like]);

  const userIds = new Set([
    ...authUsers.rows.map((row) => row.id),
    ...customers.rows.map((row) => row.id),
    ...ordersByName.rows.map((row) => row.userId).filter(Boolean),
  ]);
  const emails = new Set([
    ...authUsers.rows.map((row) => row.email).filter(Boolean),
    ...customers.rows.map((row) => row.email).filter(Boolean),
    ...ordersByName.rows.map((row) => row.buyerEmail).filter(Boolean),
  ].map((email) => String(email).toLowerCase()));

  let orders = ordersByName.rows;
  if (userIds.size || emails.size) {
    const related = await pool.query(`
      select
        id,
        "userId",
        "buyerName",
        "buyerEmail",
        status,
        total,
        "paymentProvider",
        "paymentMethod",
        "paymentExternalId",
        "checkoutUrl",
        "createdAt",
        "updatedAt"
      from public.orders
      where
        ($1::text[] = '{}' or "userId" = any($1::text[]))
        or ($2::text[] = '{}' or lower("buyerEmail") = any($2::text[]))
      order by "createdAt" desc
      limit 100
    `, [[...userIds], [...emails]]);

    const byId = new Map(orders.map((order) => [order.id, order]));
    for (const order of related.rows) byId.set(order.id, order);
    orders = [...byId.values()].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  }

  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length
    ? await pool.query(`
      select id, "orderId", "productId", name, type, price, "vendedorId", bib, event, "createdAt"
      from public.order_items
      where "orderId" = any($1::uuid[])
      order by "createdAt" asc
    `, [orderIds])
    : { rows: [] };

  const payments = orderIds.length
    ? await pool.query(`
      select id, "orderId", provider, "providerPaymentId", status, method, "rawResponse", "createdAt", "updatedAt"
      from public.payments
      where "orderId" = any($1::uuid[])
      order by "createdAt" desc
    `, [orderIds])
    : { rows: [] };

  const access = orderIds.length
    ? await pool.query(`
      select id, "orderId", "photoId", "orderItemId", "userId", "customerEmail", "isActive", "expiresAt", "createdAt"
      from public.download_access
      where "orderId" = any($1::uuid[])
      order by "createdAt" desc
    `, [orderIds])
    : { rows: [] };

  const downloads = orderIds.length
    ? await pool.query(`
      select id, "orderId", "photoId", "userId", "downloadedAt"
      from public.downloads
      where "orderId" = any($1::uuid[])
      order by "downloadedAt" desc
    `, [orderIds])
    : { rows: [] };

  const orderTimes = orders
    .flatMap((order) => [order.createdAt, order.updatedAt])
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const paymentEventsAroundOrder = orderTimes.length
    ? await pool.query(`
      select id, provider, "eventId", "orderId", status, payload, "createdAt"
      from public.payment_events
      where "createdAt" between to_timestamp($1 / 1000.0) and to_timestamp($2 / 1000.0)
      order by "createdAt" desc
      limit 50
    `, [Math.min(...orderTimes) - 60 * 60 * 1000, Math.max(...orderTimes) + 24 * 60 * 60 * 1000])
    : { rows: [] };

  const itemsByOrder = Map.groupBy(items.rows, (row) => row.orderId);
  const paymentsByOrder = Map.groupBy(payments.rows, (row) => row.orderId);
  const accessByOrder = Map.groupBy(access.rows, (row) => row.orderId);
  const downloadsByOrder = Map.groupBy(downloads.rows, (row) => row.orderId);

  console.log(JSON.stringify({
    search,
    matches: {
      authUsers: authUsers.rows.map((row) => ({
        ...row,
        email: maskEmail(row.email),
      })),
      customers: customers.rows.map((row) => ({
        ...row,
        email: maskEmail(row.email),
      })),
    },
    orders: orders.map((order) => ({
      ...order,
      buyerEmail: maskEmail(order.buyerEmail),
      checkoutUrl: order.checkoutUrl ? "present" : null,
      paymentExternalId: order.paymentExternalId ? "present" : null,
      itemCount: itemsByOrder.get(order.id)?.length ?? 0,
      paymentRows: paymentsByOrder.get(order.id)?.map((payment) => ({
        ...payment,
        providerPaymentId: payment.providerPaymentId ? "present" : null,
      })) ?? [],
      downloadAccessCount: accessByOrder.get(order.id)?.length ?? 0,
      activeDownloadAccessCount: accessByOrder.get(order.id)?.filter((row) => row.isActive).length ?? 0,
      downloadCount: downloadsByOrder.get(order.id)?.length ?? 0,
      items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        type: item.type,
        price: item.price,
        event: item.event,
        bib: item.bib,
      })),
    })),
    paymentEventsAroundOrder: paymentEventsAroundOrder.rows.map((event) => ({
      id: event.id,
      provider: event.provider,
      eventId: event.eventId ? "present" : null,
      orderId: event.orderId,
      status: event.status,
      createdAt: event.createdAt,
      payloadKeys: event.payload ? Object.keys(event.payload) : [],
    })),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: {
      name: error.name,
      code: error.code,
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end();
}
