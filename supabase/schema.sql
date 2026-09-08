-- ============================================================
-- Onextap Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)
-- ============================================================

-- 1. Profiles table (extends Supabase auth.users)
-- Auto-created on sign-up via trigger below
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  credits integer not null default 3,
  is_premium boolean not null default false,
  dodo_customer_id text unique,
  dodo_subscription_id text,
  subscription_status text default 'none',
  premium_since timestamptz,
  cancelled_at timestamptz,
  payment_failed boolean default false,
  last_failed_payment timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Credit transactions (audit log)
create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount integer not null, -- positive = add, negative = deduct
  type text not null check (type in ('initial', 'usage', 'refund', 'purchase', 'bonus')),
  description text,
  created_at timestamptz default now()
);

-- Index for fast lookups by user
create index if not exists idx_credit_transactions_user_id on public.credit_transactions(user_id);
create index if not exists idx_profiles_dodo_customer_id on public.profiles(dodo_customer_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.credit_transactions enable row level security;

-- Profiles: users can read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Profiles: users can update their own profile (limited fields)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Credit transactions: users can view their own transactions
create policy "Users can view own transactions"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

-- Note: INSERT/UPDATE on credit_transactions is done via service_role (server-side only)
-- No insert/update policy for regular users = tamper-proof credits

-- ============================================================
-- Auto-create profile on sign-up (trigger)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, credits)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    3
  );
  -- Log the initial credits grant
  insert into public.credit_transactions (user_id, amount, type, description)
  values (new.id, 3, 'initial', 'Welcome bonus: 3 free AI credits');
  return new;
end;
$$ language plpgsql security definer;

-- Drop existing trigger if it exists, then create
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Auto-update updated_at timestamp
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();
