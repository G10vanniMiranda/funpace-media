-- Preenche username/slug públicos para fotógrafos existentes.
-- Rode uma vez no SQL Editor do Supabase depois de adicionar:
-- username, slug, isPublic e updatedAt.

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
    coalesce(nullif(trim(p.username), ''), nullif(trim(p.slug), '')) as existing_slug,
    regexp_replace(
      lower(
        translate(
          coalesce(
            nullif(trim(p."displayName"), ''),
            nullif(trim(p.name), ''),
            nullif(trim(p.email), ''),
            p.id::text
          ),
          'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
          'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'
        )
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    ) as raw_slug
  from public.photographers p
  where p.username is null
     or trim(p.username) = ''
     or p.slug is null
     or trim(p.slug) = ''
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
candidates as (
  select
    id,
    left(
      case
        when duplicate_index = 1 then slug_base
        else slug_base || '-' || duplicate_index::text
      end,
      70
    ) as candidate_slug
  from ranked
),
resolved as (
  select
    c.id,
    case
      when exists (
        select 1
        from public.photographers p2
        where p2.id <> c.id
          and (
            lower(p2.username) = lower(c.candidate_slug)
            or lower(p2.slug) = lower(c.candidate_slug)
          )
      )
      then left(c.candidate_slug, 60) || '-' || substr(c.id::text, 1, 8)
      else c.candidate_slug
    end as resolved_slug
  from candidates c
)
update public.photographers p
set
  username = r.resolved_slug,
  slug = r.resolved_slug,
  "isPublic" = coalesce(p."isPublic", true),
  "updatedAt" = now()
from resolved r
where p.id = r.id
returning
  p.id,
  p.username,
  p.slug,
  p."isPublic",
  p."updatedAt";