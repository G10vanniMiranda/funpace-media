-- Preenche username/slug publicos para fotografos existentes.
-- Rode uma vez no SQL Editor do Supabase depois de adicionar as colunas username, slug e isPublic.

with reserved(slug) as (
  values
    ('admin'), ('api'), ('auth'), ('busca'), ('cadastro'), ('carrinho'),
    ('checkout'), ('contato'), ('dashboard'), ('evento'), ('eventos'),
    ('faq'), ('fotografo'), ('login'), ('minha-conta'), ('minhas-compras'),
    ('pagar'), ('pagamento'), ('para-fotografos'), ('perfil'), ('precos'),
    ('privacidade'), ('termos'), ('upload')
),
base as (
  select
    p.id,
    coalesce(nullif(p.username, ''), nullif(p.slug, '')) as existing_slug,
    regexp_replace(
      lower(
        translate(
          coalesce(nullif(p."displayName", ''), nullif(p.name, ''), p.email, p.id),
          'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
          'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'
        )
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    ) as raw_slug
  from public.photographers p
),
normalized as (
  select
    id,
    nullif(trim(both '-' from coalesce(existing_slug, raw_slug)), '') as slug_base
  from base
),
safe_base as (
  select
    n.id,
    case
      when n.slug_base is null then 'fotografo'
      when r.slug is not null then 'fotografo-' || n.slug_base
      else n.slug_base
    end as slug_base
  from normalized n
  left join reserved r on r.slug = n.slug_base
),
ranked as (
  select
    id,
    slug_base,
    row_number() over (partition by slug_base order by id) as duplicate_index
  from safe_base
),
resolved as (
  select
    id,
    left(
      case
        when duplicate_index = 1 then slug_base
        else slug_base || '-' || duplicate_index::text
      end,
      80
    ) as resolved_slug
  from ranked
)
update public.photographers p
set
  username = r.resolved_slug,
  slug = r.resolved_slug,
  "isPublic" = coalesce(p."isPublic", true),
  "updatedAt" = now()
from resolved r
where p.id = r.id
  and (p.username is null or p.username = '' or p.slug is null or p.slug = '');
