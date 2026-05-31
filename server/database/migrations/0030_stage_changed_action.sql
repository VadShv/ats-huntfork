-- Migration 0030: Add stage_changed to activity_action enum (Stage B5)
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'stage_changed';
