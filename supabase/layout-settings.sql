alter table restaurants
  add column if not exists menu_layout text default 'grid'
  check (menu_layout in ('grid', 'list'));
