alter table orders add column if not exists on_behalf boolean not null default false;
alter table orders add column if not exists placed_by_name text not null default '';
alter table orders add column if not exists placed_by_email text not null default '';
