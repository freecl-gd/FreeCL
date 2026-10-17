-- 자기소개를 120자로 제한한다. 프로필 헤더가 데스크톱 한 줄, 모바일 두 줄에 담기는 길이.
-- 실행 시점에 120자를 넘는 행은 이미 잘라 두었지만, 다시 실행해도 안전하도록 update를 남긴다.
update public.profiles set bio = left(bio, 120) where char_length(bio) > 120;

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length check (char_length(bio) <= 120);
