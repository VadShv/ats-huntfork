-- New columns on application_comment: pin support
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "pinned_by_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_comment" ADD CONSTRAINT "application_comment_pinned_by_id_user_id_fk" FOREIGN KEY ("pinned_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint

-- Message templates
CREATE TABLE IF NOT EXISTS "message_template" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"organization_id" text NOT NULL,
	"key" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_template" ADD CONSTRAINT "message_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_template" ADD CONSTRAINT "message_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_template_org" ON "message_template" ("organization_id");--> statement-breakpoint

-- Thread read state
CREATE TABLE IF NOT EXISTS "thread_read_state" (
	"application_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_comment_id" text,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_read_state" ADD CONSTRAINT "thread_read_state_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_read_state" ADD CONSTRAINT "thread_read_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_thread_read_state" ON "thread_read_state" ("application_id","user_id");--> statement-breakpoint

-- Comment polls
CREATE TABLE IF NOT EXISTS "comment_poll" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"comment_id" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_poll" ADD CONSTRAINT "comment_poll_comment_id_application_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "application_comment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_poll_comment" ON "comment_poll" ("comment_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "comment_poll_vote" (
	"poll_id" text NOT NULL,
	"user_id" text NOT NULL,
	"option_key" text NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_poll_vote" ADD CONSTRAINT "comment_poll_vote_poll_id_comment_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "comment_poll"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_poll_vote" ADD CONSTRAINT "comment_poll_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comment_poll_vote" ON "comment_poll_vote" ("poll_id","user_id");
