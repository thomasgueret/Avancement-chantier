-- ============================================================
-- Bucket Supabase Storage pour les images des plans (onglet Suivi)
-- ============================================================
-- À exécuter UNE FOIS dans le dashboard Supabase → SQL Editor.
--
-- Depuis la v1.28, les images des plans ne transitent plus dans la
-- ligne site_data (payload de synchro allégé, plus de quota localStorage).
-- Chaque image est uploadée une seule fois dans ce bucket, puis
-- téléchargée à la demande par les autres appareils.
--
-- Modèle de sécurité identique à site_data : accès anonyme (la clé anon
-- de l'app suffit). Quiconque a le lien de l'app peut lire/écrire.

-- 1) Création du bucket « plans » (public en lecture)
insert into storage.buckets (id, name, public)
values ('plans', 'plans', true)
on conflict (id) do nothing;

-- 2) Politiques d'accès pour le rôle anon sur ce bucket
create policy "plans anon select"
  on storage.objects for select
  using (bucket_id = 'plans');

create policy "plans anon insert"
  on storage.objects for insert
  with check (bucket_id = 'plans');

create policy "plans anon update"
  on storage.objects for update
  using (bucket_id = 'plans');

create policy "plans anon delete"
  on storage.objects for delete
  using (bucket_id = 'plans');
