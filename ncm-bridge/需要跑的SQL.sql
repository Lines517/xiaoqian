-- ============================================================
--  一起听相关的 SQL（在 Supabase → SQL Editor 里整段粘贴执行）
--  重复执行也没事（都是 if not exists）
-- ============================================================

-- ① 一起听：存小千的态度 + 真歌词
alter table public.cozy_music add column if not exists liked boolean;
alter table public.cozy_music add column if not exists like_reason text;
alter table public.cozy_music add column if not exists lyric text;

-- ② 小千自己点的歌（网页写请求 → 桥轮询去加进它自己的歌单）
create table if not exists public.cozy_music_self (
  id         bigserial primary key,
  keyword    text,
  reason     text,
  song_id    text,
  name       text,
  artist     text,
  status     text default 'pending',
  created_at timestamptz default now()
);
