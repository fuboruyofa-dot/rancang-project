-- =====================================================================
--  MIGRASI V2  (jalankan SETELAH project_management_schema.sql)
--  Supabase Dashboard > SQL Editor > paste semua > Run
--
--  Isi:
--   1. Status dokumen desain "revision" (menggantikan tolak)
--   2. Dokumen kajian tambahan di Studi (feasibility study, pilot project, dll)
--   3. Lampiran gambar/file generik (pengerjaan, trial, sistem, kajian)
--   4. Timeline: kelompok kegiatan + tanggal aktual (untuk S-Curve)
--   5. Kategori technical design dinamis (bisa tambah kategori sendiri)
--   6. RAB multi sistem (Sistem A/B/C) + komponen per kategori
--      -> RAB, komparasi sistem, dan pelacakan pembelian memakai 1 sumber data
--   7. Pengaturan template proposal (kop, footer, logo)
-- =====================================================================

-- 1. ---------------------------------------------------------------
alter type approval_status add value if not exists 'revision';

-- 2. & 3. ----------------------------------------------------------
create table if not exists public.study_documents (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null,
  doc_type   text not null default 'Lainnya',   -- Feasibility Study, Pilot Project Area, Benchmark, dst
  content    text,
  sort_order int not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_sdocs_updated before update on public.study_documents
  for each row execute function public.set_updated_at();

create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_type text not null,     -- study_doc | work_item | work_review | trial | system | design_doc
  owner_id   uuid not null,
  file_path  text not null,     -- path di bucket project-files
  file_name  text,
  mime       text,
  caption    text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_att_owner on public.attachments(project_id, owner_type, owner_id);

-- 4. ---------------------------------------------------------------
alter table public.study_timeline_tasks
  add column if not exists group_name   text,
  add column if not exists actual_start date,
  add column if not exists actual_end   date;

-- 5. ---------------------------------------------------------------
create table if not exists public.design_categories (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

alter table public.design_documents alter column category type text using category::text;
update public.design_documents set category = case category
  when 'mechanical'          then 'Mechanical Design'
  when 'electrical_wiring'   then 'Electrical Wiring Design'
  when 'flow_system'         then 'Flow Diagram System'
  when 'flow_operational'    then 'Flow Diagram Operational'
  when 'flow_software'       then 'Flow Diagram Software'
  when 'database_structure'  then 'Struktur Database'
  else category end;

-- kategori bawaan untuk project yang sudah ada
insert into public.design_categories(project_id, name, sort_order, is_default)
select p.id, c.name, c.ord, true
from public.projects p
cross join (values ('Mechanical Design',0),('Electrical Wiring Design',1),('Flow Diagram System',2),
                   ('Flow Diagram Operational',3),('Flow Diagram Software',4),('Struktur Database',5)) as c(name, ord)
on conflict (project_id, name) do nothing;

-- kategori custom yang mungkin sudah dipakai dokumen
insert into public.design_categories(project_id, name, sort_order)
select distinct d.project_id, d.category, 100 from public.design_documents d
on conflict (project_id, name) do nothing;

-- 6. ---------------------------------------------------------------
create table if not exists public.rab_systems (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,                 -- Sistem A / Model B / ...
  description text,
  pros        text,                          -- kelebihan
  cons        text,                          -- kekurangan
  is_selected boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.rab_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  category      text not null default 'Umum',  -- kelompok: nama kategori desain / Instrument Pneumatic / dst
  item_name     text not null,
  spec          text,
  unit          text,
  unit_price    numeric not null default 0 check (unit_price >= 0),
  sort_order    int not null default 0,
  -- pelacakan pembelian
  vendor_id     uuid references public.vendors(id) on delete set null,
  status        purchase_status not null default 'planned',
  ordered_date  date,
  expected_date date,
  arrived_date  date,
  arrived_notes text,
  received_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rab_items_project on public.rab_items(project_id, category, sort_order);

create table if not exists public.rab_quantities (
  item_id    uuid not null references public.rab_items(id) on delete cascade,
  system_id  uuid not null references public.rab_systems(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  qty        numeric not null default 0 check (qty >= 0),
  primary key (item_id, system_id)
);

-- pindahkan data purchase_items lama ke RAB (1 sistem: "Sistem Utama")
do $$
declare p record; i record; sid uuid; iid uuid;
begin
  for p in select distinct project_id from public.purchase_items loop
    if exists (select 1 from public.rab_systems where project_id = p.project_id) then continue; end if;
    insert into public.rab_systems(project_id, name, is_selected) values (p.project_id, 'Sistem Utama', true) returning id into sid;
    for i in select * from public.purchase_items where project_id = p.project_id order by sort_order, created_at loop
      insert into public.rab_items(project_id, category, item_name, spec, unit, unit_price, vendor_id, status,
                                   ordered_date, expected_date, arrived_date, arrived_notes, received_by, sort_order)
      values (i.project_id, 'Umum', i.item_name, i.spec, i.unit, i.unit_price, i.vendor_id, i.status,
              i.ordered_date, i.expected_date, i.arrived_date, i.arrived_notes, i.received_by, i.sort_order)
      returning id into iid;
      insert into public.rab_quantities(item_id, system_id, project_id, qty) values (iid, sid, i.project_id, i.qty);
    end loop;
  end loop;
end $$;

-- project baru: seed 6 kategori bawaan
create or replace function public.init_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_stages(project_id, stage, weight) values
    (new.id,'study',15), (new.id,'technical_design',15), (new.id,'purchasing',15),
    (new.id,'execution',35), (new.id,'trial',20);
  insert into public.project_studies(project_id)   values (new.id);
  insert into public.technical_designs(project_id) values (new.id);
  insert into public.design_categories(project_id, name, sort_order, is_default) values
    (new.id,'Mechanical Design',0,true), (new.id,'Electrical Wiring Design',1,true), (new.id,'Flow Diagram System',2,true),
    (new.id,'Flow Diagram Operational',3,true), (new.id,'Flow Diagram Software',4,true), (new.id,'Struktur Database',5,true);
  if new.owner_id is not null then
    insert into public.project_members(project_id, user_id, role) values (new.id, new.owner_id, 'Project Owner') on conflict do nothing;
  end if;
  return new;
end $$;

-- progress tahap: Technical Design = kategori yang sudah punya dokumen approved
--                 Purchasing      = komponen (di sistem terpilih) yang sudah sampai
create or replace function public.refresh_stage_progress(p_project uuid, p_stage stage_key)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric := 0; has_sel boolean;
begin
  if p_stage = 'study' then
    select coalesce(sum(weight*progress)/nullif(sum(weight),0),0) into v
    from public.study_timeline_tasks where project_id = p_project;

  elsif p_stage = 'technical_design' then
    select coalesce(100.0 * count(*) filter (where exists (
             select 1 from public.design_documents d
             where d.project_id = p_project and d.category = c.name and d.status = 'approved'))
           / nullif(count(*),0), 0) into v
    from public.design_categories c where c.project_id = p_project;

  elsif p_stage = 'purchasing' then
    select exists (select 1 from public.rab_systems where project_id = p_project and is_selected) into has_sel;
    select coalesce(100.0 * count(*) filter (where i.status = 'arrived')
                    / nullif(count(*) filter (where i.status <> 'cancelled'),0), 0) into v
    from public.rab_items i
    where i.project_id = p_project and exists (
      select 1 from public.rab_quantities q join public.rab_systems s on s.id = q.system_id
      where q.item_id = i.id and q.qty > 0 and (s.is_selected or not has_sel));

  elsif p_stage = 'execution' then
    select coalesce(avg(progress),0) into v from public.work_items where project_id = p_project;

  elsif p_stage = 'trial' then
    select coalesce(100.0*count(*) filter (where result='pass')/nullif(count(*),0),0) into v
    from public.trial_results
    where trial_id = (select id from public.trials where project_id = p_project order by trial_no desc limit 1);
  end if;

  update public.project_stages
     set progress = round(v,2),
         status = (case when v >= 100 then 'done' when v > 0 then 'in_progress' else 'not_started' end)::stage_status
   where project_id = p_project and stage = p_stage;
end $$;

drop trigger if exists trg_stage_purch on public.purchase_items;      -- tabel lama tidak dipakai lagi
create trigger trg_stage_rab_items  after insert or update or delete on public.rab_items
  for each row execute function public.trg_refresh_stage('purchasing');
create trigger trg_stage_rab_qty    after insert or update or delete on public.rab_quantities
  for each row execute function public.trg_refresh_stage('purchasing');
create trigger trg_stage_rab_sys    after insert or update or delete on public.rab_systems
  for each row execute function public.trg_refresh_stage('purchasing');
create trigger trg_stage_categories after insert or update or delete on public.design_categories
  for each row execute function public.trg_refresh_stage('technical_design');

-- hitung ulang progress dua tahap ini untuk semua project
do $$ declare p record; begin
  for p in select id from public.projects loop
    perform public.refresh_stage_progress(p.id, 'technical_design');
    perform public.refresh_stage_progress(p.id, 'purchasing');
  end loop; end $$;

-- view ringkasan sistem (total otomatis dari RAB)
create or replace view public.v_rab_systems with (security_invoker = true) as
select s.id, s.project_id, s.name, s.is_selected,
       coalesce(sum(q.qty * i.unit_price) filter (where i.status <> 'cancelled'), 0) as total,
       count(*) filter (where q.qty > 0 and i.status <> 'cancelled') as item_count
from public.rab_systems s
left join public.rab_quantities q on q.system_id = s.id
left join public.rab_items i on i.id = q.item_id
group by s.id;

create or replace view public.v_budget_summary with (security_invoker = true) as
select p.id as project_id,
       coalesce((select count(*) from public.rab_items i where i.project_id = p.id and i.status <> 'cancelled'),0) as total_items,
       coalesce((select count(*) from public.rab_items i where i.project_id = p.id and i.status = 'arrived'),0)    as arrived_items,
       coalesce((select total from public.v_rab_systems v where v.project_id = p.id and v.is_selected limit 1),
                (select max(total) from public.v_rab_systems v where v.project_id = p.id), 0)                     as total_budget,
       0::numeric as arrived_value
from public.projects p;

create or replace view public.v_project_dashboard with (security_invoker = true) as
select p.id, p.project_no, p.name, p.status, p.priority, p.priority_rank, p.visibility,
       p.progress, p.start_date, p.end_date,
       (p.end_date - current_date) as days_left,
       (p.end_date < current_date and p.status not in ('completed','cancelled')) as is_overdue,
       d.name as department, o.full_name as owner_name,
       (select jsonb_object_agg(s.stage, jsonb_build_object('progress',s.progress,'status',s.status))
          from public.project_stages s where s.project_id = p.id) as stages,
       (select count(*) from public.daily_todos t where t.project_id=p.id and t.todo_date=current_date and t.status<>'done') as todo_open_today,
       coalesce((select total from public.v_rab_systems v where v.project_id = p.id and v.is_selected limit 1),
                (select max(total) from public.v_rab_systems v where v.project_id = p.id), 0) as total_budget
from public.projects p
left join public.departments d on d.id = p.department_id
left join public.profiles o on o.id = p.owner_id;

-- 7. ---------------------------------------------------------------
alter table public.proposal_templates add column if not exists settings jsonb not null default '{}';
update public.proposal_templates
   set settings = jsonb_build_object(
         'company', 'PT. Fuboru Indonesia',
         'tagline', 'Produsen Suku cadang otomotif dan mesin statis',
         'doc_title', 'PROJECT PLAN DOCUMENT',
         'footer', 'Dokumen internal')
 where settings = '{}'::jsonb;

-- RLS tabel baru ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['study_documents','attachments','design_categories','rab_systems','rab_items','rab_quantities']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.can_read_project(project_id))', t);
    execute format('create policy %1$s_ins  on public.%1$I for insert to authenticated with check (public.can_write_project(project_id))', t);
    execute format('create policy %1$s_upd  on public.%1$I for update to authenticated using (public.can_write_project(project_id)) with check (public.can_write_project(project_id))', t);
    execute format('create policy %1$s_del  on public.%1$I for delete to authenticated using (public.can_write_project(project_id))', t);
  end loop;
end $$;
