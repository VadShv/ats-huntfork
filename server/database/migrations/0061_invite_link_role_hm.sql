-- Sprint 20.5 · расширяем разрешённые роли для invite-link.
--
-- В 0007 был добавлен CHECK (role IN ('admin', 'member')).
-- Теперь через ссылку-приглашение можно выдавать роль hiring_manager
-- (Настройки → Участники), поэтому список расширяем.
--
-- Идемпотентно: сначала дропаем именованный constraint (IF EXISTS),
-- затем добавляем новый с тем же именем.

ALTER TABLE "invite_link" DROP CONSTRAINT IF EXISTS "invite_link_role_check";--> statement-breakpoint
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_role_check" CHECK (role IN ('admin', 'member', 'hiring_manager'));
