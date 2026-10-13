alter table restaurants
  add column if not exists social_links jsonb default '[]'::jsonb,
  add column if not exists phone_country_code text default '+49',
  add column if not exists phone_number text;
